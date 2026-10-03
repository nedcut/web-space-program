# CLAUDE.md

Read ARCHITECTURE.md (layering, coordinates, contracts) and DECISIONS.md before changing code.

- Commands: `npm run dev`, `npm test`, `npm run typecheck`, `npm run build`.
- `src/sim` must stay DOM-free and three.js-free (runs in Node tests / future server).
- Float64 in sim; floating origin in render. Never feed raw solar-system coordinates to float32 buffers.
- No KSP assets, names, or text. Everything original.
- Progress report for the owner lives in PROGRESS.md; record autonomous decisions in DECISIONS.md.
