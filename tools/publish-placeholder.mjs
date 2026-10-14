// A one-off: publishes an empty placeholder for each package, because npm only lets you configure Trusted Publishing on a package
// that exists. Run it once, logged in to npm as an owner (`npm login`), then add the trusted publisher on each package's settings page.
//   node tools/publish-placeholder.mjs --dry-run    shows what would be published
//   node tools/publish-placeholder.mjs              publishes (npm asks for your one-time password if you have 2FA)
// The placeholder is a prerelease under its own `placeholder` tag, so it is never what `npm install inkplot` picks, and the real
// 1.0.0-beta.1 from CI is a later version. Delete this file once it has been used.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dry = process.argv.includes('--dry-run');
const version = '0.0.1-placeholder.0';
const repository = { type: 'git', url: 'git+https://github.com/neofox-solutions/inkplot.git' };
for (const name of ['inkplot', 'inkplot-scratch']) {
  const dir = mkdtempSync(join(tmpdir(), `${name}-placeholder-`));
  try {
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify(
        {
          name,
          version,
          description: `Placeholder for ${name}; the real releases are published from CI.`,
          license: 'MIT',
          repository,
          homepage: 'https://github.com/neofox-solutions/inkplot#readme',
        },
        null,
        2,
      ),
    );
    writeFileSync(
      join(dir, 'README.md'),
      `# ${name}\n\nThis is a placeholder. See https://github.com/neofox-solutions/inkplot for the real package.\n`,
    );
    console.log(`${dry ? 'would publish' : 'publishing'} ${name}@${version} (tag placeholder)`);
    execFileSync('npm', ['publish', '--tag', 'placeholder', '--access', 'public', ...(dry ? ['--dry-run'] : [])], {
      cwd: dir,
      stdio: 'inherit',
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
if (!dry)
  console.log(
    '\nNow, for each package on npmjs.com → Settings → Trusted publisher → GitHub Actions:\n  organization neofox-solutions, repository inkplot, workflow publish.yml, environment npm',
  );
