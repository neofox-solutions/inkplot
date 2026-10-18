# Browsers and runtimes

inkplot is written in ES2022 syntax and ships as it is written: no transpiling, no polyfills. What that asks of a platform is checked on every change, so the table below is the real floor, not a hope.

| Platform | Needs | Released |
|---|---|---|
| Chrome, Edge | 86 | Oct 2020 |
| Firefox | 90 | Jul 2021 |
| Safari (macOS, iOS) | 15 | Sep 2021 |
| Node.js | 16 | Apr 2021 |
| Deno | 1.31 | Feb 2023 |
| Bun | 1.0 | Sep 2023 |

That is **Baseline 2021**: everything the library uses was available in all the major browsers by the end of 2021. Firefox 90 and Safari 15 set the floor (private class members, which the elements use throughout); Chrome 86 is `replaceChildren` in the Web Components adapter. Node 16 is the first with a global `performance`, which the flush uses to time itself.

A few things are optional and need more, and the library checks for them rather than assuming:

- `TemporalTimeScale` needs `Temporal`: Chrome 144, Firefox 139, Node 26, Deno 2.7, Bun 1.4, or a polyfill passed as its `temporal` attribute. `IntlTimeScale` needs only `Date` and `Intl`.
- `toPng` draws on an `OffscreenCanvas` where there is one (Chrome 69, Firefox 105, Safari 16.4) and on a `<canvas>` element where there is not.
- Pan and zoom by touch needs pointer events (Chrome 55, Firefox 59, Safari 13), which the floor already has.

Server-side, the SVG output uses nothing from a browser: the same bundle runs unchanged on Node, Deno and Bun. CI runs the unit tests on the oldest of each (Node 16.0, Deno 1.31, Bun 1.0), and `pnpm vp run runtimes` draws a chart on Node 16.20, 20 and the latest, Deno 1.46 and the latest, and Bun 1.0 and the latest. Deno 1.31 is the first with the `node:` imports the tests use; the library itself draws a chart from Deno 1.6.

## Module format and TypeScript

- **ESM only.** inkplot is published as ES modules (`"type": "module"`) with no CommonJS build. `import` works everywhere in the table above. `require('inkplot')` works only where `require` can load an ES module (Node 22.12 or later, Node 20.19 or later, Bun); on Node 16 to 20.18 it fails with `ERR_REQUIRE_ESM`, and TypeScript with `module: node16` reports TS1479 for it. Use `import`, or `await import('inkplot')` from CommonJS.
- **TypeScript 5.0 or later.** The declaration files import their neighbours with the `.ts` extension, which TypeScript accepts in declarations from 5.0 on; older compilers do not follow those imports and type what they reach as `any`. Use `moduleResolution` `bundler`, `node16` or `nodenext` (the `exports` map needs one of them).
- **`@types/node` for the Node entry points.** `inkplot/node-worker` imports from `node:worker_threads`, so a project that type-checks it needs `@types/node` (or `skipLibCheck`). The main entry point and the browser entry points need no Node types.

## Error messages in production builds

Every error inkplot throws has a numeric code. A development build throws the full message, `[inkplot 255] Axis: has no child 0 (it needs Scale)`. A production build leaves the message table out of the bundle (about 3 KB gzipped for the whole library, 0.4 KB for a minimal chart) and throws `Minified inkplot error: https://inkplot.neofox.solutions/errors#255 [Axis]`, with the values the message mentions in brackets; [the error reference](../reference/errors.md) has every code.

The build type is read from `import.meta.env.PROD` first, then `process.env.NODE_ENV === 'production'`, and the message table drops out only if your bundler replaces one of them with a constant. Most do it by themselves for a production build:

| Where | What to do | Checked |
|---|---|---|
| Vite | Nothing: `vite build` sets both. | Yes: a Vite build is in the tests. |
| Rolldown, esbuild | Define `process.env.NODE_ENV` as `"production"` (`--define:process.env.NODE_ENV=\"production\"` for esbuild). | Rolldown in the tests; esbuild by hand. |
| webpack | Nothing: `mode: 'production'` defines `process.env.NODE_ENV`. | No: reasoned from how webpack treats `process.env.NODE_ENV` and an unknown `import.meta` property, not run. |
| Bun, Deno (bundling) | Define `process.env.NODE_ENV` as above (`bun build --production` does). | No. |
| No bundler (a browser loading the modules as they are) | Nothing: there is no `process` to read, so errors use the short form. | Yes. |
| Node, Deno, Bun running the sources | Set `NODE_ENV=production` for the short form; otherwise the full messages. | Yes (Node). |

If the bundler defines neither, the messages stay in the bundle and the errors are the full ones: a larger bundle, never a wrong one. In a Vite dev server that serves a linked copy of inkplot's own sources, the browser has no `process`, so errors there use the short form; look the code up in the reference, or build inkplot in development mode.

## How it is held

- `tsconfig.lib.json` compiles the library against the ES2021 built-ins and no Node types, so a newer method (`Object.hasOwn`, `Array.prototype.at`, `toSorted`) is a type error.
- The `baseline-js/use-baseline` lint rule, set to 2021, reports any JavaScript feature or Web API newer than that, in the library's sources (not its tests).
- A call that is newer but guarded by feature detection carries a lint comment that says so, as `OffscreenCanvas` does in `png.ts`.

To move the floor, change the year in `vite.config.ts` and fix what the two checks then name.
