// The skill in plain TypeScript: JSX examples turned into `new Element(attributes, ...children)`, so the same documentation
// can be given to a reader who writes charts without JSX (where tsc checks child order and every attribute, nested ones included).
//
//   convertCode(code)            one JSX module as TypeScript (babel for the syntax, oxfmt for the layout)
//   convertInline(markdown)      the same for the snippets in prose (`<Axis min={0} />`, `meta-title`)
//   typeScriptFlavour(markdown)  a whole page: <!-- ts --> text kept and <!-- jsx --> text dropped, code blocks and snippets converted
//
// `jsxFlavour(markdown)` is the other way: the <!-- ts --> text dropped and the markers removed. Both are used by pack-skill.mjs.
// Markers: a block between <!-- jsx --> … <!-- /jsx --> or <!-- ts --> … <!-- /ts --> on lines of their own, or the end of a line: <!-- jsx-only --> / <!-- ts-only -->.
import { parse } from '@babel/parser';
import _generate from '@babel/generator';
import * as t from '@babel/types';
import _traverse from '@babel/traverse';
import { format } from 'oxfmt';

const traverse = _traverse.default ?? _traverse,
  generate = _generate.default ?? _generate;
const isIdent = (s) => /^[A-Za-z_$][\w$]*$/.test(s);
const key = (s) => (isIdent(s) ? t.identifier(s) : t.stringLiteral(s));

/** Attributes (name, value node) as an object expression: a hyphen nests (`meta-title` is `meta: { title }`). */
function objectOf(entries) {
  const root = { kind: 'object', props: new Map() };
  for (const e of entries) {
    if (e.spread) {
      (root.spreads ??= []).push(e);
      (root.order ??= []).push({ spread: e.spread });
      continue;
    }
    const path = e.name.split('-');
    let at = root;
    path.forEach((part, i) => {
      const last = i === path.length - 1;
      const have = at.props.get(part);
      if (last) {
        if (have) throw new Error(`attribute ${e.name} is given twice or clashes with a nested one`);
        at.props.set(part, { kind: 'leaf', value: e.value });
        (at.order ??= []).push({ part });
      } else {
        let next = have;
        if (!next) {
          next = { kind: 'object', props: new Map() };
          at.props.set(part, next);
          (at.order ??= []).push({ part });
        } else if (next.kind === 'leaf') throw new Error(`attribute ${e.name} clashes with ${path.slice(0, i + 1).join('-')}`);
        at = next;
      }
    });
  }
  const build = (node) =>
    t.objectExpression(
      (node.order ?? []).map((o) => {
        if (o.spread) return t.spreadElement(o.spread);
        const v = node.props.get(o.part);
        return t.objectProperty(key(o.part), v.kind === 'leaf' ? v.value : build(v));
      }),
    );
  return build(root);
}

function newOf(node) {
  const open = node.openingElement,
    nameNode = open.name;
  const nameOf = (n) =>
    t.isJSXIdentifier(n)
      ? t.identifier(n.name)
      : t.isJSXMemberExpression(n)
        ? t.memberExpression(nameOf(n.object), nameOf(n.property))
        : (() => {
            throw new Error('a namespaced tag name');
          })();
  if (t.isJSXIdentifier(nameNode) && !/^[A-Z]/.test(nameNode.name)) throw new Error(`<${nameNode.name}> is not a chart element`);
  const entries = open.attributes.map((a) => {
    if (t.isJSXSpreadAttribute(a)) return { spread: a.argument };
    if (!t.isJSXIdentifier(a.name)) throw new Error('a namespaced attribute');
    let value;
    if (a.value === null) value = t.booleanLiteral(true);
    else if (t.isStringLiteral(a.value)) value = t.stringLiteral(a.value.value);
    else if (t.isJSXExpressionContainer(a.value)) {
      if (t.isJSXEmptyExpression(a.value.expression)) throw new Error(`attribute ${a.name.name} has an empty value`);
      value = a.value.expression;
    } else value = a.value; // an element (already made)
    return { name: a.name.name, value };
  });
  const children = [];
  for (const c of node.children) {
    if (t.isJSXText(c)) {
      if (c.value.trim() !== '')
        throw new Error(`text "${c.value.trim().slice(0, 20)}" inside <${nameNode.name}>: a chart element has no text children`);
      continue;
    }
    if (t.isJSXExpressionContainer(c)) {
      if (t.isJSXEmptyExpression(c.expression)) continue;
      if (t.isLogicalExpression(c.expression))
        throw new Error('a conditional child (&&): the TypeScript form has no way to skip a child, so write it out');
      children.push(c.expression);
    } else if (t.isJSXSpreadChild(c) || t.isJSXFragment(c)) throw new Error('a fragment or spread child');
    else children.push(c);
  }
  const args = [];
  if (entries.length > 0) args.push(objectOf(entries));
  else if (children.length > 0) args.push(t.objectExpression([]));
  args.push(...children);
  return t.newExpression(nameOf(nameNode), args);
}

