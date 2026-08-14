/**
 * useSpotifyWpsPlayer — 把 spotify-wps 包装成 React hook。
 *
 * 行为：
 *  - 懒初始化：首次有 Premium spotify session 时调 connect；后续 OAuth
 *    状态变化（logout / Free / 非 Premium）会断连。
 *  - token 续期：监听 expiresAt，提前 60s 重拉 + connect(newToken)。
 *  - 状态镜像：把 WPS 的 player_state_changed 镜像到本 hook 的 state，
 *    usePlayer 拿这套 state 同步 UI。
 *
 * 这是 v2 的 Premium-only 播放路径；Free 账户 / 离线时返回的 wpsReady
 * 始终是 false，调用方应当回退到 30s 预览路径。
 */
import { useEffect, useRef, useState } from 'react';
import { getSpotifyToken } from '../api';
import { createWpsWrapper, type WpsWrapper, type WpsPlayerState } from '../lib/spotify-wps';
import { wpsLog, wpsWarn, wpsError, wpsDebugBanner } from '../lib/debug';

/**
 * 探测 EME/Widevine 是否对 renderer 可用。WPS SDK 播放时内部调
 * `navigator.requestMediaKeySystemAccess('com.widevine.alpha', ...)`，
 * 不可用（CDM 没暴露 / session 权限）→ 播放必报 playback_error。
 */
async function probeEmeWidevine(): Promise<void> {
  const nav = navigator as Navigator & {
    requestMediaKeySystemAccess?: (
      keySystem: string,
      config: unknown[],
    ) => Promise<unknown>;
  };
  if (typeof nav.requestMediaKeySystemAccess !== 'function') {
    wpsError('eme', 'navigator.requestMediaKeySystemAccess 不存在 → EME 不可用，WPS 播放必失败');
    return;
  }
  try {
    const access = await nav.requestMediaKeySystemAccess('com.widevine.alpha', [
      {
        initDataTypes: ['cenc'],
        audioCapabilities: [{ contentType: 'audio/mp4; codecs="mp4a.40.2"' }],
        videoCapabilities: [],
        distinctiveIdentifier: 'optional',
        persistentState: 'optional',
      },
    ]);
    const info = await (
      access as { getConfiguration: () => unknown }
    ).getConfiguration();
    wpsLog('eme', `requestMediaKeySystemAccess('com.widevine.alpha') OK — keySystem=${(info as { keySystem?: string }).keySystem ?? 'widevine'}`);
  } catch (err) {
    wpsError(
      'eme',
      `requestMediaKeySystemAccess('com.widevine.alpha') 抛错:`,
      (err as Error)?.message ?? String(err),
      '→ Widevine CDM 未暴露给 renderer（castLabs components 已装但 webContents 拿不到 CDM？）',
    );
  }
}

export interface UseSpotifyWpsPlayer {
  /** WPS player 是否 connected。false = 走 30s 预览路径。 */
  wpsReady: boolean;
  /** WPS 镜像过来的播放状态。 */
  state: WpsPlayerState;
  /** 开始播放一个 spotify track URI（spotify:track:xxx）。 */
  play(trackUri: string): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  seek(positionMs: number): Promise<void>;
  /** 拿 deviceId 切到本设备的 Spotify Connect API 调用。 */
  transferHere(): Promise<void>;
}

interface Options {
  /** 当前是否登录到 Premium Spotify。tier !== 'premium' 时不会 connect。 */
  enabled: boolean;
}

/** 每 30s 检查一次 token 即将到期的情况，提前 60s refresh。 */
const TOKEN_REFRESH_LEAD_MS = 60_000;
const TOKEN_CHECK_INTERVAL_MS = 30_000;

