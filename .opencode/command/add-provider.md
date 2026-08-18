---
description: Scaffold a new music platform provider (e.g. /add-provider xiami)
---

You are adding a new music platform provider to Maestro. The platform name
(lowercase, no spaces) is `$1`.

## Where things live

| Concern | Path |
|---|---|
| Provider interface | `packages/common/src/provider.ts` |
| Cross-package types | `packages/common/src/<thing>.ts` |
| Provider implementation | `packages/server/src/music/$1.provider.ts` |
| Provider module wiring | `packages/server/src/music/music.module.ts` |
| Merge / dedupe | `packages/server/src/music/music.service.ts` |
| Frontend UI | `packages/renderer/src/components/source-select/` + `src/lib/` |
| Normalizers (fuzzyKey etc.) | `packages/common/src/normalizer.ts` (reuse, don't duplicate) |

## Required steps

1. **Read existing providers** for reference (pick the simplest one first —
   `netease.provider.ts` or `deezer.provider.ts` are good starting points).
2. **Implement `$1.provider.ts`** implementing the `MusicProvider` interface.
   All external API calls go through built-in `fetch`. Wrap metadata/search
   calls in `withTimeout` from `packages/common/src/timeout.ts` (5s; timeout
   means "absent", not "block other platforms"). Audio/cover byte proxies
   must be **streaming** with **no global timeout**.
3. **Register** the provider in `music.module.ts` and the controller that
   routes to it.
4. **Frontend**:
   - Add the source to `SourceMenu` / `SourceSelect` so users can pick it.
   - If it needs auth (cookie / OAuth), wire it through
     `packages/electron/src/auth/`. Use the same `login-window-runner.ts`
     pattern as existing providers.
5. **Tests**: at least one `*.test.ts` in `packages/server/src/music/` covering
   the search/lookup happy path. The `scripts/test.sh` runner will pick it up
   automatically.
6. **Verify**:
   ```
   npm run build:common && npm run typecheck && npm test
   ```

## Hard rules

- ❌ Do **not** add `axios` or any HTTP client lib. Use built-in `fetch`.
- ❌ Do **not** put dedupe/merge logic in the controller. It lives in
  `music.service.ts`.
- ❌ Do **not** create a private copy of normalizers in this package. Import
  from `@maestro/common`.
- ❌ Do **not** add a global timeout to audio/cover streaming proxies.
- ❌ Do **not** log secrets (cookies, MUSIC_U, access tokens) with
  `console.log` or any logger.
- ✅ Use NestJS Logger everywhere on the server.
- ✅ Stream bytes; do not buffer the whole track in memory before sending.
