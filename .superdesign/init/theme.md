# Theme — Design System & Tokens

Source: `packages/renderer/src/styles/` (SCSS via `sass`, no Tailwind). Single entry `main.scss` imported once in `main.tsx`. There are **two visual worlds** in this app:

1. **Glass Cosmic** (app shell, titlebar, modals, source picker) — token-driven CSS custom properties, light/dark themes.
2. **Monster Beats** (main player view `MonsterBeatsView`) — a separate flat cartoon palette hardcoded in `styles/components/_monster-beats.scss`, layered over/around the glass UI.

---

# PART 1 — Compact Token Summary

## CSS custom properties (runtime tokens)

### `:root` (in `base/_tokens.scss`) — always-on brand + runtime tokens

| Token | Value | Purpose |
|---|---|---|
| `--accent` | `#6b8cff` | Brand accent — cool iOS blue-violet (visionOS-style) |
| `--accent-soft` | `rgba(107, 140, 255, 0.18)` | |
| `--accent-hover` | `#5678ee` | |
| `--accent-deep` | `#3f5bd0` | |
| `--accent-bright` | `#8aa4ff` | |
| `--cosmic-near` | `#f5f0e8` | Cosmic gradient stops |
| `--cosmic-far` | `#fafaf9` | |
| `--error-fg` | `#c62828` | Error (light default; overridden per theme) |
| `--error-fg-soft` | `rgba(198, 40, 40, 0.7)` | |
| `--error-bg` | `rgba(198, 40, 40, 0.06)` | |
| `--error-border` | `rgba(198, 40, 40, 0.18)` | |
| `--error-action-bg` | `rgba(198, 40, 40, 0.08)` | |
| `--cover-accent` | `#8a93a8` (default) | **Runtime**: cover art main colour, JS-written per track |
| `--accent-live` | `color-mix(in oklab, var(--cover-accent, #d97757) 68%, white 32%)` | Live playback accent (progress/volume fill) |
| `--cover-glow` | `rgba(0, 0, 0, 0)` | Runtime: cover outer halo |
| `--bass-intensity` | `0` | Runtime 0..1: bass RAF loop → cover breathing |
| `--bass-period` | `1.4s` | Breathing animation period |
| `--plx-accent-purple` | `#b14bff` | Legacy Plexamp palette (unused in active UI) |
| `--plx-accent-pink` | `#ff3d8c` | |

### Spacing scale

```
--space-1: 4px  --space-2: 8px  --space-3: 12px  --space-4: 16px  --space-5: 24px  --space-6: 32px
```

### Radius scale

```
--radius-sm: 8px  --radius-md: 12px  --radius-lg: 18px  --radius-xl: 24px  --radius-full: 9999px
```

### Easing

```
--ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1)   (buttons / playful pops)
--ease-out:    cubic-bezier(0.16, 1, 0.3, 1)       (soft fades / entrances)
```

### Fonts

```
--font-ui: 'Fredoka', 'Inter', -apple-system, BlinkMacSystemFont, 'SF Pro Text',
           'PingFang SC', 'Hiragino Sans GB', sans-serif
```
- Loaded at runtime via `@fontsource/fredoka` (400/600/700) in `main.tsx`; Fredoka is the round cartoon font of the Monster Beats design.
- ⚠ Caveat: `--font-display` and `--font-mono` are **referenced** in SCSS (`_cover-card.scss`, `_side-cards.scss`, `_progress.scss`, `_settings-modal.scss`) but **not defined** in `_tokens.scss` — they fall through to inherit (`--font-mono` gets a `monospace` fallback only in `_settings-modal.scss`). Time codes in `_progress.scss` and `_monster-beats.scss` use a hardcoded mono stack instead.

## Themes (`base/_themes.scss`) — dark (default) & light

### Dark tokens (via `@media (prefers-color-scheme: dark)` for `:root:not([data-theme='light'])` and `[data-theme='dark']`)

| Token | Value |
|---|---|
| `--bg-base` / `--bg-primary` | `#14161a` (cool blue-black, never pure black) |
| `--bg-secondary` | `#1c1f26` |
| `--bg-elevated` | `rgba(40, 44, 54, 0.55)` |
| `--bg-overlay` | `rgba(230, 238, 255, 0.06)` |
| `--bg-overlay-strong` | `rgba(230, 238, 255, 0.12)` |
| `--text-primary` | `#eef1f7` |
| `--text-secondary` | `rgba(238, 241, 247, 0.66)` |
| `--text-tertiary` | `rgba(238, 241, 247, 0.34)` |
| `--border` | `rgba(230, 238, 255, 0.1)` |
| `--border-strong` | `rgba(230, 238, 255, 0.18)` |
| `--shadow` | `rgba(8, 10, 16, 0.6)` |
| `--heart-active` | `#ff5470` |
| `--heart-inactive` | `rgba(238, 241, 247, 0.5)` |
| `--shadow-sm` | `0 1px 2px rgba(8, 10, 16, 0.5)` |
| `--shadow-md` | `0 4px 16px rgba(8, 10, 16, 0.55)` |
| `--shadow-lg` | `0 18px 48px rgba(8, 10, 16, 0.7), 0 6px 16px rgba(8, 10, 16, 0.55)` |
| `--glass-bg` | `rgba(40, 44, 54, 0.5)` |
| `--glass-blur` | `saturate(180%) blur(40px)` |
| `--glass-border` | `1px solid rgba(230, 238, 255, 0.1)` |
| `--error-*` | `#ff8a8a` family (softer than light mode) |

### Light tokens (via `@media (prefers-color-scheme: light)` and `[data-theme='light']`)

| Token | Value |
|---|---|
| `--bg-base` / `--bg-primary` | `#fafaf9` |
| `--bg-secondary` | `#f5f5f4` |
| `--bg-elevated` | `rgba(255, 255, 255, 0.72)` |
| `--bg-overlay` | `rgba(0, 0, 0, 0.04)` |
| `--bg-overlay-strong` | `rgba(0, 0, 0, 0.08)` |
| `--text-primary` | `#1c1917` |
| `--text-secondary` | `rgba(28, 25, 23, 0.6)` |
| `--text-tertiary` | `rgba(28, 25, 23, 0.35)` |
| `--border` | `rgba(0, 0, 0, 0.08)` |
| `--border-strong` | `rgba(0, 0, 0, 0.16)` |
| `--heart-active` | `#ef4444` (@media) / `#ff2d55` ([data-theme='light']) |
| `--heart-inactive` | `rgba(28, 25, 23, 0.4)` |
| `--shadow-sm` | `0 1px 2px rgba(0, 0, 0, 0.06)` |
| `--shadow-md` | `0 4px 12px rgba(0, 0, 0, 0.08)` |
| `--shadow-lg` | `0 12px 40px rgba(0, 0, 0, 0.12), 0 4px 12px rgba(0, 0, 0, 0.08)` |
| `--glass-bg` | `rgba(255, 255, 255, 0.55)` |
| `--glass-blur` | `saturate(180%) blur(40px)` |
| `--glass-border` | `1px solid rgba(0, 0, 0, 0.06)` |

Theme selection: `<html data-theme="dark|light">` written by `useTheme`; `system` leaves it to `prefers-color-scheme`.

## Compile-time SCSS constants (`abstracts/_variables.scss`)

### z-index layers (`z('name')` helper)

```
'bg-layer': -1, 'base': 0, 'sheen': 5, 'menu-backdrop': 55, 'menu': 56,
'search-overlay': 60, 'titlebar': 100, 'modal': 1000
```

### Breakpoint

- `$bp-short: 520px` — the only breakpoint; `@media (max-height: $bp-short)` collapses the side column next to the cover.

### Fixed-dark overlay palette (search / reco-key / liked / settings panels — always dark regardless of theme)

```
$scrim:                   rgba(0, 0, 0, 0.45)
$overlay-bg:              rgba(24, 24, 28, 0.96)
$overlay-border:          rgba(255, 255, 255, 0.08)
$overlay-divider:         rgba(255, 255, 255, 0.06)
$overlay-hover:           rgba(255, 255, 255, 0.06)
$overlay-field-bg:        rgba(255, 255, 255, 0.04)
$overlay-field-border:    rgba(255, 255, 255, 0.12)
$overlay-field-border-hi: rgba(255, 255, 255, 0.3)
$overlay-text:            #f2f2f5
$overlay-text-dim:        #9a9aa2
$overlay-text-mute:       #888
$overlay-text-faint:      #777
$overlay-icon:            #aaa
$overlay-error:           #ff8080
$overlay-ph-solid:        #333
$overlay-ph-a:            #3a3a42
$overlay-ph-b:            #24242a
$accent-green:            #31c27c   (search spinner / play icon / links / primary buttons)
```

### Platform accent map (`$platform-colors`) — search "best source" chips + badges

```
'qq':      bg rgba(49, 194, 124, 0.18), fg #31c27c
'netease': bg rgba(217, 68, 68, 0.18),  fg #ff7b7b
'deezer':  bg rgba(108, 75, 195, 0.22), fg #b39dff
(spotify chip: default grey unless in liked-modal badges → #1db954)
```

### Mixins (`abstracts/_mixins.scss`)

- `backdrop-blur($blur, $saturate: 180%)` — standard + `-webkit-` prefixed frosted glass.
- `truncate` — single-line ellipsis.
- `flex-center`.
- `custom-scrollbar($width: 4px)` — thin hover-revealed scrollbar for glass scroll containers.

### Body background (Glass Cosmic look)

Four layered radial gradients driven by `--cover-accent` / `--accent` / `--bg-base`:
`radial(70% 55% @12% 8%, cover-accent 45%→transparent) + radial(55% 50% @88% 92%, accent 32%) + radial(40% 35% @center, cover-accent 12%) + radial(100% 80%, transparent→rgba(0,0,0,.35)) over var(--bg-base)`.

## Monster Beats palette (hardcoded SCSS `$`-vars in `_monster-beats.scss`)

Flat cartoon palette — sky gradient background, navy outlines, Pokémon-style accents:

```
$sky-top: #5BC0FF   $sky-bot: #8FE4FF   $cream: #FFF8E7   $navy: #0A1F3C
$navy-soft: #1F3252  $red: #FF3B3B   $yellow: #FFD60A   $blue: #2D7FFF
$green: #4CD964   $pink: #FF2D87   $orange: #FF8C2A
```

