// Installing the inkplot skills for an AI tool: copy a skill folder to where the tool looks for skills, and keep versions straight.
// Nothing here but Node's own modules: this runs under `npx inkplot`, so it has to start fast and bring nothing with it.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

export interface Harness {
  /** What to type after `install-skill`. */
  id: string;
  /** Other names that mean the same. */
  aliases: string[];
  label: string;
  /** Skills folder in a project, and in the user's home. */
  project: string;
  user: string;
  /** What to do next, for the line printed after an install. */
  next: string;
}

export const HARNESSES: Harness[] = [
  {
    id: 'claude-code',
    aliases: ['claude'],
    label: 'Claude Code',
    project: '.claude/skills',
    user: '.claude/skills',
    next: 'Start a new Claude Code session; it uses the skill when you ask for a chart, or call it with /inkplot.',
  },
  {
    id: 'codex',
    aliases: ['openai-codex'],
    label: 'OpenAI Codex',
    project: '.agents/skills',
    user: '.agents/skills',
    next: 'Start a new Codex session.',
  },
  {
    id: 'vscode',
    aliases: ['copilot', 'github-copilot'],
    label: 'VS Code (GitHub Copilot Chat)',
    project: '.github/skills',
    user: '.copilot/skills',
    next: 'Use agent mode in Copilot Chat; type /skills to see it listed.',
  },
  {
    id: 'cursor',
    aliases: [],
    label: 'Cursor',
    project: '.cursor/skills',
    user: '.cursor/skills',
    next: 'Start a new Cursor agent chat.',
  },
  {
    id: 'gemini',
    aliases: ['gemini-cli'],
    label: 'Gemini CLI',
    project: '.gemini/skills',
    user: '.gemini/skills',
    next: 'Start a new Gemini CLI session.',
  },
  {
    id: 'agents',
    aliases: [],
    label: 'any tool that reads .agents/skills (Codex, VS Code, Cursor and Gemini CLI all do)',
    project: '.agents/skills',
    user: '.agents/skills',
    next: 'Start a new session in your tool.',
  },
];

export interface Skill {
  /** The folder name, which is also the skill's `name`. */
  name: string;
  /** What to type for it. */
  short: string;
  about: string;
}

export const SKILLS: Skill[] = [
  { name: 'inkplot', short: 'inkplot', about: 'writing inkplot code in your app (needs no tools)' },
  {
    name: 'inkplot-data-charts',
    short: 'data-charts',
    about: 'turning a spreadsheet, CSV or JSON file into charts, pages and images (runs inkplot-scratch, so needs a shell and npm)',
  },
];

export const findHarness = (id: string): Harness | undefined =>
  HARNESSES.find((h) => h.id === id.toLowerCase() || h.aliases.includes(id.toLowerCase()));

export const findSkill = (id: string): Skill | undefined => SKILLS.find((s) => s.name === id || s.short === id);

/** The marker `pack` writes into a skill's front matter, so an install can tell its own folders from anyone else's. */
export function readStamp(skillMd: string): { name: string; version: string } | null {
  const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(skillMd)?.[1];
  if (!front) return null;
  const name = /^name: *(\S+)/m.exec(front)?.[1];
  const version = /^ {2}version: *"?([^"\r\n]+?)"? *$/m.exec(front)?.[1];
  if (!name || !version || !/^ {2}generator: *inkplot *$/m.test(front)) return null;
  return { name, version };
}

const read = (file: string): string | null => {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return null;
  }
};

/** The inkplot version a skills folder holds under `name`, null when the skill is not there, 'unknown' when it is but is not ours. */
export function installedVersion(folder: string): string | null {
  const text = read(join(folder, 'SKILL.md'));
  if (text === null) return existsSync(folder) ? 'unknown' : null;
  return readStamp(text)?.version ?? 'unknown';
}

/** The version of inkplot in the nearest `node_modules` at or above `from`, if any. */
export function projectLibraryVersion(from: string): string | null {
  for (let dir = resolve(from); ; dir = dirname(dir)) {
    const text = read(join(dir, 'node_modules/inkplot/package.json'));
    if (text !== null) {
      try {
        const v: unknown = (JSON.parse(text) as { version?: unknown }).version;
        return typeof v === 'string' ? v : null;
      } catch {
        return null;
      }
    }
    if (dirname(dir) === dir) return null;
  }
}

export interface Environment {
  /** Where "this project" is. */
  cwd: string;
  home: string;
  /** The folder holding the skills this package ships: one folder per skill. */
  source: string;
  /** The version of this package. */
  version: string;
  out: (text: string) => void;
}

export interface InstallOptions {
  harness?: Harness;
  /** A skills folder to use in place of the harness's. */
  dir?: string;
  user: boolean;
  skills: Skill[];
  force: boolean;
  dryRun: boolean;
  remove: boolean;
}

export interface Outcome {
  ok: boolean;
}

