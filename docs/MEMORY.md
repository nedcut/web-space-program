# OptMem pilot

Installed on 2026-10-07 for Web Space Program on the WSL host. Claude reads
CLAUDE.md and Codex reads AGENTS.md in the main checkout; both point to the
same external instructions and store. Start a fresh session in the main
checkout to load them. An already-running agent does not automatically reload
instructions. Existing worktrees do not yet contain the new AGENTS.md;
if starting a parent session there, explicitly tell it to read
`/home/nedcut/.optmem/projects/web-space-program/INSTRUCTIONS.md` first.
Subagents intentionally skip memory and report to their parent.

## Commands

Use the absolute path if the terminal does not include ~/.local/bin on PATH:

```sh
/home/nedcut/.local/bin/wsp-memory wake
/home/nedcut/.local/bin/wsp-memory recall 'performance first|Firefox/Zen'
/home/nedcut/.local/bin/wsp-memory note 'open: <dated, source-backed handoff; max 280 UTF-8 bytes>'
/home/nedcut/.local/bin/wsp-memory backup
```

Follow the printed nap/paging commands. Compression is performed by the
current agent, not a background API process. This does not replace ordinary
compaction or automatically archive full conversations.

## Storage and evidence

- Launcher: `/home/nedcut/.local/bin/wsp-memory` pins MEMORY_DIR and rewrites
  OptMem's printed command name so subsequent commands retain project scope.
- Unmodified upstream tool: `/home/nedcut/.optmem/memo`.
- Store: `/home/nedcut/.optmem/projects/web-space-program/memory`.
- Seed: 24 notes, 22 summaries; sourced user statements preserve original
  dates. Document claims are marked as snapshots, not new verification.
- Provenance: `sources.json`, `seed-notes.txt` and `source-documents/` in
  `/home/nedcut/.optmem/projects/web-space-program/`.
- Smoke-check results: `verification.json` in that directory. Ten retrieval
  cases exercise the CLI; they are not a model-recall benchmark.
- Backups: `/home/nedcut/.optmem/backups/web-space-program/*.tar.gz`. They
  contain the store, provenance and tool/launcher copies. These are local
  snapshots; loss of the WSL disk would also lose them.

No other projects' instruction files, remote devices, model selections,
provider credentials or scheduled jobs were changed. The project instruction
changes are local and uncommitted.

## Evaluate over the next week

In fresh Claude and Codex sessions, ask for the latest priority, Firefox
ownership, intended laptop experience, scale decisions and previous failed
approaches. Check answers against the cited original sources and current
Git/task state. Compare with sessions using only existing project documents.
Keep the pilot if it reduces re-explanation and produces at least nine correct,
traceable answers across ten agreed questions. Also record added latency and
tokens; that accuracy threshold is a target, not an achieved result.

## Disable or restore

Remove the shared-memory paragraph from CLAUDE.md and AGENTS.md to disable
automatic use. Keep memory and backups for later; neither instruction file
contains the memory itself. To recover from a snapshot, extract it into a
separate empty directory first, verify its contents, then restore the memory
and provenance while no agent is writing to the store.
