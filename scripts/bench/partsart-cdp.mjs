// Focused CDP transport: never attaches to other agents' renderers. Separate page
// sockets also avoid large screenshot responses blocking control traffic.
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
// Reuse the supplied Windows driver's WebSocket implementation. Node's built-in
// client closes on large Retina screenshots; no packages are downloaded.
const { ws: WebSocket } = createRequire(import.meta.url)('C:/wsp-tools/drv/node_modules/playwright-core/lib/utilsBundle.js');
const endpoint = 'http://127.0.0.1:9333';
async function transport(url) {
  const ws = new WebSocket(url);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let id = 0;
  const pending = new Map();
  ws.onclose = () => {
    for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new Error('CDP connection closed')); }
    pending.clear();
  };
  ws.onmessage = e => {
    const m = JSON.parse(e.data), p = pending.get(m.id);
    if (p) { pending.delete(m.id); clearTimeout(p.timer); if (m.error) p.reject(new Error(m.error.message)); else p.resolve(m.result); }
    if (m.method === 'Runtime.exceptionThrown') console.error(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
  };
  return {
    close: () => ws.close(),
    send: (method, params = {}, timeout = 120000) => new Promise((resolve, reject) => {
      const key = ++id;
      if (process.argv.includes('--trace')) console.log('CDP', key, method, params.expression?.slice(0, 80) ?? '');
      const timer = setTimeout(() => { pending.delete(key); console.error(`CDP timeout: ${method}`); reject(new Error(`CDP timeout: ${method}`)); }, timeout);
      pending.set(key, { resolve, reject, timer }); ws.send(JSON.stringify({ id: key, method, params }));
    }),
  };
}
export async function connect() {
  const { webSocketDebuggerUrl } = await (await fetch(endpoint + '/json/version')).json();
  const browser = await transport(webSocketDebuggerUrl);
  return {
    close: async () => browser.close(),
    async newContext(opts) {
      const pages = new Set();
      let init;
      return {
        addInitScript: async fn => { init = `(${fn.toString()})()`; },
        async close() {
          for (const page of pages) await page.close();
        },
        async newPage() {
          const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
          const targets = await (await fetch(endpoint + '/json/list')).json();
          const socket = await transport(targets.find(t => t.id === targetId).webSocketDebuggerUrl);
          const call = socket.send;
          await call('Page.enable'); await call('Runtime.enable');
          await call('Emulation.setDeviceMetricsOverride', { ...opts.viewport, deviceScaleFactor: opts.deviceScaleFactor, mobile: false });
          if (init) await call('Page.addScriptToEvaluateOnNewDocument', { source: init });
          const evaluate = async (fn, arg) => {
            const expression = typeof fn === 'string' ? fn : `(${fn.toString()})(${JSON.stringify(arg) ?? ''})`;
            const r = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
            if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
            return r.result.value;
          };
          const waitForFunction = async (fn, arg, { timeout = 120000 } = {}) => {
            const start = Date.now();
            while (!await evaluate(fn, arg)) {
              if (Date.now() - start > timeout) throw new Error('Page readiness timed out');
              await new Promise(r => setTimeout(r, 200));
            }
          };
          const page = {
            on() {}, evaluate, waitForFunction,
            bringToFront: () => call('Page.bringToFront'),
            async close() { pages.delete(page); socket.close(); await fetch(endpoint + '/json/close/' + targetId); },
            waitForTimeout: ms => new Promise(r => setTimeout(r, ms)),
            async goto(url) {
              await call('Page.navigate', { url }); await call('Page.bringToFront');
              await new Promise(r => setTimeout(r, 150));
              await waitForFunction(() => document.readyState === 'complete' && (!!window.__game || !!window.__previewReady));
            },
            async screenshot({ path }) {
              await call('Page.bringToFront');
              const { data } = await call('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
              const png = Buffer.from(data, 'base64');
              if (png.readUInt32BE(16) !== opts.viewport.width * opts.deviceScaleFactor || png.readUInt32BE(20) !== opts.viewport.height * opts.deviceScaleFactor) throw new Error('Screenshot lost the requested DPR/viewport');
              writeFileSync(path, png);
              console.log('saved', path.split(/[\\/]/).pop());
            },
          };
          pages.add(page); return page;
        },
      };
    },
  };
}
