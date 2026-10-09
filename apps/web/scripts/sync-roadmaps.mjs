// Copies the open-source roadmaps from a checkout of the MLOps MENA website
// (github.com/MLOpsMENACommunity/website, content/roadmaps/*.md) into
// apps/web/src/content/roadmaps/, byte for byte.
//
// The website (mlopsmena.com/roadmaps) is where the roadmaps are written and first
// published; the academy shows the same files. Never edit the copies here: change
// the website, then run this script and commit the result.
//
//   pnpm roadmaps:sync ../website           copy (adds, updates and deletes files)
//   pnpm roadmaps:sync ../website --check   exit 1 if the copies differ, change nothing
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const check = args.includes('--check');
const website = args.find((a) => !a.startsWith('--'));
if (!website) {
  console.error('usage: pnpm roadmaps:sync <path to the website checkout> [--check]');
  process.exit(2);
}

// INIT_CWD: where pnpm was run from, so a relative path means what the caller typed.
const from = resolve(process.env.INIT_CWD ?? process.cwd(), website, 'content/roadmaps');
const to = fileURLToPath(new URL('../src/content/roadmaps/', import.meta.url));
if (!existsSync(from)) {
  console.error(`roadmaps:sync: ${from} not found (pass the website repo's root)`);
  process.exit(2);
}

const md = (dir) => (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.md')).sort() : []);
const source = md(from);
const changed = [];
for (const file of source) {
  const content = readFileSync(join(from, file));
  const target = join(to, file);
  if (existsSync(target) && readFileSync(target).equals(content)) continue;
  changed.push(`~ ${file}`);
  if (!check) writeFileSync(target, content);
}
for (const file of md(to).filter((f) => !source.includes(f))) {
  changed.push(`- ${file}`);
  if (!check) rmSync(join(to, file));
}

if (changed.length === 0) {
  // eslint-disable-next-line no-console -- CLI output
  console.log(`roadmaps:sync: ${source.length} roadmaps, identical to ${from}`);
} else if (check) {
  console.error(`roadmaps:sync: out of date with ${from}:\n${changed.join('\n')}`);
  process.exit(1);
} else {
  // eslint-disable-next-line no-console -- CLI output
  console.log(`roadmaps:sync: ${changed.length} file(s) updated from ${from}:\n${changed.join('\n')}`);
}
