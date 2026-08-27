---
name: spec-implement
description: Implement a feature spec from specs/<name>/ end-to-end. Use when the user says "implement spec X", "按 spec 实现 X", "build feature X per the spec", references a specs/<name>/ folder, or invokes /spec-implement. Reads spec.md (and design.md if present), walks tasks.md, ticks each task as it is completed, and runs typecheck/lint/test to verify.
---

# Spec Implement

You implement a feature spec. The spec name is `$ARGUMENTS` (or `$1` if the
caller used positional form).

This skill is the natural-language counterpart to the `/spec-implement`
command — it triggers when the user says things like "implement spec
playback-queue" or "按 spec 实现 X", without needing the `/` prefix.

## Steps

1. Read `specs/$ARGUMENTS/spec.md` and understand **what** to build and the
   acceptance criteria.
2. If `specs/$ARGUMENTS/design.md` exists, read it first to understand
   **how** to build.
3. Read `specs/$ARGUMENTS/tasks.md` — this is your checklist.
4. If `$ARGUMENTS` is empty, list `specs/` and ask the user which spec.
5. For each unchecked task `- [ ] ...` in `tasks.md`:
   - Implement the change in the appropriate package (`packages/common`,
     `packages/server`, `packages/renderer`, `packages/electron`).
   - **Before** ticking the box, run `npm run typecheck` and confirm it
     passes.
   - Tick the box: `- [ ]` → `- [x]`.
   - Move on to the next task.
6. After every task is done, run the full verification:
   ```
   npm run build:common && npm run typecheck && npm run lint && npm test
   ```
7. If `spec-reviewer` is available, delegate a final review of the diff
   against the spec's acceptance criteria and incorporate the findings.
8. Report:
   - Which tasks were completed
   - Which tasks remain (and why)
   - Edge cases the spec didn't cover but you noticed
   - Any deviations from the spec (must be justified, not silent)

## Rules

- **Do not deviate from the spec** without telling the user. If the spec
  is wrong or incomplete, surface it — don't silently change scope.
- **Cross-package normalizers** (`fuzzyKey`, `stripFeatTags`,
  `stripParensContent`, `cjkUnify`, etc.) live in
  `packages/common/src/normalizer.ts`. Do **not** duplicate them in
  another package.
- **No new top-level dependencies** without confirming with the user.
- **No `console.log`** — server uses NestJS Logger; renderer uses
  `console` only in `src/main.tsx` boot.
- **Provider classes** must implement `packages/common/src/provider.ts`'s
  `MusicProvider` interface and live in `packages/server/src/music/`.
- **External API calls** use the built-in `fetch` (no axios). Search /
  metadata calls wrap in `withTimeout` from
  `packages/common/src/timeout.ts` (single platform 5s, timeout means
  absent, not blocking). Audio / cover byte proxies are **streaming** with
  **no overall timeout**.

## Escalation

- If a task reveals a deeper design issue, stop and propose an ADR before
  writing more code. Don't keep going past a wall.
- If the spec contradicts `AGENTS.md` (e.g., asks for Redux), surface the
  conflict. Do not silently resolve it in either direction.