export function useSpotifyWpsPlayer({ enabled }: Options): UseSpotifyWpsPlayer {
  const [wpsReady, setWpsReady] = useState(false);
  const [state, setState] = useState<WpsPlayerState>({
    hasTrack: false,
    isPlaying: false,
    track: null,
    positionMs: 0,
  });
  const wrapperRef = useRef<WpsWrapper | null>(null);

  useEffect(() => {
    wpsDebugBanner();
    if (!enabled) {
      wpsLog('enabled', `disabled → 不 connect，wpsReady=false（30s 预览路径）`);
      wrapperRef.current?.disconnect();
      wrapperRef.current = null;
      setWpsReady(false);
      console.log('[wps hook] disabled, wpsReady=false');
      return;
    }
    wpsLog('enabled', `enabled → 准备 connect`);

    let cancelled = false;
    let refreshTimer: number | null = null;

    async function init(): Promise<void> {
      wpsDebugBanner();
      wpsLog('init', `enabled=true → fetch token`);
      try {
        const tok = await getSpotifyToken();
        if (cancelled) return;
        wpsLog('init', `token received tier=${tok.tier} expiresIn=${Math.round((tok.expiresAt - Date.now()) / 1000)}s`);
        if (tok.tier !== 'premium') {
          // 罕见的并发：login 切到 free / premium 切换中 → 不连
          wpsLog('init', `tier !== 'premium' (got ${String(tok.tier)}) → skip connect, wpsReady stays false → 30s preview fallback`);
          setWpsReady(false);
          return;
        }
        // EME/Widevine 可用性探测：WPS SDK 内部靠 requestMediaKeySystemAccess
        // 拿 Widevine 解密音频。不可用 → connect 能成但播放必 playback_error。
        await probeEmeWidevine();
        const w = createWpsWrapper();
        wrapperRef.current = w;
        // No stored unsubscribe: teardown calls w.disconnect() which clears
        // all subscribers, and the callback already guards on `cancelled`.
        w.onStateChange((s) => {
          if (!cancelled) setState(s);
        });
        await w.connect(tok.accessToken);
        if (cancelled) { w.disconnect(); return; }
        wpsLog('init', 'connect returned; polling for emeOk && hasDeviceId (15s budget)');
        // 不等 fixed timeout——SDK ready 事件先到才真 ready。
        // 安全上限 15s；期间 emeOk 变为 false 或 ready 不 fire 则退出。
        const ready = await new Promise<boolean>((resolve) => {
          const deadline = Date.now() + 15_000;
          const check = () => {
            if (cancelled) return resolve(false);
            if (w.emeOk && w.hasDeviceId) return resolve(true);
            if (!w.emeOk) return resolve(false);
            if (Date.now() > deadline) return resolve(false);
            setTimeout(check, 200);
          };
          // 如果 ready 事件在 connect 里已经 fire 了，立即检查
          check();
        });
        if (!ready) {
          wpsWarn('init', `ready check failed: emeOk=${w.emeOk} hasDeviceId=${w.hasDeviceId} → wpsReady=false`);
          setWpsReady(false);
          return;
        }
        wpsLog('init', `READY (emeOk && hasDeviceId) — Premium WPS 全曲播放路径已激活`);
        setWpsReady(true);

        // Token 续期定时器：每次 tick 检查 expiresAt；将到期则重拉 + connect
        refreshTimer = window.setInterval(async () => {
          if (cancelled) return;
          try {
            const cur = await getSpotifyToken();
            if (cancelled) return;
            const remaining = cur.expiresAt - Date.now();
            wpsLog('token-refresh', `remaining=${Math.round(remaining / 1000)}s`);
            if (remaining < TOKEN_REFRESH_LEAD_MS) {
              // 仅刷新 token，不重建 connection —— 避免 disconnect→connect 之间
              // 的播放秒停（v2 已知限制：$w.connect() 会断旧 player 再建新。
              // 修复：不重连，只让 SDK 的 getOAuthToken 回调在下次 WebSocket 续连
              // 时拿到新 token）。
              w.refreshToken(cur.accessToken);
              wpsLog('token-refresh', `刷新 token（剩 ${Math.round(remaining / 1000)}s < 60s lead）`);
            }
          } catch (err) {
            // token 端点失败时保持现有连接（WPS 自己会断），下次 tick 再试
            console.warn('[wps] token refresh check failed:', err);
            wpsWarn('token-refresh', 'token refresh endpoint failed:', err);
          }
        }, TOKEN_CHECK_INTERVAL_MS);
      } catch (err) {
        if (!cancelled) {
          console.warn('[wps] init failed (Premium required, Free = expected):', err);
          // 大概率是 waitForSdk 超时 / scope 缺 streaming / token 无效
          wpsError('init', 'connect() 抛错 → wpsReady=false:', err,
            '→ 大概率：SDK 超时（网络/scdn.co 被墙）/ OAuth scope 缺 streaming / token 无效');
          setWpsReady(false);
        }
      }
    }
    void init();

    return () => {
      cancelled = true;
      if (refreshTimer) window.clearInterval(refreshTimer);
      wrapperRef.current?.disconnect();
      wrapperRef.current = null;
      setWpsReady(false);
    };
  }, [enabled]);

  return {
    wpsReady,
    state,
    async play(trackUri) {
      await wrapperRef.current?.play(trackUri);
    },
    async pause() {
      await wrapperRef.current?.pause();
    },
    async resume() {
      await wrapperRef.current?.resume();
    },
    async seek(positionMs) {
      await wrapperRef.current?.seek(positionMs);
    },
    async transferHere() {
      await wrapperRef.current?.transferHere();
    },
  };
}
