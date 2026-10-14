# Browsers and runtimes

inkplot is written in ES2022 syntax and ships as it is written: no transpiling, no polyfills. What that asks of a platform is checked on every change, so the table below is the real floor, not a hope.

| Platform | Needs | Released |
|---|---|---|
| Chrome, Edge | 86 | Oct 2020 |
| Firefox | 90 | Jul 2021 |
| Safari (macOS, iOS) | 15 | Sep 2021 |
| Node.js | 16 | Apr 2021 |
| Deno | 1.6 | Jan 2021 |
| Bun | 1.0 | Sep 2023 |

That is **Baseline 2021**: everything the library uses was available in all the major browsers by the end of 2021. Firefox 90 and Safari 15 set the floor (private class members, which the elements use throughout); Chrome 86 is `replaceChildren` in the DOM platform. Node 16 is the first with a global `performance`, which the flush uses to time itself.

A few things are optional and need more, and the library checks for them rather than assuming:

- `TemporalTimeScale` needs `Temporal`: Chrome 144, Firefox 139, Node 26, Deno 2.7, Bun 1.4, or a polyfill passed as its `temporal` attribute. `IntlTimeScale` needs only `Date` and `Intl`.
- `toPng` draws on an `OffscreenCanvas` where there is one (Chrome 69, Firefox 105, Safari 16.4) and on a `<canvas>` element where there is not.
- Pan and zoom by touch needs pointer events (Chrome 55, Firefox 59, Safari 13), which the floor already has.

Server-side, the SVG output uses nothing from a browser: the same bundle runs unchanged on Node, Deno and Bun. CI runs the unit tests on the oldest of each (Node 16.0, Deno 1.31, Bun 1.0), and `pnpm vp run runtimes` draws a chart on Node 16.20, 20 and the latest, Deno 1.46 and the latest, and Bun 1.0 and the latest. Deno 1.31 is the first with the `node:` imports the tests use; the library itself draws a chart from Deno 1.6.

## How it is held

- `tsconfig.lib.json` compiles the library against the ES2021 built-ins and no Node types, so a newer method (`Object.hasOwn`, `Array.prototype.at`, `toSorted`) is a type error.
- The `baseline-js/use-baseline` lint rule, set to 2021, reports any JavaScript feature or Web API newer than that, in the library's sources (not its tests).
- A call that is newer but guarded by feature detection carries a lint comment that says so, as `OffscreenCanvas` does in `png.ts`.

To move the floor, change the year in `vite.config.ts` and fix what the two checks then name.