Also: creature element types (`wild` #FFD60A, `fire` #FF3B3B, `water` #2D7FFF, `grass` #4CD964, `electric` #FFD60A, `ultra` = rainbow gradient edge), provider badge colors (qq #FFD60A, netease #FF3B3B, deezer #2D7FFF, spotify #4CD964).

## Key layout numbers

- Titlebar: fixed, `height: 40px`, `padding: 0 16px 0 96px` (96px clears macOS traffic lights), drag region.
- `.app`: `height: 100vh; padding: 56px 24px 24px; gap: 16px` (56px clears titlebar + breathing).
- Bento grid: `grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr)` (cover 62% / side column), gap 14px.
- Monster Beats stage: fixed 1440×900 canvas scaled by `--mb-scale` (React computes from window size, `scale(min(max(min(w/1440, h/900), 0.4), 1.15))`, top offset 110px below titlebar).
- Modal panel: `width: min(92vw, 540px); max-height: 78vh; border-radius: 16px`, padding-top 64px on overlay.
- Liked modal: 480px wide; settings modal: 520px.
- Glass cards: `border-radius: var(--radius-xl)` (24px), blur 30–44px.

---

# PART 2 — Raw Source Dumps

## `styles/main.scss` (entry; imports order = cascade order)

```scss
// ─────────────────────────────────────────────────────────────────
// Single stylesheet entry for the renderer. Imported once, in main.tsx.
// Components reference semantic class-name strings; none of them import
// styles directly, so tsx stays fully decoupled from CSS.
//
// Order matters for the cascade: base (tokens → themes → reset → body)
// first, then components. The abstracts layer (variables / functions /
// mixins) is pulled in by each partial via `@use '../abstracts'` and emits
// no CSS of its own.
// ─────────────────────────────────────────────────────────────────

// Base
@use 'base/tokens';
@use 'base/themes';
@use 'base/reset';
@use 'base/base';

// Components
@use 'components/app-shell';
@use 'components/titlebar';
@use 'components/dropdown-menu';
@use 'components/cover-card';
@use 'components/side-cards';
@use 'components/progress';
@use 'components/volume';
@use 'components/transport';
@use 'components/modal';
@use 'components/search-panel';
@use 'components/reco-key-modal';
@use 'components/liked-modal';
@use 'components/source-select';
@use 'components/error-panel';
@use 'components/netease-modal';
@use 'components/settings-modal';
@use 'components/auth-error-panel';
@use 'components/monster-beats';
```

## `styles/abstracts/_index.scss` (barrel — zero CSS)

```scss
// Barrel for the abstracts layer. A partial does `@use '../abstracts' as *;`
// to pull in every variable, function, and mixin in one line. Forwarding
// (not re-emitting) means this produces zero CSS.
@forward 'variables';
@forward 'functions';
@forward 'mixins';
```

## `styles/abstracts/_variables.scss`

```scss
// ─────────────────────────────────────────────────────────────────
// Compile-time SCSS constants.
//
// These are values that never change at runtime — layering, breakpoints,
// and the fixed-dark popover palette. Anything the app mutates at runtime
// (cover colour, theme) stays a CSS custom property in base/_tokens.scss,
// NOT here.
// ─────────────────────────────────────────────────────────────────

// z-index layering. One map, one source of truth — no more guessing which
// magic number sits above which. Read via z('name') (see _functions.scss).
$z-layers: (
  'bg-layer':       -1,
  'base':            0,
  'sheen':           5,
  'menu-backdrop':  55,
  'menu':           56,
  'search-overlay': 60,
  'titlebar':      100,
  'modal':        1000,
);

// The only breakpoint in the app: below this height the side column
// collapses next to the cover (see components/_app-shell.scss).
$bp-short: 520px;

// Fixed-dark popover palette. The search / reco-key panels are deliberately
// always dark — they float over a dimmed scrim regardless of the light/dark
// theme, so their text must stay light. Centralised here instead of scattered
// as magic hex through the partials. (The NetEase modal, by contrast, is
// theme-aware and uses the CSS tokens.)
$scrim:                    rgba(0, 0, 0, 0.45);
$overlay-bg:               rgba(24, 24, 28, 0.96);
$overlay-border:           rgba(255, 255, 255, 0.08);
$overlay-divider:          rgba(255, 255, 255, 0.06);
$overlay-hover:            rgba(255, 255, 255, 0.06);
$overlay-field-bg:         rgba(255, 255, 255, 0.04);
$overlay-field-border:     rgba(255, 255, 255, 0.12);
$overlay-field-border-hi:  rgba(255, 255, 255, 0.3);
$overlay-text:             #f2f2f5;
$overlay-text-dim:         #9a9aa2;
$overlay-text-mute:        #888;
$overlay-text-faint:       #777;
$overlay-icon:             #aaa;
$overlay-error:            #ff8080;
$overlay-ph-solid:         #333;
$overlay-ph-a:             #3a3a42;
$overlay-ph-b:             #24242a;
$accent-green:             #31c27c; // search spinner / play icon / links

// Search "source chip" per-platform accent, used by an @each in
// components/_search-panel.scss to generate the .source-chip--best.*
// rules instead of hand-writing one block per platform.
$platform-colors: (
  'qq':      (bg: rgba(49, 194, 124, 0.18), fg: #31c27c),
  'netease': (bg: rgba(217, 68, 68, 0.18),  fg: #ff7b7b),
  'deezer':  (bg: rgba(108, 75, 195, 0.22), fg: #b39dff),
);
```

## `styles/abstracts/_functions.scss`

```scss
@use 'sass:map';
@use 'variables' as *;

// z('titlebar') → the z-index for that layer. Fails loudly at compile time
// if the name is missing, so a typo can't silently produce z-index: null.
@function z($name) {
  @if not map.has-key($z-layers, $name) {
    @error 'Unknown z-index layer: #{$name}';
  }
  @return map.get($z-layers, $name);
}
```

## `styles/abstracts/_mixins.scss`

```scss
// ─────────────────────────────────────────────────────────────────
// Reusable declaration blocks. Kept intentionally small — only patterns
// that genuinely repeat across the app earn a mixin.
// ─────────────────────────────────────────────────────────────────

// Frosted glass. Emits both the standard and -webkit-prefixed properties
// (Electron's Chromium still wants the prefix on some builds). This exact
// pairing is repeated on every card, dropdown, and modal.
@mixin backdrop-blur($blur, $saturate: 180%) {
  backdrop-filter: blur($blur) saturate($saturate);
  -webkit-backdrop-filter: blur($blur) saturate($saturate);
}

// Single-line text with an ellipsis. Used on every title/subtitle/cell.
@mixin truncate {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@mixin flex-center {
  display: flex;
  align-items: center;
  justify-content: center;
}

// Thin, hover-revealed scrollbar for glass scroll containers (the lyrics
// list). Firefox uses scrollbar-*; WebKit uses the pseudo-elements.
@mixin custom-scrollbar($width: 4px) {
  scrollbar-width: thin;
  scrollbar-color: transparent transparent;

  &::-webkit-scrollbar {
    width: $width;
  }
  &::-webkit-scrollbar-track {
    background: transparent;
  }
  &::-webkit-scrollbar-thumb {
    background: color-mix(in oklab, var(--text-primary) 20%, transparent);
    border-radius: $width;
  }
  &:hover::-webkit-scrollbar-thumb {
    background: color-mix(in oklab, var(--text-primary) 35%, transparent);
  }
}
```

## `styles/base/_tokens.scss` (runtime design tokens on `:root`)

```scss
// ─────────────────────────────────────────────────────────────────
// Runtime design tokens — CSS custom properties on :root.
//
// These are CSS variables (not SCSS ones) on purpose: several are written
// at runtime by JS (--cover-accent / --cover-glow / --bass-intensity as a
// track plays) or flipped by the theme blocks in _themes.scss. SCSS
// constants that never change live in abstracts/_variables.scss instead.
// ─────────────────────────────────────────────────────────────────

:root {
  // Fallback: when no media query matches, lean dark — it matches the
  // backgroundColor we already set in main.ts so the window never
  // flashes white at startup.
  color-scheme: light dark;

  // Brand accent — cool iOS blue-violet (visionOS accent). Used for the
  // login button, focus rings, section-label ticks — UI chrome where a
  // stable brand identity matters more than matching the artwork.
  --accent: #6b8cff;
  --accent-soft: rgba(107, 140, 255, 0.18);
  --accent-hover: #5678ee;
  --accent-deep: #3f5bd0;
  --accent-bright: #8aa4ff;

  // Cosmic gradient stops — the deep-space wash behind the cover-extended
  // bg, and the fallback before the cover colour loads.
  --cosmic-near: #f5f0e8;
  --cosmic-far: #fafaf9;

  // Error colours (tokenised so dark mode works)
  --error-fg: #c62828;
  --error-fg-soft: rgba(198, 40, 40, 0.7);
  --error-bg: rgba(198, 40, 40, 0.06);
  --error-border: rgba(198, 40, 40, 0.18);
  --error-action-bg: rgba(198, 40, 40, 0.08);

  // Spacing scale
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 24px;
  --space-6: 32px;

  // Radius scale
  --radius-sm: 8px;
  --radius-md: 12px;
  --radius-lg: 18px;
  --radius-xl: 24px;
  --radius-full: 9999px;

  // Easing — a spring for buttons, a soft ease for fades
  --ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);

  // Cover art main colour, extracted at runtime from the current cover
  // image. Default fallback so the bg-layer has a colour before the first
  // image loads. Cool slate-grey so the pre-load state reads neutral/tech.
  --cover-accent: #8a93a8;

  // Live playback accent — the cover colour lifted toward white so it stays
  // legible on the dark glass regardless of how dark or desaturated the
  // cover is. This is what the progress bar and volume slider use, so a
  // B&W cover yields a clean light-grey bar and a colourful cover yields a
  // bright version of its own colour. Computed at use-time from
  // --cover-accent (which JS sets per track), so it tracks the song.
  --accent-live: color-mix(in oklab, var(--cover-accent, #d97757) 68%, white 32%);

  // Cover glow colour (used by the cover's outer halo).
  --cover-glow: rgba(0, 0, 0, 0);

  // Plexamp palette (legacy — kept around in case the user wants to flip
  // back to it).
  --plx-accent-purple: #b14bff;
  --plx-accent-pink: #ff3d8c;

  // Typography — Fraunces for the editorial title, Inter for UI, JetBrains
  // Mono for digits (time codes). The font files are loaded via a <link>
  // in index.html; these variables just point at them with system
  // fallbacks so the app is usable offline.
  --font-ui: 'Fredoka', 'Inter', -apple-system, BlinkMacSystemFont,
    'SF Pro Text', 'PingFang SC', 'Hiragino Sans GB', sans-serif;

  // Animated period (in seconds) for the cover-card breathing shadow.
  --bass-period: 1.4s;

  // Live bass intensity in 0..1, written by the bass RAF loop reading the
  // AnalyserNode's low-frequency bins. Drives the cover-card breathing.
  --bass-intensity: 0;
}
```

## `styles/base/_themes.scss` (dark & light token blocks)

```scss
// ─────────────────────────────────────────────────────────────────
// Theme token overrides. Two complete sets, selected by [data-theme=…] on
// <html> (written by the theme hook) or by prefers-color-scheme when the
// user leaves it on 'system'. Each theme has both an @media (auto) and a
// [data-theme] (explicit) block so the toggle can override the OS.
// ─────────────────────────────────────────────────────────────────

// Dark tokens — shared by the @media and [data-theme='dark'] blocks below.
@mixin dark-tokens {
  // Cool blue-black — never pure black. The cover-extended bg tints the
  // window; the neutral base stays cool so the whole thing reads "tech".
  --bg-base: #14161a;
  --bg-primary: #14161a;
  --bg-secondary: #1c1f26;
  --bg-elevated: rgba(40, 44, 54, 0.55);
  --bg-overlay: rgba(230, 238, 255, 0.06);
  --bg-overlay-strong: rgba(230, 238, 255, 0.12);

  --text-primary: #eef1f7;
  --text-secondary: rgba(238, 241, 247, 0.66);
  --text-tertiary: rgba(238, 241, 247, 0.34);

  --border: rgba(230, 238, 255, 0.1);
  --border-strong: rgba(230, 238, 255, 0.18);
  --shadow: rgba(8, 10, 16, 0.6);

  --heart-active: #ff5470;
  --heart-inactive: rgba(238, 241, 247, 0.5);

  --shadow-sm: 0 1px 2px rgba(8, 10, 16, 0.5);
  --shadow-md: 0 4px 16px rgba(8, 10, 16, 0.55);
  --shadow-lg: 0 18px 48px rgba(8, 10, 16, 0.7), 0 6px 16px rgba(8, 10, 16, 0.55);

  --glass-bg: rgba(40, 44, 54, 0.5);
  --glass-blur: saturate(180%) blur(40px);
  --glass-border: 1px solid rgba(230, 238, 255, 0.1);

  --error-fg: #ff8a8a;
  --error-fg-soft: rgba(255, 138, 138, 0.7);
  --error-bg: rgba(255, 138, 138, 0.08);
  --error-border: rgba(255, 138, 138, 0.25);
  --error-action-bg: rgba(255, 138, 138, 0.12);
}

// Light tokens — shared by the @media and [data-theme='light'] blocks.
// NB: the two light blocks differ by one value in the original CSS
// (--heart-active is #ef4444 via @media, #ff2d55 via [data-theme]); that
// difference is preserved by overriding it in the explicit block below.
@mixin light-tokens {
  --bg-base: #fafaf9;
  --bg-primary: #fafaf9;
  --bg-secondary: #f5f5f4;
  --bg-elevated: rgba(255, 255, 255, 0.72);
  --bg-overlay: rgba(0, 0, 0, 0.04);
  --bg-overlay-strong: rgba(0, 0, 0, 0.08);

  --text-primary: #1c1917;
  --text-secondary: rgba(28, 25, 23, 0.6);
  --text-tertiary: rgba(28, 25, 23, 0.35);

  --border: rgba(0, 0, 0, 0.08);
  --border-strong: rgba(0, 0, 0, 0.16);
  --shadow: rgba(0, 0, 0, 0.06);

  --heart-active: #ef4444;
  --heart-inactive: rgba(28, 25, 23, 0.4);

  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.06);
  --shadow-md: 0 4px 12px rgba(0, 0, 0, 0.08);
  --shadow-lg: 0 12px 40px rgba(0, 0, 0, 0.12), 0 4px 12px rgba(0, 0, 0, 0.08);

  --glass-bg: rgba(255, 255, 255, 0.55);
  --glass-blur: saturate(180%) blur(40px);
  --glass-border: 1px solid rgba(0, 0, 0, 0.06);
}

// Dark (default on macOS) — Glass Cosmic.
@media (prefers-color-scheme: dark) {
  :root:not([data-theme='light']) {
    @include dark-tokens;
  }
}

[data-theme='dark'] {
  @include dark-tokens;
}

// Light theme (overrides).
@media (prefers-color-scheme: light) {
  :root:not([data-theme='dark']) {
    @include light-tokens;
  }
}

[data-theme='light'] {
  @include light-tokens;
  // Preserve the original explicit-light heart colour, which differed from
  // the auto-light one.
  --heart-active: #ff2d55;
}
```

## `styles/base/_reset.scss`

```scss
// Element resets + structural document base. Everything here is unscoped
// and applies globally.

* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

html,
body,
#root {
  height: 100%;
  width: 100%;
  overflow: hidden;
}

// Opaque base on the root element. Insurance: if any composited layer above
// (body gradient, .app, bg-layer) ever fails to paint a region, the fallback
// shown is this dark base — never the white default canvas. Uses the theme's
// --bg-base so it's correct in both light and dark.
html {
  background-color: var(--bg-base, #14161a);
}

button {
  cursor: pointer;
  border: none;
  background: none;
  outline: none;
  font-family: inherit;
  color: inherit;
}

button:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

input,
select {
  font-family: inherit;
}

// Honour the user's reduced-motion preference.
@media (prefers-reduced-motion: reduce) {
  * {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

## `styles/base/_base.scss` (body typography + layered background wash)

```scss
// The <body> base: typography + the layered cover-driven background wash.
// (Font files themselves are loaded via a <link> in index.html; here we
// just apply the stacks from --font-*.)

body {
  font-family: var(--font-ui);
  // Keep tnum (tabular numerals) for the timecode display so 0:00 digits
  // don't jitter as they tick.
  font-variant-numeric: tabular-nums;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-rendering: optimizeLegibility;
  letter-spacing: 0;

  // Layered wash: three soft radial gradients anchored to the corners + the
  // centre, all reading from CSS custom properties so the whole window
  // tracks the current track. The wash is what makes the glass cards look
  // frosted — backdrop-filter needs colour/shape behind it to blur. The
  // bottom layer is the base colour.
  background:
    radial-gradient(
      ellipse 70% 55% at 12% 8%,
      color-mix(in oklab, var(--cover-accent) 45%, transparent) 0%,
      transparent 55%
    ),
    radial-gradient(
      ellipse 55% 50% at 88% 92%,
      color-mix(in oklab, var(--accent) 32%, transparent) 0%,
      transparent 60%
    ),
    radial-gradient(
      ellipse 40% 35% at 50% 50%,
      color-mix(in oklab, var(--cover-accent) 12%, transparent) 0%,
      transparent 70%
    ),
    radial-gradient(
      ellipse 100% 80% at 50% 50%,
      transparent 35%,
      rgba(0, 0, 0, 0.35) 100%
    ),
    var(--bg-base);
  // NB: no `background-attachment: fixed`. The app never scrolls, so fixed
  // gave zero benefit but forced the background into a viewport-sized
  // composited layer that Chromium failed to repaint across the full height
  // after a window resize, leaving the lower part painted white. Default
  // (scroll) attachment paints as part of normal element paint, reliably.
  color: var(--text-primary);

  // Theme transitions — short so the change feels responsive, not laggy.
  transition: background-color 0.3s ease, color 0.3s ease;

  user-select: none;
  // NB: drag is set on the titlebar only. Putting it on body would swallow
  // clicks on every interactive control.
}
```

## `styles/components/_app-shell.scss` (root layout + film grain + bento grid + glass card)

```scss
@use '../abstracts' as *;

// ─────────────────────────────────────────────────────────────────
// App shell: the root layout column, the film-grain + cover-wash backing
// layers, the Bento grid + its "tray" backing plate, and the shared
// glass-card surface used by the side cards.
// ─────────────────────────────────────────────────────────────────

.app {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  height: 100vh;
  padding: 56px 24px 24px; // 56px clears the 40px titlebar + breathing
  gap: 16px;
  background: var(--bg-primary);
  color: var(--text-primary);
  overflow: hidden;
  // Create a local stacking context so z-index children (bg-layer, film
  // grain) are contained inside .app rather than participating in the root
  // stacking context. Without this, z-index: 0 absolute children render ON
  // TOP of the normal-flow app-grid, and glass cards' backdrop-filter has
  // nothing to blur.
  z-index: z('base');
}

// Film grain overlay — pure-CSS cinematic grain. A single inline SVG
// (feTurbulence + feColorMatrix) tiles across the window and is composited
// with mix-blend-mode: overlay, which brightens highlights and deepens
// shadows. Opacity is low (~6%) so it adds texture without looking dirty.
.app::before {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='220' height='220'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.65 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.85'/%3E%3C/svg%3E");
  background-repeat: repeat;
  opacity: 0.06;
  mix-blend-mode: overlay;
  z-index: z('base');
}

// Full-window blurred cover wash. Gives the glass cards a rich backdrop to
// blur. background-image is set via JS on .bg-layer so it tracks the track.
.bg-layer {
  position: absolute;
  inset: 0;
  z-index: z('bg-layer');
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;
  opacity: 0.32;
  pointer-events: none;
  transition: opacity 1.2s ease;
}

// Bento grid: cover card (big, left) | side column (now-playing + lyrics).
.app-grid {
  display: grid;
  // Cover dominates — 1.6 : 1 means the cover gets ~62% of the row width.
  grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr);
  gap: 14px;
  flex: 1 1 auto;
  min-height: 0;
  // Own stacking context so the ::before backing plate stays contained here
  // — behind the cards but above the window bg-layer.
  position: relative;
  z-index: z('base');
}

