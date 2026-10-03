# vibe-wise (Pi package)

> Learning mode for [Pi](https://github.com/badlogic/pi-mono): the agent asks for your
> approach first, examines tradeoffs, then writes the code of the chosen design and
> explains it. Progress is kept in local `.vibe-wise/` notes and restored across sessions.
>
> **Status: port in progress (M1–M2 done, see PLAN.md at the repo root).**
> This README is a placeholder; install/usage/commands docs land with M7.

## Local development

```bash
npm install
npx tsc --noEmit
npx vitest run
```

- `lib/` — pure core (state-directory resolving, profile activation, pointer, reset). No Pi imports.
- `tests/` — vitest suites ported 1:1 from the original plugin's Python tests.

MIT — © Noah Kim (original vibe-wise), Pi port by the vibe-wise contributors.
