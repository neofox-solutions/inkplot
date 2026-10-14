// The `inkplot` command's install-skill: where each tool's skills go, what an install does about an older or a foreign copy, and what
// the usage says. Runs against temporary folders standing in for a project, a home folder and the package's own skills.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'vite-plus/test';
import { INSTALL_USAGE, USAGE, run } from './main.ts';
import { HARNESSES, SKILLS, readStamp } from './skills.ts';

const skillText = (name: string, version: string | null): string =>
  `---\nname: ${name}\ndescription: test skill\n${version ? `metadata:\n  generator: inkplot\n  version: "${version}"\n` : ''}---\n\n# ${name}\n`;

test('cli', () => {
  const dir = mkdtempSync(join(tmpdir(), 'inkplot-cli-'));
  try {
    const home = join(dir, 'home'),
      project = join(dir, 'project'),
      source = join(dir, 'source');
    mkdirSync(home, { recursive: true });
    mkdirSync(project, { recursive: true });
    const makeSource = (version: string): void => {
      rmSync(source, { recursive: true, force: true });
      for (const s of SKILLS) {
        mkdirSync(join(source, s.name), { recursive: true });
        writeFileSync(join(source, s.name, 'SKILL.md'), skillText(s.name, version));
      }
      mkdirSync(join(source, 'inkplot/topics'), { recursive: true });
      writeFileSync(join(source, 'inkplot/topics/axes.md'), version === '1.0.0' ? '# old topic\n' : '# axes\n');
      if (version === '1.0.0') writeFileSync(join(source, 'inkplot/topics/dropped.md'), '# gone in the next version\n');
    };
    const go = (args: string[], version = '1.0.0') => {
      const out: string[] = [],
        err: string[] = [];
      const status = run(args, { cwd: project, home, source, version, out: (t) => out.push(t), err: (t) => err.push(t) });
      return { status, out: out.join('\n'), err: err.join('\n') };
    };
    const at = (...parts: string[]) => join(project, ...parts);

    // The stamp: only a skill inkplot wrote has one.
    assert.deepEqual(readStamp(skillText('inkplot', '1.2.3-beta.4')), { name: 'inkplot', version: '1.2.3-beta.4' });
    assert.equal(readStamp(skillText('inkplot', null)), null);
    assert.equal(readStamp('# not a skill'), null);

    // Usage: nothing given shows it and exits 2; --help and --version exit 0.
    makeSource('1.0.0');
    let r = go([]);
    assert.equal(r.status, 2);
    assert.equal(r.err, USAGE);
    r = go(['install-skill']);
    assert.equal(r.status, 2);
    assert.equal(r.err, INSTALL_USAGE, 'install-skill alone shows its options');
    for (const h of HARNESSES) assert.ok(INSTALL_USAGE.includes(h.id) && INSTALL_USAGE.includes(h.project), `the usage names ${h.id}`);
    for (const opt of ['--skill', '--all', '--user', '--dir', '--force', '--dry-run', '--remove', '--list'])
      assert.ok(INSTALL_USAGE.includes(opt), opt);
    assert.equal(go(['--help']).status, 0);
    assert.equal(go(['install-skill', '--help']).out, INSTALL_USAGE);
    assert.equal(go(['--version']).out, '1.0.0');
    for (const bad of [
      ['nope'],
      ['install-skill', 'vim'],
      ['install-skill', 'cursor', '--nope'],
      ['install-skill', 'cursor', '--skill'],
      ['install-skill', 'cursor', '--skill', 'x'],
      ['install-skill', 'cursor', 'codex'],
      ['install-skill', '--force'],
      ['install-skill', 'cursor', '--dir', 'x'],
    ]) {
      r = go(bad);
      assert.equal(r.status, 2, bad.join(' '));
      assert.match(r.err, /inkplot install-skill|inkplot: tools/, 'a mistake shows the usage');
    }
    assert.match(go(['install-skill', 'vim']).err, /unknown tool "vim"/);
    assert.ok(!existsSync(at('.cursor')), 'nothing is written for a mistake');

    // A first install: the library skill alone, by default, in the project.
    r = go(['install-skill', 'cursor']);
    assert.equal(r.status, 0, r.err);
    assert.match(r.out, /installed inkplot 1\.0\.0 at \.cursor\/skills\/inkplot/);
    assert.ok(existsSync(at('.cursor/skills/inkplot/SKILL.md')) && existsSync(at('.cursor/skills/inkplot/topics/axes.md')));
    assert.ok(!existsSync(at('.cursor/skills/inkplot-data-charts')), 'only the library skill by default');
    assert.match(r.out, /Cursor|session/, 'it says what to do next');

    // Run again: nothing to do. With --dry-run: nothing changes whatever it would do.
    assert.match(go(['install-skill', 'cursor']).out, /1\.0\.0 is already installed/);
    assert.match(go(['install-skill', 'cursor', '--force', '--dry-run']).out, /would/);

    // Every tool, and the two ways to name Claude Code and Copilot.
    for (const [name, folder] of [
      ['claude-code', '.claude/skills'],
      ['claude', '.claude/skills'],
      ['codex', '.agents/skills'],
      ['vscode', '.github/skills'],
      ['copilot', '.github/skills'],
      ['gemini', '.gemini/skills'],
      ['agents', '.agents/skills'],
    ] as const) {
      r = go(['install-skill', name]);
      assert.equal(r.status, 0, `${name}: ${r.err}`);
      assert.ok(existsSync(at(folder, 'inkplot/SKILL.md')), `${name} writes ${folder}`);
    }
    // --user goes to the home folder; VS Code's differs from its project folder.
    go(['install-skill', 'vscode', '--user']);
    assert.ok(existsSync(join(home, '.copilot/skills/inkplot/SKILL.md')));
    assert.match(go(['install-skill', 'claude', '--user']).out, /at ~\/\.claude\/skills\/inkplot/);

    // --skill and --all.
    r = go(['install-skill', 'cursor', '--skill', 'data-charts']);
    assert.ok(existsSync(at('.cursor/skills/inkplot-data-charts/SKILL.md')));
    rmSync(at('.cursor'), { recursive: true });
    go(['install-skill', 'cursor', '--all']);
    assert.deepEqual(readdirSync(at('.cursor/skills')).sort(), ['inkplot', 'inkplot-data-charts']);
    rmSync(at('.cursor'), { recursive: true });
    go(['install-skill', 'cursor', '--skill', 'inkplot,data-charts']);
    assert.deepEqual(readdirSync(at('.cursor/skills')).sort(), ['inkplot', 'inkplot-data-charts']);

    // --dir for a tool that is not listed.
    r = go(['install-skill', '--dir', 'elsewhere/skills']);
    assert.equal(r.status, 0, r.err);
    assert.ok(existsSync(at('elsewhere/skills/inkplot/SKILL.md')));

    // A new version replaces the old one whole: a file the new one dropped does not stay behind.
    rmSync(at('.cursor'), { recursive: true });
    go(['install-skill', 'cursor']);
    assert.ok(existsSync(at('.cursor/skills/inkplot/topics/dropped.md')));
    makeSource('1.1.0');
    r = go(['install-skill', 'cursor'], '1.1.0');
    assert.match(r.out, /updated inkplot from 1\.0\.0 to 1\.1\.0/);
    assert.ok(!existsSync(at('.cursor/skills/inkplot/topics/dropped.md')));
    assert.equal(readFileSync(at('.cursor/skills/inkplot/topics/axes.md'), 'utf8'), '# axes\n');
    assert.equal(readStamp(readFileSync(at('.cursor/skills/inkplot/SKILL.md'), 'utf8'))?.version, '1.1.0');

    // Another copy, of another version, where a tool could also read it: named, not changed.
    // (.agents/skills and .claude/skills hold 1.0.0 from the loop above; cursor now has 1.1.0.)
    assert.match(r.out, /note: \.agents\/skills\/inkplot .*holds version 1\.0\.0/);
    assert.ok(readFileSync(at('.agents/skills/inkplot/SKILL.md'), 'utf8').includes('1.0.0'), 'the other copy is left as it was');
    assert.match(r.out, /note: ~\/\.copilot\/skills\/inkplot \(your user folder\) holds version 1\.0\.0/);

    // The project's own inkplot is another version than the skill: say so, and say what to run.
    mkdirSync(at('node_modules/inkplot'), { recursive: true });
    writeFileSync(at('node_modules/inkplot/package.json'), JSON.stringify({ name: 'inkplot', version: '1.0.5' }));
    r = go(['install-skill', 'cursor', '--force'], '1.1.0');
    assert.match(r.out, /this project has inkplot 1\.0\.5 installed, but these skills are for 1\.1\.0.*npx inkplot@1\.0\.5 install-skill/);
    writeFileSync(at('node_modules/inkplot/package.json'), JSON.stringify({ name: 'inkplot', version: '1.1.0' }));
    assert.doesNotMatch(go(['install-skill', 'cursor', '--force'], '1.1.0').out, /this project has/, 'a matching version says nothing');

    // A folder that is not ours is left alone unless forced; so is its removal.
    mkdirSync(at('.gemini/skills/inkplot'), { recursive: true });
    writeFileSync(at('.gemini/skills/inkplot/SKILL.md'), skillText('inkplot', null));
    r = go(['install-skill', 'gemini'], '1.1.0');
    assert.equal(r.status, 1);
    assert.match(r.out, /was not installed by inkplot, so it is left alone/);
    assert.ok(!readFileSync(at('.gemini/skills/inkplot/SKILL.md'), 'utf8').includes('generator'));
    assert.equal(go(['install-skill', 'gemini', '--remove'], '1.1.0').status, 1);
    assert.equal(go(['install-skill', 'gemini', '--force'], '1.1.0').status, 0);
    assert.equal(readStamp(readFileSync(at('.gemini/skills/inkplot/SKILL.md'), 'utf8'))?.version, '1.1.0');

    // --remove takes out what is ours, and says so when there is nothing.
    r = go(['install-skill', 'gemini', '--remove', '--dry-run'], '1.1.0');
    assert.match(r.out, /would remove inkplot 1\.1\.0/);
    assert.ok(existsSync(at('.gemini/skills/inkplot')));
    assert.match(go(['install-skill', 'gemini', '--remove'], '1.1.0').out, /removed inkplot 1\.1\.0 from \.gemini\/skills\/inkplot/);
    assert.ok(!existsSync(at('.gemini/skills/inkplot')));
    assert.match(go(['install-skill', 'gemini', '--remove'], '1.1.0').out, /not installed/);

    // --list shows each tool and what it holds.
    r = go(['install-skill', '--list'], '1.1.0');
    assert.equal(r.status, 0);
    assert.match(r.out, /cursor +\.cursor\/skills .*inkplot 1\.1\.0 \(project\)/);
    assert.match(r.out, /vscode .*inkplot 1\.0\.0 \(user\)/);

    // A package with no skills in it says so rather than writing an empty folder.
    rmSync(source, { recursive: true });
    r = go(['install-skill', 'codex', '--force'], '1.1.0');
    assert.equal(r.status, 1);
    assert.match(r.out, /this package has no copy of the skill/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
