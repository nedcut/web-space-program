import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
const [url, file] = process.argv.slice(2);
const b = await chromium.connectOverCDP('http://127.0.0.1:9333');
const ctx = await b.newContext({ viewport: { width: 1470, height: 920 }, deviceScaleFactor: 2 });
const p = await ctx.newPage();
try { await p.goto(url); console.log(JSON.stringify(await p.evaluate(readFileSync(file, 'utf8')))); } finally { await ctx.close(); await b.close().catch(() => {}); }
