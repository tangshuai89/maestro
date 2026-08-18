# Extractable Components — Catalog for Superdesign DraftComponent Extraction

Candidates below can be extracted as reusable design components. **Layout** = chrome that appears across screens; **basic** = shared primitives used in many places; **pattern** = page-specific UI that defines a strong, reusable visual pattern (currently defined inline in MonsterBeatsView — needs extraction before reuse). All paths relative to `packages/renderer/src/`.

---

## Layout Components

## Titlebar
- Source: `components/layout/Titlebar.tsx`
- Category: layout
- Description: Fixed 40px top window bar (macOS drag region): source switch, provider controls (deezer preset / search / reco / liked), quality menu, login/account, settings, reset.
- Extractable props: provider (MusicProvider), onSwitchProvider, deezerEditorials (array), deezerPreset (string), onChangeDeezerPreset, onOpenSearch, recoStatus ({configured}|null), recoRunning (boolean), onReco, qqQuality (QqQuality), onChangeQuality, loggedIn (boolean), loggingIn (boolean), accountName (string|undefined), onLogin, onAccount, onReset, likedCount (number), onOpenLiked, onOpenSettings
- Hardcoded: emoji icons (🔍 🎲 ❤ ⚙ ↺), Chinese tooltips/labels, `.titlebar-btn` CSS classes, liked-count badge logic (999+ cap)

## SourceMenu
- Source: `components/layout/SourceMenu.tsx`
- Category: layout
- Description: Source-switch pill + dropdown menu (4 platforms), owns its own open state with fixed backdrop.
- Extractable props: provider (MusicProvider), onSelect (MusicProvider => void)
- Hardcoded: SELECTABLE list (qq/netease/deezer/spotify), PROVIDER_LABELS text, ⇄ icon, ✓ check mark, `.source-menu*` CSS classes

## QualityMenu
- Source: `components/layout/QualityMenu.tsx`
- Category: layout
- Description: Stream-quality dropdown (standard/high/lossless), right-aligned so it doesn't overflow the window.
- Extractable props: quality (QqQuality), onSelect (QqQuality => void)
- Hardcoded: QUALITIES list, QQ_QUALITY_LABELS text, ✓ check, `.source-menu*` shared CSS

## DeezerPresetSelect
- Source: `components/layout/DeezerPresetSelect.tsx`
- Category: layout
- Description: Native `<select>` for Deezer editorial charts; maps display names to preset codes.
- Extractable props: editorials (DeezerEditorial[]), value (string), onChange (string => void)
- Hardcoded: PRESET_CODES name→code map (All/亚洲流行/国际流行/说唱/摇滚/舞曲/R&B/古典/爵士), `.preset-select` CSS

## SourceSelect
- Source: `components/source-select/SourceSelect.tsx`
- Category: layout
- Description: First-run full-window source picker: centred heading + 4 glass cards with brand-tinted logo tiles.
- Extractable props: onSelect (MusicProvider => void)
- Hardcoded: SOURCES config (names, descriptions, initial letters 云/Q/D/S, brand gradient classes), "选择音乐来源 / 挑一个音源，开始你的电台" copy, arrow SVG, `.source-*` CSS

---

## Basic Components

## Modal
- Source: `components/common/Modal.tsx`
- Category: basic
- Description: Shared overlay + frosted-dark panel shell; scrim-click closes, panel clicks stopped.
- Extractable props: onClose (() => void), panelClassName (string?), children
- Hardcoded: `.modal-overlay` / `.modal-panel` CSS, scrim color, 540px default width

## ErrorPanel
- Source: `components/common/ErrorPanel.tsx`
- Category: basic
- Description: Collapsible error panel — one-line summary expands to full text with copy + close actions.
- Extractable props: message (string), onClose (() => void)
- Hardcoded: ⚠ icon, ▸/▾ toggle glyphs, Chinese button labels (复制/关闭/已复制 ✓), `.error-*` CSS