// Backing plate ("tray"): a dim glass panel behind all the cards, inset
// slightly beyond the grid so the cards read as floating ON it (visionOS
// depth cue). Deliberately NO backdrop-filter here — nesting a second
// blurred layer under the cards' own backdrop-filter is fragile in Chromium.
.app-grid::before {
  content: '';
  position: absolute;
  inset: -10px;
  z-index: z('bg-layer');
  border-radius: calc(var(--radius-xl) + 6px);
  background: color-mix(in oklab, var(--bg-base) 62%, transparent);
  border: 1px solid color-mix(in oklab, var(--text-primary) 5%, transparent);
  box-shadow:
    inset 0 1px 0 color-mix(in oklab, var(--text-primary) 6%, transparent),
    inset 0 0 40px color-mix(in oklab, #000 18%, transparent);
  pointer-events: none;
}

// Glass card base — BACKGROUND tier. The side-column cards use this: a touch
// more transparent and a lighter blur than the hero, so they sit visually
// behind the cover card even though they're coplanar.
.glass-card {
  position: relative;
  background: color-mix(
    in oklab,
    var(--cover-accent) 6%,
    rgba(255, 255, 255, 0.045)
  );
  border: 1px solid color-mix(in oklab, var(--cover-accent) 14%, var(--border));
  border-radius: var(--radius-xl);
  @include backdrop-blur(30px, 160%);
  box-shadow:
    var(--shadow-md),
    inset 0 1px 0 rgba(255, 255, 255, 0.08),
    inset 0 -1px 0 rgba(0, 0, 0, 0.12);
  overflow: hidden;
  transition:
    transform 0.4s var(--ease-out),
    box-shadow 0.4s var(--ease-out),
    background 0.8s ease,
    border-color 0.4s ease;
}

.glass-card:hover {
  transform: translateY(-2px);
  box-shadow:
    var(--shadow-lg),
    inset 0 1px 0 rgba(255, 255, 255, 0.12),
    inset 0 -1px 0 rgba(0, 0, 0, 0.14);
}

// Responsive: collapse side column on narrow heights.
@media (max-height: $bp-short) {
  .app-grid {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  }
  .cover-card {
    padding: 16px;
    gap: 12px;
  }
}
```

## `styles/components/_titlebar.scss`

```scss
@use '../abstracts' as *;

// Top window bar: drag region + source switch + provider controls + auth.

.titlebar {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: 40px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 16px 0 96px; // 96px clears the macOS traffic-light area
  -webkit-app-region: drag;
  background: transparent;
  z-index: z('titlebar');
}

.titlebar > * {
  -webkit-app-region: no-drag;
}

.titlebar-btn {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-secondary);
  padding: 4px 10px;
  border-radius: 12px;
  background: var(--bg-overlay);
  border: 1px solid var(--border);
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.titlebar-btn:hover {
  background: var(--bg-overlay-strong);
  color: var(--text-primary);
  border-color: var(--border-strong);
}

.titlebar-btn:disabled {
  opacity: 0.5;
  cursor: default;
}

.preset-select {
  font-size: 11px;
  font-weight: 500;
  color: var(--text-secondary);
  background: var(--bg-overlay);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 3px 10px;
  cursor: pointer;
  outline: none;
  transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
}

.preset-select:hover {
  color: var(--text-primary);
  border-color: var(--border-strong);
  background: var(--bg-overlay-strong);
}

.login-btn {
  background: var(--accent);
  color: #fff;
  border-color: var(--accent);
  // Push login to the right edge of the titlebar; everything before it
  // clusters on the left.
  margin-left: auto;
}

.login-btn:hover {
  background: var(--accent-hover);
  color: #fff;
  border-color: var(--accent-hover);
}

// Logged-in equivalent of .login-btn — same push-to-right behaviour.
.account-btn {
  margin-left: auto;
  max-width: 160px;
  @include truncate;
}

.reset-btn {
  font-size: 14px;
  line-height: 1;
  color: var(--text-tertiary);
  padding: 2px 8px;
}

.reset-btn:hover {
  color: var(--accent);
  background: var(--bg-overlay-strong);
  border-color: var(--border-strong);
}
```

## `styles/components/_dropdown-menu.scss` (shared source/quality dropdown)

```scss
@use '../abstracts' as *;

// Shared dropdown used by both the source switch and the quality switch in
// the titlebar. The wrapper anchors the absolutely-positioned menu to its
// trigger button; a fixed transparent backdrop catches outside clicks.

.source-switch {
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.source-switch-icon {
  font-size: 12px;
  opacity: 0.7;
}

// The wrapper sits in the titlebar's normal flex flow. The menu uses
// position:absolute relative to this wrap. We DO NOT use position:fixed —
// that takes the wrap out of flex flow and makes sibling buttons overlap.
.source-switch-wrap {
  position: relative;
  display: inline-flex;
}

.source-menu-backdrop {
  position: fixed;
  inset: 0;
  z-index: z('menu-backdrop');
}

.source-menu {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: z('menu');
  min-width: 158px;
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  background: var(--bg-overlay-strong);
  border: 1px solid var(--border-strong);
  border-radius: 12px;
  box-shadow: var(--shadow-lg);
  @include backdrop-blur(40px);
}

.source-menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 10px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 13px;
  text-align: left;
  cursor: pointer;
  transition: background 0.12s ease, color 0.12s ease;
}

.source-menu-item:hover:not(.source-menu-item--disabled) {
  background: var(--bg-overlay);
  color: var(--text-primary);
}

.source-menu-item--active {
  color: var(--text-primary);
}

.source-menu-item--disabled {
  opacity: 0.4;
  cursor: default;
}

.source-menu-check {
  width: 12px;
  color: var(--accent);
}

.source-menu-label {
  flex: 1;
}

// Quality dropdown lives in the titlebar; anchor its menu to the button.
.quality-wrap {
  position: relative;
  display: inline-flex;
}

// Right-aligned menu variant (so it doesn't overflow the window edge).
.source-menu--right {
  left: auto;
  right: 0;
}
```

## `styles/components/_cover-card.scss` (legacy hero card — glass tier, unused by MonsterBeatsView)

```scss
@use '../abstracts' as *;

// ─────────────────────────────────────────────────────────────────
// Cover card (left, big) — FOREGROUND / hero tier. Brighter, more saturated
// glass, a stronger cover-tinted rim, a heavier blur, and a bigger drop
// shadow than the side cards, so it reads as the closest layer (visionOS
// spatial depth). Holds the cover art + its mirror reflection + track meta.
// ─────────────────────────────────────────────────────────────────

.cover-card {
  position: relative;
  display: block;
  padding: 16px;
  background: color-mix(
    in oklab,
    var(--cover-accent) 12%,
    rgba(255, 255, 255, 0.1)
  );
  border: 1px solid
    color-mix(in oklab, var(--cover-accent) 30%, var(--border-strong));
  border-radius: var(--radius-xl);
  overflow: hidden;
  box-shadow:
    var(--shadow-lg),
    0 0 0 1px color-mix(in oklab, var(--cover-accent) 12%, transparent),
    inset 0 1px 0 rgba(255, 255, 255, 0.18),
    inset 0 -1px 0 rgba(0, 0, 0, 0.16);
  transition: box-shadow 0.4s var(--ease-out);
}

// Static frosted layer. Sibling of (not ancestor of) the animated cover art,
// so nothing inside it animates and nothing inside .cover-card-inner can
// trigger re-rasterisation of its cached backdrop.
.cover-card-frost {
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  background: color-mix(
    in oklab,
    var(--cover-accent) 6%,
    rgba(255, 255, 255, 0.04)
  );
  @include backdrop-blur(44px, 190%);
}

// Inner content wrapper — sits ABOVE the frost layer (z-index 1) and owns the
// grid rows. The per-frame .cover-art transform happens here, on a sibling of
// the frost layer, so it never invalidates the backdrop-filter cache.
.cover-card-inner {
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-rows: minmax(0, 1fr) auto;
  gap: 14px;
  height: 100%;
}

.cover-card:hover {
  box-shadow:
    var(--shadow-lg),
    0 24px 60px color-mix(in oklab, #000 45%, transparent),
    0 0 0 1px color-mix(in oklab, var(--cover-accent) 18%, transparent),
    inset 0 1px 0 rgba(255, 255, 255, 0.22),
    inset 0 -1px 0 rgba(0, 0, 0, 0.18);
}

// Cover stack: original cover-art on top + a blurred mirror reflection
// below. Both share the same background-image (set on .cover-art via JS;
// the reflection reads background-image: inherit). overflow:hidden clips the
// reflection to the rounded shape. The track-change animation lives here:
// the parent has key={track.id} so React remounts the stack on each track,
// replaying this keyframe.
.cover-stack {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 0;
  border-radius: calc(var(--radius-xl) - 8px);
  overflow: hidden;
  animation: cover-stack-enter 0.55s cubic-bezier(0.34, 1.4, 0.55, 1) both;
}

@keyframes cover-stack-enter {
  from {
    opacity: 0;
    transform: scale(0.96);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

@keyframes cover-meta-enter {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@media (prefers-reduced-motion: reduce) {
  .cover-stack,
  .cover-meta {
    animation: none;
  }
}

.cover-art {
  position: absolute;
  inset: 0;
  background-color: var(--bg-secondary);
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;
  box-shadow:
    0 20px 50px rgba(0, 0, 0, 0.45),
    0 0 0 1px rgba(255, 255, 255, 0.06);
  transition: box-shadow 0.8s var(--ease-out);
}

// Mirror reflection: bottom 30% of the stack, vertically flipped, blurred,
// and faded out with a top-to-bottom mask so it bleeds into the dark
// background instead of cutting hard at the cover edge.
.cover-art-reflection {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 30%;
  background-image: inherit;
  background-size: 100% auto;
  background-position: bottom center;
  transform: scaleY(-1);
  filter: blur(8px);
  opacity: 0.5;
  -webkit-mask-image: linear-gradient(
    to bottom,
    rgba(0, 0, 0, 0.95) 0%,
    rgba(0, 0, 0, 0) 100%
  );
  mask-image: linear-gradient(
    to bottom,
    rgba(0, 0, 0, 0.95) 0%,
    rgba(0, 0, 0, 0) 100%
  );
  pointer-events: none;
}

.cover-card.is-playing .cover-art {
  transform: scale(calc(1 + var(--bass-intensity, 0) * 0.03));
  will-change: transform;
  box-shadow:
    0 22px 55px rgba(0, 0, 0, 0.5),
    0 0 100px 4px var(--cover-glow),
    0 0 0 1px rgba(255, 255, 255, 0.08);
  transition: transform 0.09s linear, box-shadow 0.8s var(--ease-out);
}

@media (prefers-reduced-motion: reduce) {
  .cover-card.is-playing .cover-art {
    transform: none;
    transition: none;
  }
}

// Sheen sweep: a diagonal translucent highlight that glides across the card
// every 8s. The keyframe holds it off-screen 60%→100% so it reads as an
// event, not a constant shimmer. mix-blend-mode: screen keeps it additive.
.cover-card::after {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  width: 55%;
  height: 100%;
  background: linear-gradient(
    100deg,
    transparent 30%,
    rgba(255, 255, 255, 0.09) 50%,
    transparent 70%
  );
  transform: translateX(-100%);
  animation: cover-sheen 8s ease-in-out infinite;
  pointer-events: none;
  z-index: z('sheen');
  mix-blend-mode: screen;
}

@keyframes cover-sheen {
  0% {
    transform: translateX(-100%);
  }
  55% {
    transform: translateX(220%);
  }
  100% {
    transform: translateX(220%);
  }
}

// While the search overlay is open, pause the sheen. The overlay's
// backdrop-filter re-samples the cover behind it; a moving sheen would
// flicker through the blur on every scroll repaint.
.app.search-open .cover-card::after {
  animation-play-state: paused;
}

@media (prefers-reduced-motion: reduce) {
  .cover-card::after {
    animation: none;
  }
}

.cover-art-placeholder {
  position: absolute;
  inset: 0;
  @include flex-center;
  font-family: var(--font-display);
  font-size: 96px;
  // Sits over the generated gradient (see placeholderCover) — a soft white
  // glyph reads cleanly on any hue, unlike the tertiary grey used pre-gradient.
  color: rgba(255, 255, 255, 0.55);
  text-shadow: 0 2px 12px rgba(0, 0, 0, 0.35);
}

.cover-meta {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  // Slide-in animation: parent has key={track.id} so React remounts it on
  // every track change, replaying this. The cubic-bezier with y > 1 gives a
  // slight overshoot (spring landing). Delayed 0.08s so the cover "arrives"
  // first, then the text follows.
  animation: cover-meta-enter 0.45s cubic-bezier(0.34, 1.4, 0.55, 1) 0.08s both;
}

.track-title {
  font-family: var(--font-display);
  font-size: clamp(28px, 3.6vw, 40px);
  font-weight: 500;
  font-variation-settings: 'opsz' 144, 'SOFT' 30;
  letter-spacing: -0.022em;
  color: var(--text-primary);
  line-height: 1.05;
  @include truncate;
}

.track-artist {
  font-size: 14px;
  font-weight: 400;
  color: var(--text-secondary);
  letter-spacing: 0;
  @include truncate;
}

.track-album {
  font-size: 12px;
  font-weight: 400;
  color: var(--text-tertiary);
  font-style: italic;
  @include truncate;
  margin-top: 2px;
}
```

## `styles/components/_side-cards.scss` (legacy now-playing / lyrics cards — unused by MonsterBeatsView)

```scss
@use '../abstracts' as *;

// Side column: the Now Playing info card + the synced Lyrics card, stacked.

.side-column {
  display: grid;
  grid-template-rows: minmax(0, 1fr) minmax(0, 1fr);
  gap: 14px;
  min-height: 0;
}

.side-card {
  padding: 16px 18px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

// Reusable pulse — used by .lyrics-loading for the "加载歌词…" shimmer.
@keyframes placeholder-pulse {
  0%,
  100% {
    opacity: 0.4;
  }
  50% {
    opacity: 0.9;
  }
}

// ── Lyrics card ──
.lyrics-card {
  padding: 16px 18px;
  overflow: hidden;
  min-height: 0;
}

.lyrics-panel {
  flex: 1 1 auto;
  overflow: hidden;
  min-height: 0;
  display: flex;
  align-items: stretch;
}

.lyrics-list {
  flex: 1 1 auto;
  overflow-y: auto;
  overflow-x: hidden;
  // Contain paint & layout: this scroll container sits inside a
  // backdrop-filter glass card. Without containment, every scroll repaint
  // leaks into the backdrop chain and forces the compositor to re-blur,
  // which can white-screen parts of the window (Chromium bug).
  // contain:layout+paint isolates the scroll paint; will-change:transform
  // promotes it to a GPU layer so the compositor never touches the backdrop.
  contain: layout paint;
  will-change: transform;
  @include custom-scrollbar;
  padding-right: 6px;
}

.lyrics-line {
  display: block;
  width: 100%;
  padding: 6px 0;
  text-align: left;
  font-family: var(--font-ui);
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-tertiary);
  background: transparent;
  border: none;
  cursor: pointer;
  border-radius: 4px;
  padding-left: 6px;
  transition:
    color 0.2s ease,
    transform 0.2s var(--ease-out),
    padding-left 0.2s var(--ease-out);
}

.lyrics-line:hover {
  color: var(--text-secondary);
}

.lyrics-line.is-active {
  color: var(--text-primary);
  font-weight: 500;
  font-size: 13px;
  transform: scale(1.02);
  padding-left: 10px;
  // Subtle left border accent on the active line, tinted to the cover colour.
  border-left: 2px solid color-mix(in oklab, var(--cover-accent) 70%, var(--accent));
}

.lyrics-line:focus-visible {
  outline: 1px solid var(--accent);
  outline-offset: -1px;
}

// No-lyrics / loading empty state. Shared between "暂无歌词" and "加载歌词…".
.lyrics-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  gap: 6px;
  color: var(--text-tertiary);
}

.lyrics-empty-glyph {
  font-family: var(--font-display);
  font-size: 40px;
  opacity: 0.35;
}

.lyrics-empty-hint {
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  opacity: 0.7;
}

.lyrics-loading {
  // subtle pulse so it's visually distinct from "no lyrics"
  animation: placeholder-pulse 2s ease-in-out infinite;
}

// ── Lyrics toolbar (source badge + copy-all / share) ──
.lyrics-card-header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.lyrics-source-badge {
  font-size: 9px;
  letter-spacing: 0.04em;
  text-transform: none;
  color: var(--text-tertiary);
  border: 1px solid color-mix(in oklab, var(--text-tertiary) 35%, transparent);
  border-radius: 999px;
  padding: 1px 7px;
  line-height: 1.5;
}

.lyrics-actions {
  margin-left: auto;
  display: flex;
  gap: 2px;
}

.lyrics-action-btn {
  background: transparent;
  border: none;
  cursor: pointer;
  color: var(--text-tertiary);
  font-size: 13px;
  line-height: 1;
  padding: 2px 5px;
  border-radius: 4px;
  transition: color 0.2s ease, background 0.2s ease;

  &:hover {
    color: var(--text-primary);
    background: color-mix(in oklab, var(--text-tertiary) 12%, transparent);
  }
}

// Per-line hover copy button lives in a row wrapper so it doesn't shift the
// lyric text; the seek button keeps the full row width.
.lyrics-line-row {
  display: flex;
  align-items: center;

  .lyrics-line {
    flex: 1 1 auto;
  }
}

.lyrics-line-copy {
  flex: 0 0 auto;
  background: transparent;
  border: none;
  cursor: pointer;
  color: var(--text-tertiary);
  font-size: 11px;
  padding: 2px 4px;
  border-radius: 4px;
  opacity: 0;
  transition: opacity 0.15s ease, color 0.15s ease;
}

.lyrics-line-row:hover .lyrics-line-copy,
.lyrics-line-copy:focus-visible {
  opacity: 1;
}

.lyrics-line-copy:hover {
  color: var(--text-primary);
}

// Transient toast for copy/share feedback, anchored to the card bottom.
.lyrics-toast {
  position: absolute;
  left: 50%;
  bottom: 14px;
  transform: translateX(-50%);
  background: color-mix(in oklab, var(--text-primary) 85%, transparent);
  color: var(--bg-primary, #fff);
  font-size: 11px;
  padding: 5px 12px;
  border-radius: 999px;
  pointer-events: none;
  white-space: nowrap;
  animation: placeholder-pulse 2s ease-in-out infinite;
}

.lyrics-submit-link {
  font-size: 11px;
  color: var(--accent);
  text-decoration: none;
  margin-top: 4px;

  &:hover {
    text-decoration: underline;
  }
}

// 「换个源找歌词」按钮——主源 + altSources + lyrics.ovh 全 miss 时，按歌名+歌手
// 去其他有歌词 API 的平台再搜一次（QQ / 网易云 / Deezer）。命中即替换当前
// 歌词；未命中保持空态（用户可再点或去网易云提交）。
.lyrics-retry-btn {
  margin-top: 6px;
  padding: 4px 10px;
  font-size: 11px;
  color: var(--text);
  background: var(--surface-1);
  border: 1px solid var(--border);
  border-radius: 999px;
  cursor: pointer;
  transition: background 0.12s ease, border-color 0.12s ease;

  &:hover {
    background: var(--surface-2);
    border-color: var(--accent);
  }

  &:active {
    background: var(--surface-1);
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
}

.side-card-label {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--text-tertiary);
  display: flex;
  align-items: center;
  gap: 6px;
}

.side-card-label::before {
  content: '';
  display: inline-block;
  width: 3px;
  height: 10px;
  border-radius: 2px;
  background: var(--accent);
}

.now-playing-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px 18px;
}

.now-playing-cell {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.now-playing-cell-label {
  font-size: 10px;
  color: var(--text-tertiary);
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.now-playing-cell-value {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
  @include truncate;
}

.queue-card {
  // placeholder for upcoming songs / lyrics — kept simple in v1
}

.queue-empty {
  font-size: 12px;
  color: var(--text-tertiary);
  font-style: italic;
}
```

## `styles/components/_progress.scss` (legacy glass progress row)

```scss
@use '../abstracts' as *;

// Full-width progress row: thin bar with a hover-grown thumb dot, plus the
// time codes (left) and volume group (right) sharing the row below it.

.progress-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 0 4px;
}

.progress-bar {
  position: relative;
  width: 100%;
  height: 5px;
  background: color-mix(in oklab, var(--border) 80%, transparent);
  border-radius: 999px;
  cursor: pointer;
  transition: height 0.15s var(--ease-out);
}

.progress-bar:hover {
  height: 7px;
}

.progress-fill {
  height: 100%;
  // Width is fed at runtime via the --progress custom property (0–100),
  // set on the element by <ProgressBar>. Keeping the value in a CSS var
  // (rather than an inline width rule) keeps the styling rule here in SCSS.
  width: calc(var(--progress, 0) * 1%);
  // Cover-driven fill: darker end is the raw cover colour, bright end is the
  // lifted-toward-white version, giving a subtle sheen along the played
  // portion. No brand orange — a B&W cover reads as light grey.
  background: linear-gradient(90deg, var(--cover-accent) 0%, var(--accent-live) 100%);
  border-radius: 999px;
  position: relative;
  box-shadow: 0 0 8px color-mix(in oklab, var(--accent-live) 50%, transparent);
  transition: width 0.18s linear;
}

.progress-fill::after {
  // thumb dot that grows on hover
  content: '';
  position: absolute;
  right: -6px;
  top: 50%;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--text-primary);
  transform: translateY(-50%) scale(0);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.5);
  transition: transform 0.15s var(--ease-spring);
}

.progress-bar:hover .progress-fill::after {
  transform: translateY(-50%) scale(1);
}

.progress-time {
  // flex:1 so this fills the row width left of the volume group; without it
  // the box shrinks to content and space-between collapses.
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-family: var(--font-mono);
  font-size: 10.5px;
  color: var(--text-tertiary);
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.02em;
}

// Bottom of the progress row: time codes left, volume group right, on the
// same horizontal axis so the eye reads them as one balanced row.
.progress-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
```

## `styles/components/_volume.scss`

```scss
@use '../abstracts' as *;

// Volume group: mute toggle + slim custom range slider, sitting at the right
// end of the progress row's bottom line.

.volume-group {
  display: flex;
  align-items: center;
  gap: 8px;
}

.volume-btn {
  @include flex-center;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: transparent;
  border: none;
  color: var(--text-tertiary);
  cursor: pointer;
  padding: 0;
  transition: color 0.15s ease, background 0.15s ease;
}

.volume-btn:hover {
  color: var(--text-primary);
  background: var(--bg-overlay);
}

.volume-btn.is-muted {
  color: var(--text-tertiary);
}

// Slim custom range slider. The fill portion (left of thumb) is driven by
// the --volume custom property (0–100), set on the element by
// <VolumeControl>. Track height is deliberately thin so the slider reads as
// a horizontal accent next to the time codes.
.volume-slider {
  -webkit-appearance: none;
  appearance: none;
  width: 90px;
  height: 3px;
  border-radius: 999px;
  outline: none;
  cursor: pointer;
  background: linear-gradient(
    to right,
    var(--accent-live) calc(var(--volume, 0) * 1%),
    color-mix(in oklab, var(--text-primary) 18%, transparent) calc(var(--volume, 0) * 1%)
  );
}

.volume-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--text-primary);
  cursor: pointer;
  box-shadow: 0 0 0 0 transparent;
  transition: transform 0.12s var(--ease-spring), box-shadow 0.15s ease;
}

.volume-slider:hover::-webkit-slider-thumb {
  transform: scale(1.25);
  box-shadow: 0 0 0 4px color-mix(in oklab, var(--accent-live) 25%, transparent);
}

.volume-slider::-moz-range-thumb {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--text-primary);
  cursor: pointer;
  border: none;
  transition: transform 0.12s var(--ease-spring);
}

