# Routes — State Machine of `App.tsx`

This app is **NOT route-based**. It is a single-window Electron renderer (React 18, no router). `main.tsx` mounts `<App/>`; there is no `router/` config. "Pages" are conditional render branches in `App.tsx` (`packages/renderer/src/App.tsx`) driven by hook state.

## Boot chain

```
main.tsx
  └─ <App/>  (StrictMode)
       ├─ hooks: usePlayer / useSpotifyWpsPlayer / useLyrics / useAuth / useReco /
       │         useTheme / useDeezerEditorials  (all logic lives here)
       └─ render branches below
```

## State → component mapping (authoritative, from App.tsx)

| # | Condition (state) | Component(s) rendered | Notes |
|---|---|---|---|
| 1 | `!player.provider` | `SourceSelect` (`components/source-select/SourceSelect.tsx`) | Source picker screen. `?demo=qq\|netease\|deezer\|spotify` URL param writes localStorage and reloads to force a provider (dev helper). |
| 2 | `player.provider` set | `.app` shell: `Titlebar` + `.bg-layer` (cover wash) + `MonsterBeatsView` + always-mounted `<audio>` | The main player view. `search-open` class added to `.app` while search is open (freezes cover animations behind the overlay's backdrop-filter). |
| 3 | `auth.showCookieFallback` | `NeteaseCookieModal` (`components/modals/NeteaseCookieModal.tsx`) | QR → cookie fallback login for NetEase/QQ. |
| 4 | `player.searchOpen` | `SearchPanel` (`components/search/SearchPanel.tsx`) | Cross-platform unified search overlay (inside shared `Modal`). |
| 5 | `reco.recoKeyOpen` | `RecoKeyModal` (`components/modals/RecoKeyModal.tsx`) | DeepSeek API key dialog. |
| 6 | `likedOpen` | `LikedLibraryModal` (`components/modals/LikedLibraryModal.tsx`) | Merged ❤ library across platforms (virtualized list). |
| 7 | `settingsOpen` | `SettingsModal` (`components/modals/SettingsModal.tsx`) | Session-snapshot backup / export / import. |
| 8 | `auth.authError` | `AuthErrorPanel` (`components/common/AuthErrorPanel.tsx`) | Auth failure recovery, fixed bottom-center at App level. |

Modals 3–8 are all mounted **inside** the main player view branch (state 2) and are conditionally rendered (unmounted when closed). The `<audio>` element is never conditionally unmounted (Web Audio graph must stay valid).

## Key wiring (how App.tsx connects hooks → components)

- **usePlayer** (`hooks/usePlayer.ts`) owns the audio core: `provider`, `track`, `playing`, `loading`, `currentTime`, `duration`, `liked`, `fanOutCount`, `searchOpen`, `qqQuality`, `deezerPreset`, `bgLayerRef`, `coverBackdropRef`; actions `selectSource`, `switchToProvider`, `playSearch`, `handlePlayPause/Skip/Prev`, `handleLike/Dislike`, `seek`, `setSearchOpen`, `resetForSwitch`.
- **useAuth** (`hooks/useAuth.ts`) owns `auth.auth` (loggedIn/user/tier), `loggingIn`, `authError`, `showCookieFallback`; actions `handleNeteaseLogin`, `handleQqLogin`, `handleSpotifyLogin`, `handleLogout`, `handleRetry`, `handleDismissError`, `setShowCookieFallback`, `handleCookieFallbackSuccess`, `resetAuth`.
- **useLyrics** (`hooks/useLyrics.ts`) feeds `lyrics` / `lyricsSynced` / `lyricsSource` from `player.track` + provider.
- **useReco** (`hooks/useReco.ts`) feeds `recoStatus`, `recoRunning`, `recoKeyOpen`, `suggestions`; action `handleReco`, `handleSaveRecoKey`.
- **useTheme** (`hooks/useTheme.ts`) manages light/dark/system theme on `<html data-theme>`.
- **useDeezerEditorials** feeds `deezerEditorials` to Titlebar.
- **useSpotifyWpsPlayer** bridges Spotify Premium full-track playback; `audioRef` + `wpsRef` + `spotifyTierRef` are the shared refs threaded through.

## Cross-cutting handlers in App.tsx

- `handleSwitchSource` → `player.resetForSwitch()` + `auth.resetAuth()` (drop playback + auth, bounce to source picker). Used by Deezer "account" button and AuthErrorPanel's 切换音源.
- `handleResetLocal` → clears localStorage + sessionStorage, resets player/auth/theme.
- `reloadLikedCount()` → first paints cached count (from `readCachedLibrary`), then refreshes from `getLibrary()`; kept in sync via `likedVersion` polling after heart fan-out.
- Tray transport (Electron IPC): `window.electronAPI.onTrayCommand` routes play/pause/next/prev through a ref to usePlayer handlers; `reportPlaybackState` keeps tray label/tooltip in sync.

## What each "page" renders

- **Source picker** — full-window centred heading "选择音乐来源 / 挑一个音源，开始你的电台" + 4 glass source cards (NetEase 云 / QQ Q / Deezer D / Spotify S) with brand-tinted logo tiles + descriptions.
- **Main player view (Monster Beats)** — Pokémon-style game skin over the player: top strip (radar + HUD stat bars + sync/bag), 4 circular source badges top-right, legendary creature card (cover art + derived HP/ATK/DEF/SPD stats + element type), battle dialog (synced lyrics with blinking cursor), DeepSeek encounter log (AI suggestions as mini creature cards), bottom battle menu (FIGHT/BAG/PKMN/RUN + mega play + prev/next/shuffle/repeat), bottom progress bar, rainbow strip. Full detail in `pages.md` and `theme.md`.
- **Modals** — see table above; all are frosted-dark panels over a dimmed scrim via the shared `Modal` component.