## AuthErrorPanel
- Source: `components/common/AuthErrorPanel.tsx`
- Category: basic
- Description: Fixed bottom-center auth-failure recovery panel with typed actions (retry / re-login / paste cookie / switch source / dismiss).
- Extractable props: provider (MusicProvider), error (AuthError|null), onRetry, onReLogin, onSwitch, onPasteCookie (optional), onDismiss
- Hardcoded: FRIENDLY error-code→label map (Chinese), button labels, `.auth-error-*` CSS

## ProgressBar
- Source: `components/player/ProgressBar.tsx`
- Category: basic
- Description: Click-to-seek progress row with hover-grown thumb, time codes left, children slot right (volume group).
- Extractable props: currentTime (number), duration (number), onSeek (seconds => void), children (ReactNode)
- Hardcoded: formatTime display, `.progress-*` CSS, `--progress` custom property pattern

## VolumeControl
- Source: `components/player/VolumeControl.tsx`
- Category: basic
- Description: Mute toggle + slim range slider; fill fed by `--volume` custom property.
- Extractable props: volume (number 0..1), muted (boolean), onVolumeChange (event), onToggleMute (() => void)
- Hardcoded: VolumeIcon SVG, Chinese aria-labels (静音/取消静音), `.volume-*` CSS, 90px slider width

## VolumeIcon
- Source: `components/player/VolumeIcon.tsx`
- Category: basic
- Description: Four-state speaker icon (muted/low/mid/high) as inline SVG, 14×14.
- Extractable props: volume (number), muted (boolean)
- Hardcoded: Material Design icon SVG paths, 14×14 size

## TransportBar
- Source: `components/player/TransportBar.tsx`
- Category: basic
- Description: Bottom transport row: dislike / like (with fan-out ❤ badge) / play-pause (loading spinner) / skip.
- Extractable props: hasTrack (boolean), loading (boolean), playing (boolean), liked (boolean), fanOutCount (number), onDislike, onLike, onPlayPause, onSkip
- Hardcoded: SVG icon paths (X / heart / play / pause / skip / spinner), Chinese tooltips, `.transport-*` / `.control-btn` CSS, 999+ badge logic

## SourceChip
- Source: `components/search/SourceChip.tsx`
- Category: basic
- Description: Tiny platform chip marking a unified result's availability; best source gets brand color + ★, no-rights gets strikethrough.
- Extractable props: source (UnifiedSourceInfo), isBest (boolean)
- Hardcoded: platform short labels (QQ/网易/DZ/SP), ★ glyph, per-platform colors from `$platform-colors`, `.source-chip*` CSS

---

## Pattern Components (page-specific, strong reusable UI — currently defined inline in MonsterBeatsView)

## MbBattleMenu
- Source: `components/views/MonsterBeatsView.tsx` (`.mb-battle-menu` block, inline)
- Category: pattern
- Description: Pokémon-style battle menu — symmetric 2×2 color button columns (FIGHT/BAG/PKMN/RUN | prev/next/shuffle/repeat) flanking a mega circular play button; chunky 3D-press buttons (box-shadow offset).
- Extractable props: liked (boolean), loading (boolean), playing (boolean), hasTrack (boolean), onDislike, onLike, onOpenLiked, onSwitchProvider, onPlayPause, onPrev, onSkip
- Hardcoded: button labels (FIGHT/BAG/PKMN/RUN), icon SVGs, color variants (red/yellow/green/blue/pink/white), `.mb-menu-*` / `.mb-mega-play` CSS, 1440×900 stage coordinates

## MbCreatureCard
- Source: `components/views/MonsterBeatsView.tsx` (`.mb-creature-card` block, inline)
- Category: pattern
- Description: "Legendary creature" track card — white card, -3° rotation, yellow border, black banner, cover art with shine + holographic overlays, navy nameplate, 2×2 stat bars (HP/ATK/DEF/SPD), element-type badge.
- Extractable props: track (Track|null), coverBackdropRef (RefObject), stats derived in-view (hp/atk/def/spd/level), cardType (string)
- Hardcoded: "LEGENDARY CREATURE" banner, stat labels, TYPE_COLORS map, star icon, `.mb-creature-*` CSS

