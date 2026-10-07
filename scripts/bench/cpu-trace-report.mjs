// Summarise a page-scoped CDP trace; optionally compact an older whole-browser trace in place.
// node scripts/bench/cpu-trace-report.mjs <trace.json.gz> [page-url-prefix]
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync, gzipSync } from 'node:zlib';
const [file, prefix] = process.argv.slice(2);
const trace = JSON.parse(gunzipSync(readFileSync(file)));
const events = trace.traceEvents;
let pid = trace.metadata?.pagePid;
if (pid === undefined) {
  if (!prefix) throw new Error('A whole-browser trace requires an explicit page URL prefix');
  for (const e of events) for (const frame of e.args?.data?.frames ?? []) {
    if (frame.url?.startsWith(prefix)) pid = frame.processId ?? e.pid;
  }
}
if (pid === undefined) throw new Error('Could not identify benchmark renderer');
const own = events.filter(e => e.pid === pid);
const tid = own.find(e => e.name === 'thread_name' && e.args.name === 'CrRendererMain')?.tid;
const main = own.filter(e => e.tid === tid && e.ph === 'X');
// Chrome can emit both the outer RunTask and its nested ThreadController task. Count once.
const taskName = main.some(e => e.name === 'RunTask') ? 'RunTask' : 'ThreadControllerImpl::RunTask';
const tasks = main.filter(e => e.name === taskName && e.dur > 50000);
const report = {
  file, pid, longTasks: tasks.length,
  longest: tasks.sort((a, b) => b.dur - a.dur).slice(0, 8).map(task => ({
    ms: task.dur / 1000,
    work: main.filter(e => e !== task && e.ts >= task.ts && e.ts + e.dur <= task.ts + task.dur)
      .sort((a, b) => b.dur - a.dur).slice(0, 5).map(e => [e.name, e.dur / 1000]),
  })),
};
if (prefix) writeFileSync(file, gzipSync(JSON.stringify({ traceEvents: own, metadata: { pageUrl: prefix, pagePid: pid } })));
console.log(JSON.stringify(report, null, 2));