const LAYOUT = { singleQuote: true, printWidth: 118, semi: true, trailingComma: 'all', objectWrap: 'collapse' };

/** One JSX module as TypeScript. `width` is the line width to lay out for (a snippet in prose wants it long). */
export async function convertCode(code, width = LAYOUT.printWidth) {
  code = code.replace(/\/\*\*\s*@jsxImportSource\s+\S+\s*\*\/\n?/, '');
  const ast = parse(code, { sourceType: 'module', plugins: ['jsx', 'typescript'] });
  traverse(ast, {
    JSXElement: {
      exit(path) {
        path.replaceWith(newOf(path.node));
      },
    },
    JSXFragment() {
      throw new Error('a JSX fragment');
    },
    // A tag was typed AnyElement, so charts were cast; `new Chart(…)` is a Chart already.
    TSAsExpression: {
      exit(path) {
        const { expression, typeAnnotation: ty } = path.node;
        const inner = t.isParenthesizedExpression(expression) ? expression.expression : expression;
        if (t.isTSTypeReference(ty) && t.isIdentifier(ty.typeName, { name: 'Chart' }) && t.isNewExpression(inner)) path.replaceWith(inner);
      },
    },
  });
  const printed = generate(ast, { comments: true, jsescOption: { quotes: 'single' } }).code;
  const formatted = await format('example.ts', printed, { ...LAYOUT, printWidth: width });
  if (formatted.errors.length) throw new Error(`the converted example does not parse: ${formatted.errors[0]?.message}`);
  const text = formatted.code.replace(/\n+$/, '\n');
  // Statements come out without the blank lines the source had: put one after the imports and before an `export`.
  const lines = text.split('\n'),
    out = [];
  let inImport = false;
  lines.forEach((l, i) => {
    const startsImport = /^import\b/.test(l),
      endsImport = (startsImport || inImport) && /\bfrom '[^']+';$|^import '[^']+';$/.test(l);
    if (startsImport) inImport = true;
    if (/^export\b/.test(l) && out.length && out[out.length - 1] !== '') out.push('');
    out.push(l);
    if (endsImport) {
      inImport = false;
      if (lines[i + 1] && !/^(import\b|$)/.test(lines[i + 1])) out.push('');
    }
  });
  return out.join('\n');
}

// ─── Snippets in prose ───

/** The attributes of one tag, from `text` starting just after the name, to the `>` or `/>` that ends it. */
function scanTag(text, at) {
  const attrs = [];
  let i = at;
  for (;;) {
    while (/\s/.test(text[i] ?? '')) i++;
    if (i >= text.length) return null;
    if (text[i] === '>') return { attrs, end: i + 1, self: false };
    if (text[i] === '/' && text[i + 1] === '>') return { attrs, end: i + 2, self: true };
    if (text.startsWith('…', i) || text.startsWith('...', i)) {
      attrs.push({ placeholder: true });
      i += text[i] === '…' ? 1 : 3;
      continue;
    }
    const name = /^[A-Za-z_][\w-]*/.exec(text.slice(i));
    if (!name) return null;
    i += name[0].length;
    if (text[i] !== '=') {
      attrs.push({ name: name[0], value: 'true' });
      continue;
    }
    i++;
    if (text[i] === '"') {
      const e = text.indexOf('"', i + 1);
      if (e < 0) return null;
      attrs.push({ name: name[0], value: `'${text.slice(i + 1, e).replace(/'/g, "\\'")}'` });
      i = e + 1;
      continue;
    }
    if (text[i] !== '{') return null;
    let depth = 0,
      j = i;
    for (; j < text.length; j++) {
      if (text[j] === '{') depth++;
      else if (text[j] === '}' && --depth === 0) break;
    }
    if (j >= text.length) return null;
    attrs.push({ name: name[0], value: text.slice(i + 1, j).trim() });
    i = j + 1;
  }
}

