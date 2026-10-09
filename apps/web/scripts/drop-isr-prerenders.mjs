// Runs after `next build`: deletes the build-time HTML of ISR pages (the ones with a
// revalidate time, i.e. the pages that show API data), so each renders on its first
// request instead and is cached from then on.
//
// Why: the API is not reachable while the image builds, so those build-time renders are
// the empty fallbacks (no courses, no sessions). A container serves its image's files
// after every deploy and every wake from sleep, so its first visitor to each page would
// get that empty page (Next serves the stale copy while it regenerates). Without the
// file, Next renders the page with live data on the first request (x-nextjs-cache: MISS).
// Pages without a revalidate time (policies, auth shells) are fully static and kept.
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const manifest = JSON.parse(readFileSync(join(root, '.next/prerender-manifest.json'), 'utf8'));
const dirs = [join(root, '.next/server/app'), join(root, '.next/standalone/apps/web/.next/server/app')].filter((d) => existsSync(d));

let routes = 0;
let files = 0;
for (const [route, info] of Object.entries(manifest.routes)) {
  if (!/^\/(en|ar)(\/|$)/.test(route) || !(typeof info.initialRevalidateSeconds === 'number' && info.initialRevalidateSeconds > 0)) continue;
  routes++;
  for (const dir of dirs) {
    for (const ext of ['.html', '.rsc', '.meta']) {
      const file = join(dir, `${route}${ext}`);
      if (existsSync(file)) {
        rmSync(file);
        files++;
      }
    }
  }
}
// ISR routes but nothing deleted: Next's output layout changed under us, and the empty
// build-time pages would ship. Fail the build rather than ship them.
if (routes > 0 && files === 0) {
  console.error(`drop-isr-prerenders: ${routes} ISR routes in the manifest but no prerendered files found in ${dirs.join(', ') || '(no output dirs)'}`);
  process.exit(1);
}
// eslint-disable-next-line no-console -- build output
console.log(`drop-isr-prerenders: deleted ${files} files for ${routes} ISR pages (${dirs.length} output dirs); they render on first request`);
