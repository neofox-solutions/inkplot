// One configuration for the toolchain (Vite+): `lint` is Oxlint's, as it stood in .oxlintrc.json.
import { defineConfig } from 'vite-plus';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', '*.test.mjs', 'tools/**/*.test.{ts,mjs}'],
    // Each file is one long script-style test; the heavy ones take seconds, and a CI machine is slower than this one.
    testTimeout: 120_000,
    hookTimeout: 60_000,
    // A fresh process per file, with the memory ceiling `npm test` used to give each one.
    pool: 'forks',
    execArgv: ['--max-old-space-size=768'],
    isolate: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/fake-platform.ts'],
      // `json-summary` is what the CI report reads; `json` gives it the per-file detail.
      reporter: ['text-summary', 'json-summary', 'json', 'html'],
      reportsDirectory: 'coverage',
      reportOnFailure: true,
    },
    // Some tests run against the clock (a flick is a speed over real milliseconds), so in CI, with its shared and
    // slower cores, fewer files run at once and a failure is tried once more before it counts.
    maxWorkers: process.env.CI ? 2 : undefined,
    retry: process.env.CI ? 1 : 0,
    reporters: process.env.CI ? ['default', 'github-actions'] : ['default'],
  },
  run: {
    // `vp run all` is everything CI runs. Tasks that write files, need a browser, or reach the network are not cached.
    tasks: {
      check: { command: ['tsc -p .', 'tsc -p tsconfig.lib.json'] },
      lint: {
        command: [
          'vp lint --deny-warnings --report-unused-disable-directives src scratch/src tools *.mjs *.ts',
          'node tools/lint-audit.mjs',
        ],
      },
      fmt: { command: 'vp fmt', cache: false },
      'fmt:check': { command: 'vp fmt --check' },
      // Coverage is recorded on every run (it is cheap), so the CI report always has it.
      test: { command: 'vp test run src/ --coverage', cache: false },
      deps: { command: 'vp test run tools/deps.test.ts' },
      docs: { command: 'vp test run tools/docs.test.ts tools/skill-ts.test.mjs', cache: false },
      types: { command: 'rm -rf types && tsc -p tsconfig.types.json', cache: false },
      playground: { command: 'node build-playground.ts', cache: false },
      'playground:test': { command: 'vp test run playground.test.mjs', dependsOn: ['playground'], cache: false },
      'react:test': { command: 'vp test run react.test.mjs', cache: false },
      'wc:test': { command: 'vp test run webcomponents.test.mjs', cache: false },
      'touch:test': { command: 'vp test run touch.test.mjs', cache: false },
      'png:test': { command: 'vp test run png.test.mjs', cache: false },
      'png-server:test': { command: 'vp test run tools/png-server.test.mjs', cache: false },
      'scratch:test': { command: 'vp test run tools/scratch.test.mjs', cache: false },
      'pack:test': { command: 'vp test run tools/pack.test.mjs', cache: false },
      'runtime-tests': { command: 'node tools/runtime-tests.ts', cache: false },
      runtimes: { command: 'node tools/runtimes.ts', cache: false },
      size: { command: 'node tools/size.mjs --modules', cache: false },
      all: {
        command: 'echo all green',
        cache: false,
        dependsOn: [
          'check',
          'lint',
          'fmt:check',
          'test',
          'deps',
          'docs',
          'types',
          'playground:test',
          'react:test',
          'wc:test',
          'touch:test',
          'png:test',
          'png-server:test',
          'scratch:test',
          'pack:test',
        ],
      },
    },
  },
  fmt: {
    printWidth: 140,
    singleQuote: true,
    ignorePatterns: [
      'out/**',
      'coverage/**',
      'types/**',
      'shots/**',
      'node_modules/**',
      'playground.html',
      'pnpm-lock.yaml',
      '**/*.md',
      'docs/**',
      'scratch/skill/**',
      '**/*.json',
      '**/*.yml',
      '**/*.yaml',
      '**/*.html',
      '**/*.css',
    ],
  },
  lint: {
    options: { typeAware: true },
    // The platform the library may assume (see docs/extending/platforms.md): nothing newer than Baseline 2021 in what ships.
    jsPlugins: ['eslint-plugin-baseline-js'],
    plugins: ['typescript', 'unicorn', 'oxc'],
    categories: {
      correctness: 'error',
      suspicious: 'warn',
    },
    // No `env` here: with globals declared, the Baseline rule takes `Object` and `OffscreenCanvas` for the program's own names and
    // sees nothing. The library is checked without one (TypeScript knows its globals); everything else is given them below.
    ignorePatterns: ['out/**', 'coverage/**', 'types/**', 'shots/**', 'node_modules/**', 'playground.html'],
    rules: {
      'typescript/no-explicit-any': 'error',
      'typescript/ban-ts-comment': [
        'error',
        {
          'ts-expect-error': 'allow-with-description',
          'ts-ignore': true,
          'ts-nocheck': true,
        },
      ],
      'typescript/no-confusing-non-null-assertion': 'off',
      'eslint/no-new': 'off',
      'eslint/no-shadow': 'off',
      'eslint/no-underscore-dangle': 'off',
      'unicorn/consistent-function-scoping': 'off',
      'unicorn/no-array-fill-with-reference-type': 'off',
      'unicorn/no-array-sort': 'off',
      'unicorn/no-array-reverse': 'off',
      'unicorn/prefer-add-event-listener': 'off',
      'typescript/no-non-null-assertion': 'error',
      // Casts are owned by the comments above each one (consistent-type-assertions), so a second rule would only repeat them.
      'typescript/no-unsafe-type-assertion': 'off',
      // Exhaustive switches and effect cleanups return on some paths by design; tsc checks the exhaustive ones.
      'typescript/consistent-return': 'off',
      'typescript/no-unnecessary-type-parameters': 'off',
      'typescript/consistent-type-assertions': [
        'error',
        {
          assertionStyle: 'never',
        },
      ],
    },
    overrides: [
      {
        files: ['src/*.test.ts', 'src/*.check.tsx', 'src/fake-platform.ts', 'tools/**', 'scratch/**', '*.mjs', '*.ts'],
        env: { browser: true, node: true, es2022: true },
      },
      {
        files: ['src/*.ts'],
        rules: {
          'baseline-js/use-baseline': [
            'error',
            { available: 2021, includeWebApis: { preset: 'auto' }, includeJsBuiltins: { preset: 'auto' } },
          ],
        },
      },
      {
        files: ['src/*.check.tsx'],
        rules: {
          'eslint/no-constant-binary-expression': 'off',
        },
      },
      {
        files: ['**/*.test.ts', 'src/*.check.tsx', 'src/fake-platform.ts', 'tools/**'],
        rules: {
          'typescript/no-non-null-assertion': 'off',
          'baseline-js/use-baseline': 'off',
          'typescript/consistent-type-assertions': 'off',
        },
      },
    ],
  },
});
