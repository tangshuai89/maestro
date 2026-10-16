/**
 * 远端歌单弹窗（specs/remote-playlist §Phase 5）。
 *
 * 流程：粘贴歌单链接 / 裸 id → GET /music/playlists/:provider/:id/tracks
 *      → { playlist: RemotePlaylist, items: UnifiedSearchItem[] }
 *      → 播放整单 / 追加到队列 / 存为本地歌单
 *
 * ## 为什么直接播 items，不在前端再合并一次
 *
 * server 端已经把 `Track[]` 转成 **1:1 保序、不合并** 的 `UnifiedSearchItem[]`
 * （`playlistTracksToUnifiedItems`）。前端**不要**再跑一遍 `buildUnifiedItems`
 * 之类的跨平台去重 —— 那会按歌名折叠同名条目，227 首的歌单会变成 225 首。
 * 「镜像而非导入」这条决策在这里是硬约束，不是风格偏好。
 *
 * ## 支持矩阵（2026-10-15 实测，见 specs/remote-playlist/spec.md）
 *
 * | 平台     | 列目录 | 读歌单                       |
 * | -------- | ------ | ---------------------------- |
 * | 网易云   | ✅    | ✅                           |
 * | QQ       | ❌    | ✅（给定 disstid）           |
 * | Deezer   | ❌    | ✅（公开歌单，匿名）         |
 * | Spotify  | —     | 🟡 未接（scope 未申请）      |
 *
 * 所以入口是「粘贴链接」而不是「浏览歌单」：QQ / Deezer 拿不到目录，只能由
 * 用户从浏览器地址栏复制过来。这也是 QQ 列目录接口实测下线后的唯一走法。
 */
import * as React from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/Dialog';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import {
  createPlaylist,
  getRemotePlaylist,
  parseRemotePlaylistInput,
  type MusicProvider,
  type RemotePlaylist,
  type UnifiedSearchItem,
} from '../../api';

const PROVIDER_LABELS: Record<MusicProvider, string> = {
  qq: 'QQ 音乐',
  netease: '网易云',
  deezer: 'Deezer',
  spotify: 'Spotify',
};

/** 平台不支持「读歌单」时的提示。Spotify 是 scope 没申请，不是接口不存在。 */
const UNSUPPORTED: Partial<Record<MusicProvider, string>> = {
  spotify: 'Spotify 歌单读取尚未接入（需要改 OAuth scope，会强制所有用户重新授权）。',
};

export interface RemotePlaylistModalProps {
  open: boolean;
  onClose: () => void;
  /** 播放整单（复用 player.playSearch，覆盖当前队列）。 */
  onPlay: (items: UnifiedSearchItem[], index: number) => void;
  /** 追加到当前队列（player.appendToQueue，不清空）。 */
  onAppendQueue?: (items: UnifiedSearchItem[]) => void;
}

