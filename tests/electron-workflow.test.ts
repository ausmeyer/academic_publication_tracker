import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const source = readFileSync(path.join(root, '.github/workflows/build.yml'), 'utf8');
// js-yaml ships with electron-builder, which reads the same kind of files.
const workflow = (createRequire(import.meta.url)('js-yaml') as { load(text: string): any }).load(
  source,
);
const steps = (job: string): any[] => workflow.jobs[job].steps;

describe('the desktop build workflow', () => {
  it('pins every action to a commit, keeping the release it was taken from in a comment', () => {
    const uses = [...source.matchAll(/^\s*(?:-\s+)?uses:\s*(\S+)(.*)$/gm)];
    expect(uses.length).toBeGreaterThan(4);
    for (const [, action, rest] of uses) {
      expect(action, action).toMatch(/^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/);
      expect(rest, action).toMatch(/#\s*v\d+\.\d+\.\d+/);
    }
  });

  it('stops a job that hangs instead of waiting for the platform limit', () => {
    for (const name of Object.keys(workflow.jobs)) {
      const minutes = workflow.jobs[name]['timeout-minutes'];
      expect(minutes, name).toBeGreaterThan(0);
      expect(minutes, name).toBeLessThanOrEqual(60);
    }
  });

  it('refuses a release tag that does not match the version inside the package', () => {
    const all = steps('build');
    const check = all.find((step) => /GITHUB_REF_NAME/.test(step.run ?? ''));
    expect(check, 'a version check step').toBeTruthy();
    expect(check.if).toContain("startsWith(github.ref, 'refs/tags/v')");
    expect(check.run).toContain('package.json');
    expect(check.run).toContain('package-lock.json');
    expect(check.run).toMatch(/exit 1/);
    // It runs before anything is installed or built.
    expect(all.indexOf(check)).toBeLessThan(all.findIndex((step) => step.run === 'npm ci'));
  });

  it('adds installers to a draft release that already exists, and never to a published one', () => {
    const run: string = steps('draft-release').find((step) =>
      /gh release/.test(step.run ?? ''),
    ).run;
    expect(run).toContain('gh release create');
    expect(run).toMatch(/gh release upload .*--clobber/);
    expect(run).toContain('isDraft');
    expect(run).toMatch(/already published[\s\S]*exit 1/);
  });

  it('still verifies the packaged application on both platforms', () => {
    const commands = steps('build').map((step) => step.run ?? '');
    expect(commands).toContain('node scripts/smoke-electron.mjs --packaged');
    expect(commands).toContain('node scripts/smoke-scholar.mjs --packaged');
  });
});
