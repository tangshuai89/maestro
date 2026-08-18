# Pages — Component Dependency Trees

All paths are relative to `packages/renderer/src/`. Trees trace **local imports recursively** (node_modules skipped; `@maestro/common` and `@tanstack/react-virtual` are workspace/external packages and are noted but not expanded). `api.ts` is the shared IPC/client module — listed once per page as a leaf (it is a flat module, not a component tree).

Per the task note: hooks are included as dependencies but **not expanded beyond one level** (their direct local imports shown; those leaf modules are not recursed further).

---

## App (Root) — `App.tsx`

Entry: `App.tsx`
Dependencies:

```
- App.tsx
  - hooks/usePlayer.ts
    - hooks/useSpotifyWpsPlayer.ts (type-only import)
    - hooks/useCoverArt.ts
      - lib/coverColor.ts
      - lib/placeholderCover.ts
    - lib/debug.ts
  - hooks/useSpotifyWpsPlayer.ts
    - lib/spotify-wps.ts
      - lib/debug.ts
    - lib/debug.ts
  - hooks/useLyrics.ts
    - api.ts
  - hooks/useAuth.ts
    - auth/reducer.ts
      - api.ts (type-only)
    - auth/types.ts
      - api.ts (type-only)
  - hooks/useReco.ts
    - api.ts
  - hooks/useTheme.ts
    - lib/storage.ts
      - api.ts (type-only)
  - hooks/useDeezerEditorials.ts
    - api.ts
  - api.ts
  - lib/likedCache.ts
    - api.ts (type-only)
  - lib/debug.ts
  - components/source-select/SourceSelect.tsx
    - api.ts
  - components/views/MonsterBeatsView.tsx
    - api.ts (types + PROVIDER_LABELS)
  - components/layout/Titlebar.tsx
    - components/layout/SourceMenu.tsx
      - api.ts
    - components/layout/QualityMenu.tsx
      - api.ts
    - components/layout/DeezerPresetSelect.tsx
      - api.ts (type-only)
  - components/search/SearchPanel.tsx
    - api.ts
    - lib/format.ts
    - components/common/Modal.tsx
    - components/search/SourceChip.tsx
      - api.ts
  - components/modals/NeteaseCookieModal.tsx
    - api.ts
  - components/modals/RecoKeyModal.tsx
    - components/common/Modal.tsx
  - components/modals/LikedLibraryModal.tsx
    - components/common/Modal.tsx
    - api.ts
    - lib/groupLibrary.ts
      - api.ts (type-only)
    - lib/placeholderCover.ts
    - lib/likedCache.ts
      - api.ts (type-only)
    - @maestro/common (workspace pkg: displayKey / titleAliasMatch / VersionTag)
    - @tanstack/react-virtual (external)
  - components/modals/SettingsModal.tsx
    - components/common/Modal.tsx
    - api.ts
    - lib/backup-crypto.ts
    - lib/storage.ts
      - api.ts (type-only)
  - components/common/AuthErrorPanel.tsx
    - auth/types.ts
    - api.ts (type-only)
```

Render branches (state machine): `!player.provider` → SourceSelect; else `.app` shell with Titlebar + MonsterBeatsView + always-mounted `<audio>`; modals (NeteaseCookie / SearchPanel / RecoKey / LikedLibrary / Settings) + AuthErrorPanel conditionally. See `routes.md`.

---

## Main Player View — `components/views/MonsterBeatsView.tsx`

Entry: `components/views/MonsterBeatsView.tsx`

Dependencies:

```
- components/views/MonsterBeatsView.tsx
  - api.ts (types: Track, LyricLine, LyricsSource, MusicProvider, QqQuality; PROVIDER_LABELS)
  - [local, defined in-file — no separate component files]
    - HUDStat (top-strip HUD bars: icon + pct track)
    - CreatureStat (HP/ATK/DEF/SPD stat row)
    - MbIcon (lucide-style inline SVG icon, ICON_PATHS map)
    - BotAvatar (seeded robot avatar, SVG)
    - helpers: seededFromString / deriveStats / pickType / activeLineIndex / fmtTime
```

