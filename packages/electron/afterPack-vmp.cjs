/**
 * electron-builder afterPack 钩子：给打包出的 .app 做 Widevine VMP 签名。
 *
 * 为什么需要：
 *   dev 模式直接跑 castLabs 的 electron 二进制，它自带 VMP 签名，Spotify WPS
 *   开箱能播整曲。但 electron-builder 会重新组包 + macOS codesign，把 castLabs
 *   原始 VMP 签名弄失效 → 打包产物里的 Spotify 全曲会挂（退回 30s）。
 *   必须用 castLabs EVS 重新 VMP 签名，且**必须在 codesign 之前**（afterPack
 *   早于 electron-builder 的 afterSign/codesign 阶段，时序正好）。
 *
 * 前置（一次性，本机手动 —— 命令已按 2026-09-28 实测修正）：
 *   python3 -m venv ~/.castlabs-evs-venv
 *   ~/.castlabs-evs-venv/bin/pip install --upgrade castlabs-evs
 *   ~/.castlabs-evs-venv/bin/evs-account signup     # 注册 EVS 账号（免费）
 *   （凭据缓存在本机 ~/.castlabs-evs/，之后 sign-pkg 非交互）
 *
 * ⚠️ 曾经踩的坑：本文件原先调 `python3 -m castlabs_evs.vmp sign-pkg`——
 *   **该入口不存在**（castlabs-evs 只提供 `evs-vmp` / `evs-account` 两个 CLI，
 *   没有 `python3 -m castlabs_evs` 的 __main__），且系统 python3 也没有装这个包
 *   （homebrew python 3.14 受 PEP 668 保护）。结果：只要不带 SKIP_VMP=1，
 *   `npm run pack` 必然在这里抛 "No module named castlabs_evs"。现在改成直接
 *   解析 `evs-vmp` 可执行文件路径。
 *
 * 逃生阀：设 SKIP_VMP=1 跳过签名（只想验打包管线本身、不验 Widevine 时用）。
 *   跳过后产物的 Spotify 全曲不可用（退回 30s 预览），其它源不受影响。
 */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/**
 * 定位 `evs-vmp` 可执行文件。
 *
 * 查找顺序：EVS_VMP_BIN 环境变量 → 本项目约定的 venv → 系统 PATH 里常见的
 * 位置（pipx / --user / brew）。找不到返回 null，由调用方给出可执行的报错
 * （而不是让 execFileSync 抛一句看不懂的 ENOENT）。
 */
function resolveEvsVmpBin() {
  if (process.env.EVS_VMP_BIN) {
    return fs.existsSync(process.env.EVS_VMP_BIN)
      ? process.env.EVS_VMP_BIN
      : null;
  }
  const home = os.homedir();
  const candidates = [
    path.join(home, '.castlabs-evs-venv', 'bin', 'evs-vmp'),
    path.join(home, '.local', 'bin', 'evs-vmp'),
    '/usr/local/bin/evs-vmp',
    '/opt/homebrew/bin/evs-vmp',
  ];
  return candidates.find((p) => fs.existsSync(p)) ?? null;
}

const SETUP_HINT = [
  'python3 -m venv ~/.castlabs-evs-venv',
  '~/.castlabs-evs-venv/bin/pip install --upgrade castlabs-evs',
  '~/.castlabs-evs-venv/bin/evs-account signup',
].join('\n  ');

exports.default = async function afterPackVmp(context) {
  // 只有 macOS 需要在此处 VMP 签名；其它平台 castLabs 时序不同，本项目也只打 mac。
  if (context.electronPlatformName !== 'darwin') {
    return;
  }

  if (process.env.SKIP_VMP === '1') {
    console.warn(
      '[vmp] SKIP_VMP=1 → 跳过 Widevine VMP 签名。' +
        '打包产物的 Spotify 全曲将不可用（退回 30s 预览），其它源正常。',
    );
    return;
  }

  // castlabs sign-pkg 收的是「包含 .app 的目录」，不是 .app 本身。
  const pkgDir = context.appOutDir;

  const bin = resolveEvsVmpBin();
  if (!bin) {
    throw new Error(
      '[vmp] 找不到 `evs-vmp`（castLabs EVS 客户端未安装）。请先执行：\n  ' +
        SETUP_HINT +
        '\n已装在别处时用 EVS_VMP_BIN=/path/to/evs-vmp 指定。\n' +
        '若只想验打包管线（不验 Widevine），用 SKIP_VMP=1 npm run pack 跳过。',
    );
  }

  console.log(`[vmp] castLabs EVS 签名中：${pkgDir}（via ${bin}）`);

  try {
    execFileSync(bin, ['sign-pkg', pkgDir], { stdio: 'inherit' });
    console.log('[vmp] Widevine VMP 签名完成');
  } catch (err) {
    throw new Error(
      '[vmp] Widevine VMP 签名失败。若报「未登录 / token 过期」，先执行：\n' +
        '  ~/.castlabs-evs-venv/bin/evs-account refresh\n' +
        '若只想验打包管线（不验 Widevine），用 SKIP_VMP=1 npm run pack 跳过。\n' +
        `原始错误：${err && err.message ? err.message : err}`,
    );
  }
};
