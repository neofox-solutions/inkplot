# Contributing to inkplot

This guide is for everyone who changes the repository: people, and AI coding agents (it is written to be read start to finish by either). It says what the project values, the rules the checks enforce, what a change must include, and how to know it is done. Chores that come round (a release, a dependency update, a platform bump) are step by step in [RUNBOOKS.md](RUNBOOKS.md). How the *documentation* is written is in [docs/authoring.md](docs/authoring.md); how the library is put together is in [docs/extending/how-it-works.md](docs/extending/how-it-works.md).

If you are an agent: read this file and the two pages above before editing, run the checks (below) before saying a change is finished, and read their output, not just their exit code.

## Contents

- [Getting started](#getting-started)
- [What inkplot values](#what-inkplot-values)
- [The repository](#the-repository)
- [Code standards](#code-standards)
- [Architecture rules the checks hold](#architecture-rules-the-checks-hold)
- [Adding or changing a feature](#adding-or-changing-a-feature)
- [Tests](#tests)
- [Documentation](#documentation)
- [Commits and pull requests](#commits-and-pull-requests)
- [Working as an agent](#working-as-an-agent)

## Getting started

You need Node 26 or later (the repository's tooling, not the library, needs it; see [platform floor](#the-platform-floor)) and pnpm (the version is pinned by `packageManager` in `package.json`).

```sh
pnpm install
pnpm exec playwright install chromium   # the browser tests; or set INKPLOT_CHROMIUM to a Chromium you have
pnpm vp run --concurrency-limit 2 all   # everything CI runs
```

The toolchain is [Vite+](https://viteplus.dev) (`vp`): one command for tests, lint and format. The commands you will use:

| Command | What it does |
|---|---|
| `pnpm vp run all` | Everything CI runs. Run it with `--concurrency-limit 2`: a few tests run against the clock, and more tasks at once make them flaky. |
| `pnpm vp test run src/series.test.ts` | One test file. Without a path: all of them. |
| `npx tsc -p .` | The type check of everything (the same as the `check` task, which also checks the library against the platform floor). |
| `pnpm vp lint src` | Lint. `pnpm vp run lint` adds the strict audit (see [non-null assertions and casts](#typescript)). |
| `pnpm vp fmt` | Format. It rewrites files, so run it *before* a scripted find-and-replace and re-read the text you meant to match. |
| `pnpm vp run size` | The bundle cost of each feature. |
| `node build-playground.ts` | Rebuild `playground.html`, the page with a demo of each feature. |
| `node tools/api.ts > docs/reference/api.md`, `node tools/skill-topics.ts` | Regenerate the generated docs (see [Documentation](#documentation)). |

`pnpm vp run all` is the definition of green. A change is not finished until it passes, with no warnings in the lint output.

## What inkplot values

These are the reasons behind the rules. When a rule does not cover a case, decide by these.

- **Small, and pay for what you use.** A minimal chart is about 15 KB gzipped; each feature adds only its own code. Features are opt-in by import, and the import graph is held to that (see [layers](#architecture-rules-the-checks-hold)). A feature that makes every chart bigger is a bug. Measure with `pnpm vp run size`.
- **Zero dependencies.** The library imports nothing but itself. A new runtime dependency is not a trade-off to weigh case by case: the answer is no.
- **A tree you keep.** A chart is a tree of elements configured by attributes, changed in place and redrawn. A new capability is an element (or an attribute on one), not a global, a plugin registry or a hidden mode.
- **Everything language-shaped is the user's.** The core has no English strings, no translation tables and no locale data. Numbers and dates come from `Intl`; words (titles, labels, error messages for users' mistakes aside) come from attributes. Nothing in core code may assume English, a left-to-right script, a calendar, or a decimal mark.
- **The same on every platform.** The library draws through a platform (the DOM, a string for servers, a test double). It runs unchanged on browsers and on Node, Deno and Bun, including old ones (see [the platform floor](#the-platform-floor)). SVG output must be identical wherever it is produced.
- **Fast where it counts.** Per-frame and per-point code is written for the engine: typed arrays, no allocation in loops, caches keyed on `version`. Elsewhere, clarity beats cleverness. Do not optimise without a number, and do not leave a measured hot path slower than you found it.
- **Accessible and testable by default.** Charts have text alternatives and keyboard operation (see the accessibility guide); features that draw must say what they draw.
- **Honest errors.** A mistake the user can make (a channel that does not exist, an element in the wrong parent, a data layout that disagrees with its use) fails early with a message that names the thing and says what to do. `fail(message)` from `element.ts` is how.
- **Docs and examples that cannot rot.** Every example in the docs is compiled, and every `live` one is run, in CI. If it is documented it is tested.
- **Written for readers.** The source is read by people and by models. Say *why*, not what; keep modules focused; prefer a plain function to a clever abstraction.

## The repository

```
src/            the library (one module per feature, a *.test.ts beside each)
  index.ts      the public barrel; registry.ts the element registry (serialization, adapters)
cli/            the `inkplot` command (installs the AI skills)
scratch/        inkplot-scratch: a command that turns a module of charts into SVG/PNG/JSON/HTML
docs/           the documentation (Markdown); docs/reference and docs/skill-topics are partly generated
playground/     the demo page's source; build-playground.ts makes playground.html
tools/          repository tooling: packing, docs and layering tests, size, API reference generator
*.test.mjs      browser tests (the playground, React, web components, touch, worker, PNG)
.github/        CI (ci.yml) and the release workflow (publish.yml)
```

`docs/start/concepts.md` is the one-page model of the library; `docs/extending/how-it-works.md` is the map of the machinery.

## Code standards

### TypeScript

- **Strict, and erasable only.** The compiler runs with `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride` and `noUnusedLocals`. `erasableSyntaxOnly` is on, because the library is shipped by blanking its types out (see [RUNBOOKS](RUNBOOKS.md#whats-in-the-package)): no `enum`, no `namespace`, no parameter properties (`constructor(private x)`), no `import x = require`. Use `const` objects, unions and ordinary fields.
- **Import with the real extension:** `import { Chart } from './chart.ts'`. Type-only imports use `import type` or `{ type X }` (`verbatimModuleSyntax`).
- **No `any`, no `@ts-ignore`, no `@ts-nocheck`.** `@ts-expect-error` needs a description.
- **Non-null assertions (`x!`) are forbidden, with one exception that is owned in writing.** `noUncheckedIndexedAccess` types every `a[i]` as possibly `undefined`, which is wrong inside a numeric loop whose bound proves the index. A file full of such loops opts out with a file-level `/* oxlint-disable typescript/no-non-null-assertion -- <reason> */` at the top, or a single line does with a comment that says why. `tools/lint-audit.mjs` then fails on any `!` that is *not* an indexed read (`a[i]!`): write a guard, restructure, or use `??` instead. `?.[i]!` is not allowed.
- **Casts (`as T`) are forbidden** (`as const` too: write the type). Where one is truly needed (user data of unknown shape, an attribute bag read by name), a line or file opts out with a comment giving the reason. Prefer narrowing, a type guard, a generic, or `satisfies`.
- **Unused lint directives fail the build** (`--report-unused-disable-directives`): remove an opt-out when the code it excused is gone.
- **Format** is `pnpm vp fmt` (oxfmt: width 140, single quotes). Do not hand-format against it; do not mix reformatting into a change (a formatter bump goes in its own commit and in `.git-blame-ignore-revs`).
- **Public means semver; `@internal` is the exception.** Everything exported from an entry point follows semver. An export that is only there for the library's own entry points or for advanced use, and that is not documented as API, is tagged `@internal` in its JSDoc (`/** … @internal */`), which is the only way a name is left out of the promise. Do not tag a name that appears in a public signature or in a guide; document it or leave it public.
- **Private fields are `#private`** (`private` and `protected` are fine for methods). Elements keep attributes in `attrs` and expose what other code needs through getters.
- **Names:** classes `PascalCase`, files `lowercase-with-dashes.ts` named for the feature, attributes `camelCase`. A class that is an element is registered (see [adding a feature](#adding-or-changing-a-feature)).
- **Errors** for the user's mistakes are `fail('…')`, in sentence case, naming what was wrong and what would work, quoting names with double quotes (`the data has no channel "w"`). Internal invariants may throw plainly.

### Comments and documentation in the source

- Every public attribute has a doc comment. The **first sentence** is what the generated API reference shows (`docs/reference/api.md`), so make it stand alone and say what the attribute is for and its default.
- Module headers say what the module is, and why it is shaped that way when that is not obvious (see `data.ts`).
- Comments explain *why*: a constraint, an invariant, a decision. Do not narrate the line below, and do not leave commented-out code or `TODO`s behind (there are none in the source today).
- Keep comments true. A change that makes a comment wrong updates it in the same commit.

### The platform floor

The library ships as written (ES2022 syntax, no transpiling, no polyfills) and must run on **Baseline 2021**: Chrome 86, Firefox 90, Safari 15, Node 16, Deno 1.6 (the tests need 1.31), Bun 1.0. Two checks hold it, and CI runs the unit tests on the oldest Node, Deno and Bun:

- `tsconfig.lib.json` compiles `src` against the ES2021 built-ins with no Node types, so `Array.prototype.at`, `Object.hasOwn`, `findLast`, `toSorted`, `structuredClone` and the like are type errors;
- the `baseline-js/use-baseline` lint rule (2021) in the library's sources.

**The tests are held to the floor too**, because the old runtimes run them: do not use `.at()`, `Object.hasOwn`, `Array.prototype.findLast` and friends in a `*.test.ts` either, or Node 16 fails when your machine does not. A newer feature behind a real feature check gets a lint comment that says so (see `OffscreenCanvas` in `png.ts`). Move the floor only by the [runbook](RUNBOOKS.md#move-the-platform-floor).

### Performance

- No allocation in per-point or per-frame loops: reuse typed arrays, and key caches on `version` (see `data.ts`).
- A kernel over flat buffers addresses by stride, and may use indexed `!` under a file-level opt-out with a reason.
- A cached result handed to a caller who keeps it must not be a buffer you overwrite on the next call (copy, as `Decimator` does for the rows it reports).
- Check the cost of a feature with `pnpm vp run size`, and report the delta for a change that grows the minimal chart.

## Architecture rules the checks hold

`tools/deps.test.ts` holds the import graph to three layers so a feature can never become a hidden cost of every chart:

| Layer | Rule |
|---|---|
| **Foundation** (`geometry`, `events`, `theme`, `element`, `attrs`, …) | Knows nothing of charts. |
| **Core** (`chart`, `plane`, `axis`, `series`, `renderer`, `data`, …) | What every chart pulls in. Imports foundation and core only. |
| **Features** (everything else) | Independent of one another. A feature may use another only if the pair is listed in `FEATURE_USES` in `tools/deps.ts`: add the line on purpose, with the reason in mind, and expect review to ask. |

Only *runtime* imports count; a type-only import is free. If a feature needs a type from another, import the type.

Other rules of the design that the code relies on:

- **Elements are `new X(attrs, ...children)`**, plain classes, with `attrTypes` describing their attributes for the adapters (JSX, React, web components, serialization). A new attribute needs an `attrTypes` entry or it is invisible to them.
- **Data stages deliver by plan:** `plan(context) → { capacity, fill }`, and the caller owns the buffer. The columns asked for are named in `context.columns`; a stage resolves them by name. Whether points are wanted ascending in the domain is `context.sorted`. See [Custom data and scales](docs/extending/custom-data-and-scales.md). Anything that changes the data bumps `version`.
- **Draw through the surface,** never the DOM directly in core code: the same chart must render to a string on a server.
- **No global mutable state.** Module-level scratch is only for synchronous, non-reentrant kernels (see `runExtent` in `decimation.ts`), and says so.

## Adding or changing a feature

A new element, renderer, scale, data stage or option is complete when all of this is true. (The commit that added `GradientLinePath` is a good model: `git show a619d6d --stat`.)

1. **The code** in `src/<feature>.ts`, following the layering above. Doc comments on every attribute.
2. **Registered:** exported from `src/index.ts`; in `src/registry.ts` (so it serializes); in `src/react.ts` if it is an element (the React wrapper); in `tools/deps.ts` (`FEATURE_USES` for `react`, and any other declared use); in `tools/api.ts` (`STRUCTURE`: parent, children, one line) and, if it belongs in a skill topic, `tools/skill-topics.ts`. The tests in `tools/` fail with a message naming what is missing.
3. **Tests** beside it (`src/<feature>.test.ts`): see [Tests](#tests).
4. **Docs:** the relevant guide page (with a live example if it is something a reader will use), the skill topic if an agent should know it, and the regenerated reference. See [Documentation](#documentation).
5. **A playground demo** in `playground/app.ts` for anything a person looks at, and its name in the coverage list there, so the page shows every feature; `node build-playground.ts` and the playground test confirm it draws.
6. **Cost:** `pnpm vp run size`. A feature that makes the minimal chart bigger is a layering mistake.
7. **Accessibility, i18n and platforms:** it works from the keyboard and has a text alternative where it draws; no English in the core; no API newer than the floor.
8. **`pnpm vp run --concurrency-limit 2 all`** passes.

A change to behaviour that is documented changes the docs in the same commit. A change to a public default or a removed option is a breaking change: say so in the commit message.

## Tests

Every behaviour change comes with a test that fails without it. Bug fixes start with the test that reproduces the bug.

- **Where:** `src/<module>.test.ts` beside the module for unit tests; `*.test.mjs` at the root for tests that need a real browser (Chromium via Playwright) or the packaging; `tools/*.test.*` for the repository's own checks.
- **Style:** `import assert from 'node:assert/strict'` and `import { test } from 'vite-plus/test'`. A file is a script of blocks inside one or a few `test('name', …)` calls: set up, act, assert, with a message on any assertion that would otherwise be cryptic. Comments say what the block establishes.
- **Charts are drawn on a `StringPlatform`** (the server platform: no browser needed). Assert on geometry and on the SVG string, and check that nothing in the output is `NaN` or `undefined`. Test the *numbers* (a point lands at pixel x), not just that something drew.
- **Compare with an independent oracle** for numeric code: a straightforward implementation in the test, or the same computation by another route (see how `partition.test.ts` checks the keyed reduction against reducing each key alone). Cover the edges: empty data, one point, NaN gaps, unsorted input, a window that cuts the data, a zoomed range, duplicate domain values.
- **Floor-safe:** no post-ES2021 built-ins (see [the platform floor](#the-platform-floor)); CI runs these files on Node 16, Deno 1.31 and Bun 1.0.
- **Deterministic:** no network, no `Math.random()`, no wall-clock assertions (a few interaction tests run against the clock and are retried once in CI; do not add more).
- **Docs examples are tests:** `tools/docs.test.ts` compiles every `live` and `check` block. See [Documentation](#documentation).
- **Coverage** is recorded on every run (`vp test run src/ --coverage`) and commented on pull requests. New code should be covered by its own tests; do not delete a test to make a change pass—change it when its expectation is the thing that changed, and say so in the commit message.

## Documentation

- The docs are Markdown in `docs/`. **Live examples** are fenced `tsx live` blocks that a docs site runs and CI compiles and draws; the format and the rules are in [docs/authoring.md](docs/authoring.md). Example ids (from the `title`, or `id=`) must be unique across the docs.
- **Generated parts must be regenerated, not edited:** `docs/reference/api.md` (`node tools/api.ts > docs/reference/api.md`), the attribute tables in `docs/skill-topics/*.md` and `docs/SKILL.md` (`node tools/skill-topics.ts`). `tools/docs.test.ts` fails if they are stale. The prose around the generated parts, in the guide *and* in the matching skill topic, is hand-written, and a change usually touches both.
- Guide pages: one `#` per page, a paragraph saying what the page is for, a short live example near the top of each section, then tables, then details. Say what is *not* supported when a reader would expect it.
- Troubleshooting: a new `fail(...)` message the user can hit gets a row in `docs/reference/troubleshooting.md` (and the skill's copy), saying what causes it and what to do.

## Commits and pull requests

- **One logical change per commit,** with the checks green at each commit. A refactor that must land with a behaviour change can go in two commits (the refactor first, with no behaviour change and the tests as the proof).
- **Subject:** a sentence in the imperative or descriptive, no prefix, under ~72 characters, saying what the change *lets* the library do (`A Decimator carries channels and says which source row each point is`). **Body:** why, what the design is, what it does not do, and any behaviour change a user would notice.
- **Rebase, do not merge:** `git pull --rebase` before pushing. Do not rewrite history on `main`.
- **Pull requests** say what changed and why, how it was verified (the commands you ran), and anything a reviewer should look at first. CI (`ci.yml`) runs `all` plus the oldest Node, Deno and Bun; it must be green.
- **Mechanical changes** (a formatter run, a rename across files) are their own commit, and their revision goes in `.git-blame-ignore-revs`.
- **Attribution:** commits made with an AI tool carry the tool's `Co-Authored-By` trailer; the human who sends the change is responsible for it.

## Working as an agent

Things that have gone wrong before, so that they do not again:

- **Run the whole check, read the output.** `pnpm vp run --concurrency-limit 2 all`. A passing exit code with a lint warning, or a skipped task, is not green. Run the failing test on its own to read the real error (an "unhandled error" from a browser test often hides an exception from your change in the page).
- **Set `INKPLOT_CHROMIUM`** (to a Chromium) if Playwright's own browser is not installed, or the browser tests fail to launch for reasons that have nothing to do with your change.
- **`pnpm vp fmt` before a scripted edit.** The formatter reflows code, so a replacement written against the text you remember silently fails to match. Re-read the actual text first.
- **Do not use post-2021 built-ins in `src` or in tests** (`.at()`, `Object.hasOwn`, `findLast`, `toSorted`): Node 16 runs the tests in CI.
- **Do not add dependencies,** do not add `any`, `as`, `!` or `@ts-ignore` to get past a check; fix the type. If a lint opt-out is truly warranted, it carries a reason.
- **An unused lint directive fails the build.** Delete opt-outs when the code under them changes.
- **Generated files:** after changing an attribute or its doc comment, regenerate the reference and the skill topics, and commit them with the change.
- **Doc example ids are global,** and docs code blocks are compiled with `noUnusedLocals`.
- **Keep the working tree clean of scratch files** (screenshots, logs): put them under `out/`, which is ignored. `git status` before committing.
- **Do not guess at the platform:** the shell of a sandbox may not reach the network. The tools you need are in the repository; the browser tests need a local Chromium.
- **Ask when the design is the question,** and when it is not, make the call, say what you decided, and keep the change small enough to review.
