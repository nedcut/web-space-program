import { test as base, expect } from '@playwright/test';

// Only Chromium's known pre-gesture audio warning is benign. Errors never bypass the guard.
const ALLOWED_WARNING = /^The AudioContext was not allowed to start\. It must be resumed \(or created\) after a user gesture on the page\./;
const GPU_ERROR = /WebGL.*(?:error|warning|lost)|context lost|GL_INVALID|INVALID_(?:OPERATION|ENUM|VALUE|FRAMEBUFFER)|GL ERROR|Audio disabled after an error/i;

const test = base.extend({
  page: async ({ page }, use) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.stack ?? error.message));
    page.on('console', message => {
      const text = message.text();
      if (message.type() === 'error' || ((message.type() === 'warning' || message.type() === 'error') && GPU_ERROR.test(text) && !ALLOWED_WARNING.test(text))) errors.push(text);
    });
    await page.addInitScript(() => {
      if (!localStorage.getItem('wsp.settings.v1')) localStorage.setItem('wsp.settings.v1', JSON.stringify({ quality: 'low', frameRateCap: 30, graphicsProfile: 99, adaptiveQuality: false, shadows: false, bloom: false, clouds: false, scatter: false, renderScale: 0.5, autoSaveInterval: 0 }));
      localStorage.setItem('wsp.help.seen.v1', '1');
      const failures = window.__smokeFailures = [];
      const contexts = [], programs = [], disposed = new WeakSet();
      // three.js deliberately loses contexts on scene disposal. Unexpected losses still fail.
      for (const P of [WebGLRenderingContext.prototype, WebGL2RenderingContext.prototype]) {
        const get = P.getExtension;
        P.getExtension = function (name) {
          const ext = get.call(this, name);
          if (name === 'WEBGL_lose_context' && ext && !ext.__smokeWrapped) {
            const lose = ext.loseContext.bind(ext);
            ext.loseContext = () => { disposed.add(this); lose(); };
            ext.__smokeWrapped = true;
          }
          return ext;
        };
      }
      // Production three.js disables shader diagnostics. Check actual link status too.
      for (const P of [WebGLRenderingContext.prototype, WebGL2RenderingContext.prototype]) {
        const link = P.linkProgram;
        P.linkProgram = function (program) {
          if (!contexts.includes(this)) {
            contexts.push(this);
            this.canvas.addEventListener('webglcontextlost', () => { if (!disposed.has(this)) failures.push('WebGL context lost'); });
          }
          programs.push([this, program]);
          return link.call(this, program);
        };
      }
      window.__smokeGPU = () => {
        for (const gl of contexts) {
          if (disposed.has(gl)) continue;
          if (gl.isContextLost()) failures.push('Lost GL context');
          const error = gl.getError();
          if (error) failures.push(`GL error ${error}`);
        }
        for (const [gl, program] of programs.splice(0)) {
          if (!disposed.has(gl) && gl.isProgram(program) && !gl.getProgramParameter(program, gl.LINK_STATUS)) failures.push(gl.getProgramInfoLog(program) || 'Shader link failed');
        }
        return failures;
      };
    });
    await use(page);
    if (!page.isClosed()) {
      await pixels(page);
      errors.push(...await page.evaluate(() => window.__smokeGPU()));
    }
    expect(errors, 'No page, console, shader or WebGL errors').toEqual([]);
  },
});

