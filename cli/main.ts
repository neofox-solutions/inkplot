// The `inkplot` command. One job so far: put the inkplot skills where an AI tool looks for them.
//   npx inkplot install-skill cursor
import { type Environment, HARNESSES, SKILLS, type Skill, findHarness, findSkill, installSkills, listInstalled } from './skills.ts';

const harnessTable = HARNESSES.map(
  (h) => `  ${h.id.padEnd(12)} ${h.label}\n  ${' '.repeat(12)} folder: ${h.project} in a project, ~/${h.user} with --user`,
).join('\n');
const skillTable = SKILLS.map((s) => `  ${s.short.padEnd(12)} ${s.about}`).join('\n');

export const USAGE = `inkplot: tools for the inkplot chart library

  inkplot install-skill <tool> [options]    teach an AI tool to write inkplot charts
  inkplot --version

Run \`inkplot install-skill\` with nothing after it for the options.`;

export const INSTALL_USAGE = `inkplot install-skill <tool> [options]
inkplot install-skill --dir <skills folder> [options]

  Copies the inkplot skill into the folder an AI tool reads skills from, so the tool knows how to write inkplot charts.
  The skill is the one in this version of inkplot. Run it again after updating inkplot: an older copy is replaced.

Tools:
${harnessTable}
  (Claude on the web or in the desktop app, and ChatGPT, take an uploaded .zip instead: see the guide below.)

Skills (--skill):
${skillTable}

Options:
  --skill <name>   which skill: inkplot (the default), data-charts, or both separated by a comma
  --all            both skills
  --user           install for you in every project (in your home folder), not just this project
  --dir <folder>   put the skills in this folder instead; for a tool not listed, which reads folders holding a SKILL.md
  --force          replace a folder that is there but was not installed by inkplot
  --dry-run        say what would happen and change nothing
  --remove         take the skills out instead of putting them in
  --list           show where each tool looks, and which skills are installed there
  -h, --help       this text

Examples:
  npx inkplot install-skill claude-code
  npx inkplot install-skill cursor --all
  npx inkplot install-skill vscode --user
  npx inkplot install-skill --dir ./my-tool/skills

While inkplot is in beta, use \`npx inkplot@beta\`.
Guide: https://github.com/neofox-solutions/inkplot/blob/main/docs/guide/ai-agents.md`;

const VALUED = new Set(['--skill', '--dir']),
  FLAGS = new Set(['--all', '--user', '--force', '--dry-run', '--remove', '--list']);

/** Run the command; returns the exit status (0 done, 1 could not do it, 2 used wrongly). Everything it says goes through `env.out`. */
export function run(argv: string[], env: Environment & { err: (text: string) => void }): number {
  const help = (text: string): number => {
    env.out(text);
    return 0;
  };
  // Used wrongly: the complaint (if there is one) and then how to use it, on stderr.
  const bad = (text: string, message = ''): number => {
    env.err((message ? message + '\n\n' : '') + text);
    return 2;
  };
  const [command, ...rest] = argv;
  if (command === undefined) return bad(USAGE);
  if (command === '-h' || command === '--help') return help(USAGE);
  if (command === '-v' || command === '--version') {
    env.out(env.version);
    return 0;
  }
  if (command !== 'install-skill') return bad(USAGE, `unknown command "${command}"`);

  const on = new Set<string>(),
    values = new Map<string, string>(),
    positional: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!;
    if (a === '-h' || a === '--help') return help(INSTALL_USAGE);
    if (FLAGS.has(a)) on.add(a);
    else if (VALUED.has(a)) {
      const v = rest[++i];
      if (v === undefined || v.startsWith('--')) return bad(INSTALL_USAGE, `${a} needs a value`);
      values.set(a, v);
    } else if (a.startsWith('-')) return bad(INSTALL_USAGE, `unknown option ${a}`);
    else positional.push(a);
  }
  if (on.has('--list')) {
    env.out(`${'tool'.padEnd(12)} ${'project folder'.padEnd(16)} ${'user folder'.padEnd(18)} installed\n${listInstalled(env).join('\n')}`);
    return 0;
  }
  if (positional.length === 0 && !values.has('--dir') && rest.length === 0) return bad(INSTALL_USAGE);
  if (positional.length > 1) return bad(INSTALL_USAGE, `give one tool, not ${positional.map((p) => `"${p}"`).join(' and ')}`);

  const name = positional[0];
  const harness = name === undefined ? undefined : findHarness(name);
  if (name !== undefined && !harness)
    return bad(
      INSTALL_USAGE,
      `unknown tool "${name}". The tools are: ${HARNESSES.map((h) => h.id).join(', ')}. For another tool use --dir <its skills folder>.`,
    );
  const dir = values.get('--dir');
  if (!harness && dir === undefined) return bad(INSTALL_USAGE, 'say which tool, or give --dir <skills folder>');
  if (harness && dir !== undefined) return bad(INSTALL_USAGE, 'give a tool or --dir, not both');
  if (dir !== undefined && on.has('--user')) return bad(INSTALL_USAGE, "--user chooses the tool's user folder; with --dir there is none");

  const skills: Skill[] = [];
  if (on.has('--all') || values.get('--skill')?.split(',').includes('all')) skills.push(...SKILLS);
  else
    for (const id of (values.get('--skill') ?? 'inkplot').split(',')) {
      const s = findSkill(id.trim());
      if (!s) return bad(INSTALL_USAGE, `unknown skill "${id}". The skills are: ${SKILLS.map((k) => k.short).join(', ')}.`);
      if (!skills.includes(s)) skills.push(s);
    }
  const { ok } = installSkills(env, {
    ...(harness && { harness }),
    ...(dir !== undefined && { dir }),
    user: on.has('--user'),
    skills,
    force: on.has('--force'),
    dryRun: on.has('--dry-run'),
    remove: on.has('--remove'),
  });
  if (ok && harness && !on.has('--remove') && !on.has('--dry-run')) env.out(harness.next);
  return ok ? 0 : 1;
}