.volume-slider:hover::-moz-range-thumb {
  transform: scale(1.25);
}

.volume-btn:focus-visible,
.volume-slider:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
```

## `styles/components/_transport.scss` (legacy glass transport row)

```scss
@use '../abstracts' as *;

// Bottom transport row: dislike / like / play / skip.

.transport-row {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 2px 8px 0;
}

.control-btn {
  @include flex-center;
  color: var(--text-secondary);
  transition:
    color 0.2s ease,
    transform 0.2s var(--ease-spring),
    background 0.2s ease;
  padding: 6px;
  border-radius: 50%;
  background: transparent;
  border: none;
  cursor: pointer;
  position: relative;
}

.control-btn:hover:not(:disabled) {
  color: var(--text-primary);
  background: var(--bg-overlay);
  transform: scale(1.08);
}

.control-btn:disabled {
  opacity: 0.3;
  cursor: default;
}

.play-btn {
  width: 46px;
  height: 46px;
  background: var(--text-primary);
  color: var(--bg-primary) !important;
  border-radius: 50%;
  box-shadow:
    0 6px 20px rgba(0, 0, 0, 0.4),
    0 0 0 5px color-mix(in oklab, var(--cover-accent) 18%, transparent);
  transition: transform 0.2s var(--ease-spring), box-shadow 0.4s ease;
}

.play-btn:hover:not(:disabled) {
  background: var(--text-primary);
  color: var(--bg-primary) !important;
  transform: scale(1.08);
  box-shadow:
    0 8px 24px rgba(0, 0, 0, 0.5),
    0 0 0 8px color-mix(in oklab, var(--cover-accent) 28%, transparent);
}

// 推荐按钮 + 未配 key 的小红点提示。复用 .titlebar-btn 基础样式。
.reco-btn {
  position: relative;
}

.reco-key-dot {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #ff7b7b;
  box-shadow: 0 0 0 2px rgba(24, 24, 28, 0.96);
  pointer-events: none;
}

// ❤ 红心库按钮：复用 .titlebar-btn 基础样式，右侧带数字徽章。
.liked-btn {
  position: relative;
  font-size: 15px;
}

.liked-count-badge {
  margin-left: 4px;
  padding: 1px 6px;
  border-radius: 8px;
  background: $overlay-hover;
  color: $overlay-text-dim;
  font-size: 10px;
  font-weight: 600;
  line-height: 14px;
}

.like-btn.liked {
  color: var(--heart-active);
}

.like-btn.liked:hover {
  color: var(--heart-active);
  background: rgba(239, 68, 68, 0.08);
}

// Heart fan-out 角标：显示这一首被心动了多少个平台（>1 才显示）。绝对定位到
// ❤ 按钮右上角，背景用品牌色制造"小红点"感。
.like-btn-badge {
  position: absolute;
  top: 4px;
  right: 2px;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 9px;
  background: var(--heart-active, #ef4444);
  color: #fff;
  font-size: 10px;
  font-weight: 700;
  line-height: 18px;
  text-align: center;
  box-shadow: 0 0 0 2px rgba(24, 24, 28, 0.96);
  pointer-events: none;
}

.dislike-btn:hover:not(:disabled) {
  color: var(--text-primary);
  background: var(--bg-overlay);
}

// Spinner (loading state on play button).
.spinner {
  animation: rotate 1s linear infinite;
}

@keyframes rotate {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}
```

## `styles/components/_modal.scss` (shared frosted-dark modal shell)

```scss
@use '../abstracts' as *;

// Shared modal shell used by the search + reco-key dialogs (see the Modal
// component). Frosted-dark and theme-independent — it floats over a dimmed,
// blurred scrim regardless of the light/dark theme, so it draws from the
// fixed $overlay-* palette. (The NetEase modal is theme-aware and keeps its
// own bespoke shell in _netease-modal.scss.)

.modal-overlay {
  position: fixed;
  inset: 0;
  z-index: z('search-overlay');
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 64px;
  background: $scrim;
  backdrop-filter: blur(6px);
}

.modal-panel {
  width: min(92vw, 540px);
  max-height: 78vh;
  display: flex;
  flex-direction: column;
  background: $overlay-bg;
  border: 1px solid $overlay-border;
  border-radius: 16px;
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.5);
  overflow: hidden;
}
```

## `styles/components/_search-panel.scss` (search overlay internals + source chips)

```scss
@use 'sass:map';
@use '../abstracts' as *;

// Cross-platform search results. The overlay + panel shell live in
// _modal.scss (shared with the reco-key dialog via the Modal component); this
// file styles the search-specific innards. The always-dark $overlay-* palette
// is used so the panel stays legible over the dimmed scrim regardless of theme.

.search-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px;
  border-bottom: 1px solid $overlay-divider;
}

.search-input {
  flex: 1;
  height: 36px;
  padding: 0 12px;
  border-radius: 10px;
  border: 1px solid $overlay-field-border;
  background: $overlay-field-bg;
  color: $overlay-text;
  font-size: 14px;
  outline: none;
}

.search-input:focus {
  border-color: $overlay-field-border-hi;
}

.search-spinner {
  width: 16px;
  height: 16px;
  border: 2px solid rgba(255, 255, 255, 0.18);
  border-top-color: $accent-green;
  border-radius: 50%;
  animation: search-spin 0.8s linear infinite;
  flex-shrink: 0;
}

@keyframes search-spin {
  to {
    transform: rotate(360deg);
  }
}

.search-close {
  width: 32px;
  height: 36px;
  border: none;
  background: transparent;
  color: $overlay-icon;
  font-size: 22px;
  line-height: 1;
  cursor: pointer;
}

.search-close:hover {
  color: #fff;
}

// Source 切换条：在 search-bar 下方一行 5 个 chip（全部 / QQ / 网易云 /
// Spotify / Deezer），点击切到单平台搜索路径（fan-out 走 'all'）。
.search-source-toggle {
  display: flex;
  gap: 6px;
  padding: 8px 12px 4px;
  border-bottom: 1px solid $overlay-divider;
  overflow-x: auto;
}

.search-source-toggle__chip {
  height: 26px;
  padding: 0 10px;
  border-radius: 13px;
  border: 1px solid transparent;
  background: rgba(255, 255, 255, 0.06);
  color: $overlay-text-dim;
  font-size: 12px;
  white-space: nowrap;
  cursor: pointer;
  transition: background 0.12s ease, color 0.12s ease, border-color 0.12s ease;
}

.search-source-toggle__chip:hover:not(.is-active) {
  background: rgba(255, 255, 255, 0.12);
  color: $overlay-text;
}

.search-source-toggle__chip.is-active {
  background: $accent-green;
  color: #0b1c12;
  border-color: $accent-green;
  font-weight: 600;
}

.search-error {
  padding: 10px 14px;
  color: $overlay-error;
  font-size: 13px;
}

.search-empty {
  padding: 28px 14px;
  text-align: center;
  color: $overlay-text-mute;
  font-size: 13px;
}

.search-loading-more {
  padding: 12px 14px;
  text-align: center;
  color: $overlay-text-mute;
  font-size: 12px;
}

.search-results {
  overflow-y: auto;
  padding: 6px;
}

.search-row {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 10px;
  border: none;
  border-radius: 10px;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.search-row:hover:not(:disabled) {
  background: $overlay-hover;
}

.search-row--disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.search-cover {
  width: 48px;
  height: 48px;
  border-radius: 6px;
  object-fit: cover;
  flex-shrink: 0;
  background: $overlay-ph-solid;
}

.search-cover-ph {
  background: linear-gradient(135deg, $overlay-ph-a, $overlay-ph-b);
}

.search-row-meta {
  flex: 1;
  min-width: 0;
}

.search-row-title {
  color: $overlay-text;
  font-size: 14px;
  @include truncate;
}

.search-row-sub {
  color: $overlay-text-dim;
  font-size: 12px;
  @include truncate;
  margin-top: 2px;
}

.search-row-sources {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 4px;
}

// 平台 chip — 标出 unified 搜索结果在哪些平台能找到。默认小号、灰底；best
// 平台用对应平台主色 + ★；无版权的置灰斜杠。
.source-chip {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  height: 18px;
  padding: 0 6px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.02em;
  background: rgba(255, 255, 255, 0.08);
  color: #c0c0c6;
  line-height: 1;
  white-space: nowrap;
}

.source-chip--no-rights {
  text-decoration: line-through;
  opacity: 0.55;
}

// Per-platform "best source" accent, generated from $platform-colors so
// adding a platform is a one-line map edit rather than a new CSS block.
@each $name, $c in $platform-colors {
  .source-chip--best.source-chip--#{$name} {
    background: map.get($c, bg);
    color: map.get($c, fg);
  }
}

