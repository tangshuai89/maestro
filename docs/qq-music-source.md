# QQ 音乐音源接入说明

> 结论先行：**QQ 音乐（TME）没有面向个人开发者的官方 API 来播放音源。**
> 本文档记录官方开放能力的现状、为什么不可用，以及本项目实际采用的
> 逆向接口方案与其风险。

## 1. 官方开放能力盘点

| 平台 / 能力 | 入口 | 适用场景 | 个人开发者可用 |
|---|---|---|---|
| QQ 音乐开发者平台 OpenAPI | https://developer.y.qq.com/docs/openapi | TME Connect、车机、大屏（智能电视）合作方 | ❌ 需企业资质 + 商务对接 |
| QPlay 协议 | https://y.qq.com/y/static/qplay/qplay_coop.html | 音响 / 硬件设备厂商，让设备拉起 QQ 音乐 App 取流 | ❌ 需营业执照、签 NDA、过认证实验室 |
| 移动 Web 开放平台 QMplayer | https://y.qq.com/m/api/open/index.html | 在 QQ 音乐域下的 H5 页面嵌入播放器组件 `player.play(songmid)` | ⚠️ 仅限 QQ 音乐站内 H5，会拉起 QQ 音乐客户端播放，**不提供独立可外带的音源 URL** |
| 腾讯连连 IoT H5 SDK | https://cloud.tencent.com/document/product/1081/67456 | 腾讯物联网面板内调 `window.h5PanelSdk.qqMusic.*` 取播放链接 | ❌ 必须在腾讯连连面板环境内，且绑定 IoT 设备 |

腾讯官方把"取 QQ 音乐播放直链"严格限定在：① 自家客户端 / H5 内、
② 签约的车机 / 大屏 / IoT 合作方。**没有任何一条开放给个人开发者做
独立桌面播放器。**

## 2. 本项目实际方案：Web 端非公开逆向接口

由于没有官方公开 API，本项目（以及几乎所有第三方聚合播放器）使用
QQ 音乐 Web 端的非公开接口。实现见
`packages/server/src/music/qq.provider.ts`。

### 2.1 关键端点

- 网关：`https://u.y.qq.com/cgi-bin/musicu.fcg`
  - POST，JSON body，`{ comm, module, method, param }` 统一信封结构
  - 少量老接口走 `c.y.qq.com` / `i.y.qq.com` 的独立 fcgi
- 通用 Header：`Referer: https://y.qq.com/` + 浏览器 `User-Agent`
- 取播放直链：`vkey.GetVkeyServer` / `CgiGetVkey`
- 「我喜欢」列表（2026-08 起，现网 web 端同款）：
  `music.srfDissInfo.DissInfo/CgiGetDiss`，param `disstid=0` + `dirid=201` +
  `enc_host_uin=<euin>`（euin 在 cookie jar 里，形如 `Ne6ANK4s7KE*`），
  `song_begin`/`song_num` 翻页、`hasmore` 判末页。
  ⚠️ 旧路 `fcg_user_created_diss` 里找 `dirid=201` 的 dissid 已失效——QQ 新
  登录体系下「我喜欢」的 dirid 不再是 201（实测返回 1/31~57/205），旧实现
  恒拿 0 首；CgiGetDiss 用 `disstid=0` 让服务端直接解析 201，不需要 dissid。

### 2.2 鉴权

- 用户手动粘贴 Cookie（在 renderer 设置页操作，存本地）
- 关键字段：`uin`（QQ 号，微信登录时取 `wxuin`）+ `qm_keyst` /
  `qqmusic_key` 票据
- 播放地址另需 `qqCookiePlaybackKey`；仅有网页登录态但缺播放票据
  时会命中 `104003` 限制
- 所有凭据**只存本地，不上传任何服务器**（本项目也没有服务器）

### 2.3 音质

音质候选前缀（`_QUALITY_CANDIDATE_TEMPLATES`）：
`01`（Hi-Res）、`002`（FLAC）、`000`/`M500`（MP3）、`C600`（AAC）等。
具体能否取到取决于用户 QQ 音乐账号的会员权益。

### 2.4 参考实现（社区逆向库，用于交叉核对 module/method）

- `jsososo/QQMusicApi`（Node.js）
- `copws/qq-music-api`（JS，2025.9 仍可用）
- `l-1124/QQMusicApi`（Python，文档 https://l-1124.github.io/QQMusicApi/ ）

## 3. 风险与对策

| 风险 | 说明 | 对策 |
|---|---|---|
| 接口失效 | 上游改版 / 加签（如 `musics.fcg` 的 `sign` 校验）随时可能让现有通道挂掉 | 当前仍走旧版 `musicu.fcg`，若上游收紧需专项逆向；关注上面三个社区库的更新 |
| 法律灰色 | 违反 QQ 音乐用户协议，**不能用于任何商业 / 公开发布的产品** | 个人自用可接受；若将来公开发布 maestro，QQ 音乐这一源要么去掉、要么做成"用户自行承担风险"的可选插件 |
| 账号风险 | 频繁调用非官方接口理论上可能触发风控 | 控制请求频率，复用用户登录态，不做批量爬取 |

## 4. 决策

- **个人自用**：继续走逆向接口 + 用户自带 Cookie（即 `qq.provider.ts` 现状），这是目前唯一可行路径。
- **想走官方路**：只能注册公司、走 TME Connect 或车机 / 大屏合作，门槛高，不适合个人项目。
- **公开发布时**：QQ 音乐源建议做成可选插件，由用户自行粘贴 Cookie 并承担风险；网易云 / Deezer / Spotify 都有相对正规的第三方接入路径，可优先靠这几个。
