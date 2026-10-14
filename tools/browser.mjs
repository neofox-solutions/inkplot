// The headless Chromium the browser tests drive: `playwright` is a dev dependency, and CI installs the browser with
// `pnpm exec playwright install --with-deps chromium`. Where a matching browser cannot be installed, point INKPLOT_CHROMIUM at
// any Chromium executable and it is used instead.
import { chromium as playwrightChromium } from 'playwright';

const executablePath = process.env.INKPLOT_CHROMIUM || undefined;
export const chromium = {
  launch: (options = {}) => playwrightChromium.launch({ ...options, ...(executablePath ? { executablePath } : {}) }),
};