.source-chip-best {
  font-size: 9px;
}

.search-play-icon {
  color: $accent-green;
  opacity: 0;
  flex-shrink: 0;
}

.search-row:hover:not(:disabled) .search-play-icon {
  opacity: 1;
}

.search-no-rights {
  color: $overlay-text-faint;
  font-size: 11px;
  flex-shrink: 0;
  padding: 2px 6px;
  border-radius: 4px;
  background: $overlay-field-bg;
}
```

## `styles/components/_reco-key-modal.scss` (DeepSeek key dialog)

```scss
@use '../abstracts' as *;

// DeepSeek key dialog. Rendered inside the shared .modal-panel (see
// _modal.scss), so this only styles the inner header / body / form. Uses the
// same always-dark $overlay-* palette as the search panel for consistency.

.reco-modal-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px;
  border-bottom: 1px solid $overlay-divider;
}

.reco-modal-title {
  flex: 1;
  font-size: 14px;
  color: $overlay-text;
}

.reco-modal-close {
  width: 32px;
  height: 36px;
  border: none;
  background: transparent;
  color: $overlay-icon;
  font-size: 22px;
  line-height: 1;
  cursor: pointer;
}

.reco-modal-close:hover {
  color: #fff;
}

.reco-modal-body {
  padding: 16px 14px;
}

.reco-modal-hint {
  margin: 0 0 10px;
  font-size: 12px;
  line-height: 1.5;
  color: $overlay-text-dim;
}

.reco-modal-link {
  color: $accent-green;
}

.reco-modal-input {
  width: 100%;
  height: 36px;
  padding: 0 12px;
  border-radius: 10px;
  border: 1px solid $overlay-field-border;
  background: $overlay-field-bg;
  color: $overlay-text;
  font-size: 14px;
  outline: none;
}

.reco-modal-input:focus {
  border-color: $overlay-field-border-hi;
}

.reco-modal-actions {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}

.reco-modal-save {
  height: 34px;
  padding: 0 16px;
  border: none;
  border-radius: 10px;
  background: $accent-green;
  color: #06231a;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

.reco-modal-save:disabled {
  opacity: 0.5;
  cursor: default;
}

.reco-modal-cancel {
  height: 34px;
  padding: 0 14px;
  border: none;
  border-radius: 10px;
  background: transparent;
  color: $overlay-text-dim;
  font-size: 13px;
  cursor: pointer;
}

.reco-modal-cancel:hover {
  color: $overlay-text;
}
```

## `styles/components/_liked-modal.scss` (❤ library modal — virtualized list)

```scss
@use '../abstracts' as *;

// ❤ 红心库弹窗。共用 .modal-panel（_modal.scss），这里是内部样式：
// - 头部带平台计数 + 关闭
// - 中部滚动列表（支持千级条目）
// - 空态 + 底部"重新导入"
// - 行点击直接 playSearch
//
// 体验细节：
// - sessionStorage SWR：二次打开无白屏
// - 首次打开用 skeleton 行占位
// - 「重新导入」中顶部渐变条 + 中央心形脉动 overlay + 列表变暗

.liked-modal-panel {
  width: 480px;
  max-width: calc(100vw - 40px);
  max-height: calc(100vh - 80px);
  display: flex;
  flex-direction: column;
}

.liked-modal-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px;
  border-bottom: 1px solid $overlay-divider;
  flex-shrink: 0;
}

.liked-modal-title {
  font-size: 14px;
  color: #ff6b81; // 心红
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

// 后台拉新中指示：一个心红小点循环脉动，让用户知道现在显示的可能不是最新数据。
// 紧贴标题文字右侧，不占位，不抢戏——视觉重量 = 一颗 6px 圆点。
.liked-modal-syncing-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: $accent-green;
  box-shadow: 0 0 6px rgba(49, 194, 124, 0.6);
  animation: liked-syncing-pulse 1.2s ease-in-out infinite;
}

@keyframes liked-syncing-pulse {
  0%,
  100% {
    opacity: 0.4;
    transform: scale(0.85);
  }
  50% {
    opacity: 1;
    transform: scale(1.1);
  }
}

.liked-modal-count {
  flex: 1;
  font-size: 12px;
  color: $overlay-text-dim;
  text-align: right;
  padding-right: 8px;
}

.liked-modal-count-detail {
  color: $overlay-text-faint;
}

.liked-modal-close {
  width: 32px;
  height: 32px;
  border: none;
  background: transparent;
  color: $overlay-icon;
  font-size: 22px;
  line-height: 1;
  cursor: pointer;
  border-radius: 6px;
}

.liked-modal-close:hover {
  color: #fff;
  background: $overlay-hover;
}

.liked-modal-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 4px 0;
  // 虚拟滚动时 body 自身就是 scroll container——给子元素一个明确的全宽上下文。
  position: relative;
}

// 搜索条：header 与 body 之间的固定区（不随列表滚动）。
.liked-modal-search {
  position: relative;
  flex-shrink: 0;
  padding: 6px 16px 2px;
  border-bottom: 1px solid $overlay-divider;
}

.liked-modal-search-input {
  width: 100%;
  height: 32px;
  padding: 0 30px 0 12px;
  border: 1px solid $overlay-field-border;
  border-radius: 8px;
  background: $overlay-field-bg;
  color: $overlay-text;
  font-size: 13px;
  outline: none;
  transition: border-color 0.1s ease;

  &::placeholder {
    color: $overlay-text-faint;
  }

  &:focus {
    border-color: $overlay-field-border-hi;
  }
}

.liked-modal-search-clear {
  position: absolute;
  right: 22px;
  top: 50%;
  transform: translateY(-50%);
  width: 20px;
  height: 20px;
  border: none;
  border-radius: 50%;
  background: $overlay-hover;
  color: $overlay-text-faint;
  font-size: 12px;
  line-height: 20px;
  cursor: pointer;

  &:hover {
    color: $overlay-text;
  }
}

// 虚拟滚动列表容器：virtualizer 用它算 visible range。高度由 .liked-modal-body
// 的 flex: 1 + min-height: 0 决定；自己只负责内部 absolute 定位。
.liked-modal-list {
  list-style: none;
  margin: 0;
  padding: 0;
  // 兼容虚拟滚动（@tanstack/react-virtual）：内层行用 absolute 定位，
  // 外层容器不需要 list-style 等——保留原 reset 即可。
}

// 虚拟化时 group 不再是 <li>，而是 absolute 定位的 div。给它和原来 <li>
// 同样的 list-item 样式（底部无分隔线——视觉上是连续的列表）。
.liked-modal-virtual-list {
  position: relative;
  width: 100%;
}

.liked-modal-loading,
.liked-modal-error {
  padding: 40px 16px;
  text-align: center;
  font-size: 13px;
  color: $overlay-text-dim;
}

.liked-modal-error {
  color: $overlay-error;
}

.liked-modal-empty {
  padding: 60px 16px;
  text-align: center;
}

.liked-modal-empty-icon {
  font-size: 48px;
  color: $overlay-text-faint;
  margin-bottom: 12px;
}

.liked-modal-empty-text {
  font-size: 13px;
  color: $overlay-text-dim;
  margin-bottom: 16px;
}

.liked-modal-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.liked-modal-group {
  // 展开时给整组一个轻微的边界，让子列表在视觉上归属于这一组。
  &:has(.liked-modal-row.is-open) {
    background: rgba(255, 255, 255, 0.02);
  }
}

.liked-modal-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  cursor: pointer;
  transition: background-color 0.1s ease;
}

.liked-modal-row:hover {
  background: $overlay-hover;
}

.liked-modal-row:active {
  background: $overlay-field-bg;
}

.liked-modal-row.is-open {
  background: $overlay-hover;
}

// 移动端 accordion 风格的展开按钮：平台版本数 + 旋转的 chevron。
.liked-modal-toggle {
  display: flex;
  align-items: center;
  gap: 3px;
  flex-shrink: 0;
  height: 22px;
  padding: 0 6px;
  margin-left: 2px;
  border: 1px solid $overlay-field-border;
  border-radius: 11px;
  background: transparent;
  color: $overlay-text-dim;
  cursor: pointer;
  transition: all 0.12s ease;
}

.liked-modal-toggle:hover {
  border-color: $overlay-field-border-hi;
  background: $overlay-field-bg;
  color: $overlay-text;
}

.liked-modal-toggle-count {
  font-size: 11px;
  font-weight: 600;
  line-height: 1;
}

.liked-modal-toggle-chevron {
  font-size: 9px;
  line-height: 1;
}

// 展开后的各平台子列表。
.liked-modal-sublist {
  list-style: none;
  margin: 0;
  padding: 0 0 4px;
}

.liked-modal-subrow {
  display: flex;
  align-items: center;
  gap: 10px;
  // 左侧缩进对齐到封面右缘（封面 40 + gap 10 + padding 12），让子行明显是下级。
  padding: 6px 12px 6px 30px;
  cursor: pointer;
  transition: background-color 0.1s ease;
}

.liked-modal-subrow:hover {
  background: $overlay-hover;
}

.liked-modal-subrow:active {
  background: $overlay-field-bg;
}

// 子行前的连接圆点，暗示层级归属。
.liked-modal-subrow-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  flex-shrink: 0;
  background: $overlay-text-faint;
}

.liked-modal-subrow .liked-modal-track {
  font-size: 12px;
  font-weight: 400;
  color: $overlay-text-dim;
}

.liked-modal-cover {
  width: 40px;
  height: 40px;
  border-radius: 6px;
  object-fit: cover;
  flex-shrink: 0;
  background: $overlay-ph-a;
}

.liked-modal-cover-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  // Glyph sits over the per-song generated gradient (inline background-image).
  color: rgba(255, 255, 255, 0.7);
  background-size: cover;
  background-position: center;
}

.liked-modal-meta {
  flex: 1;
  min-width: 0;
}

