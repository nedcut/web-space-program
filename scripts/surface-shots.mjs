import { chromium } from '@playwright/test';
const browser = await chromium.launch({ channel: 'chromium', args: ['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--enable-webgl'] });
const page = await browser.newPage({viewport:{width:960,height:600}});
await page.addInitScript(() => {
  const getContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function(kind, options) {
    return getContext.call(this,kind,kind==='webgl2' ? {...options,preserveDrawingBuffer:true} : options);
  };
});
page.on('pageerror' , e => console.error(e.message));
page.on('console', m => {if(m.type()==='error')console.error(m.text());});
for(const [name,query] of [
  ['titan-sea','body=titan&lat=70&lon=40&alt=500&pitch=-15&head=0&hour=12&dec=25'],
  ['io-night-lava','body=io&lat=18&lon=30&alt=12000&pitch=-90&hour=0'],
  ['mars-arch','body=mars&lat=-9.009&lon=-48&alt=28&pitch=-10&head=0&hour=10'],
].filter(([name]) => !process.argv[2] || name===process.argv[2])) {
  await page.goto(`http://127.0.0.1:5197/planet-preview.html?${query}&quality=low&ui=0&settle=1`);
  await page.waitForFunction(()=>window.__preview?.ready,{},{timeout:120000});
  await page.screenshot({path:`docs/screenshots/surface/${name}.png`});
  console.log(name,await page.evaluate(()=>window.__preview.stats));
}
await browser.close();
