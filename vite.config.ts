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
    // Some tests run against the clock (a flick is a speed over real milliseconds), so in CI, with its shared and
    // slower cores, fewer files run at once and a failure is tried once more before it counts.
    maxWorkers: process.env.CI ? 2 : undefined,
    retry: process.env.CI ? 1 : 0,
    reporters: process.env.CI ? ['default', 'github-actions'] : ['default'],
  },
  lint: {
    options: { typeAware: true },
    "plugins": [
      "typescript",
      "unicorn",
      "oxc"
    ],
    "categories": {
      "correctness": "error",
      "suspicious": "warn"
    },
    "env": {
      "browser": true,
      "node": true,
      "es2022": true
    },
    "ignorePatterns": [
      "out/**",
      "types/**",
      "shots/**",
      "node_modules/**",
      "playground.html"
    ],
    "rules": {
      "typescript/no-explicit-any": "error",
      "typescript/ban-ts-comment": [
        "error",
        {
          "ts-expect-error": "allow-with-description",
          "ts-ignore": true,
          "ts-nocheck": true
        }
      ],
      "typescript/no-confusing-non-null-assertion": "off",
      "eslint/no-new": "off",
      "eslint/no-shadow": "off",
      "eslint/no-underscore-dangle": "off",
      "unicorn/consistent-function-scoping": "off",
      "unicorn/no-array-fill-with-reference-type": "off",
      "unicorn/no-array-sort": "off",
      "unicorn/no-array-reverse": "off",
      "unicorn/prefer-add-event-listener": "off",
      "typescript/no-non-null-assertion": "error",
      // Casts are owned by the comments above each one (consistent-type-assertions), so a second rule would only repeat them.
      "typescript/no-unsafe-type-assertion": "off",
      // Exhaustive switches and effect cleanups return on some paths by design; tsc checks the exhaustive ones.
      "typescript/consistent-return": "off",
      "typescript/no-unnecessary-type-parameters": "off",
      "typescript/consistent-type-assertions": [
        "error",
        {
          "assertionStyle": "never"
        }
      ]
    },
    "overrides": [
      {
        "files": [
          "src/*.check.tsx"
        ],
        "rules": {
          "eslint/no-constant-binary-expression": "off"
        }
      },
      {
        "files": [
          "**/*.test.ts",
          "src/*.check.tsx",
          "src/fake-platform.ts",
          "tools/**"
        ],
        "rules": {
          "typescript/no-non-null-assertion": "off",
          "typescript/consistent-type-assertions": "off"
        }
      }
    ]
  },
});
