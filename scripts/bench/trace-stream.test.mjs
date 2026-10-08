import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { writeRendererTrace } from './trace-stream.mjs';
mkdirSync('.tmp', { recursive: true });

function source(text, size) {
  let offset = 0;
  const cdp = { closed: false, async send(method) {
    if (method === 'IO.close') { cdp.closed = true; return; }
    const data = text.slice(offset, offset + size); offset += size;
    return { data, eof: offset >= text.length };
  } };
  return cdp;
}

test('streams one renderer through arbitrary boundaries, escaped braces, and trailing metadata', async () => {
  const dir = mkdtempSync('.tmp/trace-stream-');
  const events = [{ pid: 9, args: { text: 'escaped \\"[]}{', nested: [{ a: 1 }] } }, { pid: 4, name: 'unrelated' }, { pid: 9, name: 'last' }];
  try {
    for (const size of [1, 2, 7, 8192]) {
      const cdp = source(JSON.stringify({ traceEvents: events, metadata: { notAnEvent: 1 } }), size);
      const file = `${dir}/${size}.gz`;
      await writeRendererTrace(cdp, 'stream', 9, 'test', file);
      const result = JSON.parse(gunzipSync(readFileSync(file)));
      assert.deepEqual(result.traceEvents, events.filter(e => e.pid === 9));
      assert.equal(result.metadata.pagePid, 9); assert(cdp.closed);
    }
  } finally { rmSync(dir, { recursive: true }); }
});

test('rejects truncated trace data and closes its CDP stream', async () => {
  const dir = mkdtempSync('.tmp/trace-stream-'), cdp = source('{"traceEvents":[{"pid":9', 3);
  try {
    await assert.rejects(writeRendererTrace(cdp, 'stream', 9, 'test', `${dir}/bad.gz`), /Incomplete/);
    assert(cdp.closed);
  } finally { rmSync(dir, { recursive: true }); }
});
