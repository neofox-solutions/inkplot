// A module's JavaScript, made the way the packaged library's is: the types blanked out by Node's own type stripping (so every
// line and column stays where it is in the source), and the relative `.ts` import paths made `.js`, which is the same length.
import { stripTypeScriptTypes } from 'node:module';

const RELATIVE_TS = /((?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])\.{1,2}\/[^'"]+)\.ts\2/g;

/** @param {string} source TypeScript, erasable syntax only */
export function stripToJs(source) {
  return stripTypeScriptTypes(source, { mode: 'strip' }).replace(RELATIVE_TS, '$1.js$2');
}
