/**
 * A chart as a PNG in the browser: `toPng(chart)` for one on the page, `svgToPng(svg)` for an SVG string you already have.
 *
 *   const blob = await toPng(chart, { scale: 2, background: '#fff' });
 *
 * It draws the chart's SVG into a canvas, which is the one thing a browser does that node does not, so it lives apart from
 * the core and costs nothing unless imported. For a chart on the page it takes the SVG that is showing, so the picture is
 * what the person sees; for one not attached it renders a copy with `toSvgString` and leaves the chart as it was.
 * `scale` multiplies the pixel size (2 for a sharp picture on a dense screen). Fonts the page loaded are not
 * available to an SVG drawn as an image, so text falls back to the system's; names a system has (the default
 * `system-ui`) come out right. A transparent background stays transparent unless `background` says otherwise. On a server use a WASM
 * renderer instead: see the recipe "Make a PNG on a server".
 */
import { type Chart, toSvgString } from './chart.ts';
import type { Size } from './geometry.ts';
import { StringPlatform } from './platform.ts';
import { inkplotError } from './fail.ts';

export interface PngOptions {
  /** Pixels per CSS pixel. Default 1. */
  scale?: number;
  /** Colour painted behind the chart. Default none (transparent). */
  background?: string;
  /** Size in CSS pixels for a chart that is not attached or an SVG without one. Default: the chart's own `width` and `height`, else 640 by 400. */
  size?: Size;
}

/** What `svgToPng` needs of the browser, so it can be tested without one. */
export interface PngHost {
  loadImage(url: string): Promise<{ width: number; height: number; image: unknown }>;
  canvas(
    width: number,
    height: number,
  ): {
    context: {
      fillStyle: string;
      fillRect(x: number, y: number, w: number, h: number): void;
      drawImage(image: unknown, x: number, y: number, w: number, h: number): void;
      scale(x: number, y: number): void;
    };
    blob(): Promise<Blob>;
  };
}

const browserHost = (): PngHost => ({
  loadImage: (url) =>
    new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight, image });
      image.onerror = () => reject(inkplotError(171));
      image.src = url;
    }),
  canvas: (width, height) => {
    if (typeof OffscreenCanvas !== 'undefined') {
      // oxlint-disable-next-line baseline-js/use-baseline -- feature-detected above: without OffscreenCanvas this draws on a canvas element
      const c = new OffscreenCanvas(width, height);
      // oxlint-disable-next-line typescript/consistent-type-assertions -- the canvas context is handed to the renderer as the one type it draws on
      return { context: c.getContext('2d') as never, blob: () => c.convertToBlob({ type: 'image/png' }) };
    }
    const c = document.createElement('canvas');
    c.width = width;
    c.height = height;
    return {
      // oxlint-disable-next-line typescript/consistent-type-assertions -- the canvas context is handed to the renderer as the one type it draws on
      context: c.getContext('2d') as never,
      blob: () => new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(inkplotError(170))), 'image/png')),
    };
  },
});

/** An SVG document as a PNG. Its own `width` and `height` give the size, else `options.size`. */
export async function svgToPng(svg: string, options: PngOptions = {}, host: PngHost = browserHost()): Promise<Blob> {
  const scale = options.scale ?? 1;
  if (!(scale > 0)) throw inkplotError(169);
  const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  const { width: w, height: h, image } = await host.loadImage(url);
  const width = Math.max(1, Math.round((options.size?.width ?? w) * scale)),
    height = Math.max(1, Math.round((options.size?.height ?? h) * scale));
  const canvas = host.canvas(width, height),
    context = canvas.context;
  if (options.background) {
    context.fillStyle = options.background;
    context.fillRect(0, 0, width, height);
  }
  context.drawImage(image, 0, 0, width, height);
  return canvas.blob();
}

/** The chart as a PNG: what is showing if it is on the page, else a rendering of it. */
export function toPng(chart: Chart, options: PngOptions = {}, host?: PngHost): Promise<Blob> {
  // A real SVG element is serialised as XML, which puts its namespace on it (outerHTML does not, and an image needs it).
  const platform = chart.platform,
    // oxlint-disable-next-line typescript/consistent-type-assertions -- the platform root is opaque; it is checked with `instanceof` on the same line
    root = platform?.root as unknown,
    element = typeof XMLSerializer !== 'undefined' && typeof Element !== 'undefined' && root instanceof Element ? root : null;
  if (element) chart.flush(); // what is showing includes anything still waiting to be drawn
  const live = element ? new XMLSerializer().serializeToString(element) : null;
  if (live && platform) {
    return svgToPng(live, { ...options, size: options.size ?? platform.size() }, host);
  }
  if (chart.platform) {
    // On a string platform the SVG is already in hand; on anything else there is nothing to draw it from.
    if (!(chart.platform instanceof StringPlatform)) throw inkplotError(168);
    return svgToPng(chart.platform.toString(), { ...options, size: options.size ?? chart.platform.size() }, host);
  }
  const a = chart.attrs,
    size = options.size ?? { width: a.width ?? 640, height: a.height ?? 400 };
  return svgToPng(toSvgString(chart, size), { ...options, size }, host);
}