The view is fully self-contained — it has **no component imports** other than `api.ts`. It renders (all inside `.mb-root` → `.mb-stage`):
- top strip: radar + `.mb-hud-stats` (4× HUDStat) + sync bar + bag
- 4 circular source badges
- creature card (cover art via `coverBackdropRef`, stats, type badge)
- battle dialog (prev/current/next lyric lines + NEXT button)
- encounter log (up to 3 reco mini-cards with BotAvatar)
- battle menu (FIGHT/BAG/PKMN/RUN + mega play + prev/next/shuffle/repeat)
- bottom progress bar (click-to-seek) + rainbow strip

Props come straight from App.tsx (player/lyrics/reco/auth data + transport callbacks). Note: this is the "page" Superdesign will most likely be asked to reproduce.

---

## Search Panel — `components/search/SearchPanel.tsx`

Entry: `components/search/SearchPanel.tsx`

Dependencies:

```
- components/search/SearchPanel.tsx
  - api.ts (searchUnified / searchOne / fetchLyricsAvailability + types + PROVIDER_LABELS)
  - lib/format.ts (formatDuration)
  - components/common/Modal.tsx
  - components/search/SourceChip.tsx
    - api.ts (PROVIDER_LABELS + types)
```

Behavior: debounced (300ms) cross-platform search; source toggle (`all` | qq | netease | spotify | deezer); infinite scroll pagination (20/page); concurrent lyrics-availability probing (3 workers); 3s empty-state timeout. Rendered inside shared `Modal`.

---

## Liked Library Modal — `components/modals/LikedLibraryModal.tsx`

Entry: `components/modals/LikedLibraryModal.tsx`

Dependencies:

```
- components/modals/LikedLibraryModal.tsx
  - components/common/Modal.tsx
  - api.ts (getLibrary / importLibrary + types)
  - lib/groupLibrary.ts
    - api.ts (type-only)
  - lib/placeholderCover.ts
  - lib/likedCache.ts
    - api.ts (type-only)
  - @maestro/common (workspace pkg: displayKey / titleAliasMatch / VersionTag / versionTagLabel)
  - @tanstack/react-virtual (external — virtualized list)
  - [local, in-file]
    - PlatformBadges (per-platform color badges with version-tag styling)
    - SkeletonRow (loading placeholder row)
    - RefreshingOverlay (re-import progress card)
```

Behavior: stale-while-revalidate from sessionStorage; virtualized (3000+ rows); search filter (substring + `titleAliasMatch` + normalized `displayKey`); expandable cross-platform version groups; "重新导入" re-import with overlay.

---

## Settings Modal — `components/modals/SettingsModal.tsx`

Entry: `components/modals/SettingsModal.tsx`

Dependencies:

```
- components/modals/SettingsModal.tsx
  - components/common/Modal.tsx
  - api.ts (getStateSnapshot / importState / triggerBackup / getBackupInfo)
  - lib/backup-crypto.ts (encryptBundle / decryptBundle / generatePassphrase)
  - lib/storage.ts (collectLocalStorage / restoreLocalStorage)
  - [local, in-file]
    - StatusLine (ok/err status text)
```

Behavior: session-snapshot backup/export/import — three sections (local auto-backup info / passphrase-encrypted export / passphrase-decrypted import-merge). No other component dependencies.

---

## Source Select — `components/source-select/SourceSelect.tsx`

Entry: `components/source-select/SourceSelect.tsx`

Dependencies:

```
- components/source-select/SourceSelect.tsx
  - api.ts (getSpotifyStatus + MusicProvider type)
```

Behavior: first-run picker; static `SOURCES` config array; fetches Spotify tier to adapt that card's description. Only component dependency is `api.ts`. No other components.

---

## Shared leaf modules (referenced by multiple pages)

- `api.ts` — the renderer→server client (all `search*`, `getLibrary`, auth, reco, WPS calls + shared types `Track`, `MusicProvider`, `UnifiedSearchItem`, `PROVIDER_LABELS`, etc.). Referenced by virtually every page.
- `components/common/Modal.tsx` — overlay shell used by SearchPanel, RecoKeyModal, LikedLibraryModal, SettingsModal.
- `lib/format.ts` — `formatTime` / `formatDuration` (ProgressBar, SearchPanel).
- `lib/likedCache.ts` — sessionStorage cache of the merged library (App.tsx, LikedLibraryModal).
- `lib/storage.ts` — theme + local-state persistence (useTheme, SettingsModal).
