# Runbooks

Step-by-step procedures for the chores that come round. Each says when to do it, what to run, and how to know it worked. The rules for ordinary changes are in [CONTRIBUTING.md](CONTRIBUTING.md); read that first. Commands assume `pnpm install` has been run and, for the browser tests, a Chromium (`pnpm exec playwright install chromium`, or `INKPLOT_CHROMIUM=/path/to/chromium`).

**"Green"** always means `pnpm vp run --concurrency-limit 2 all` passes with nothing skipped and no lint warnings. Read the output; do not trust the exit code alone.

- [What's in the package](#whats-in-the-package)
- [Release a new version](#release-a-new-version)
- [One-time release setup](#one-time-release-setup)
- [Update dependencies](#update-dependencies)
- [Update the toolchain](#update-the-toolchain)
- [Move the platform floor](#move-the-platform-floor)
- [Change the Node version the repository uses](#change-the-node-version-the-repository-uses)
- [Regenerate the generated docs](#regenerate-the-generated-docs)
- [Investigate a failure that only happens in CI](#investigate-a-failure-that-only-happens-in-ci)
- [Housekeeping to remember](#housekeeping-to-remember)

## What's in the package

Two packages are published, **`inkplot`** (the library, the `inkplot` command and the AI skills) and **`inkplot-scratch`** (a command that turns a module of charts into SVG, PNG, JSON or an HTML app). They are built by `tools/pack-scratch.mjs`, which calls `tools/pack-consumer.mjs` for the library.

- **One version.** The version of both packages is `version` in the **root `package.json`**, and nowhere else. The packer writes it into the library's manifest, into `inkplot-scratch`'s manifest (whose `inkplot` dependency is pinned to exactly that version), and into the skills' version marks. `scratch/package.json` has no version of its own.
- **The JavaScript is the source with its types blanked out,** not a compiler's re-emission. `tools/strip-types.mjs` uses Node's own type stripping (`module.stripTypeScriptTypes`), which replaces every type with whitespace, so **each line is where it is in `src/`**. A stack trace from an installed `inkplot` names the line to open in the repository. The only edit is `.ts` to `.js` in relative import paths, which is the same length. This is why the code is limited to erasable TypeScript syntax (no `enum`, no `namespace`, no parameter properties), and `tools/pack.test.mjs` checks that the line counts agree.
- **The declarations (`.d.ts`) come from `tsc`** (`tsconfig.types.json`, declaration-only).
- Nothing is bundled or minified: an app bundles the library, and the files should read like the source.
- `engines` is deliberately not copied to the published manifest: the root's Node requirement is for the repository's tooling.

To look at what would be published: `node tools/pack-scratch.mjs out/release` (prints the tarball paths; `out/` is ignored by git), then `tar -tzf <tarball>`.

## Release a new version

Releases are made by publishing a **GitHub release**; the workflow in `.github/workflows/publish.yml` does the rest. Nothing goes live on npm until a maintainer approves it.

1. **Decide the version** (semver: a prerelease is `1.0.0-beta.3`, a release `1.0.0`). Breaking changes since the last release need a major (or, before 1.0, a note that says so).
2. **Make `main` green.** `git pull --rebase`, then `pnpm vp run --concurrency-limit 2 all`, and check the latest `ci.yml` run on GitHub is green too (it also runs the oldest Node, Deno and Bun). For a release that changes performance-sensitive code, run `pnpm vp run size` and compare with the last release; for platform-sensitive changes also run `pnpm vp run runtimes` (it fetches runtimes from npm, so it needs the network).
3. **Check the generated docs are current:** `node tools/api.ts > docs/reference/api.md && node tools/skill-topics.ts`, then `git status`. Nothing should change (the docs test fails otherwise).
4. **Bump the version** in the root `package.json` only. Look for prose that names the previous version: `git grep -n "<old version>"` (the install line in the README and the AI-agents guide say `@beta` while there is a beta; those do not name a number). Commit it as its own commit (`Release 1.0.0-beta.3`) and push.
5. **Create the release** on GitHub: tag **`v<version>`** exactly (`v1.0.0-beta.3`), target `main`, "Generate release notes", and tick **"Set as a pre-release"** for a prerelease. Publishing it starts the workflow.
6. **The workflow** (`Publish`):
   - `verify` fails if the tag is not `v` + the root `package.json` version, then runs the whole of `all`.
   - `publish` packs both packages and **stages** them with `npm stage publish`, `inkplot` first. The npm dist-tag comes from the version: `1.0.0-beta.3` goes under `beta`, a plain `1.0.0` under `latest`; any other prerelease name becomes its own tag (`rc`, …).
   - `assets` attaches the two skill zips (`inkplot-data-charts-<version>.zip`, `inkplot-skill-<version>.zip`) and `inkplot-playground-<version>.html` to the release.
7. **Approve the staged versions** (this asks for your 2FA): on npmjs.com under *Staged packages*, or `npm stage list inkplot`, `npm stage approve <stage-id>`, for each of `inkplot` and `inkplot-scratch`. Approve `inkplot` first.
8. **Check what is live:**
   ```sh
   npm view inkplot version dist-tags
   npm view inkplot-scratch version dist-tags
   npx inkplot@<version> --version          # the command runs and reports the version
   ```
   If a package's `latest` dist-tag is missing or wrong (npm does not move `latest` for a prerelease published under another tag, so the first release of a package may leave it unset), set it: `npm dist-tag add inkplot@<version> latest` (and the same for `inkplot-scratch`), or leave `latest` alone on purpose while only betas exist.
9. **Tidy up:** announce, and close the milestone or issues the release finishes.

**If the workflow fails before staging,** fix `main`, delete the GitHub release *and* its tag (`git push --delete origin v<version>`), and make the release again; a version that was staged but not approved can be discarded on npmjs.com. **If a bad version was approved and went live,** npm versions cannot be reused: publish the next patch version, and `npm deprecate inkplot@<bad> "reason, use <good>"`.

## One-time release setup

Done once per package/repository; keep as a checklist for a new fork or a renamed package.

- **GitHub:** an environment named `npm` (Settings, Environments), optionally with required reviewers; `publish.yml` runs its publish job in it.
- **npm:** each package exists (npm only lets you configure trusted publishing on a package that exists; `tools/publish-placeholder.mjs` publishes an empty placeholder for that, and can be deleted once it has been used). On each package's settings page add a **trusted publisher**: this GitHub repository, workflow `publish.yml`, environment `npm`, with `npm stage publish` allowed. There is no npm token anywhere; authentication is OIDC.
- The maintainers who approve staged packages have 2FA on their npm accounts.

## Update dependencies

The repository has no runtime dependencies; this is about the tooling. Versions live in two places: the **`catalog:`** in `pnpm-workspace.yaml` (the versions shared across the root and the packed packages), and the ordinary entries in `package.json` (`@babel/*`, `jsdom`, `@types/jsdom`). `inkplot-scratch`'s manifest is published as written, so the ranges in `scratch/package.json` for packages that are in the catalog (`typescript`, `rolldown`, `@resvg/resvg-wasm`) must equal the catalog's; `tools/pack.test.mjs` fails if they differ.

1. See what is old: `pnpm outdated -r`.
2. Update in small groups (the test runner and its plugins together; the React packages together; the type packages together), editing the catalog entry or `package.json`, then `pnpm install`. For a catalog package used by `scratch/package.json`, change that range too.
3. `pnpm vp run --concurrency-limit 2 all`. Browser tests use Playwright's Chromium: after a Playwright bump run `pnpm exec playwright install chromium`.
4. Read the changelog of anything with a major bump. Things that have bitten: a TypeScript release that changes `lib` types (the platform-floor check, `tsconfig.lib.json`, may start failing on a built-in); a linter or formatter release that adds rules or reflows code (see below); a new Rolldown that changes bundle size (`pnpm vp run size`).
5. Commit `package.json`/`pnpm-workspace.yaml` and `pnpm-lock.yaml` together, with the reason (`Update Playwright to 1.65`). One commit per group keeps a regression easy to bisect.

pnpm refuses to install a package version younger than its minimum release age, as a defence against compromised releases. `minimumReleaseAgeExclude` in `pnpm-workspace.yaml` lists the exact versions taken early on purpose (the Vite+ and Rolldown binaries). Do not add to it casually; remove entries when the versions are old enough to pass on their own.

## Update the toolchain

- **Formatter (`oxfmt`) or linter (`oxlint` via Vite+):** bump it, run `pnpm vp fmt`, and commit the reformatting **by itself**. Add that commit's full hash to `.git-blame-ignore-revs` (one hash per line, with a comment) so `git blame` skips it. If the new linter reports new things, fix them in separate commits, or add a rule override in `vite.config.ts` with a comment saying why. Remember `--report-unused-disable-directives`: a rule change can make an old opt-out unused, which fails the build.
- **TypeScript:** run `npx tsc -p .` and `npx tsc -p tsconfig.lib.json`. The library must still compile against ES2021 built-ins only.
- **Vite+/Vitest:** run the whole suite; the test config (pool, timeouts, retry in CI) is in `vite.config.ts`.
- After any of these, build the package once (`node tools/pack-scratch.mjs out/release`) and run `pnpm vp run pack:test`.

## Move the platform floor

Two floors exist; do not confuse them.

**The library's floor** (what users' browsers and runtimes must have; today Baseline 2021: Chrome 86, Firefox 90, Safari 15, Node 16, Deno 1.6, Bun 1.0). Raising it is a breaking change for users, so do it for a reason (a feature that needs a newer API) and in a major release or with a loud note.

1. Change the year in the `baseline-js/use-baseline` rule in `vite.config.ts`, and the `lib` in `tsconfig.lib.json` (`es2021` to the new level).
2. Run `npx tsc -p tsconfig.lib.json` and `pnpm vp lint src`: they name every place that can now use (or, when lowering, no longer may use) a newer API. Newer APIs behind feature detection keep a lint comment that says so.
3. Update the table and prose in `docs/guide/compatibility.md` (the browser and runtime versions, and which feature set the floor), `docs/extending/` pages that name the floor, the README if it states one, and the comment in `tsconfig.lib.json`.
4. **The CI runtime matrix** tests the oldest runtimes the docs name: in `.github/workflows/ci.yml` the `runtimes` job lists Node `16.0.0`, Deno `1.31.3` (the first with the `node:` imports the tests use), Bun `1.0.0`. When the floor moves, change these to the new oldest versions, and the `runtimes` list in `tools/runtimes.ts` (oldest and newest of each, drawn by `pnpm vp run runtimes`) to match. Update the same versions in `docs/guide/compatibility.md`.
5. Remember the tests are held to the floor too (CONTRIBUTING, "The platform floor"): old runtimes run them.
6. `pnpm vp run --concurrency-limit 2 all`, then `pnpm vp run runtimes` (network needed), then push and read the `runtimes` jobs in CI.

**A new newest runtime** (a new Node/Deno/Bun release) needs no change unless `pnpm vp run runtimes` shows a failure: it uses `@latest`.

## Change the Node version the repository uses

This is the version that runs the *tooling* (build, tests, packing), not the library's floor.

1. `engines.node` in the root `package.json`, and `node-version` in **both** workflows (`.github/workflows/ci.yml` and `publish.yml`, three places in `ci.yml` and `publish.yml` combined: grep `node-version`).
2. The tools use Node's built-in type stripping (`tools/*.ts` run directly, and `module.stripTypeScriptTypes` builds the package), which is experimental and changes between releases. Run `node tools/pack-scratch.mjs out/release` and `pnpm vp run pack:test` on the new version, and read any new warnings.
3. `inkplot-scratch` declares its own `engines.node` in `scratch/package.json`: that is what its users need, a separate floor.
4. Green, then push and check CI.

## Regenerate the generated docs

When an attribute, its doc comment, or an element's place in the tree changes:

```sh
node tools/api.ts > docs/reference/api.md     # the full attribute reference
node tools/skill-topics.ts                    # the generated parts of docs/SKILL.md and docs/skill-topics/*.md
pnpm vp run docs                              # compiles and runs every example, and checks these files are current
```

Do not edit the generated parts by hand. The prose around them (in `docs/guide/` and in `docs/skill-topics/`) is hand-written and should be updated together. `INKPLOT_DOCS_SHEET=1 pnpm vp run docs` writes `out/docs-sheet.html` with every live example drawn on one page, for looking at.

## Investigate a failure that only happens in CI

1. Read the failing job's log from the top of the failure, not the summary. `gh run list`, `gh run view <id> --log-failed`.
2. **A runtime job failing (Node 16, Deno, Bun) and nothing else:** a built-in newer than the floor in code or a test (`.at()`, `Object.hasOwn`, `findLast`, `structuredClone`, `toSorted`). Fix it with index arithmetic or a plain loop. To reproduce: `node tools/runtime-tests.ts` bundles the unit tests into `out/runtime-tests/*.mjs`, which run on any runtime (`npx -y node@16.0.0 out/runtime-tests/<file>.mjs`).
3. **A browser test failing on timing:** a few tests measure real time; CI runs two tasks at a time and retries once. Reproduce with the same limit (`--concurrency-limit 2`); if it is a new flaky test, make it deterministic rather than raising a threshold.
4. **A packaging failure:** `node tools/pack-scratch.mjs out/release` and read the error; `pnpm vp run pack:test`.
5. **Only on a fork pull request:** the coverage comment cannot post with a read-only token (`continue-on-error` covers it); other failures are real.

## Housekeeping to remember

- `tools/publish-placeholder.mjs` was for the first publish only; delete it once the trusted publishers are set up.
- `.git-blame-ignore-revs` lists mechanical commits; add to it, never remove. Contributors run `git config blame.ignoreRevsFile .git-blame-ignore-revs`.
- `out/`, `coverage/`, `types/`, `shots/`, `playground.html` and `*.tgz` are build output and ignored; keep scratch files there, not in the root.
- A release's README install line should say `@beta` only while the latest release is a prerelease.
