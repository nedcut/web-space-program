# Web Space Program agent instructions

Read `/home/nedcut/.optmem/projects/web-space-program/INSTRUCTIONS.md` and follow
the shared-memory workflow. Subagents skip memory and report to their parent.

Read ARCHITECTURE.md (layering, coordinates, contracts) and DECISIONS.md before changing code.

- `src/sim` must stay DOM-free and three.js-free (runs in Node tests / future server).
- Float64 in sim; floating origin in render. Never feed raw solar-system coordinates to float32 buffers.
- No KSP assets, names, or text. Everything original.
- Progress report for the owner lives in PROGRESS.md. DECISIONS.md holds lasting design
  decisions and their reasons; per-change evidence belongs in the PR.

## Branches and pull requests

Every push to `main` deploys to the public site, so every change reaches `main` through a
pull request that passes CI.

1. Work on a topic branch in its own worktree. The `main` checkout stays read-only for agents.
2. Before pushing, run the CI gate and get it green:
   `npm run lint && npm run typecheck && npx vitest run --maxWorkers=2 && npm run build`.
3. Push the branch and open the PR with `gh pr create`, filling every section of
   `.github/pull_request_template.md`. One PR per change. Link the PR to the T3 thread.
4. Put verification evidence (commands and results, screenshots, perf numbers) in the PR
   description.
5. Bring in `main` only when the PR conflicts or CI needs it.
6. The owner merges. An agent merges only a PR the owner has told it to merge, once CI is
   green, with `gh pr merge --squash --delete-branch`.