.liked-modal-track {
  font-size: 13px;
  color: $overlay-text;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.liked-modal-artist {
  font-size: 11px;
  color: $overlay-text-dim;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-top: 2px;
}

.liked-modal-album {
  color: $overlay-text-faint;
}

.liked-modal-sources {
  display: flex;
  gap: 3px;
  flex-shrink: 0;
}

.liked-modal-badge {
  width: 18px;
  height: 18px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  font-weight: 600;
  color: #fff;
}

.liked-modal-badge-qq {
  background: #31c27c;
}

.liked-modal-badge-netease {
  background: #c20c0c;
}

.liked-modal-badge-spotify {
  background: #1db954;
}

.liked-modal-badge-deezer {
  background: #a238ff;
}

// ── 版本 / 翻唱 染色（Step 4 跨平台 fan-out 重构配套）───────────────
// 折叠行的组级徽章不染色（保留并集总览），子行徽章按 versionTag 加左边框
// 标识 + 内部小字标签，让用户一眼区分 studio / live / 翻唱。COVER 默认
// 折叠行用 ⚠ 标记，展开子行看斜体「翻唱」字样。
.liked-modal-badges {
  &--live {
    .liked-modal-badge { border-top: 2px solid #3b82f6; }
  }
  &--acoustic {
    .liked-modal-badge { border-top: 2px solid #a855f7; }
  }
  &--remix {
    .liked-modal-badge { border-top: 2px solid #f97316; }
  }
  &--instrumental {
    .liked-modal-badge { border-top: 2px solid #94a3b8; }
  }
  &--karaoke {
    .liked-modal-badge { border-top: 2px solid #64748b; }
  }
  &--demo {
    .liked-modal-badge { border-top: 2px solid #cbd5e1; }
  }
  &--edit {
    .liked-modal-badge { border-top: 2px solid #fbbf24; }
  }
  &--cover {
    // 翻唱：边框 + 内部字染色为「灰 + 斜体」，区别于录音版本。
    .liked-modal-badge {
      border-top: 2px solid #64748b;
      background-image: linear-gradient(135deg, transparent 45%, rgba(100,116,139,0.4) 50%, transparent 55%);
      font-style: italic;
    }
  }
}

.liked-modal-badge-version {
  display: none; // 默认隐藏，CSS 用 .liked-modal-badges--* 容器决定是否可见
}

// 子行版本标签（title 旁的 inline 小字）
.liked-modal-version-tag {
  display: inline-block;
  margin-left: 6px;
  padding: 1px 5px;
  border-radius: 3px;
  font-size: 10px;
  font-weight: 500;
  vertical-align: middle;

  &--live { background: rgba(59, 130, 246, 0.15); color: #60a5fa; }
  &--acoustic { background: rgba(168, 85, 247, 0.15); color: #c084fc; }
  &--remix { background: rgba(249, 115, 22, 0.15); color: #fb923c; }
  &--instrumental { background: rgba(148, 163, 184, 0.15); color: #94a3b8; }
  &--cover { background: rgba(100, 116, 139, 0.18); color: #94a3b8; font-style: italic; }
  &--karaoke { background: rgba(100, 116, 139, 0.15); color: #94a3b8; }
  &--demo { background: rgba(203, 213, 225, 0.15); color: #cbd5e1; }
  &--edit { background: rgba(251, 191, 36, 0.15); color: #fbbf24; }
}

// 折叠行末尾的「含翻唱」⚠ 提示
.liked-modal-cover-warn {
  font-size: 12px;
  color: #f59e0b;
  margin: 0 4px;
  flex-shrink: 0;
}

// 子行配色：子行的左侧 2px 描边让版本类型一眼可辨
.liked-modal-subrow {
  &--live { border-left: 2px solid rgba(59, 130, 246, 0.5); }
  &--acoustic { border-left: 2px solid rgba(168, 85, 247, 0.5); }
  &--remix { border-left: 2px solid rgba(249, 115, 22, 0.5); }
  &--instrumental { border-left: 2px solid rgba(148, 163, 184, 0.4); }
  &--cover { border-left: 2px solid rgba(100, 116, 139, 0.5); }
  &--karaoke { border-left: 2px solid rgba(100, 116, 139, 0.4); }
  &--demo { border-left: 2px solid rgba(203, 213, 225, 0.4); }
  &--edit { border-left: 2px solid rgba(251, 191, 36, 0.4); }
}

.liked-modal-footer {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-top: 1px solid $overlay-divider;
  flex-shrink: 0;
}

.liked-modal-refresh {
  height: 30px;
  padding: 0 12px;
  border: 1px solid $overlay-field-border;
  border-radius: 8px;
  background: transparent;
  color: $overlay-text;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.1s ease;
}

.liked-modal-refresh:hover:not(:disabled) {
  border-color: $overlay-field-border-hi;
  background: $overlay-hover;
}

.liked-modal-refresh:disabled {
  opacity: 0.5;
  cursor: default;
}

.liked-modal-hint {
  flex: 1;
  text-align: right;
  font-size: 11px;
  color: $overlay-text-faint;
}

// ── Skeleton 占位（首次打开、无 sessionStorage 缓存时） ──────
//
// 复用真实行结构（40×40 封面 + 双行 meta），尺寸 1:1，避免真数据到达时整
// 列下沉。每个块的 pulse 动画错开 60ms，做出"瀑布式"的轻微延迟感。
.liked-modal-skeleton-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.liked-modal-skeleton {
  cursor: default;
  pointer-events: none;
}

.liked-modal-skeleton-block {
  background: linear-gradient(
    90deg,
    rgba(255, 255, 255, 0.04) 0%,
    rgba(255, 255, 255, 0.10) 50%,
    rgba(255, 255, 255, 0.04) 100%
  );
  background-size: 200% 100%;
  animation: liked-skeleton-pulse 1.4s ease-in-out infinite;
}

.liked-modal-skeleton-line {
  height: 10px;
  border-radius: 3px;
  background: linear-gradient(
    90deg,
    rgba(255, 255, 255, 0.04) 0%,
    rgba(255, 255, 255, 0.10) 50%,
    rgba(255, 255, 255, 0.04) 100%
  );
  background-size: 200% 100%;
  animation: liked-skeleton-pulse 1.4s ease-in-out infinite;
}

.liked-modal-skeleton-line-track {
  width: 65%;
  margin-bottom: 8px;
}

.liked-modal-skeleton-line-artist {
  width: 40%;
  height: 8px;
}

@keyframes liked-skeleton-pulse {
  0% {
    background-position: 100% 0;
  }
  100% {
    background-position: -100% 0;
  }
}

// ── 「重新导入」中：顶部渐变同步条 ─────────────────────
//
// 浮在 header 下边缘的 2px 高条，从左到右循环滚动，做出"正在同步"的暗示。
// 类似 YouTube Music / Apple Music 的「syncing」指示。颜色用平台绿
// (#31c27c) + 白色淡出，看起来像信号灯。
.liked-modal-syncbar {
  position: absolute;
  top: 41px; // header 12+12+边框 1 + 行高 ≈ 此处
  left: 0;
  right: 0;
  height: 2px;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.04);
  z-index: 1;

  &::after {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    height: 100%;
    width: 40%;
    background: linear-gradient(
      90deg,
      transparent 0%,
      rgba(49, 194, 124, 0.0) 0%,
      $accent-green 50%,
      rgba(49, 194, 124, 0.0) 100%
    );
    animation: liked-syncbar-slide 1.4s ease-in-out infinite;
  }
}

@keyframes liked-syncbar-slide {
  0% {
    transform: translateX(-100%);
  }
  100% {
    transform: translateX(350%);
  }
}

// ── 「重新导入」中：列表中央的覆盖卡片 ─────────────────
//
// 绝对定位覆盖整个 body，模糊 + 半透明黑底，中央放心形脉动 spinner + 文字。
// 列表本身亮度降到 0.55 让背景仍然可见（用户知道自己在哪），但又被遮罩
// 引导视觉到中央。
.liked-modal-refresh-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  animation: liked-overlay-fade-in 0.18s ease-out;
  z-index: 2;
  border-radius: inherit;
}

@keyframes liked-overlay-fade-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

.liked-modal-refresh-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 18px 24px;
  border-radius: 12px;
  background: rgba(24, 24, 28, 0.85);
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.liked-modal-refresh-heart {
  font-size: 36px;
  line-height: 1;
  color: #ff6b81; // 心红（与 header title 同色）
  // 心形「心跳」动画：放大 + 缩小循环。2 次连击模拟真实心电图的「lub-dub」。
  animation: liked-heart-pulse 1.2s ease-in-out infinite;
  text-shadow: 0 0 16px rgba(255, 107, 129, 0.5);
}

@keyframes liked-heart-pulse {
  0%,
  100% {
    transform: scale(1);
    opacity: 0.95;
  }
  20% {
    transform: scale(1.18);
    opacity: 1;
  }
  40% {
    transform: scale(1);
    opacity: 0.9;
  }
  60% {
    transform: scale(1.1);
    opacity: 1;
  }
}

.liked-modal-refresh-title {
  font-size: 13px;
  color: $overlay-text;
  font-weight: 500;
}

.liked-modal-refresh-sub {
  font-size: 11px;
  color: $overlay-text-faint;
}

// ── 「重新导入」按钮内的小 spinner ────────────────────
//
// 空态"现在导入"和 footer "重新导入"按钮在 refreshing 时都内嵌一个 12px
// 旋转点。比把整个按钮加 :disabled opacity 更明确——用户知道是「正在做」
// 而不是「按钮坏了」。
.liked-modal-btn-spinner {
  display: inline-block;
  width: 12px;
  height: 12px;
  margin-right: 6px;
  vertical-align: -2px;
  border: 1.5px solid rgba(255, 255, 255, 0.25);
  border-top-color: #fff;
  border-radius: 50%;
  animation: liked-btn-spin 0.7s linear infinite;
}

@keyframes liked-btn-spin {
  to {
    transform: rotate(360deg);
  }
}

// 列表在 refreshing 时整体降亮度（让中央 overlay 更突出）。
// 虚拟化后 list 是 div，所以 selector 改用 class 而不是 element type。
.liked-modal-body:has(.liked-modal-refresh-overlay) .liked-modal-virtual-list {
  opacity: 0.55;
  transition: opacity 0.2s ease-out;
  pointer-events: none;
}
```

## `styles/components/_source-select.scss` (first-run picker screen)

```scss
@use '../abstracts' as *;

// First-run screen: pick a music source. Full-window centred card list.

.source-select {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100vh;
  padding: 0 var(--space-6) var(--space-6);
  gap: var(--space-6);
  isolation: isolate;
  overflow: hidden;
  background: var(--bg-base);
}

.source-titlebar {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: 40px;
  -webkit-app-region: drag;
  background: var(--glass-bg);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  border-bottom: 1px solid var(--glass-border);
  z-index: z('titlebar');
}

.source-heading {
  text-align: center;
}

.source-title {
  font-size: 28px;
  font-weight: 700;
  color: var(--text-primary);
  letter-spacing: -0.02em;
  margin-bottom: 6px;
  background: linear-gradient(135deg, var(--text-primary) 0%, var(--accent) 100%);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
}

.source-subtitle {
  font-size: 13px;
  color: var(--text-secondary);
  font-weight: 400;
}

.source-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  width: 100%;
  max-width: 360px;
}

.source-card {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  width: 100%;
  padding: var(--space-4) var(--space-5);
  border-radius: var(--radius-lg);
  background: var(--glass-bg);
  -webkit-backdrop-filter: var(--glass-blur);
  backdrop-filter: var(--glass-blur);
  border: 1px solid var(--glass-border);
  box-shadow: var(--shadow-md);
  transition:
    transform 0.25s var(--ease-spring),
    box-shadow 0.25s ease,
    border-color 0.25s ease,
    background 0.25s ease;
  text-align: left;
  position: relative;
  overflow: hidden;
}

.source-card::after {
  // Subtle gradient sweep that lights up on hover.
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(135deg, transparent 0%, var(--accent-soft) 100%);
  opacity: 0;
  transition: opacity 0.25s ease;
  pointer-events: none;
}

.source-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-lg);
  border-color: var(--border-strong);
}

.source-card:hover::after {
  opacity: 1;
}

.source-card-disabled,
.source-card-disabled:hover {
  opacity: 0.45;
  cursor: not-allowed;
  transform: none;
  box-shadow: var(--shadow-sm);
  border-color: var(--glass-border);
}

.source-card-disabled::after {
  display: none;
}

.source-logo {
  width: 52px;
  height: 52px;
  border-radius: var(--radius-md);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 22px;
  font-weight: 700;
  color: #fff;
  flex-shrink: 0;
  box-shadow: var(--shadow-sm);
}

.source-netease .source-logo {
  background: linear-gradient(135deg, #c20c0c 0%, #8b0000 100%);
}

.source-qq .source-logo {
  background: linear-gradient(135deg, #31c27c 0%, #1ba45e 100%);
}

.source-deezer .source-logo {
  background: linear-gradient(135deg, #a238ff 0%, #ff6e7f 100%);
  color: #fff;
}

.source-spotify .source-logo {
  background: linear-gradient(135deg, #1db954 0%, #0fa844 100%);
  color: #fff;
}

.source-meta {
  flex: 1;
  min-width: 0;
}

.source-name {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
  letter-spacing: -0.01em;
}

.source-desc {
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 2px;
  font-weight: 400;
}

.source-arrow {
  color: var(--text-tertiary);
  flex-shrink: 0;
  transition: transform 0.25s var(--ease-spring), color 0.25s ease;
}

.source-card:hover .source-arrow {
  color: var(--accent);
  transform: translateX(4px);
}
```

## `styles/components/_error-panel.scss`

```scss
@use '../abstracts' as *;

// Collapsible error panel — a one-line summary that expands to the full text
// with copy/close actions. Sits inside the cover-meta area.

.error-panel {
  margin-top: var(--space-2);
  width: 100%;
  max-width: 360px;
  background: var(--error-bg);
  border: 1px solid var(--error-border);
  border-radius: var(--radius-md);
  overflow: hidden;
  text-align: left;
  @include backdrop-blur(20px, 100%);
}

.error-summary {
  width: 100%;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: 6px var(--space-3);
  font-size: 11px;
  color: var(--error-fg);
  background: transparent;
  text-align: left;
  -webkit-app-region: no-drag;
  transition: background 0.15s ease;
}

.error-summary:hover {
  background: var(--bg-overlay);
}

.error-icon {
  flex-shrink: 0;
  font-size: 12px;
}

.error-summary-text {
  flex: 1;
  @include truncate;
}

.error-toggle {
  flex-shrink: 0;
  font-size: 10px;
  color: var(--error-fg-soft);
}

.error-panel.expanded .error-summary {
  border-bottom: 1px solid var(--error-border);
}

.error-detail {
  padding: var(--space-2) var(--space-3);
  max-height: 220px;
  overflow-y: auto;
}

.error-pre {
  margin: 0;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 10.5px;
  line-height: 1.45;
  color: var(--error-fg);
  white-space: pre-wrap;
  word-break: break-all;
  user-select: text;
}

.error-actions {
  display: flex;
  gap: 6px;
  margin-top: var(--space-2);
  justify-content: flex-end;
}

.error-action {
  font-size: 11px;
  padding: 4px 10px;
  border-radius: var(--radius-sm);
  background: var(--error-action-bg);
  color: var(--error-fg);
  -webkit-app-region: no-drag;
  transition: background 0.15s ease;
}

.error-action:hover {
  background: var(--error-border);
}
```

## `styles/components/_netease-modal.scss` (QR login modal — theme-aware)

```scss
@use '../abstracts' as *;

// NetEase QR-login modal. Unlike the search overlay this one is theme-aware
// (uses --glass-* tokens) and centred. Dead selectors from an earlier
// tabbed design (.qr-tabs / .qr-tab / .qr-img-wrap / .qr-status / .qr-hint /
// .qr-optional) were dropped in the SCSS migration.

.qr-modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.35);
  @include backdrop-blur(20px, 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: z('modal');
  animation: qr-fade-in 0.15s ease;
}

@keyframes qr-fade-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

.qr-modal {
  position: relative;
  width: 320px;
  max-height: 90vh;
  overflow-y: auto;
  padding: 24px 20px 20px;
  background: var(--glass-bg);
  -webkit-backdrop-filter: var(--glass-blur);
  backdrop-filter: var(--glass-blur);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  display: flex;
  flex-direction: column;
  align-items: stretch;
  -webkit-app-region: no-drag;
}

.qr-close {
  position: absolute;
  top: 8px;
  right: 12px;
  font-size: 22px;
  color: var(--text-tertiary);
  padding: 4px 8px;
  line-height: 1;
}

.qr-close:hover {
  color: var(--text-primary);
}

.qr-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 14px;
  text-align: center;
}

.qr-error {
  color: #c62828;
  font-size: 12px;
  padding: 8px 10px;
  background: rgba(198, 40, 40, 0.06);
  border-radius: 8px;
  margin-bottom: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.qr-image-wrap {
  position: relative;
  align-self: center;
  width: 200px;
  height: 200px;
  border-radius: 8px;
  overflow: hidden;
  background: #fff;
}

.qr-image {
  width: 100%;
  height: 100%;
  display: block;
}

.qr-image--loading {
  background: var(--bg-secondary);
}

.qr-refresh {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  font-size: 13px;
  font-weight: 500;
}

.qr-manual-toggle {
  margin-top: 12px;
  align-self: center;
  font-size: 12px;
  color: var(--text-secondary);
  text-decoration: underline;
}

.qr-manual-toggle:hover {
  color: var(--text-primary);
}

.qr-cookie-form {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.qr-field-label {
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 6px;
}

.qr-required {
  color: #c62828;
}

.qr-input {
  width: 100%;
  padding: 8px 10px;
  font-size: 12px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--bg-secondary);
  color: var(--text-primary);
  -webkit-app-region: no-drag;
}

.qr-input:focus {
  outline: none;
  border-color: var(--accent-hover);
}

.qr-help {
  margin-top: 8px;
  font-size: 11px;
  line-height: 1.5;
  color: var(--text-tertiary);
}

.qr-help a {
  color: var(--text-secondary);
  text-decoration: underline;
}

.qr-help code {
  background: var(--bg-secondary);
  padding: 0 4px;
  border-radius: 3px;
  font-size: 10px;
}

.qr-submit {
  margin-top: 14px;
  padding: 8px 14px;
  border-radius: 12px;
  background: var(--text-primary);
  color: var(--bg-primary);
  font-size: 13px;
  font-weight: 500;
}

.qr-submit:hover:not(:disabled) {
  opacity: 0.85;
}

.qr-submit:disabled {
  opacity: 0.5;
  cursor: default;
}
```

## `styles/components/_settings-modal.scss`

```scss
@use '../abstracts' as *;

// Settings dialog (会话快照 备份/导出/导入). Rendered inside the shared
// .modal-panel; same always-dark $overlay-* palette as reco-key / liked modals.

.settings-modal-panel {
  width: min(92vw, 520px);
}

.settings-modal-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 14px;
  border-bottom: 1px solid $overlay-divider;
}

.settings-modal-title {
  flex: 1;
  font-size: 14px;
  font-weight: 600;
  color: $overlay-text;
}

.settings-modal-close {
  width: 32px;
  height: 36px;
  border: none;
  background: transparent;
  color: $overlay-icon;
  font-size: 22px;
  line-height: 1;
  cursor: pointer;

  &:hover {
    color: #fff;
  }
}

.settings-modal-body {
  padding: 8px 14px 16px;
  overflow-y: auto;
  max-height: 70vh;
}

.settings-section {
  padding: 14px 0;
  border-bottom: 1px solid $overlay-divider;

  &:last-child {
    border-bottom: none;
  }
}

.settings-section-title {
  margin: 0 0 6px;
  font-size: 13px;
  font-weight: 600;
  color: $overlay-text;
}

.settings-section-hint {
  margin: 0 0 10px;
  font-size: 12px;
  line-height: 1.5;
  color: $overlay-text-dim;
}

.settings-path {
  padding: 8px 10px;
  border-radius: 8px;
  background: $overlay-field-bg;
  border: 1px solid $overlay-field-border;
  font-family: var(--font-mono, monospace);
  font-size: 11px;
  color: $overlay-text-dim;
  word-break: break-all;
  margin-bottom: 10px;
}

.settings-label {
  display: block;
  font-size: 11px;
  color: $overlay-text-mute;
  margin: 8px 0 4px;
}

.settings-input {
  width: 100%;
  height: 34px;
  padding: 0 12px;
  border-radius: 9px;
  border: 1px solid $overlay-field-border;
  background: $overlay-field-bg;
  color: $overlay-text;
  font-size: 13px;
  outline: none;

  &:focus {
    border-color: $overlay-field-border-hi;
  }
}

.settings-file {
  width: 100%;
  font-size: 12px;
  color: $overlay-text-dim;
  margin-bottom: 4px;
}

.settings-pass-row {
  display: flex;
  gap: 6px;
  align-items: center;
}

.settings-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 12px;
}

.settings-btn {
  height: 34px;
  padding: 0 16px;
  border: 1px solid $overlay-field-border;
  border-radius: 9px;
  background: $overlay-field-bg;
  color: $overlay-text;
  font-size: 13px;
  cursor: pointer;

  &:hover:not(:disabled) {
    background: $overlay-hover;
  }

  &:disabled {
    opacity: 0.5;
    cursor: default;
  }
}

.settings-btn-primary {
  background: $accent-green;
  border-color: transparent;
  color: #06231a;
  font-weight: 600;
}

.settings-btn-ghost {
  width: 34px;
  height: 34px;
  border: 1px solid $overlay-field-border;
  border-radius: 9px;
  background: transparent;
  color: $overlay-text-dim;
  font-size: 15px;
  cursor: pointer;

  &:hover {
    color: $overlay-text;
  }
}

.settings-count {
  font-size: 12px;
  color: $overlay-text-mute;
}

.settings-status {
  margin-top: 10px;
  font-size: 12px;
  line-height: 1.4;

  &--ok {
    color: $accent-green;
  }

  &--err {
    color: $overlay-error;
  }
}
```

## `styles/components/_auth-error-panel.scss`

```scss
@use '../abstracts' as *;

// Recovery panel rendered at App level when a login attempt fails.
// Sits above the cover-card area so it survives track swaps. Distinct
// from <ErrorPanel> (which is for transport/playback errors inside
// the cover card).

.auth-error-panel {
  position: fixed;
  left: 50%;
  bottom: var(--space-5);
  transform: translateX(-50%);
  z-index: z('modal');
  max-width: 480px;
  width: calc(100% - 2 * var(--space-3));
  background: var(--error-bg);
  border: 1px solid var(--error-border);
  border-radius: var(--radius-md);
  padding: var(--space-3);
  color: var(--error-fg);
  -webkit-app-region: no-drag;
  @include backdrop-blur(20px, 100%);
}

.auth-error-title {
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 4px;
}

.auth-error-detail {
  font-size: 11px;
  line-height: 1.4;
  color: var(--error-fg-soft);
  margin-bottom: var(--space-2);
  word-break: break-all;
}

.auth-error-actions {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.auth-error-btn {
  font-size: 11px;
  padding: 4px 10px;
  border-radius: var(--radius-sm);
  background: var(--accent);
  color: #fff;
  border: 1px solid var(--accent);
  cursor: pointer;
  transition: background 0.15s ease;
  -webkit-app-region: no-drag;
}

.auth-error-btn:hover {
  background: var(--accent-hover);
  border-color: var(--accent-hover);
}

.auth-error-btn-ghost {
  background: transparent;
  color: var(--error-fg);
  border-color: var(--error-border);
}

.auth-error-btn-ghost:hover {
  background: var(--error-border);
  color: var(--error-fg);
}
```

## `styles/components/_monster-beats.scss` (main player view — Monster Beats skin)

```scss
// ═══════════════════════════════════════════════════════════════════
// Monster Beats — avant-M 怪兽捕捉 UI
// 第三轮：对照 superdesign 设计稿（MONSTER BEATS | A.I. Collector Music Player）
//  1. 字体 Fredoka（@fontsource 本地打包）+ 顶栏 HUD 改图标条（❤⚡🗡🛡）
//  2. 雷达放大到 140px 并从顶栏下缘半挂
//  3. source badges 放大 96px：斜体粗字母 + QQ ★ 角标 + ♥ 红底角标 + ring 光晕
//  4. 精灵卡：banner 黑底白字 + 全息 holographic 流动 + Type 彩虹渐变描边白底徽章
//  5. encounter 卡头像换本地 SVG 机器人 + 选中卡 ✓ 角标
//  6. 战斗菜单重构为设计稿对称布局：左 2×2（FIGHT/BAG/PKMN/RUN）+ 中巨型 ▶ + 右 2×2
//  7. 背景 sparkle 四角星闪烁 + 底部彩虹渐变条
// ═══════════════════════════════════════════════════════════════════

@use '../abstracts' as *;

$sky-top: #5BC0FF;
$sky-bot: #8FE4FF;
$cream: #FFF8E7;
$navy: #0A1F3C;
$navy-soft: #1F3252;
$red: #FF3B3B;
$yellow: #FFD60A;
$blue: #2D7FFF;
$green: #4CD964;
$pink: #FF2D87;
$orange: #FF8C2A;

.mb-root {
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  background: linear-gradient(135deg, $sky-top 0%, $sky-bot 100%);
  overflow: hidden;

  &::before {
    content: '';
    position: absolute;
    inset: 0;
    background-image: repeating-linear-gradient(
      -45deg,
      rgba(255, 255, 255, 0.06) 0 1px,
      transparent 1px 6px
    );
    pointer-events: none;
    z-index: 0;
  }

  > * { position: absolute; }
  // 设计稿 1440x900 固定画布 → 舞台整体缩放适配任意窗口（--mb-scale 由 React 写入）
  .mb-stage {
    left: 50%; top: 110px; // 顶栏之下固定（Titlebar 40 + 设计条 70）
    width: 1440px; height: 900px;
    transform: translateX(-50%) scale(var(--mb-scale, 1));
    transform-origin: top center;
    z-index: 1;
    > * { position: absolute; }
  }

  // ── 四角星闪烁（设计稿 .sparkle） ────────────────────────
  .mb-sparkle {
    width: 12px; height: 12px;
    background: #fff;
    clip-path: polygon(50% 0%, 60% 40%, 100% 50%, 60% 60%, 50% 100%, 40% 60%, 0% 50%, 40% 40%);
    animation: mb-twinkle 3s infinite ease-in-out;
    z-index: 1;
    pointer-events: none;
  }
  @keyframes mb-twinkle {
    0%, 100% { opacity: 0.3; transform: scale(0.8); }
    50% { opacity: 1; transform: scale(1.2); }
  }

  // ═══════════════════════════════════════════════════════════════
  //  TOP STRIP — 黑底黄边，雷达半挂 + HUD 图标条 + 同步/收藏
  // ═══════════════════════════════════════════════════════════════
  .mb-top-strip {
    top: 0; left: 0; right: 0;
    height: 110px; // 40px Electron Titlebar 区（透明按钮浮于其上）+ 70px 设计条
    background: rgba(0, 0, 0, 0.92);
    border-bottom: 4px solid $yellow;
    display: flex;
    align-items: center;
    padding: 40px 18px 0 170px; // 左侧给半挂雷达让位；内容从 Titlebar 之下开始
    gap: 18px;
    z-index: 5;
  }

  // ── 大雷达：从顶栏左下缘半挂（设计稿 140px） ─────────────
  .mb-radar {
    position: absolute;
    left: 24px;
    bottom: -50px; // 半挂：20px 留在顶栏内，视觉上从顶栏下缘长出
    width: 140px; height: 140px;
    flex-shrink: 0;
    border: 4px solid #334155;
    border-radius: 50%;
    background: #0F172A;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
    overflow: hidden;
    z-index: 6;
    &::before, &::after {
      content: ''; position: absolute; inset: 0;
    }
    &::before {
      background: linear-gradient(90deg, transparent 49.5%, rgba(76, 217, 100, 0.35) 50%, transparent 50.5%);
    }
    &::after {
      background: linear-gradient(0deg, transparent 49.5%, rgba(76, 217, 100, 0.25) 50%, transparent 50.5%);
    }
  }
  .mb-radar-ring {
    position: absolute;
    border: 1px solid rgba(76, 217, 100, 0.4);
    border-radius: 50%;
    left: 50%; top: 50%;
    transform: translate(-50%, -50%);
    &--1 { width: 30%; height: 30%; }
    &--2 { width: 58%; height: 58%; }
    &--3 { width: 88%; height: 88%; }
  }
  .mb-radar-sweep {
    position: absolute; inset: 0;
    background: conic-gradient(from 0deg, transparent 0deg, rgba(76, 217, 100, 0.5) 30deg, transparent 60deg);
    animation: mb-radar-spin 3s linear infinite;
    border-radius: 50%;
  }
  .mb-radar-blip {
    position: absolute;
    width: 5px; height: 5px;
    background: $green; border-radius: 50%;
    top: 50%; left: 50%; transform: translate(-50%, -50%);
    box-shadow: 0 0 10px $green;
  }
  .mb-radar-label {
    position: absolute; inset: 0;
    display: flex; align-items: center; justify-content: center;
    color: $green; font-size: 11px; font-weight: 700;
    letter-spacing: 0.15em;
    text-shadow: 0 0 4px rgba(76, 217, 100, 0.8);
    z-index: 2;
  }
  @keyframes mb-radar-spin {
    from { transform: rotate(0deg); }
    to   { transform: rotate(360deg); }
  }

  // ── HUD 图标条（❤/⚡/🗡/🛡 圆形图标 + 进度条） ──────────
  .mb-hud-stats {
    flex: 1;
    display: flex; flex-direction: row; // 设计稿：4 组水平一行
    align-items: center;
    gap: 20px;
  }
  .mb-hud-stat {
    display: flex; align-items: center; gap: 8px;
    flex-shrink: 0;
  }
  .mb-hud-stat-icon {
    width: 28px; height: 28px;
    border-radius: 50%;
    border: 2px solid #fff;
    display: flex; align-items: center; justify-content: center;
    flex-shrink: 0;
    box-shadow: 0 2px 0 rgba(0, 0, 0, 0.35);
  }
  .mb-hud-stat-track {
    width: 110px; // 设计稿 w-24
    height: 12px;
    background: #1E293B;
    border-radius: 5px;
    overflow: hidden;
    border: 2px solid #475569;
  }
  .mb-hud-stat-fill {
    height: 100%;
    border-radius: 3px;
    transition: width 0.6s cubic-bezier(0.16, 1, 0.3, 1);
  }

  .mb-top-right {
    display: flex; align-items: center; gap: 14px;
    margin-left: auto;
  }
  .mb-sync-bar {
    display: flex; flex-direction: column; align-items: flex-end; gap: 3px;
  }
  .mb-sync-bar-text {
    color: $yellow; font-size: 10px; font-weight: 700;
    letter-spacing: 0.12em;
  }
  .mb-sync-bar-track {
    position: relative;
    width: 160px; height: 10px;
    background: #1E293B;
    border-radius: 999px;
    border: 2px solid rgba(255, 214, 10, 0.5);
  }
  .mb-sync-bar-fill {
    position: absolute; left: 1px; top: 1px; bottom: 1px;
    background: $yellow; border-radius: 999px;
    transition: width 0.5s ease;
  }
  .mb-sync-ball {
    position: absolute;
    width: 8px; height: 8px; border-radius: 50%;
    top: 50%; transform: translateY(-50%);
    &--start { left: 2px;  background: $red;   box-shadow: 0 0 6px $red; }
    &--end   { right: 2px; background: $green; box-shadow: 0 0 6px $green; }
  }

  .mb-bag {
    display: flex; align-items: center; gap: 6px;
    padding: 4px 14px;
    background: #1E293B;
    border: 2px solid $yellow;
    border-radius: 12px;
    color: #fff;
    cursor: default;
  }
  .mb-bag-count {
    font-weight: 700; font-size: 15px;
  }

  // ═══════════════════════════════════════════════════════════════
  //  4 大 source badge — 右上角独立大圆
  // ═══════════════════════════════════════════════════════════════
  .mb-source-badges {
    top: 92px; right: 24px;
    display: flex; gap: 16px;
    z-index: 4;
  }
  .mb-source-badge {
    --badge-color: #{$navy};
    position: relative;
    width: 96px; height: 96px;
    border-radius: 50%;
    background: var(--badge-color);
    border: 3px solid $navy;
    box-shadow: 0 0 0 8px rgba(255, 255, 255, 0.25);
    color: $cream;
    display: flex; align-items: center; justify-content: center;
    cursor: pointer;
    transition: transform 0.15s, box-shadow 0.15s;
    &:hover { transform: scale(1.08); }
    &.is-active {
      box-shadow: 0 0 0 4px $yellow, 0 0 0 10px rgba(255, 214, 10, 0.25);
      transform: scale(1.1);
    }
  }
  .mb-source-badge-star {
    position: absolute;
    top: -6px; right: -6px;
    width: 24px; height: 24px;
    border-radius: 50%;
    background: $yellow;
    border: 2px solid $navy;
    display: flex; align-items: center; justify-content: center;
  }
  .mb-source-badge-letter {
    font-size: 44px; font-weight: 900;
    font-style: italic;
    line-height: 1;
    text-shadow: 2px 2px 0 rgba(0, 0, 0, 0.35);
  }
  .mb-source-badge-heart {
    position: absolute;
    bottom: -8px; left: 50%; transform: translateX(-50%);
    display: flex; align-items: center; gap: 3px;
    background: $red;
    color: #fff;
    font-size: 9px; font-weight: 900;
    padding: 2px 8px;
    border-radius: 999px;
    border: 2px solid $navy;
    white-space: nowrap;
  }

  // ═══════════════════════════════════════════════════════════════
  //  CREATURE CARD (left) — 白底黄边 -3° 全息卡
  // ═══════════════════════════════════════════════════════════════
  .mb-creature-card {
    top: 96px; left: 24px;
    width: 360px;
    background: #fff;
    border: 4px solid $yellow;
    border-radius: 24px;
    box-shadow: 0 12px 30px rgba(0, 0, 0, 0.25);
    transform: rotate(-3deg);
    transform-origin: center;
    animation: mb-card-pop 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
    z-index: 3;
    display: flex; flex-direction: column;
    overflow: hidden;
  }
  @keyframes mb-card-pop {
    from { transform: rotate(-3deg) scale(0.85); opacity: 0; }
    to   { transform: rotate(-3deg) scale(1);    opacity: 1; }
  }
  .mb-creature-banner {
    background: #000;
    color: #fff;
    font-weight: 700;
    font-size: 13px;
    letter-spacing: 0.22em;
    padding: 10px 16px;
    text-align: center;
    flex-shrink: 0;
  }
  .mb-creature-art {
    position: relative;
    margin: 12px 14px 10px;
    flex: none;
    height: 220px;
    border-radius: 16px;
    overflow: hidden;
    background: linear-gradient(135deg, #3a3a3a 0%, #1a1a1a 100%);
    box-shadow: 0 4px 0 rgba(0, 0, 0, 0.2);
  }
  .mb-creature-art-img {
    position: absolute; inset: 0;
    background-size: cover; background-position: center;
  }
  .mb-creature-art-placeholder {
    position: absolute; inset: 0;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    color: $cream;
    font-size: 64px;
    line-height: 1;
  }
  .mb-creature-art-shine {
    position: absolute; inset: 0;
    background: linear-gradient(115deg, transparent 30%, rgba(255, 255, 255, 0.35) 50%, transparent 70%);
    background-size: 200% 200%;
    animation: mb-shine 3s linear infinite;
    pointer-events: none;
  }
  @keyframes mb-shine {
    from { background-position: 200% 0; }
    to   { background-position: -200% 0; }
  }
  // 全息流动（设计稿 .holographic-card）
  .mb-creature-art-holo {
    position: absolute; inset: 0;
    background: linear-gradient(135deg,
      rgba(255,255,255,0.22) 0%,
      rgba(255,0,255,0.10) 25%,
      rgba(0,255,255,0.10) 50%,
      rgba(255,255,0,0.10) 75%,
      rgba(255,255,255,0.22) 100%);
    background-size: 200% 200%;
    animation: mb-holo 5s linear infinite;
    pointer-events: none;
  }
  @keyframes mb-holo {
    0%   { background-position: 0% 0%; }
    100% { background-position: 200% 200%; }
  }
  .mb-creature-nameplate {
    display: flex; align-items: center; justify-content: space-between;
    margin: 0 14px 12px;
    padding: 8px 14px;
    background: $navy;
    border-radius: 10px;
    border-bottom: 4px solid rgba(0, 0, 0, 0.3);
    flex-shrink: 0;
  }
  .mb-creature-name-block {
    display: flex; flex-direction: column; gap: 1px;
    min-width: 0;
  }
  .mb-creature-album {
    color: #7DD3FC;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.06em;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .mb-creature-name {
    color: #fff;
    font-weight: 700;
    font-size: 18px;
    letter-spacing: 0.02em;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    min-width: 0;
  }
  .mb-creature-name-star { color: $yellow; display: flex; }

  .mb-creature-stats {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px 14px;
    padding: 0 14px;
    margin-bottom: 14px;
    flex-shrink: 0;
  }
  .mb-creature-stat {
    display: grid;
    grid-template-columns: 30px 1fr 44px;
    align-items: center;
    gap: 6px;
  }
  .mb-creature-stat-label {
    font-size: 10px; font-weight: 700; color: $navy;
  }
  .mb-creature-stat-track {
    height: 8px;
    background: rgba(10, 31, 60, 0.1);
    border-radius: 4px;
    overflow: hidden;
  }
  .mb-creature-stat-fill {
    height: 100%;
    border-radius: 4px;
    transition: width 0.6s cubic-bezier(0.16, 1, 0.3, 1);
  }
  .mb-creature-stat-value {
    font-size: 10px; font-weight: 700;
    text-align: right;
  }

  // ── Type 徽章：彩虹渐变描边 + 白底黑字（设计稿 ULTRA-ELEMENTAL） ──
  .mb-creature-type {
    padding: 0 14px 14px;
    display: flex; justify-content: flex-end;
    flex-shrink: 0;
  }
  .mb-creature-type-badge {
    --type-edge: #{$yellow};
    --type-fg: #{$navy};
    display: inline-block;
    padding: 4px 12px;
    font-size: 10px; font-weight: 900;
    letter-spacing: 0.08em;
    border-radius: 8px;
    background: var(--type-bg, #fff);
    color: var(--type-fg);
    border: 2px solid transparent;
    background-image: linear-gradient(#fff, #fff), var(--type-edge);
    background-origin: border-box;
    background-clip: padding-box, border-box;
    box-shadow: 0 3px 6px rgba(0, 0, 0, 0.2);
  }

  // ═══════════════════════════════════════════════════════════════
  //  BATTLE DIALOG (right, below source badges)
  // ═══════════════════════════════════════════════════════════════
  .mb-battle-dialog {
    top: 224px; right: 24px;
    width: 560px;
    max-height: 380px; // 长歌词内部滚动，底部与 battle-menu（≈640）保持间距
    background: $cream;
    border: 4px solid $navy;
    border-radius: 32px;
    box-shadow: 0 12px 30px rgba(0, 0, 0, 0.25);
    // 2026-08-14: 改 visible——原 hidden 把 position: absolute 的 NEXT
    // 按钮（bottom: -22px，半挂在 dialog 底边外）直接裁掉一半。长歌词滚动
    // 已经由内层 .mb-battle-body（overflow-y: auto）独立负责，不依赖此层
    // hidden 裁圆角。children 都没独立 background，cream 同色也不会透出。
    overflow: visible;
    display: flex; flex-direction: column;
    padding-bottom: 14px; // 给半挂 NEXT 让出空间
  }
  .mb-battle-status {
    display: flex; align-items: center; justify-content: space-between;
    gap: 12px;
    padding: 8px 16px;
    background: $cream;
    // 2026-08-14: 顶角圆角——配合 dialog 的 overflow: visible。dialog 自身
    // 是 32px + 4px 边框，内角约 28px；status bar 作为首个 child 顶角需要
    // 跟随 dialog 圆角，否则 cream 背景会把 dialog 圆角"啃"出方角（截图
    // 状态栏红黄绿点飘出 dialog 边外就是这个问题）。底角保持 0（紧贴
    // border-bottom 装饰线）。
    border-radius: 28px 28px 0 0;
    border-bottom: 2px solid rgba(10, 31, 60, 0.1);
    font-size: 10px; font-weight: 700;
    color: $navy;
    letter-spacing: 0.08em;
    flex-shrink: 0;
  }
  .mb-battle-status-left {
    display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
  }
  .mb-battle-status-item {
    background: #E2E8F0;
    color: $navy;
    padding: 2px 10px;
    border-radius: 999px;
    font-weight: 700;
    font-size: 10px;
    & + & { margin-left: 0; }
  }
  .mb-battle-status-item.dim { opacity: 0.55; }
  // TYPE 胶囊黄色（设计稿：LV 深蓝 / YEAR 灰 / TYPE 黄）
  .mb-battle-status-left .mb-battle-status-item:nth-child(3) {
    background: $yellow;
  }
  .mb-battle-status-left .mb-battle-status-item:first-child {
    background: $navy; color: #fff;
  }
  .mb-battle-dots {
    display: flex; align-items: center; gap: 4px;
  }
  .mb-battle-dot {
    width: 8px; height: 8px; border-radius: 50%;
    border: 1px solid rgba(10, 31, 60, 0.2);
    &--red    { background: $red; }
    &--yellow { background: $yellow; }
    &--green  { background: $green; }
  }
  .mb-battle-body {
    display: flex; gap: 18px;
    padding: 22px 24px 44px;
    flex: 1;
    min-height: 0; // flex 内允许收缩 → overflow 生效
    overflow-y: auto; // 长歌词滚动
    scrollbar-width: thin;
  }
  .mb-speaker-portrait {
    flex-shrink: 0;
    width: 72px; height: 72px;
    border-radius: 50%;
    background: #fff;
    border: 4px solid $navy;
    box-shadow: inset 0 0 0 2px $cream, 0 4px 0 rgba(0, 0, 0, 0.15);
    display: flex; align-items: center; justify-content: center;
    align-self: flex-start;
  }
  .mb-battle-text { flex: 1; min-width: 0; padding-top: 4px; }
  .mb-battle-line {
    color: $navy;
    line-height: 1.5;
    font-weight: 700;
    &--prev { font-size: 16px; opacity: 0.45; min-height: 1.5em; }
    &--current {
      font-size: 34px; font-weight: 900;
      color: $navy;
      margin: 6px 0;
      letter-spacing: -0.01em;
    }
    &--next { font-size: 16px; opacity: 0.6; min-height: 1.5em; }
  }
  .mb-battle-cursor {
    color: $red;
    margin-right: 6px;
    animation: mb-blink 1s steps(2) infinite;
  }
  @keyframes mb-blink {
    50% { opacity: 0; }
  }
  .mb-battle-source,
  .mb-battle-account {
    margin-top: 10px;
    font-size: 11px;
    color: $navy-soft;
    opacity: 0.7;
  }
  .mb-battle-next {
    position: absolute;
    bottom: -22px; right: 48px;
    z-index: 5; // 2026-08-14: 显式抬高层级——按钮挂在 dialog 底边外，可能压
                 // 上方被 encounter log / battle menu 的高 z-index 元素遮。
                 // dialog 自身 z 默认 0，下方元素若设了 z-index > 0 会盖按钮。
    display: flex; align-items: center; gap: 6px;
    padding: 10px 26px;
    background: $red;
    color: $cream;
    border: 3px solid $navy;
    border-bottom-width: 6px;
    border-radius: 16px;
    font-weight: 900; font-size: 14px;
    letter-spacing: 0.1em;
    cursor: pointer;
    transition: transform 0.1s, border-bottom-width 0.1s;
    &:hover:not(:disabled) {
      transform: translateY(2px);
      border-bottom-width: 4px;
    }
    &:active:not(:disabled) {
      transform: translateY(5px);
      border-bottom-width: 1px;
    }
    &:disabled { opacity: 0.4; cursor: not-allowed; }
  }

  // ═══════════════════════════════════════════════════════════════
  //  ENCOUNTER LOG (bottom-left)
  // ═══════════════════════════════════════════════════════════════
  .mb-encounter {
    bottom: 110px; left: 24px;
    width: 480px;
    z-index: 2;
    display: flex; flex-direction: column;
  }
  .mb-encounter-banner {
    background: $red;
    color: #fff;
    padding: 7px 16px;
    font-weight: 700;
    font-size: 12px;
    letter-spacing: 0.14em;
    border: 3px solid $navy;
    border-bottom: none;
    border-radius: 14px 14px 0 0;
    display: flex; align-items: center; gap: 8px;
    flex-shrink: 0;
    &-prefix { font-size: 14px; }
    &-sep { opacity: 0.55; }
  }
  .mb-encounter-grid {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 8px;
    background: rgba(255, 248, 231, 0.85);
    backdrop-filter: blur(6px);
    border: 3px solid $navy;
    border-radius: 0 0 14px 14px;
    padding: 12px;
    box-shadow: 0 6px 0 rgba(0, 0, 0, 0.2);
    flex-shrink: 0;
  }
  .mb-encounter-empty {
    grid-column: 1 / -1;
    padding: 28px 12px;
    text-align: center;
    color: $navy-soft;
    font-size: 12px;
    font-weight: 700;
    opacity: 0.65;
  }
  .mb-mini-card {
    --card-color: #{$blue};
    position: relative;
    background: #fff;
    border: 2px solid $navy;
    border-radius: 12px;
    padding: 10px 6px 8px;
    display: flex; flex-direction: column; align-items: center;
    gap: 4px;
    min-width: 0;
    &.is-active {
      border-color: $yellow;
      border-width: 3px;
      box-shadow: 0 0 0 3px rgba(255, 214, 10, 0.35), 0 0 12px rgba(255, 214, 10, 0.6);
      .mb-mini-card-match { background: $yellow; color: $navy; }
    }
  }
  .mb-mini-card-creature {
    width: 64px; height: 64px;
    display: flex; align-items: center; justify-content: center;
    flex-shrink: 0;
  }
  .mb-mini-card-check {
    position: absolute;
    top: -8px; right: -8px;
    width: 22px; height: 22px;
    border-radius: 50%;
    background: $yellow;
    border: 2px solid $navy;
    display: flex; align-items: center; justify-content: center;
  }
  .mb-mini-card-name {
    font-size: 10px; font-weight: 700; color: $navy;
    text-align: center;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    margin-top: 2px;
    max-width: 100%;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .mb-mini-card-type {
    font-size: 8px; font-weight: 700; color: $navy-soft;
    text-align: center;
    letter-spacing: 0.1em;
    margin-bottom: 2px;
  }
  .mb-mini-card-match {
    align-self: stretch;
    text-align: center;
    font-size: 9px; font-weight: 900;
    color: $navy;
    background: rgba(10, 31, 60, 0.08);
    padding: 2px 4px;
    border-radius: 4px;
    margin-top: 2px;
  }
  .mb-encounter-foot {
    align-self: center;
    margin-top: 8px;
    font-size: 11px; font-weight: 700;
    color: $navy;
    background: $yellow;
    padding: 3px 10px;
    border: 2px solid $navy;
    border-radius: 999px;
    flex-shrink: 0;
  }

  // ═══════════════════════════════════════════════════════════════
  //  BATTLE MENU (bottom-right) — 设计稿对称布局：左2×2 + 中▶ + 右2×2
  // ═══════════════════════════════════════════════════════════════
  .mb-battle-menu {
    bottom: 110px; right: 24px;
    display: flex;
    align-items: flex-end;
    gap: 20px;
    z-index: 3;
  }
  .mb-menu-col {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
    width: 264px;
  }
  .mb-menu-btn {
    --btn-color: #{$navy};
    border: 3px solid $navy;
    border-radius: 14px;
    background: var(--btn-color);
    color: $cream;
    font-size: 14px; font-weight: 900;
    letter-spacing: 0.1em;
    cursor: pointer;
    box-shadow: 0 5px 0 $navy;
    transition: transform 0.08s, box-shadow 0.08s;
    height: 70px;
    min-width: 0;
    display: flex; align-items: center; justify-content: center;
    gap: 4px;
    &:hover:not(:disabled) {
      transform: translateY(2px);
      box-shadow: 0 3px 0 $navy;
    }
    &:active:not(:disabled) {
      transform: translateY(5px);
      box-shadow: 0 0 0 $navy;
    }
    &:disabled { opacity: 0.4; cursor: not-allowed; box-shadow: 0 5px 0 rgba(10, 31, 60, 0.4); }

    &--red    { --btn-color: #{$red}; }
    &--yellow { --btn-color: #{$yellow}; color: $navy; }
    &--yellow.is-on { --btn-color: #{$red}; color: #fff; }
    &--green  { --btn-color: #{$green}; }
    &--blue   { --btn-color: #{$blue}; }
    &--pink   { --btn-color: #{$pink}; }
    &--white  { --btn-color: #fff; color: $navy; }
  }
  // 巨型播放键（设计稿 mega play：红圆白边 + 光晕）
  .mb-mega-play {
    position: relative;
    width: 96px; height: 96px;
    border-radius: 50%;
    background: $red;
    border: 6px solid #fff;
    box-shadow: 0 0 0 8px rgba(10, 31, 60, 0.08), 0 10px 24px rgba(0, 0, 0, 0.35);
    display: flex; align-items: center; justify-content: center;
    cursor: pointer;
    flex-shrink: 0;
    transition: transform 0.15s;
    &::before {
      content: '';
      position: absolute;
      inset: -14px;
      border-radius: 50%;
      background: rgba(255, 214, 10, 0.2);
      filter: blur(12px);
      animation: mb-pulse 2.4s ease-in-out infinite;
      z-index: -1;
    }
    &:hover:not(:disabled) { transform: scale(1.06); }
    &:active:not(:disabled) { transform: scale(0.95); }
    &:disabled { opacity: 0.5; cursor: not-allowed; }
    svg { margin-left: 2px; }
  }
  @keyframes mb-pulse {
    0%, 100% { opacity: 0.4; transform: scale(1); }
    50%      { opacity: 0.9; transform: scale(1.15); }
  }
  .mb-mega-play-spinner {
    color: #fff;
    font-size: 28px;
    font-weight: 900;
    animation: mb-blink 0.8s steps(2) infinite;
  }

  // ═══════════════════════════════════════════════════════════════
  //  PROGRESS BAR (bottom)
  // ═══════════════════════════════════════════════════════════════
  .mb-progress {
    bottom: 24px; left: 50%;
    transform: translateX(-50%);
    width: 720px;
    height: 44px;
    display: flex; align-items: center; gap: 12px;
    background: $navy;
    border: 3px solid $yellow;
    border-radius: 999px;
    padding: 0 18px;
    z-index: 3;
  }
  .mb-progress-time {
    color: $yellow; font-size: 11px; font-weight: 700;
    font-family: 'JetBrains Mono', 'SF Mono', Menlo, Consolas, monospace;
    min-width: 36px;
  }
  .mb-progress-track {
    flex: 1;
    height: 8px;
    background: rgba(255, 255, 255, 0.12);
    border-radius: 4px;
    position: relative;
    cursor: pointer;
  }
  .mb-progress-fill {
    position: absolute; left: 0; top: 0; bottom: 0;
    background: linear-gradient(90deg, $yellow 0%, $orange 100%);
    border-radius: 4px;
    transition: width 0.2s linear;
  }
  .mb-progress-handle {
    position: absolute;
    top: 50%;
    width: 14px; height: 14px;
    background: $cream;
    border: 2px solid $yellow;
    border-radius: 50%;
    transform: translate(-50%, -50%);
    box-shadow: 0 0 8px $yellow;
  }

  // ═══════════════════════════════════════════════════════════════
  //  BOTTOM RAINBOW STRIP（设计稿 .bottom-rainbow 8px）
  // ═══════════════════════════════════════════════════════════════
  .mb-bottom-rainbow {
    left: 0; right: 0; bottom: 0;
    height: 8px;
    background: linear-gradient(to right, $red, $yellow, $green, $blue, $pink);
    box-shadow: 0 -2px 10px rgba(0, 0, 0, 0.2);
    z-index: 6;
  }
}
```
