import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as catalog from '../src/catalog';

describe('interface source hygiene (W4-15, W4-16)', () => {
  it('writes the byte-order mark in App.tsx as an escape, not as an invisible character', () => {
    const source = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
    expect(source).not.toContain('﻿');
    expect(source).toContain('\\uFEFF');
  });

  it('has one DOI link builder, in src/core/merge.ts', () => {
    expect('doiUrl' in catalog).toBe(false);
  });
});