/** A path as a person would write it: relative to the project when inside it, else from their home, else whole. */
const shown = (env: Environment, path: string): string => {
  const inside = (root: string): string | null => {
    const rel = relative(root, path);
    return rel === '' || rel.startsWith('..') || isAbsolute(rel) ? null : rel;
  };
  const here = inside(env.cwd),
    there = inside(env.home);
  return here !== null ? here : there !== null ? '~/' + there : path;
};

/** Where the skills go. */
export function targetFolder(env: Environment, o: Pick<InstallOptions, 'harness' | 'dir' | 'user'>): string {
  if (o.dir !== undefined) return resolve(env.cwd, o.dir);
  if (!o.harness) throw new Error('no tool or folder given');
  return o.user ? join(env.home, o.harness.user) : join(env.cwd, o.harness.project);
}

/** Every folder some tool would read a skill from, with what it is: for finding another copy of a skill. */
function knownFolders(env: Environment): { path: string; where: string }[] {
  const seen = new Map<string, string>();
  for (const h of HARNESSES) {
    seen.set(join(env.cwd, h.project), 'this project');
    seen.set(join(env.home, h.user), 'your user folder');
  }
  return [...seen].map(([path, where]) => ({ path, where }));
}

export function installSkills(env: Environment, o: InstallOptions): Outcome {
  const base = targetFolder(env, o);
  let ok = true;
  const say = env.out;
  const known = knownFolders(env);
  for (const skill of o.skills) {
    const from = join(env.source, skill.name),
      to = join(base, skill.name),
      where = shown(env, to);
    const have = installedVersion(to);
    if (o.remove) {
      if (have === null) say(`${skill.name}: not installed at ${where}`);
      else if (have === 'unknown' && !o.force) {
        say(`${skill.name}: ${where} was not installed by inkplot, so it is left alone (--force removes it anyway)`);
        ok = false;
      } else {
        if (!o.dryRun) rmSync(to, { recursive: true, force: true });
        say(`${o.dryRun ? 'would remove' : 'removed'} ${skill.name} ${have === 'unknown' ? '' : have + ' '}from ${where}`);
      }
      continue;
    }
    if (!existsSync(join(from, 'SKILL.md'))) {
      say(`${skill.name}: this package has no copy of the skill (looked in ${from})`);
      ok = false;
      continue;
    }
    if (have === 'unknown' && !o.force) {
      say(`${skill.name}: ${where} exists and was not installed by inkplot, so it is left alone (--force replaces it)`);
      ok = false;
      continue;
    }
    if (have === env.version && !o.force) {
      say(`${skill.name} ${env.version} is already installed at ${where}`);
    } else {
      const verb = have === null ? 'install' : have === 'unknown' ? 'replace' : `update ${have} to ${env.version} at`;
      if (o.dryRun) say(`would ${verb} ${skill.name} ${have === null || have === 'unknown' ? env.version + ' at ' + where : where}`);
      else {
        // Replace the folder, not merge into it: a topic file the new version dropped must not stay behind for an agent to find.
        rmSync(to, { recursive: true, force: true });
        mkdirSync(dirname(to), { recursive: true });
        cpSync(from, to, { recursive: true });
        say(
          have === null || have === 'unknown'
            ? `installed ${skill.name} ${env.version} at ${where}`
            : `updated ${skill.name} from ${have} to ${env.version} at ${where}`,
        );
      }
    }
    // Another copy of this skill that a tool could also read, from another version: the agent could follow either.
    for (const { path, where: label } of known) {
      if (resolve(path, skill.name) === resolve(to)) continue;
      const other = installedVersion(join(path, skill.name));
      if (other !== null && other !== env.version)
        say(
          `  note: ${shown(env, join(path, skill.name))} (${label}) holds ${other === 'unknown' ? 'a copy not made by inkplot' : 'version ' + other}; a tool that reads both may follow that one. Remove it, or update it by running this again for that tool${label === 'your user folder' ? ' with --user' : ''}.`,
        );
    }
  }
  if (!o.remove) {
    const lib = projectLibraryVersion(env.cwd);
    if (lib !== null && lib !== env.version)
      say(
        `  note: this project has inkplot ${lib} installed, but these skills are for ${env.version}. An agent could write attributes ${lib} does not have (or miss new ones). Run \`npx inkplot@${lib} install-skill …\` for the skills that match the project, or update inkplot in the project.`,
      );
  }
  return { ok };
}

/** What is installed where, for `--list`. */
export function listInstalled(env: Environment): string[] {
  const lines: string[] = [];
  for (const h of HARNESSES) {
    const found: string[] = [];
    for (const [scope, root] of [
      ['project', join(env.cwd, h.project)],
      ['user', join(env.home, h.user)],
    ] as const)
      for (const s of SKILLS) {
        const v = installedVersion(join(root, s.name));
        if (v !== null) found.push(`${s.name} ${v === 'unknown' ? '(not from inkplot)' : v} (${scope})`);
      }
    lines.push(`${h.id.padEnd(12)} ${h.project.padEnd(16)} ~/${h.user.padEnd(16)} ${found.join(', ') || '-'}`);
  }
  return lines;
}
