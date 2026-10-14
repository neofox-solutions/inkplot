// PNG on a server: resvg compiled to WebAssembly, with the Inter fonts that ship in this package, so a machine with no fonts still gets text.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// The package may be CommonJS or ESM depending on how it resolves, so take the namespace or its default.
const load = async (path: string): Promise<typeof import('@resvg/resvg-wasm')> => {
  const m = await import(pathToFileURL(path).href);
  return 'initWasm' in m ? m : m.default;
};

export async function renderer(workspace: string, background: string | undefined, scale: number): Promise<(svg: string) => Uint8Array> {
  let resvg: typeof import('@resvg/resvg-wasm'), wasm: string;
  try {
    const need = createRequire(join(workspace, 'x.js'));
    resvg = await load(need.resolve('@resvg/resvg-wasm'));
    wasm = need.resolve('@resvg/resvg-wasm/index_bg.wasm');
  } catch {
    try {
      const own = createRequire(import.meta.url);
      resvg = await load(own.resolve('@resvg/resvg-wasm'));
      wasm = own.resolve('@resvg/resvg-wasm/index_bg.wasm');
    } catch {
      process.stderr.write('error: --png needs @resvg/resvg-wasm. Run: npm i @resvg/resvg-wasm\n');
      return process.exit(1);
    }
  }
  await resvg.initWasm(readFileSync(wasm));
  const here = dirname(fileURLToPath(import.meta.url)),
    fonts = [join(here, '../fonts'), join(here, 'fonts')].find((d) => {
      try {
        readFileSync(join(d, 'Inter-Regular.otf'));
        return true;
      } catch {
        return false;
      }
    });
  const fontBuffers = fonts ? ['Inter-Regular.otf', 'Inter-Bold.otf'].map((f) => new Uint8Array(readFileSync(join(fonts, f)))) : [];
  return (svg) =>
    new resvg.Resvg(svg, {
      ...(background !== 'none' && { background: background ?? '#ffffff' }),
      fitTo: { mode: 'zoom', value: scale },
      font: { fontBuffers, defaultFontFamily: 'Inter', loadSystemFonts: false },
    })
      .render()
      .asPng();
}