## MbHudStats
- Source: `components/views/MonsterBeatsView.tsx` (`.mb-hud-stats` block, inline; `HUDStat` subcomponent)
- Category: pattern
- Description: Top-strip HUD — row of circular icon chips (❤⚡🗡🛡) each with a colored fill track; plus sync-bar and bag counter.
- Extractable props: fanOutCount (number), progressPct (number), loading (boolean), track (Track|null), likedCount (number)
- Hardcoded: icon set (heart/zap/swords/shield via MbIcon), labels (跨平台红心/播放进度/战斗能量/同步完成度), "Syncing n/4" text, `.mb-hud-*` / `.mb-sync-*` / `.mb-bag` CSS

## MbRadar
- Source: `components/views/MonsterBeatsView.tsx` (`.mb-radar` block, inline)
- Category: pattern
- Description: Animated radar disc half-hanging from the top strip — crosshair rings, conic sweep, blip, "YOU" label.
- Extractable props: none (purely decorative)
- Hardcoded: ring/sweep/blip styles, "YOU" label, `.mb-radar*` CSS + `mb-radar-spin` keyframes

## MbSourceBadges
- Source: `components/views/MonsterBeatsView.tsx` (`.mb-source-badges` block, inline)
- Category: pattern
- Description: Four 96px circular provider badges (Q/N/D/S) with italic letters, star/heart corner badges, active ring highlight.
- Extractable props: provider (MusicProvider), fanOutCount (number)
- Hardcoded: PROVIDER_BADGE map (letters/colors/names), fake heart counts (PROVIDER_HEART_DEFAULT), `.mb-source-badge*` CSS

## MbBattleDialog
- Source: `components/views/MonsterBeatsView.tsx` (`.mb-battle-dialog` block, inline)
- Category: pattern
- Description: Cream rounded dialog showing synced lyrics (prev/current/next lines with blinking ▶ cursor), status pill row (LV/YEAR/TYPE/SOURCE), speaker portrait, half-hanging NEXT button.
- Extractable props: lyrics lines (prevLine/currentLine/nextLine), lyricsSource, loading (boolean), accountName, fanOutCount, stats (level/year), provider, qqQuality, trialFellBack, onSkip
- Hardcoded: status labels, blinking cursor, red/yellow/green dots, NEXT button, `.mb-battle-*` CSS

## MbEncounterLog
- Source: `components/views/MonsterBeatsView.tsx` (`.mb-encounter` block, inline)
- Category: pattern
- Description: "DEEP.SEEK ENCOUNTER LOG" — red banner + 3-column grid of AI-recommendation mini creature cards (BotAvatar, type, name, match %), yellow footer pill.
- Extractable props: recoSuggestions (array), recoConfigured (boolean), recoLibrarySize (number), recoMatchRate (number)
- Hardcoded: "#092 · DEEP.SEEK · ENCOUNTER LOG" banner text, empty-state copy, BotAvatar seed derivation, `.mb-encounter-*` / `.mb-mini-card*` CSS

## MbProgressBar
- Source: `components/views/MonsterBeatsView.tsx` (`.mb-progress` block, inline)
- Category: pattern
- Description: Bottom full-width seek bar — navy pill, yellow border, yellow→orange fill, cream handle, mono time codes.
- Extractable props: currentTime (number), duration (number), onSeek (seconds => void)
- Hardcoded: fmtTime display, `.mb-progress*` CSS, mono font stack

---

### Notes
- The `MonsterBeatsView` pattern components share one source file and are position-absolute within a fixed 1440×900 scaled stage (`--mb-scale`). Extracting any of them means splitting `components/views/MonsterBeatsView.tsx`; they share helpers `seededFromString`, `deriveStats`, `pickType`, `MbIcon`, `BotAvatar`, and the `$monster-beats` SCSS palette (see `theme.md` Part 1).
- Legacy unused components (`CoverCard`, `NowPlayingCard`, `LyricsCard`, `LyricsPanel` + their `_cover-card.scss` / `_side-cards.scss` / `_progress.scss` / `_transport.scss` / `_volume.scss` styles) are **not** recommended for extraction — the active player view is MonsterBeatsView.