export function RemotePlaylistModal({
  open,
  onClose,
  onPlay,
  onAppendQueue,
}: RemotePlaylistModalProps) {
  const [raw, setRaw] = React.useState('');
  const [playlist, setPlaylist] = React.useState<RemotePlaylist | null>(null);
  const [items, setItems] = React.useState<UnifiedSearchItem[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [saveOpen, setSaveOpen] = React.useState(false);
  const [saveName, setSaveName] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [saved, setSaved] = React.useState(false);

  // 每次重新打开都清空上一张歌单，否则会出现「输入框是空的但下面还挂着上一张
  // 歌单的曲目」这种看不懂的状态。
  React.useEffect(() => {
    if (open) {
      setPlaylist(null);
      setItems([]);
      setError(null);
      setSaved(false);
      setSaveOpen(false);
      setSaveName('');
    }
  }, [open]);

  const parsed = parseRemotePlaylistInput(raw);
  const blocked = parsed ? UNSUPPORTED[parsed.provider] : undefined;

  const load = async () => {
    if (!parsed || blocked) return;
    setLoading(true);
    setError(null);
    try {
      const res = await getRemotePlaylist(parsed.provider, parsed.playlistId);
      setPlaylist(res.playlist);
      setItems(res.items);
      setSaveName(res.playlist.name || '');
    } catch (e) {
      setPlaylist(null);
      setItems([]);
      setError(describeError(e));
    } finally {
      setLoading(false);
    }
  };

  const save = async () => {
    if (!playlist || !saveName.trim() || items.length === 0) return;
    setSaving(true);
    try {
      // 存成**本地**歌单：走 UnifiedSearchItem[] 通道（PlaylistService 收这个
      // 形状）。此时它已经是一次性快照 —— 平台侧歌单之后变了不会同步回来。
      await createPlaylist({
        name: saveName.trim(),
        tracks: items,
        source: 'manual',
      });
      setSaved(true);
      setSaveOpen(false);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="remote-playlist-modal">
        <DialogHeader>
          <DialogTitle>从平台歌单导入</DialogTitle>
          <DialogDescription>
            粘贴歌单链接或末段 id。读取到的歌单会保持平台上的原顺序，不做跨平台去重。
          </DialogDescription>
        </DialogHeader>

        <div className="rp-input-row">
          <Input
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && parsed && !blocked) void load();
            }}
            placeholder="https://y.qq.com/n/ryqq/playlist/8584177317"
            aria-label="歌单链接或 id"
          />
          <Button onClick={() => void load()} disabled={!parsed || !!blocked || loading}>
            {loading ? '读取中…' : '读取'}
          </Button>
        </div>

        <p className="rp-hint">
          {blocked ? (
            <span className="rp-error">{blocked}</span>
          ) : parsed ? (
            <>
              识别为 <strong>{PROVIDER_LABELS[parsed.provider]}</strong> · id {parsed.playlistId}
            </>
          ) : raw.trim() ? (
            '认不出这个链接。支持 QQ 音乐 / 网易云 / Deezer 的歌单链接，或直接填数字 id。'
          ) : (
            'QQ / Deezer 的「歌单目录」接口已不可用，所以要从浏览器地址栏复制链接。'
          )}
        </p>

        {error && <div className="rp-error">{error}</div>}

        {playlist && (
          <>
            <div className="rp-meta">
              {playlist.coverUrl && (
                <img className="rp-cover" src={playlist.coverUrl} alt="" aria-hidden="true" />
              )}
              <div className="rp-meta-text">
                <div className="rp-name">{playlist.name || '(未命名歌单)'}</div>
                <div className="rp-sub">
                  {PROVIDER_LABELS[playlist.provider]} · {items.length} 首
                  {/* trackCount 是平台口径，可能 > items.length（QQ 过滤失效歌曲） */}
                  {items.length < playlist.trackCount && (
                    <span className="rp-dim">（平台标 {playlist.trackCount} 首）</span>
                  )}
                  {playlist.private && <span className="rp-dim"> · 私有</span>}
                </div>
              </div>
            </div>

            <div className="rp-actions">
              <Button
                onClick={() => {
                  onClose();
                  onPlay(items, 0);
                }}
                disabled={items.length === 0}
              >
                ▶ 播放全部
              </Button>
              {onAppendQueue && (
                <Button
                  variant="secondary"
                  onClick={() => {
                    onClose();
                    onAppendQueue(items);
                  }}
                  disabled={items.length === 0}
                >
                  追加到队列
                </Button>
              )}
              <Button variant="secondary" onClick={() => setSaveOpen((v) => !v)}>
                {saved ? '✓ 已存为本地歌单' : '存为本地歌单'}
              </Button>
            </div>

            {saveOpen && (
              <div className="rp-save-row">
                <Input
                  value={saveName}
                  onChange={(e) => setSaveName(e.target.value)}
                  placeholder="本地歌单名"
                  aria-label="本地歌单名"
                />
                <Button onClick={() => void save()} disabled={saving || !saveName.trim()}>
                  {saving ? '保存中…' : '保存'}
                </Button>
              </div>
            )}

            <ol className="rp-tracklist">
              {items.map((it, i) => (
                <li key={it.id}>
                  <button type="button" onClick={() => onPlay(items, i)} title={it.album}>
                    <span className="rp-idx">{i + 1}</span>
                    <span className="rp-t">
                      <span className="rp-title">{it.title}</span>
                      <span className="rp-artist">{it.artist}</span>
                    </span>
                    {it.sources[0]?.vipLocked && <span className="rp-vip">[VIP]</span>}
                  </button>
                </li>
              ))}
            </ol>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** 把后端的错误体翻成一句能看懂的话。 */
function describeError(e: unknown): string {
  const anyE = e as {
    body?: { error?: string; hint?: string; provider?: string };
    message?: string;
  };
  switch (anyE?.body?.error) {
    case 'playlist_not_found':
      return '这个歌单不存在，或是私有的（当前登录态看不到）。';
    case 'playlist_unsupported':
      return `${anyE.body?.provider ?? '该'}平台暂不支持歌单读取。`;
    case 'invalid_playlist_id':
      return anyE.body?.hint ?? '歌单 id 不对。';
    case 'not_logged_in':
      return '还没登录这个平台，先在设置里登录。';
    default:
      return anyE?.message ?? '读取失败。';
  }
}
