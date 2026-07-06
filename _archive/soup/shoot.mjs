// Render soup.glb in the local viewer and save a screenshot.
// Uses the chromium binary playwright already downloaded.
import { chromium } from 'playwright';

const CHROMIUM = '/home/guyonwifi/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome';

const browser = await chromium.launch({
  executablePath: CHROMIUM,
  args: ['--no-sandbox', '--use-gl=swiftshader'],
});
const ctx = await browser.newContext({ viewport: { width: 600, height: 700 } });
const page = await ctx.newPage();
await page.goto('http://localhost:8765/viewer.html');
await page.waitForFunction(() => window.__soupReady === true, null, { timeout: 15000 });
// give one frame to render after ready flag flips
await page.waitForTimeout(300);
await page.screenshot({ path: 'soup_render.png' });
console.log('wrote soup_render.png');
await browser.close();
