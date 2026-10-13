// toPng in headless Chromium: a live chart and a detached one both come out as real PNGs of the right size with ink in them.
//   node png.test.mjs
import { build } from 'esbuild';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { chromium } from './tools/browser.mjs';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const app = `
import { Axis, CartesianPlane, Chart, DOMPlatform, DomainSeries, FlatDataSource, LinePath, LinearCurve, LinearScale, lightTheme, toPng } from 'inkplot';
const make = () => new Chart({ theme: lightTheme, width: 400, height: 250 }, new CartesianPlane({}, new Axis({}, new LinearScale()), new Axis({}, new LinearScale()),
  new DomainSeries({}, new FlatDataSource({ data: [1, 3, 2, 5, 4] }), new LinePath({}, new LinearCurve()))));
const inspect = async (blob) => {
  const bitmap = await createImageBitmap(blob), c = new OffscreenCanvas(bitmap.width, bitmap.height), g = c.getContext('2d');
  g.drawImage(bitmap, 0, 0);
  const px = g.getImageData(0, 0, bitmap.width, bitmap.height).data;
  let ink = 0, clear = 0;
  for (let i = 3; i < px.length; i += 4) { if (px[i] > 0) ink++; else clear++; }
  return { type: blob.type, width: bitmap.width, height: bitmap.height, ink, clear, corner: Array.from(g.getImageData(0, 0, 1, 1).data) };
};
window.run = async () => {
  const live = make(); live.attach(new DOMPlatform(document.getElementById('host'), { size: { width: 400, height: 250 } }));
  const a = await inspect(await toPng(live, { scale: 2 }));
  const b = await inspect(await toPng(make(), { background: '#ffffff' }));
  return { a, b };
};
`;
const bundled = await build({
  stdin: { contents: app, resolveDir: here('./'), loader: 'ts' }, bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2022', logLevel: 'error',
  alias: { inkplot: here('./src/index.ts') },
});
const dir = mkdtempSync(tmpdir() + '/inkplot-png-');
writeFileSync(`${dir}/index.html`, `<!doctype html><meta charset="utf-8"><body style="margin:0"><div id="host" style="width:400px;height:250px"></div><script>${bundled.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')}</script>`);
const browser = await chromium.launch();
const page = await browser.newPage();
const problems = [];
page.on('pageerror', (e) => problems.push(e.message));
await page.goto(pathToFileURL(`${dir}/index.html`).href);
const { a, b } = await page.evaluate(() => window.run());
await browser.close();
assert.deepEqual(problems, []);
assert.equal(a.type, 'image/png'); assert.deepEqual([a.width, a.height], [800, 500], 'live chart at scale 2');
assert(a.ink > 500 && a.clear > 1000, `transparent with ink: ${a.ink} / ${a.clear}`);
assert.deepEqual([b.width, b.height], [400, 250], 'detached chart at its own size');
assert.deepEqual(b.corner, [255, 255, 255, 255], 'the background is painted'); assert.equal(b.clear, 0);
console.log('ok png in a browser');
