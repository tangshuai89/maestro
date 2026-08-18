---
description: Implement a spec from specs/<name>/ end-to-end
---

You are implementing a feature spec. The spec name is `$1`.

## Steps

1. Read `specs/$1/spec.md` and understand **what** to build and the acceptance
   criteria.
2. If `specs/$1/design.md` exists, read it first to understand **how** to build.
3. Read `specs/$1/tasks.md` — this is your checklist.
4. For each unchecked task `- [ ] ...` in `tasks.md`:
   - Implement the change in the appropriate package (`packages/common`,
     `packages/server`, `packages/renderer`, `packages/electron`).
   - **Before** ticking the box, run `npm run typecheck` and confirm it passes.
   - Tick the box: `- [ ]` → `- [x]`.
   - Move on to the next task.
5. After every task is done, run the full verification:
   ```
   npm run build:common && npm run typecheck && npm run lint && npm test
   ```
6. Report:
   - Which tasks were completed
   - Which tasks remain (and why)
   - Edge cases the spec didn't cover but you noticed
   - Any deviations from the spec (must be justified, not silent)

## Rules

- **Do not deviate from the spec** without telling the user. If the spec is
  wrong or incomplete, surface it — don't silently change scope.
- **Cross-package normalizers** (`fuzzyKey`, `stripFeatTags`, `stripParensContent`,
  `cjkUnify`, etc.) live in `packages/common/src/normalizer.ts`. Do **not**
  duplicate them in another package.
- **No new top-level dependencies** without confirming with the user.
- **No `console.log`** — server uses NestJS Logger; renderer uses `console`
  only in `src/main.tsx` boot.
- **Provider classes** must implement `packages/common/src/provider.ts`'s
  `MusicProvider` interface and live in `packages/server/src/music/`.