/** `a-b: 1, a-c: 2` as `a: { b: 1, c: 2 }`. */
function objectText(attrs) {
  const tree = new Map();
  const rest = attrs.some((a) => a.placeholder);
  for (const { name, value } of attrs.filter((a) => !a.placeholder)) {
    const path = name.split('-');
    let at = tree;
    path.forEach((p, i) => {
      if (i === path.length - 1) at.set(p, value);
      else {
        if (!(at.get(p) instanceof Map)) at.set(p, new Map());
        at = at.get(p);
      }
    });
  }
  const show = (m) => [...m].map(([k, v]) => `${isIdent(k) ? k : `'${k}'`}: ${v instanceof Map ? `{ ${show(v)} }` : v}`).join(', ');
  return [show(tree), rest ? '…' : ''].filter(Boolean).join(', ');
}

/** Elements in a snippet. Tags left open (a snippet often shows one) get `…` for what goes inside. */
function convertTags(span) {
  let out = '',
    i = 0;
  const stack = [];
  const startsChild = () => {
    const top = stack[stack.length - 1];
    if (top) {
      out += top.n > 0 ? ', ' : '';
      top.n++;
    }
  };
  while (i < span.length) {
    const m = /(?<![\w)\]])<(\/?)([A-Z][\w.]*)/y;
    m.lastIndex = i;
    const next = (() => {
      const re = /(?<![\w)\]])<(\/?)([A-Z][\w.]*)/g;
      re.lastIndex = i;
      return re.exec(span);
    })();
    if (!next) {
      out += span.slice(i);
      break;
    }
    out += span.slice(i, next.index);
    if (next[1]) {
      // </Name>
      const close = span.indexOf('>', next.index);
      const top = stack.pop();
      out += top ? (top.n === 0 ? ', …)' : ')') : '';
      i = close + 1;
      continue;
    }
    const tag = scanTag(span, next.index + next[0].length);
    if (!tag) {
      out += span.slice(next.index);
      break;
    }
    startsChild();
    const obj = tag.attrs.length ? `{ ${objectText(tag.attrs)} }` : '';
    if (tag.self) out += `new ${next[2]}(${obj})`;
    else {
      out += `new ${next[2]}(${obj || '{}'}, `;
      stack.push({ n: 0 });
    }
    i = tag.end;
  }
  while (stack.length) {
    const top = stack.pop();
    out += top.n === 0 ? '…)' : ', …)';
  }
  return out.replace(/\(\{\}, …\)/g, '({}, …)');
}

/** A snippet that is attributes alone: `include={[0]}` as `include: [0]`, `meta-title` as `meta: { title }`. */
function convertAttributes(span) {
  // Only the attributes that nest; `styling-output` is a topic's name.
  const bare = /^(?:meta|regularDomain|style|aria)(?:-[A-Za-z]+)+$/.exec(span.trim());
  if (bare) {
    const [head, ...rest] = span.trim().split('-');
    return `${head}: ${rest.reduceRight((inner, k) => `{ ${k}${inner ? `: ${inner}` : ''} }`, '')}`;
  }
  if (!/^\s*[a-z][\w-]*=/.test(span)) return null;
  let i = 0;
  const attrs = [];
  while (i < span.length) {
    while (/\s/.test(span[i] ?? '')) i++;
    if (i >= span.length) break;
    const probe = scanTag(span.slice(i) + ' />', 0);
    if (!probe) return null;
    attrs.push(...probe.attrs);
    i = span.length;
  }
  return attrs.length ? objectText(attrs) : null;
}

