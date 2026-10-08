// Stream a known renderer out of Chrome's whole-browser JSON without V8's ~512 MiB string limit.
import { createWriteStream } from 'node:fs';
import { createGzip } from 'node:zlib';
import { once } from 'node:events';
import { pipeline } from 'node:stream/promises';
export async function writeRendererTrace(cdp, stream, pid, pageUrl, file) {
  const gzip = createGzip(), finished = pipeline(gzip, createWriteStream(file));
  // Attach immediately; propagate errors below without an unhandled rejection during CDP reads.
  void finished.catch(() => {});
  let header = '', inArray = false, ended = false, depth = 0, quoted = false, escaped = false;
  let event = '', batch = '', first = true;
  const write = async text => { if (!gzip.write(text)) await once(gzip, 'drain'); };
  try {
    await write(`{"metadata":${JSON.stringify({ pagePid: pid, pageUrl })},"traceEvents":[`);
    for (;;) {
      const chunk = await cdp.send('IO.read', { handle: stream, size: 1 << 22 });
      let text = chunk.base64Encoded ? Buffer.from(chunk.data, 'base64').toString() : chunk.data;
      if (!inArray) {
        header += text;
        const match = /"traceEvents"\s*:\s*\[/.exec(header);
        if (match) { text = header.slice(match.index + match[0].length); header = ''; inArray = true; }
        else if (header.length > 65536 || chunk.eof) throw new Error('Missing traceEvents array');
        else continue;
      }
      let start = depth ? 0 : -1;
      for (let i = 0; i < text.length && !ended; i++) {
        const c = text[i];
        if (quoted) { if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === '"') quoted = false; continue; }
        if (depth && c === '"') { quoted = true; continue; }
        if (c === '{') { if (!depth) start = i; depth++; }
        else if (c === '}' && depth && --depth === 0) {
          event += text.slice(start, i + 1);
          if (JSON.parse(event).pid === pid) { batch += (first ? '' : ',') + event; first = false; }
          event = ''; start = -1;
        } else if (!depth && c === ']') ended = true;
      }
      if (depth && start >= 0) event += text.slice(start);
      if (batch.length >= 1 << 20) { await write(batch); batch = ''; }
      if (chunk.eof) break;
    }
    if (!ended || depth) throw new Error('Incomplete traceEvents array');
    await write(batch + ']}'); gzip.end(); await finished;
  } catch (error) { gzip.destroy(error); await finished.catch(() => {}); throw error; }
  finally { await cdp.send('IO.close', { handle: stream }); }
}
