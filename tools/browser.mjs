// The headless Chromium the browser tests drive. `playwright` is a dev dependency (CI installs it and the browser with
// `npx playwright install chromium`); where it is not installed in the repository, a copy kept beside the tools is used.
import { createRequire } from 'node:module';
const here = createRequire(import.meta.url);
const shared = createRequire('/opt/node-tools/node_modules/');
let playwright;
try { playwright = here('playwright'); } catch { playwright = shared('playwright'); }
export const { chromium } = playwright;
