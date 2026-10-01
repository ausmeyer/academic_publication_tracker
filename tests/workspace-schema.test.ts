import { describe, expect, it } from 'vitest';
import { MAX_WORKSPACE_BYTES } from '../src/core/limits';
import { WORKSPACE_VERSION, validateWorkspace, workspaceBytes } from '../src/core/workspace';
import type { Work } from '../src/types';

const work = (i: number, abstract = ''): Work => ({
  id: `w${i}`,
  title: `Title ${i}`,
  authors: ['Jane Scholar'],
  year: 2020,
  venue: 'Journal',
  doi: `10.1000/${i}`,
  abstract,
  type: 'article',
  url: '',
  openAccessUrl: '',
  isOpenAccess: false,
  citations: 1,
  provenance: [],
  included: true,
  tags: [],
  notes: '',
});
const snapshot = (id: string, name: string, works: Work[]) => ({
  id,
  name,
  query: { text: 'q', mode: 'topic', sources: ['crossref'], limit: 10 },
  works,
  searchedAt: '2026-09-30T00:00:00.000Z',
  sourceResults: [],
});

describe('workspace schema version', () => {
  it('migrates a legacy version 1 workspace and always writes version 2', () => {
    const legacy = {
      version: 1,
      activeId: 'a',
      snapshots: [snapshot('a', 'Old search', [work(1)])],
    };
    const migrated = validateWorkspace(JSON.parse(JSON.stringify(legacy)));
    expect(WORKSPACE_VERSION).toBe(2);
    expect(migrated.version).toBe(2);
    expect(migrated.snapshots[0].works[0].title).toBe('Title 1');
  });

  it('accepts version 2 and rejects versions it does not know', () => {
    const current = { version: 2, activeId: null, snapshots: [] };
    expect(validateWorkspace(current).version).toBe(2);
    expect(() => validateWorkspace({ ...current, version: 3 })).toThrow('not supported');
    expect(() => validateWorkspace({ ...current, version: 0 })).toThrow('not supported');
  });
});

describe('validation errors', () => {
  it('names the field, search and record that broke a limit', () => {
    const broken = { ...work(3), type: 'x'.repeat(201) };
    const workspace = {
      version: 2,
      activeId: 'a',
      snapshots: [snapshot('a', 'Forecasting', [work(1), work(2), broken])],
    };
    expect(() => validateWorkspace(workspace)).toThrow(/type/);
    expect(() => validateWorkspace(workspace)).toThrow(/Forecasting/);
    expect(() => validateWorkspace(workspace)).toThrow(/record 3/);
  });
});

describe('workspace size cap', () => {
  it('measures compact JSON in UTF-8 bytes', () => {
    const workspace = validateWorkspace({
      version: 2,
      activeId: null,
      snapshots: [snapshot('a', 'Ünïcode ✓', [])],
    });
    expect(workspaceBytes(workspace)).toBe(
      new TextEncoder().encode(JSON.stringify(workspace)).length,
    );
    expect(workspaceBytes(workspace)).toBeGreaterThan(JSON.stringify(workspace).length);
  });

  it('accepts a workspace that only exceeds the cap when pretty-printed, and rejects one that exceeds it compact', () => {
    const perWork = Buffer.byteLength(JSON.stringify(work(1_000_000)));
    const build = (targetBytes: number) => {
      const pad = Math.max(0, Math.floor(targetBytes / 40_000 - perWork));
      const make = (offset: number) =>
        Array.from({ length: 20_000 }, (_, i) => work(offset + i, 'x'.repeat(pad)));
      return {
        version: 2,
        activeId: 'a',
        snapshots: [snapshot('a', 'One', make(0)), snapshot('b', 'Two', make(20_000))],
      };
    };
    const fits = build(MAX_WORKSPACE_BYTES * 0.93);
    const compact = Buffer.byteLength(JSON.stringify(fits));
    const pretty = Buffer.byteLength(JSON.stringify(fits, null, 2));
    expect(compact).toBeLessThan(MAX_WORKSPACE_BYTES);
    expect(pretty).toBeGreaterThan(MAX_WORKSPACE_BYTES);
    expect(() => validateWorkspace(fits)).not.toThrow();
    expect(() => validateWorkspace(build(MAX_WORKSPACE_BYTES * 1.05))).toThrow('25 MB');
  }, 60_000);
});