export function convertSpan(span) {
  if (/(?<![\w)\]])<\/?[A-Z]/.test(span)) return convertTags(span);
  return convertAttributes(span) ?? span;
}

/** Snippets in the prose of a Markdown page (fenced code and generated attribute tables are left alone). */
export function convertInline(markdown) {
  let fence = null,
    generated = false;
  return markdown
    .split('\n')
    .map((line) => {
      const open = /^\s*(`{3,})/.exec(line);
      if (fence) {
        if (open && open[1].length >= fence.length && /^\s*`+\s*$/.test(line)) fence = null;
        return line;
      }
      if (open) {
        fence = open[1];
        return line;
      }
      if (line.includes('<!-- api:start -->')) generated = true;
      if (line.includes('<!-- api:end -->')) generated = false;
      if (generated) return line;
      return line.replace(/(`{1,2})((?:(?!\1)[\s\S])+?)\1(?!`)/g, (whole, ticks, span) => {
        const to = convertSpan(span);
        return to === span ? whole : `${ticks}${to}${ticks}`;
      });
    })
    .join('\n');
}

// ─── A page, in one flavour or the other ───
const TS_BLOCK = /<!-- ts -->\n([\s\S]*?)<!-- \/ts -->\n?/g,
  JSX_BLOCK = /<!-- jsx -->\n([\s\S]*?)<!-- \/jsx -->\n?/g;

/** The page for readers who use JSX: text marked for TypeScript is dropped, the markers go. */
export const jsxFlavour = (markdown) =>
  markdown
    .replace(TS_BLOCK, '')
    .replace(JSX_BLOCK, '$1')
    .split('\n')
    .filter((l) => !l.includes('<!-- ts-only -->'))
    .map((l) => l.replace(' <!-- jsx-only -->', ''))
    .join('\n');

/** The page for readers who write `new Element(…)`: text marked for JSX is dropped, every example and snippet converted. */
export async function typeScriptFlavour(markdown, where = 'page') {
  // A line (a table row, say) can carry its own marker: <!-- jsx-only --> or <!-- ts-only -->.
  const text = markdown
    .replace(JSX_BLOCK, '')
    .replace(TS_BLOCK, '$1')
    .split('\n')
    .filter((l) => !l.includes('<!-- jsx-only -->'))
    .map((l) => l.replace(' <!-- ts-only -->', ''))
    .join('\n');
  const lines = text.split('\n'),
    out = [];
  for (let i = 0; i < lines.length; i++) {
    const open = /^(\s*)(`{3,})(.*)$/.exec(lines[i]);
    if (!open) {
      out.push(lines[i]);
      continue;
    }
    let end = i + 1;
    while (end < lines.length && !new RegExp(`^\\s*${open[2]}\`*\\s*$`).test(lines[end])) end++;
    const info = open[3].trim();
    if (/^tsx\b/.test(info)) {
      if (/\bjsx=react\b/.test(info)) {
        out.push(...lines.slice(i, end + 1));
        i = end;
        continue;
      } // React's JSX is React's: it stays
      const body = lines
        .slice(i + 1, end)
        .join('\n')
        .replace(/^ {0,8}/gm, (s) => (open[1].length ? s.slice(0, Math.min(s.length, open[1].length)) : s));
      const code =
        body
          .split('\n')
          .map((l) => l.slice(open[1].length))
          .join('\n') + '\n';
      let converted;
      try {
        converted = await convertCode(code);
      } catch (e) {
        throw new Error(`${where}:${i + 1}: ${e.message}`, { cause: e });
      }
      out.push(`${open[1]}${open[2]}${info.replace(/^tsx\b/, 'ts')}`);
      out.push(
        ...converted
          .replace(/\n$/, '')
          .split('\n')
          .map((l) => open[1] + l),
        lines[end],
      );
    } else out.push(...lines.slice(i, end + 1));
    i = end;
  }
  return convertInline(out.join('\n'));
}
