/**
 * The GitHub Actions the workflows use, pinned to the commit they were released at.
 *
 * A tag such as `actions/checkout@v7` can be moved to other code by whoever holds the repository; a commit cannot. So every
 * `uses:` in `.github/workflows` names a full commit hash, with the release it is as a comment:
 *
 *     - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
 *
 *   node tools/actions.mjs check             Fails on any action not pinned that way. Offline; part of the test run.
 *   node tools/actions.mjs pin               Pins any `owner/repo@tag` to its commit, with the exact release in the comment.
 *   node tools/actions.mjs update [--major]  Moves each action to the newest release of the major version it is on (with
 *                                            --major, to the newest release of all) and prints what changed. Review the diff.
 *   node tools/actions.mjs list              Prints each action, its release and its commit.
 *
 * The network is used by `pin`, `update` and `list` only, through `git ls-remote`, so it needs no token.
 * Dependabot (`.github/dependabot.yml`) reads the same comments, so its weekly pull requests keep both in step.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const workflows = fileURLToPath(new URL('../.github/workflows/', import.meta.url));
const USES = /^(\s*(?:-\s*)?uses:\s*)([^\s@#]+)@([^\s#]+)(?:\s*#\s*(.*))?$/;
const SHA = /^[0-9a-f]{40}$/;
const RELEASE = /^v?(\d+)\.(\d+)\.(\d+)$/;

/** Every `uses:` line of every workflow: `{ file, line, prefix, action, ref, comment }`. Local actions (`./…`) are left out. */
export function usesIn(dir = workflows) {
  const out = [];
  for (const file of readdirSync(dir).filter((f) => /\.ya?ml$/.test(f))) {
    readFileSync(dir + file, 'utf8')
      .split('\n')
      .forEach((text, line) => {
        const m = USES.exec(text);
        if (m && !m[2].startsWith('./')) out.push({ file, line, prefix: m[1], action: m[2], ref: m[3], comment: m[4] ?? '' });
      });
  }
  return out;
}

/** The pinned ones' problems, as text: not a commit hash, or no release named in the comment. */
export function problems(dir = workflows) {
  const bad = [];
  for (const u of usesIn(dir)) {
    if (!SHA.test(u.ref)) bad.push(`${u.file}:${u.line + 1}: ${u.action}@${u.ref} is a tag or branch, which can move: run \`node tools/actions.mjs pin\``);
    else if (!/^v\d+\.\d+\.\d+/.test(u.comment))
      bad.push(`${u.file}:${u.line + 1}: ${u.action}@${u.ref.slice(0, 7)} has no \`# vX.Y.Z\` comment naming the release it is`);
  }
  return bad;
}

const repoOf = (action) => action.split('/').slice(0, 2).join('/');
const cache = new Map();
/** Tag name to commit hash for a repository (annotated tags peeled to the commit they point at). */
function tagsOf(repo) {
  let tags = cache.get(repo);
  if (!tags) {
    const text = execFileSync('git', ['ls-remote', '--tags', '--heads', `https://github.com/${repo}`], { encoding: 'utf8', timeout: 60000 });
    tags = new Map();
    for (const line of text.split('\n')) {
      const [sha, ref] = line.split('\t');
      if (!ref) continue;
      // A branch named like a major version (`v2`) counts when no tag has that name; a tag wins.
      const name = ref.replace(/^refs\/(tags|heads)\//, '');
      if (name.endsWith('^{}')) tags.set(name.slice(0, -3), sha);
      else if (ref.startsWith('refs/tags/') || !tags.has(name)) tags.set(name, sha);
    }
    cache.set(repo, tags);
  }
  return tags;
}
const version = (tag) => RELEASE.exec(tag)?.slice(1).map(Number);
const newer = (a, b) => {
  const x = version(a),
    y = version(b);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
};
/** The newest release tag at a commit (`v7` and `v7.0.1` can be the same commit; the exact one is the one to name). */
function releaseAt(repo, sha) {
  return [...tagsOf(repo)]
    .filter(([tag, s]) => s === sha && RELEASE.test(tag) && tag.split('.').length === 3)
    .map(([tag]) => tag)
    .sort(newer)
    .pop();
}

/** Rewrites the lines of the workflows through `change(use) => { ref, comment } | null`; returns the changes made as text. */
function rewrite(change) {
  const made = [];
  for (const file of readdirSync(workflows).filter((f) => /\.ya?ml$/.test(f))) {
    const lines = readFileSync(workflows + file, 'utf8').split('\n');
    let touched = false;
    for (const [i, text] of lines.entries()) {
      const m = USES.exec(text);
      if (!m || m[2].startsWith('./')) continue;
      const use = { action: m[2], ref: m[3], comment: m[4] ?? '' };
      const next = change(use);
      if (!next || (next.ref === use.ref && next.comment === use.comment)) continue;
      // What the comment said besides a release (`the version comes from …`) moves to a line of its own above.
      const note = use.comment.replace(/^v\d+(\.\d+){0,2}\s*/, '').trim();
      const indent = /^\s*/.exec(text)[0];
      lines[i] = `${m[1]}${use.action}@${next.ref} # ${next.comment}`;
      if (note) {
        lines.splice(i, 0, `${indent}# ${note}`);
      }
      made.push(`${file}: ${use.action} ${use.comment || use.ref} -> ${next.comment}`);
      touched = true;
    }
    if (touched) writeFileSync(workflows + file, lines.join('\n'));
  }
  return made;
}

const [command, ...flags] = process.argv.slice(2);
if (import.meta.url === `file://${process.argv[1]}`) {
  if (command === 'check') {
    const bad = problems();
    if (bad.length) {
      console.error(bad.join('\n'));
      process.exit(1);
    }
    console.log(`${usesIn().length} action uses, all pinned`);
  } else if (command === 'pin') {
    const made = rewrite((u) => {
      if (SHA.test(u.ref)) return null;
      const sha = tagsOf(repoOf(u.action)).get(u.ref);
      if (!sha) throw new Error(`${u.action}@${u.ref}: no such tag`);
      return { ref: sha, comment: releaseAt(repoOf(u.action), sha) ?? u.ref };
    });
    console.log(made.join('\n') || 'nothing to pin');
  } else if (command === 'update') {
    const any = flags.includes('--major');
    const made = rewrite((u) => {
      if (!SHA.test(u.ref)) return null;
      const have = /^v\d+\.\d+\.\d+/.exec(u.comment)?.[0];
      if (!have) return null;
      const tags = [...tagsOf(repoOf(u.action)).keys()].filter((t) => RELEASE.test(t) && t.split('.').length === 3);
      const best = tags.filter((t) => any || version(t)[0] === version(have)[0]).sort(newer).pop();
      if (!best || newer(best, have) <= 0) return null;
      return { ref: tagsOf(repoOf(u.action)).get(best), comment: best };
    });
    console.log(made.join('\n') || 'everything is on the newest release');
  } else if (command === 'list') {
    for (const u of usesIn()) console.log(`${u.file}\t${u.action}\t${u.comment.split(' ')[0]}\t${u.ref}`);
  } else {
    console.error('usage: node tools/actions.mjs check | pin | update [--major] | list');
    process.exit(2);
  }
}
