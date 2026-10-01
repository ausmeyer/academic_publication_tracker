import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (file: string) => readFileSync(path.join(root, file), 'utf8');
// js-yaml ships with electron-builder, which reads these same files.
const yaml = createRequire(import.meta.url)('js-yaml') as { load(text: string): any };
const builder = yaml.load(read('electron-builder.yml'));
const preview = yaml.load(read('electron-builder.preview.yml'));
const pkg = JSON.parse(read('package.json'));
const lock = JSON.parse(read('package-lock.json'));
const bundled = ['fast-xml-parser', 'lucide-react', 'react', 'react-dom'];

describe('hardening of the packaged application (Electron fuses)', () => {
  it('turns off the switches that let other programs run code under the signed application', () => {
    expect(builder.electronFuses).toMatchObject({
      runAsNode: false, // ELECTRON_RUN_AS_NODE
      enableNodeOptionsEnvironmentVariable: false, // NODE_OPTIONS
    });
  });

  it('validates the app archive and refuses to load application code from anywhere else', () => {
    expect(builder.electronFuses).toMatchObject({
      enableEmbeddedAsarIntegrityValidation: true,
      onlyLoadAppFromAsar: true,
    });
  });

  it('encrypts the cookie store', () => {
    expect(builder.electronFuses).toMatchObject({ enableCookieEncryption: true });
  });

  it('decides the inspector and file-protocol fuses explicitly instead of leaving defaults', () => {
    expect(typeof builder.electronFuses.enableNodeCliInspectArguments).toBe('boolean');
    // The window is loaded from file://, which needs the extra privileges until a custom protocol exists.
    expect(builder.electronFuses.grantFileProtocolExtraPrivileges).toBe(true);
  });

  it('applies to the ad-hoc preview builds as well', () => {
    expect(preview.extends).toBe('./electron-builder.yml');
    expect(preview.electronFuses).toBeUndefined();
  });
});

describe('macOS entitlements', () => {
  const plist = () => read('build/entitlements.mac.plist');
  const keys = () => [...plist().matchAll(/<key>([^<]+)<\/key>/g)].map((match) => match[1]).sort();

  it('are the two Electron needs for its JavaScript engine, and nothing else', () => {
    expect(keys()).toEqual([
      'com.apple.security.cs.allow-jit',
      'com.apple.security.cs.allow-unsigned-executable-memory',
    ]);
    expect(plist().match(/<true\/>/g)).toHaveLength(2);
  });

  it('do not turn library validation off', () => {
    expect(keys()).not.toContain('com.apple.security.cs.disable-library-validation');
    expect(plist()).not.toMatch(/<key>[^<]*disable-library-validation<\/key>/);
  });

  it('are used for the application and for its helper processes', () => {
    expect(builder.mac.entitlements).toBe('build/entitlements.mac.plist');
    expect(builder.mac.entitlementsInherit).toBe('build/entitlements.mac.plist');
  });
});

describe('what ships inside the application archive', () => {
  it('has no runtime dependencies: the interface and main process are bundled', () => {
    expect(pkg.dependencies).toBeUndefined();
    for (const name of bundled) expect(pkg.devDependencies[name]).toBeTruthy();
  });

  it('is described by a lockfile that marks the bundled libraries as development packages', () => {
    const packages: Record<string, { dev?: boolean; devOptional?: boolean }> = lock.packages;
    expect(lock.packages[''].dependencies).toBeUndefined();
    for (const name of bundled) expect(lock.packages[''].devDependencies[name]).toBeTruthy();
    const production = Object.entries(packages).filter(
      ([name, entry]) => name && !entry.dev && !entry.devOptional,
    );
    expect(production.map(([name]) => name)).toEqual([]);
  });

  it('includes the notices of the bundled libraries next to the application', () => {
    expect(builder.extraResources).toContainEqual({
      from: 'dist-electron/THIRD_PARTY_LICENSES.txt',
      to: 'THIRD_PARTY_LICENSES.txt',
    });
  });

  it('generates those notices as part of the build', () => {
    expect(pkg.scripts.build).toContain('node scripts/generate-licenses.mjs');
  });
});
