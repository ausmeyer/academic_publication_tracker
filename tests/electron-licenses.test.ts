import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const script = path.join(root, 'scripts', 'generate-licenses.mjs');
const temporary: string[] = [];
const scratch = () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'apt-licenses-'));
  temporary.push(directory);
  return directory;
};
afterEach(() => {
  for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true, force: true });
});
const run = (args: string[]) =>
  spawnSync(process.execPath, [script, ...args], { cwd: root, encoding: 'utf8' });
function generate(): string {
  const out = path.join(scratch(), 'THIRD_PARTY_LICENSES.txt');
  const result = run(['--out', out]);
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  return readFileSync(out, 'utf8');
}

describe('third-party notices shipped with the application', () => {
  it('include the notice of every bundled library and of the packages they use', () => {
    const text = generate();
    for (const name of [
      'react',
      'react-dom',
      'scheduler',
      'lucide-react',
      'fast-xml-parser',
      'strnum',
      'anynum',
      'fast-xml-builder',
      'path-expression-matcher',
      'is-unsafe',
      'xml-naming',
      '@nodable/entities',
    ])
      expect(text, name).toMatch(new RegExp(`^${name.replace(/[/@]/g, '\\$&')}@\\d`, 'm'));
    expect(text).toContain('Copyright (c) Meta Platforms, Inc. and affiliates.');
    expect(text).toContain('Lucide Icons and Contributors');
    expect(text).toContain('Permission is hereby granted');
  });

  it('say so instead of inventing a text for a package that ships no license file', () => {
    expect(generate()).toMatch(
      /^@nodable\/entities@\S+[\s\S]*?MIT \(declared in package\.json; this package ships no license file\)/m,
    );
  });

  it('leave out the build tooling, which is not part of the application', () => {
    const text = generate();
    for (const tool of [
      'vite',
      'vitest',
      'electron-builder',
      'typescript',
      '@playwright/test',
      'esbuild',
    ])
      expect(text).not.toMatch(new RegExp(`^${tool.replace(/[/@]/g, '\\$&')}@`, 'm'));
  });

  it('are identical from one run to the next and list each package once, sorted by name', () => {
    const first = generate();
    expect(generate()).toBe(first);
    const [summary, ...notices] = first.split(/\n-{78}\n/);
    const names = [...summary.matchAll(/^([@\w./-]+)@\d\S*$/gm)].map((match) => match[1]);
    expect(names.length).toBeGreaterThan(5);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual([...names].sort());
    expect(notices).toHaveLength(names.length);
  });

  it('cover every library that the application code imports', async () => {
    const { BUNDLED_PACKAGES } = await import(pathToFileURL(script).href);
    const imported = new Set<string>();
    const scan = (directory: string) => {
      for (const entry of readdirSync(directory)) {
        const file = path.join(directory, entry);
        if (statSync(file).isDirectory()) scan(file);
        else if (/\.(ts|tsx)$/.test(entry) && !entry.endsWith('.d.ts')) {
          const source = readFileSync(file, 'utf8');
          for (const match of source.matchAll(
            /^(?!\s*(?:import|export)\s+type\b)\s*(?:import|export)\b[^'";]*?\bfrom\s+['"]([^'"]+)['"]|^\s*import\s+['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]/gm,
          )) {
            const specifier = match[1] ?? match[2] ?? match[3];
            if (specifier.startsWith('.') || specifier.startsWith('node:')) continue;
            const parts = specifier.split('/');
            imported.add(specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]);
          }
        }
      }
    };
    scan(path.join(root, 'src'));
    scan(path.join(root, 'electron'));
    imported.delete('electron'); // The runtime itself, not bundled.
    expect([...imported].filter((name) => !BUNDLED_PACKAGES.includes(name))).toEqual([]);
    expect(imported.size).toBeGreaterThan(0);
  });

  it('fail, naming the package, when a bundled library is missing or has no readable notice', () => {
    const project = scratch();
    for (const name of ['react', 'react-dom', 'lucide-react', 'fast-xml-parser']) {
      const directory = path.join(project, 'node_modules', name);
      mkdirSync(directory, { recursive: true });
      writeFileSync(
        path.join(directory, 'package.json'),
        JSON.stringify({ name, version: '1.0.0', license: 'MIT' }),
      );
    }
    writeFileSync(path.join(project, 'node_modules', 'react', 'LICENSE'), 'MIT License');
    // react-dom, lucide-react and fast-xml-parser declare a license but ship no file: allowed.
    const ok = run(['--root', project, '--out', path.join(project, 'out.txt')]);
    expect(ok.status).toBe(0);
    // No declared license and no file: refused.
    writeFileSync(
      path.join(project, 'node_modules', 'react-dom', 'package.json'),
      JSON.stringify({ name: 'react-dom', version: '1.0.0' }),
    );
    const refused = run(['--root', project, '--out', path.join(project, 'out.txt')]);
    expect(refused.status).not.toBe(0);
    expect(refused.stderr).toContain('react-dom');
    // A library that is not installed at all.
    rmSync(path.join(project, 'node_modules', 'lucide-react'), { recursive: true });
    const missing = run(['--root', project, '--out', path.join(project, 'out.txt')]);
    expect(missing.status).not.toBe(0);
    expect(missing.stderr).toMatch(/lucide-react|react-dom/);
  });
});