// Decode a compositor screenshot, not readPixels after a discarded drawing buffer.
// 64x36 samples must contain lit pixels AND variation; catches black/solid blank canvases.
async function pixels(page) {
  const canvas = page.locator('canvas:visible').first();
  const png = await (await canvas.count() ? canvas.screenshot() : page.screenshot());
  const result = await page.evaluate(async b64 => {
    const image = new Image(); image.src = `data:image/png;base64,${b64}`; await image.decode();
    const c = document.createElement('canvas'); c.width = 64; c.height = 36;
    const ctx = c.getContext('2d'); ctx.drawImage(image, 0, 0, 64, 36);
    const p = ctx.getImageData(0, 0, 64, 36).data;
    let lit = 0, min = 255, max = 0;
    for (let i = 0; i < p.length; i += 4) { const v = Math.max(p[i], p[i + 1], p[i + 2]); if (v > 15) lit++; min = Math.min(min, v); max = Math.max(max, v); }
    return { lit, spread: max - min };
  }, png.toString('base64'));
  expect(result.lit, 'Rendered pixels above near-black').toBeGreaterThan(20);
  expect(result.spread, 'Rendered image is not a solid blank').toBeGreaterThan(10);
}
async function altitudeAGL(page) {
  return page.evaluate(() => {
    const w = window.__flight.world, v = w.active;
    return w.universe.surfaceInfo(v.body, v.state.position, w.ut).heightAboveTerrain;
  });
}
async function menu(page) {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'New Game', exact: true })).toBeVisible();
  await expect(page.locator('.loading-screen')).toHaveCount(0);
}
async function hub(page) {
  await page.getByRole('button', { name: 'New Game', exact: true }).click();
  await page.getByRole('button', { name: 'Sandbox', exact: true }).click();
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.getByRole('button', { name: /Integration Hall/ })).toBeVisible();
}
async function openLibrary(page) {
  const direct = page.getByRole('button', { name: 'Open craft library', exact: true });
  if (await direct.isVisible()) await direct.click();
  else {
    await page.getByRole('button', { name: 'More tools', exact: true }).click();
    await page.getByRole('menuitem', { name: /^Open craft library/ }).click();
  }
}
async function editor(page) {
  await hub(page);
  await page.getByRole('button', { name: /Integration Hall/ }).click();
  await page.waitForFunction(() => !!window.__editor);
  // Reuse the production stock-load hook; the full thumbnail catalogue is outside this smoke budget.
  await page.evaluate(() => window.__editor.loadStock('kestrel'));
  await expect(page.getByLabel('Craft name', { exact: true })).toHaveValue('Kestrel Sounding Rocket');
}
test.beforeEach(async ({ page }) => menu(page));
test('sandbox: startup, hub, stock editor, toolbar, persistence, launch and map', async ({ page }) => {
  test.setTimeout(300_000);
  await test.step('startup finishes', async () => {
    await expect(page.getByRole('button', { name: 'Spacepedia', exact: true })).toBeVisible();
    await pixels(page);
  });
  await test.step('new sandbox program and stock craft', async () => { await editor(page); });
  for (const width of [1366, 1920]) await test.step(`numeric Δv and toolbar fit at ${width}`, async () => {
    await page.setViewportSize({ width, height: width === 1920 ? 1080 : 768 });
    await expect(page.getByTestId('editor-dv')).toContainText(/[1-9][\d,.]*\s*(?:km\/s|m\/s)/);
    const fit = await page.getByTestId('editor-toolbar').evaluate(bar => {
      const b = bar.getBoundingClientRect();
      const buttons = [...bar.querySelectorAll('button')].filter(e => e.getClientRects().length);
      return { overflow: bar.scrollWidth - bar.clientWidth, outside: buttons.filter(e => { const r = e.getBoundingClientRect(); return r.left < b.left - 1 || r.right > b.right + 1 || r.bottom > b.bottom + 1; }).map(e => e.getAttribute('aria-label') || e.textContent) };
    });
    expect(fit).toEqual({ overflow: 0, outside: [] });
    await pixels(page);
  });
  await page.setViewportSize({ width: 1366, height: 768 });
  await test.step('craft IndexedDB and program save survive reload', async () => {
    await page.getByLabel('Craft name', { exact: true }).fill('Smoke persisted craft');
    await page.keyboard.press('Enter'); await page.keyboard.press('Control+s');
    await expect(page.getByTestId('editor-toolbar')).not.toContainText('Unsaved');
    await page.getByRole('button', { name: 'Exit to Space Center', exact: true }).click();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Save as…', exact: true }).click();
    await page.getByLabel('Save slot name').fill('Smoke program');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Program saved.', { exact: true })).toBeVisible();
    await page.reload();
    await page.getByRole('button', { name: /^Continue/ }).click();
    await page.getByRole('button', { name: /Integration Hall/ }).click();
    await openLibrary(page);
    await page.getByLabel('Search vehicles').fill('Smoke persisted craft');
    const row = page.getByTestId('saved-craft').filter({ hasText: 'Smoke persisted craft' });
    await row.getByRole('button', { name: 'Load', exact: true }).click();
    await expect(page.getByLabel('Craft name', { exact: true })).toHaveValue('Smoke persisted craft');
    const dbs = await page.evaluate(() => indexedDB.databases());
    expect(dbs.map(db => db.name)).toContain('wsp.craft-library');
  });
  await test.step('launch, keyboard throttle and staging produce ascent', async () => {
    await page.getByRole('button', { name: /^Launch/ }).click();
    await page.waitForFunction(() => !!window.__flight && !document.querySelector('.loading-screen'));
    const altitude = await altitudeAGL(page);
    expect(Number.isFinite(altitude)).toBe(true);
    await page.keyboard.press('z'); await page.keyboard.press('Space');
    await expect.poll(() => page.evaluate(() => window.__flight.input.state.throttle)).toBe(1);
    await expect.poll(() => altitudeAGL(page), { timeout: 60_000 }).toBeGreaterThan(altitude + 10);
    await pixels(page);
  });
  await test.step('map opens and closes through keyboard', async () => {
    await page.keyboard.press('m');
    await page.waitForFunction(() => window.__flight.mapMode);
    await pixels(page);
    await page.keyboard.press('m');
    await page.waitForFunction(() => !window.__flight.mapMode);
  });
});
test('first training lesson starts', async ({ page }) => {
  await page.getByRole('button', { name: /^Training/ }).click();
  await page.getByRole('button', { name: /Building your first rocket/ }).click();
  await expect(page.getByLabel('Craft name', { exact: true })).toBeVisible();
  await expect(page.locator('.tutorial-panel')).toContainText('Building your first rocket');
});
test('quick-start challenge loads a flight', async ({ page }) => {
  await page.getByRole('button', { name: 'Challenges', exact: true }).click();
  await page.getByRole('button', { name: 'Fly challenge', exact: true }).click();
  await page.waitForFunction(() => !!window.__flight && !document.querySelector('.loading-screen'));
  await expect(page.getByRole('button', { name: 'Scenarios', exact: true })).toBeVisible();
});
test('settings UI scale changes and closes', async ({ page }) => {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('tab', { name: 'Accessibility', exact: true }).click();
  const scale = page.getByRole('slider', { name: 'UI scale', exact: true });
  await scale.focus(); await page.keyboard.press('ArrowRight'); await scale.blur();
  await expect(scale).toHaveValue('1.05');
  await page.getByRole('dialog').getByRole('button', { name: 'Done', exact: true }).first().click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('wsp.settings.v1')).uiScale)).toBe(1.05);
});
test('Spacepedia opens', async ({ page }) => {
  await page.getByRole('button', { name: 'Spacepedia', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Spacepedia/ })).toBeVisible();
});
