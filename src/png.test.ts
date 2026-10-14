// toPng and svgToPng, with a fake canvas: what is drawn, how big, on what background, and that an unattached chart is rendered.
import assert from 'node:assert/strict';
import {
  Chart,
  CartesianPlane,
  Axis,
  LinearScale,
  DomainSeries,
  FlatDataSource,
  LinePath,
  LinearCurve,
  svgToPng,
  toPng,
  type PngHost,
} from './index.ts';
import { lightTheme } from './themes.ts';
import { FakePlatform } from './fake-platform.ts';
import { test } from 'vite-plus/test';

test('png', async () => {
  function host(natural = { width: 300, height: 200 }) {
    const log: { url?: string; size?: [number, number]; fills: string[]; draws: [number, number][] } = { fills: [], draws: [] };
    const h: PngHost = {
      loadImage: async (url) => {
        log.url = url;
        return { ...natural, image: 'img' };
      },
      canvas: (w, hh) => {
        log.size = [w, hh];
        const context = {
          fillStyle: '',
          fillRect() {
            log.fills.push(context.fillStyle);
          },
          scale() {},
          drawImage(_i: unknown, _x: number, _y: number, dw: number, dh: number) {
            log.draws.push([dw, dh]);
          },
        };
        return { context, blob: async () => new Blob(['png'], { type: 'image/png' }) };
      },
    };
    return { h, log };
  }
  const make = () =>
    new Chart(
      { theme: lightTheme, width: 320, height: 180 },
      new CartesianPlane(
        {},
        new Axis({}, new LinearScale()),
        new Axis({}, new LinearScale()),
        new DomainSeries({}, new FlatDataSource({ data: [1, 3, 2] }), new LinePath({}, new LinearCurve())),
      ),
    );

  {
    const { h, log } = host();
    const blob = await svgToPng('<svg xmlns="http://www.w3.org/2000/svg"/>', { scale: 2, background: '#fff' }, h);
    assert.equal(blob.type, 'image/png');
    assert.deepEqual(log.size, [600, 400]);
    assert.deepEqual(log.draws, [[600, 400]]);
    assert.deepEqual(log.fills, ['#fff']);
    assert(log.url!.startsWith('data:image/svg+xml;charset=utf-8,%3Csvg'));
    const bare = host();
    await svgToPng('<svg/>', {}, bare.h);
    assert.deepEqual(bare.log.fills, [], 'transparent by default');
    await assert.rejects(svgToPng('<svg/>', { scale: 0 }, h), /scale/);
  }
  {
    // A chart that is not attached is rendered at its own size, and left unattached.
    const { h, log } = host({ width: 1, height: 1 });
    const chart = make();
    await toPng(chart, { scale: 2 }, h);
    assert.deepEqual(log.size, [640, 360], 'its width and height, scaled');
    assert(decodeURIComponent(log.url!).includes('<path'), 'the chart is in it');
    assert.equal(chart.platform, null);
    // One that is attached (a platform whose root is not a DOM element) is rendered too, at the size asked for.
    const attached = make();
    attached.attach(new FakePlatform({ width: 100, height: 50 })).flush();
    const second = host();
    await toPng(attached, { size: { width: 200, height: 100 } }, second.h);
    assert.deepEqual(second.log.size, [200, 100]);
  }
});
