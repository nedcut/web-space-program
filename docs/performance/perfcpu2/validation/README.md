# Validation

Runtime revision: `b91881a1` (only evidence/documentation changes follow).

- `npm run lint`: exit 0.
- `npx tsc --noEmit`: exit 0 (empty output).
- `npx vitest run --maxWorkers=3`: 131 files passed; 1397 passed, 1 skipped.
- `npm run build`: exit 0. Existing bundle-size warning remains.
- `node --test scripts/bench/trace-stream.test.mjs`: 2 passed.

The full checks held `/tmp/wsp-gpu.lock` to avoid running host tests during another agent's
browser measurement. The browser captures are described in the parent README and PERFORMANCE.md.
