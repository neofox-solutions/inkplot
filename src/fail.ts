// How inkplot reports its own errors. Every error has a numeric code and a message template in messages.ts. A development build throws
// the full message; a production build throws only the code and a link to docs/reference/errors.md, and the table drops out of the bundle.
//
// The build type is read from `import.meta.env.PROD` (Vite, Rolldown, Bun and anything else that sets it) or `process.env.NODE_ENV`
// (webpack, esbuild with `--define`, Node, Deno). Both are written inline, exactly like this, so a bundler can fold the condition to a constant and
// remove the branch that is not taken. Where neither is defined (a browser module served as it is, with no bundler) there is no `process`, which
// is a ReferenceError we catch: the answer is then the short message, never a crash while reporting a crash.
import { messages } from './messages.ts';

export type ErrorCode = keyof typeof messages;

type Messages = typeof messages;

// The highest `%n` in a template, as the number of values it needs. Templates are literal types, so a call is checked against its own code.
type Count<S extends string, Seen extends unknown[] = []> = S extends `${string}%${infer N extends number}${infer Rest}`
  ? Count<Rest, Seen['length'] extends N ? [...Seen, unknown] : Seen>
  : Seen['length'];

type Tuple<N extends number, T extends unknown[] = []> = T['length'] extends N ? T : Tuple<N, [...T, unknown]>;

/** The values a code needs: none for a message without placeholders, one per distinct `%n` otherwise. */
export type ErrorArgs<C extends ErrorCode> = Tuple<Count<Messages[C]>>;

// The library is compiled without Node's types, so the one thing it reads from `process` is declared here (a module's own declaration, not a global).
declare const process: { env: { NODE_ENV?: string } };

const site = 'https://inkplot.neofox.solutions/errors';

function minified(code: number, args: readonly unknown[]): string {
  return `Minified inkplot error: ${site}#${code}${args.length ? ` [${args.map(String).join(', ')}]` : ''}`;
}

/** The text of an error without throwing it, for a failure that is reported rather than raised. */
export function errorText<C extends ErrorCode>(code: C, ...values: ErrorArgs<C>): string {
  const args: readonly unknown[] = values;
  // Two separate tests, each returning, so that a bundler which defines only one of the two still removes the message table: the
  // test it defines becomes `true` and what follows is unreachable.
  try {
    // oxlint-disable-next-line typescript/consistent-type-assertions -- the text `import.meta.env` has to stay as written for a bundler to replace it; ImportMeta has no `env` without Vite's types
    if ((import.meta as { env?: { PROD?: boolean } }).env?.PROD) return minified(code, args);
    if (process.env.NODE_ENV === 'production') return minified(code, args);
  } catch {
    return minified(code, args);
  }
  const template: string = messages[code];
  return `[inkplot ${code}] ${template.replace(/%(\d+)/g, (_, n) => String(args[Number(n)]))}`;
}

/** The error to throw for `code`, with `args` filled into its message in a development build. */
export function inkplotError<C extends ErrorCode>(code: C, ...args: ErrorArgs<C>): Error {
  return new Error(errorText(code, ...args));
}

/** `throw` as an expression, so a missing value can be reported inline: `x ?? fail(144, name)`. */
export function fail<C extends ErrorCode>(code: C, ...args: ErrorArgs<C>): never {
  throw inkplotError(code, ...args);
}
