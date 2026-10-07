import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
const require=createRequire(import.meta.url);
// The harness transport handles large screenshot responses reliably on Windows Node.
const {ws:WebSocket}=require(join(dirname(require.resolve('playwright-core/package.json')),'lib/utilsBundle.js'));
// Session-scoped CDP transport: never auto-attaches to other agents' tabs.
async function connection(url, errors) {
 const ws = new WebSocket(url), pending = new Map();
 let id = 0;
 await new Promise((ok, no) => { ws.onopen = ok; ws.onerror = no; });
 ws.onmessage = ({ data }) => {
  const m = JSON.parse(data), p = pending.get(m.id);
  if (p) {
   clearTimeout(p.timer); pending.delete(m.id);
   if (m.error) p.no(new Error(JSON.stringify(m.error))); else p.ok(m.result);
  } else if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails);
 };
 const call = (method, params = {}) => new Promise((ok, no) => {
  const key = ++id;
  const timer = setTimeout(() => { pending.delete(key); no(new Error('CDP timeout: ' + method)); }, 60000);
  pending.set(key, { ok, no, timer });
  ws.send(JSON.stringify({ id: key, method, params }));
 });
 return { call, close: () => ws.close() };
}
export async function openPage() {
 const errors = [];
 const version = await fetch('http://127.0.0.1:9333/json/version').then(r => r.json());
 const browser = await connection(version.webSocketDebuggerUrl, errors);
 const { browserContextId } = await browser.call('Target.createBrowserContext');
 const { targetId } = await browser.call('Target.createTarget', { url: 'about:blank', browserContextId });
 const targets = await fetch('http://127.0.0.1:9333/json/list').then(r => r.json());
 const target = targets.find(t => t.id === targetId);
 if (!target) throw new Error('New CDP target missing');
 const page = await connection(target.webSocketDebuggerUrl, errors), send = page.call;
 await send('Page.enable'); await send('Runtime.enable');
 await send('Emulation.setFocusEmulationEnabled', {enabled:true});
 await send('Runtime.runIfWaitingForDebugger');
 await send('Emulation.setDeviceMetricsOverride', { width: 1470, height: 920, deviceScaleFactor: 2, mobile: false });
 await send('Page.addScriptToEvaluateOnNewDocument', { source: `
  localStorage.setItem('wsp.settings.v1',JSON.stringify({quality:'medium',graphicsProfile:99,shadows:true,bloom:true,clouds:true,scatter:true,renderScale:1,adaptiveQuality:false,masterVolume:0}));
  localStorage.setItem('wsp.help.seen.v1','1');
  window.__groundLoad=[];
  new PerformanceObserver(l=>window.__groundLoad.push(...l.getEntries().map(e=>({start:e.startTime,ms:e.duration})))).observe({type:'longtask',buffered:true});
 ` });
 const evaluate = async expression => {
  if (typeof expression === 'function') expression = '(' + expression.toString() + ')()';
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
  return r.result.value;
 };
 const until = async (expression, ms = 120000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
   if (await evaluate(expression)) return;
   await new Promise(r => setTimeout(r, 200));
  }
  throw new Error('Page wait timeout: ' + expression);
 };
 return {
  send, evaluate, until, errors,
  navigate: async url => {
   await send('Page.navigate', { url });
   await send('Runtime.runIfWaitingForDebugger'); await send('Page.bringToFront');
  },
  close: async () => {
   page.close();
   try { await browser.call('Target.disposeBrowserContext', { browserContextId }); }
   finally { browser.close(); }
  },
 };
}

