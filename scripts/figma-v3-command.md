# Figma 落地指令（重置后喂给 Claude Code）

文件：https://www.figma.com/design/FtbRZXvzlCp4Sq9e322cQQ（Maestro AETHER Music Player）
目标 frame：`AETHER — Canvas`（node-id 1-2，若不存在则创建 1440×900）

## 任务
把「AETHER ENGINE v3.0 | Professional Cosmic HUD」设计（参考 /tmp/sd-skill/aether-v3-pro.html 的结构与视觉）用 use_figma 在 Figma 中重建为**设计师级专业稿**。

## 设计规格（v3 Professional，克制高级版）

### 设计令牌（先创建 Figma Variables，组名 AETHER）
- bg #02020A（深空黑）
- neon-cyan #00E5FF（主强调）
- glass-bg rgba(255,255,255,0.06)（玻璃填充）
- glass-stroke rgba(255,255,255,0.12)（玻璃描边）
- text-main #F5F0E8（主文字）
- text-dim rgba(245,240,232,0.4)（次级）
- text-muted rgba(245,240,232,0.1)（弱化）
- 平台色：QQ #FFD93D / 网易云 #FF3B5C / Deezer #3D9BFF / Spotify #3DFFA2

### 布局（1440×900，左右分栏，杂志式）

1. **背景层**：垂直渐变 #02020A→#04040F + 36 颗星尘粒子（1-2.5px 白点，alpha 0.08-0.5 随机）+ 左上电紫光晕（#5B2BFF blur 80）+ 右下霓虹青光晕（#00E5FF blur 80）

2. **顶部协议条**（y=0, 高 40，左右 padding 64）：
   - 左：`SYSTEM PROTOCOL`（9px mono 字距 2px 白 30%）+ `AETHER ENGINE v3.0`（18px Semi Bold）
   - 中：4 枚平台徽章（28px 圆形玻璃底 + 彩色描边 + 字母 Q/N/D/S，网易云激活态：填充 25% 红 + 红色外发光）
   - 右：`BUFF 99.4% // LAT 47ms`（10px mono 青色）+ `NEURAL.SYNC ACTIVE`（9px 白 10%）

3. **左栏**（x=64, y=90, 宽 480）：
   - 封面 420×420 圆角 12：电紫→深空→霓虹青渐变 + 青色细描边(40% alpha) + 电紫外发光（offset y8 blur 40 alpha 35%）+ 中央 ♪ 符号（140px 白 15%）+ 左下角 `HI-RES 96KHZ` / `DOLBY ATMOS` 标签
   - 歌名 `走钢丝的人` 44px Semi Bold（字距 -1）
   - 元信息行：`李泉` 18px 白 40% + 青色圆点(6px) + `2001 · 寓言` 18px 白 10%
   - `NEURAL FEED` 标签（10px mono 字距 2px 白 40%）+ 2 张推荐卡（420×56 玻璃底 12 圆角：40px 缩略图电紫渐变 + `午夜巴黎/王菲` + `94%` 青色 mono）

4. **右栏**（x=560, y=90, 宽 400, 高 580）：歌词玻璃卡（20 圆角，padding 40）
   - 卡头：`TRANSCRIBING // CORE 02`（10px mono 白 10%）+ `● LIVE`（9px 青色）
   - 1px 分割线（白 10%）
   - 歌词：`有人在欢呼` 18px 白 10% → **当前行**「我就像个走钢丝的人」30px Bold + 青色 3×44px 左边条 → `T: 02:14 / S: 0.82`（9px 青色 mono）→ `在云端漫步/不曾想过退路/平衡这孤独` 18px 白 10%

5. **底部控制条**（y=760, padding 64）：
   - 控制组：⏮ 40px 玻璃圆钮 → ⇄ 40px → **播放键 64px 圆形霓虹青填充 + 青色外发光**（▶ 26px 深色）→ ⏭ 40px → ⟳ 40px
   - 进度区：`02:14`（11px 青色 mono）/ `04:52`（11px 白 10%）+ 500×2px 轨道（白 20%）+ 青色填充 45% + 10px 白色圆形滑块（青色描边）

6. **右下角**：`NEURAL.SYNC // AES.ENGINE v3.0`（9px mono 白 10%）

### 执行要求
- 先用 use_figma 创建变量组 AETHER（含上述颜色变量），再逐段构建（背景→顶部→左栏→右栏→底部），每段一个 use_figma 调用，代码保持 <10KB
- 全部用 auto-layout（间距 8pt 网格：8/16/24/32/40）
- 字体：标题/正文 Inter（Semi Bold/Regular），HUD 标签 JetBrains Mono（若 Figma 无此字体用 Menlo/Monaco，保持等宽即可）
- 完成后 get_screenshot 验证
