// The repository's bundler for tools and tests (Rolldown): one entry, either a file or source text that
// has a place to resolve its imports from, bundled in memory.
import { join } from 'node:path';
import { rolldown } from 'rolldown';

// oxlint-disable-next-line eslint/no-control-regex -- an escape character is what colour codes start with
const ANSI = /\u001b\[[0-9;]*m/g;

export type BundleOptions = {
  /** A file to bundle, or */
  entry?: string;
  /** source text, whose relative imports resolve from `resolveDir`. */
  contents?: string;
  resolveDir?: string;
  /** How `contents` is read (default 'ts'). */
  type?: 'ts' | 'tsx' | 'js' | 'jsx';
  /** Exact module names to files. */
  alias?: Record<string, string>;
  external?: string[];
  platform?: 'node' | 'browser';
  format?: 'esm' | 'iife';
  minify?: boolean;
  /** An import source: JSX is compiled to its automatic runtime. */
  jsx?: string;
  define?: Record<string, string>;
};

/** The bundle's code, and the bytes each module contributed to it. */
export async function bundle(o: BundleOptions): Promise<{ code: string; modules: Record<string, number> }> {
  const entryId = o.entry ?? join(o.resolveDir ?? process.cwd(), `bundle-entry.${o.type ?? 'ts'}`);
  const alias = o.alias ?? {};
  const unresolved: string[] = [];
  let build: Awaited<ReturnType<typeof rolldown>> | undefined;
  try {
    build = await rolldown({
      input: entryId,
      platform: o.platform ?? 'node',
      logLevel: 'warn',
      external: o.external,
      // A module that cannot be found is an error here, not an external to fail on later.
      onLog: (_level, log) => {
        if (log.code === 'UNRESOLVED_IMPORT') unresolved.push(log.message.replace(ANSI, ''));
      },
      transform: {
        target: 'es2022',
        ...(o.define ? { define: o.define } : {}),
        ...(o.jsx ? { jsx: { runtime: 'automatic', importSource: o.jsx } } : {}),
      },
      plugins: [
        {
          name: 'bundle-helper',
          resolveId: (id) => (Object.hasOwn(alias, id) ? alias[id] : o.contents !== undefined && id === entryId ? id : null),
          load: (id) => (o.contents !== undefined && id === entryId ? { code: o.contents, moduleType: o.type ?? 'ts' } : null),
        },
      ],
    });
    const out = await build.generate({ format: o.format ?? 'esm', codeSplitting: false, minify: o.minify ?? false, comments: !o.minify });
    if (unresolved.length) throw new Error(unresolved.join('\n'));
    const chunk = out.output[0];
    const modules = Object.fromEntries(Object.entries(chunk.modules ?? {}).map(([id, m]) => [id, m.renderedLength]));
    return { code: chunk.code, modules };
  } catch (e) {
    const errors: unknown[] = e instanceof Error && 'errors' in e && Array.isArray(e.errors) ? e.errors : [e];
    throw new Error(
      errors
        .map((x) =>
          String(x instanceof Error ? x.message : x)
            .replace(ANSI, '')
            .trimEnd(),
        )
        .join('\n\n'),
      { cause: e },
    );
  } finally {
    await build?.close();
  }
}
