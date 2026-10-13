/** What a part of the API that is declared and not yet supported says when it is used. */

/** Fails when used rather than drawing something wrong, so a half-supported option cannot be relied on by accident. */
export function notImplemented(what: string): never {
  throw new Error(`${what} is not implemented yet`);
}
