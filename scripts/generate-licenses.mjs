// Writes THIRD_PARTY_LICENSES.txt: the license notices of the third-party libraries whose code is
// bundled into the application (dist/ and dist-electron/), plus the packages those libraries use.
// The bundles carry no license banners, so this file is what ships the notices with the installers.
//
//   node scripts/generate-licenses.mjs [--root <project>] [--out <file>]
//
// Keep BUNDLED_PACKAGES in step with the libraries that src/ and electron/ import at runtime
// (tests/electron-licenses.test.ts fails when one is missing).
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const BUNDLED_PACKAGES = ['fast-xml-parser', 'lucide-react', 'react', 'react-dom'];

const NOTICE_FILE = /^(?:licen[sc]e|copying|notice)(?:[.-].*)?$/i;

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

/** Finds an installed package the way Node resolves it: nearest node_modules, walking upwards. */
async function locate(name, from, root) {
  for (let directory = from; ; directory = path.dirname(directory)) {
    const candidate = path.join(directory, 'node_modules', name);
    if (await readJson(path.join(candidate, 'package.json'))) return candidate;
    if (directory === root || directory === path.dirname(directory)) return null;
  }
}

function repositoryOf(manifest) {
  const repository =
    typeof manifest.repository === 'string' ? manifest.repository : manifest.repository?.url;
  return repository?.replace(/^git\+/, '').replace(/\.git$/, '');
}

function declaredLicense(manifest) {
  const license =
    manifest.license ?? manifest.licenses?.map((entry) => entry.type ?? entry).join(' OR ');
  return typeof license === 'string' ? license : license?.type;
}

async function noticeOf(directory, manifest) {
  const files = (await readdir(directory)).filter((entry) => NOTICE_FILE.test(entry)).sort();
  const texts = [];
  for (const file of files) {
    const fullPath = path.join(directory, file);
    if ((await stat(fullPath)).isFile()) texts.push((await readFile(fullPath, 'utf8')).trim());
  }
  if (texts.length) return texts.join('\n\n');
  const license = declaredLicense(manifest);
  if (!license) return null;
  const author = typeof manifest.author === 'string' ? manifest.author : manifest.author?.name;
  return [
    `${license} (declared in package.json; this package ships no license file)`,
    ...(author ? [`Author: ${author}`] : []),
    ...(repositoryOf(manifest) ? [`Repository: ${repositoryOf(manifest)}`] : []),
  ].join('\n');
}

/** Every bundled library and its runtime dependencies, with their notices, sorted by name. */
export async function collectLicenses(root) {
  const found = new Map();
  const queue = BUNDLED_PACKAGES.map((name) => ({ name, from: root }));
  while (queue.length) {
    const { name, from } = queue.shift();
    const directory = await locate(name, from, root);
    if (!directory) throw new Error(`${name} is not installed. Run npm ci before building.`);
    const manifest = await readJson(path.join(directory, 'package.json'));
    const key = `${manifest.name}@${manifest.version}`;
    if (found.has(key)) continue;
    const notice = await noticeOf(directory, manifest);
    if (!notice) throw new Error(`${key} has no license file and declares no license.`);
    found.set(key, { name: manifest.name, version: manifest.version, notice });
    for (const dependency of Object.keys(manifest.dependencies ?? {}))
      queue.push({ name: dependency, from: directory });
  }
  // Plain code-unit order, so the file is identical on every machine.
  const order = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  return [...found.values()].sort((a, b) => order(a.name, b.name) || order(a.version, b.version));
}

export function formatLicenses(entries) {
  const separator = `\n\n${'-'.repeat(78)}\n\n`;
  return (
    [
      "Academic Publication Tracker's interface and main-process code include the following",
      'third-party libraries. The Electron runtime and Chromium, which the application runs on,',
      'are licensed separately: see https://www.electronjs.org/ and https://www.chromium.org/.',
      '',
      ...entries.map((entry) => `${entry.name}@${entry.version}`),
    ].join('\n') +
    separator +
    entries.map((entry) => `${entry.name}@${entry.version}\n\n${entry.notice}`).join(separator) +
    '\n'
  );
}

async function main() {
  const args = process.argv.slice(2);
  const option = (flag, fallback) =>
    args.includes(flag) ? path.resolve(args[args.indexOf(flag) + 1]) : fallback;
  const root = option('--root', process.cwd());
  const out = option('--out', path.join(root, 'dist-electron', 'THIRD_PARTY_LICENSES.txt'));
  const entries = await collectLicenses(root);
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, formatLicenses(entries));
  console.log(`Wrote ${entries.length} notices to ${path.relative(process.cwd(), out) || out}.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
