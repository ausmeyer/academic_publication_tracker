import { describe, expect, it } from 'vitest';
import { analyzeInsights } from '../src/core/insights';
import { carryInsights, validateInsights } from '../src/core/insights-data';
import { carryForwardCuration } from '../src/core/curation';
import type { SourceId } from '../src/types';
import { settings, work } from './insights-helpers';

const prov = (source: SourceId, sourceId: string) => ({
  source,
  sourceId,
  citations: 5,
  retrievedAt: '2026-09-01T00:00:00Z',
  url: '',
});
const authors = ['Alex Other', 'Kim Lee', 'Jane Scholar'];
const review = (key: string) => ({ key, authors, complete: true, role: 'corresponding' as const });
const annual = (key: string, year = 2024) => ({
  key,
  year,
  citations: 3,
  source: 'scholar' as const,
});

describe('Insights reviews and annual counts across a refresh', () => {
  it.each([
    [
      'an arXiv id that loses its version',
      work('a', {
        id: 'arxiv:2304.02643v1',
        doi: '',
        authors,
        provenance: [prov('arxiv', '2304.02643v1')],
      }),
      work('a', {
        id: 'arxiv:2304.02643',
        doi: '',
        authors,
        provenance: [prov('arxiv', '2304.02643')],
      }),
    ],
    [
      'a Scholar record that gains a DOI by merging with Crossref',
      work('s', { id: 'scholar:abc', doi: '', authors, provenance: [prov('scholar', 'abc')] }),
      work('s', {
        id: 'crossref:10.5555/x',
        doi: '10.5555/x',
        authors,
        provenance: [prov('crossref', '10.5555/x'), prov('scholar', 'abc')],
      }),
    ],
    [
      'a record that keeps its workspace ID and gains a DOI',
      work('o', { id: 'openalex:W1', doi: '', authors }),
      work('o', { id: 'openalex:W1', doi: '10.5555/w1', authors }),
    ],
  ])('keeps the confirmed role and annual counts of %s', (_label, old, fresh) => {
    const saved = settings({ annotations: [review(old.id)], annualCitations: [annual(old.id)] });
    const before = analyzeInsights([old], saved, 'all', 2026);
    const [refreshed] = carryForwardCuration([fresh], [old]);
    const carried = carryInsights(saved, [old], [refreshed]);
    const after = analyzeInsights([refreshed], carried, 'all', 2026);
    expect([after.rows[0].role, after.rows[0].reason, after.annual]).toEqual([
      before.rows[0].role,
      before.rows[0].reason,
      before.annual,
    ]);
    expect(carried.annotations).toEqual([review(after.rows[0].key)]);
    expect(carried.annualCitations).toEqual([annual(after.rows[0].key)]);
  });

  it('leaves rows alone when their paper keeps its key or has no counterpart', () => {
    const kept = work('kept', { authors });
    const gone = work('gone', {
      id: 'scholar:gone',
      doi: '',
      provenance: [prov('scholar', 'gone')],
    });
    const saved = settings({
      author: 'Jane Scholar',
      annotations: [review('10.1234/kept'), review('scholar:gone'), review('scholar:elsewhere')],
      annualCitations: [annual('10.1234/kept'), annual('scholar:gone')],
      journalRanks: [{ venue: 'Research', year: 2020, category: 'M', quartile: 'Q1', source: 'S' }],
    });
    expect(carryInsights(saved, [kept, gone], [work('kept', { authors })])).toEqual(saved);
  });

  it('never makes two reviews or annual rows for one paper', () => {
    // Two old copies of one paper, each reviewed, become one fresh record: both stay as they were.
    const copyA = work('ca', {
      id: 'europepmc:MED:1',
      doi: '',
      provenance: [prov('europepmc', 'MED:1')],
    });
    const copyB = work('cb', { id: 'pubmed:1', doi: '', provenance: [prov('pubmed', '1')] });
    const merged = work('m', {
      id: 'crossref:10.5555/m',
      doi: '10.5555/m',
      provenance: [prov('europepmc', 'MED:1'), prov('pubmed', '1')],
    });
    // A review already saved under the new key keeps its place, and the moving one stays put.
    const idOnly = work('i', { id: 'openalex:W9', doi: '' });
    const withDoi = work('i', { id: 'openalex:W9', doi: '10.5555/w9' });
    const saved = settings({
      annotations: [
        review('europepmc:MED:1'),
        review('pubmed:1'),
        review('openalex:W9'),
        { key: '10.5555/w9', authors: ['Other'], complete: false },
      ],
      annualCitations: [annual('europepmc:MED:1'), annual('pubmed:1'), annual('pubmed:1', 2025)],
    });
    const carried = carryInsights(saved, [copyA, copyB, idOnly], [merged, withDoi]);
    expect(() => validateInsights(carried)).not.toThrow();
    expect(carried.annotations).toEqual(saved.annotations);
    // Only the 2025 row has no rival for the merged paper's key.
    expect(carried.annualCitations).toEqual([
      annual('europepmc:MED:1'),
      annual('pubmed:1'),
      annual('10.5555/m', 2025),
    ]);
  });

  it('does not move rows to a record that is not clearly the same paper', () => {
    const old = work('x', { id: 'scholar:x', doi: '', provenance: [prov('scholar', 'x')] });
    // Two fresh records claim the Scholar record: ambiguous.
    const twins = [
      work('t1', { id: 'crossref:10.5555/t1', provenance: [prov('scholar', 'x')] }),
      work('t2', { id: 'crossref:10.5555/t2', provenance: [prov('scholar', 'x')] }),
    ];
    const saved = settings({ annotations: [review('scholar:x')] });
    expect(carryInsights(saved, [old], twins)).toEqual(saved);
    // A shared provider record with a different DOI is a different paper.
    const doiOld = work('d', { id: 'openalex:W5', provenance: [prov('openalex', 'W5')] });
    const otherDoi = work('e', { id: 'openalex:W5b', provenance: [prov('openalex', 'W5')] });
    const byDoi = settings({ annotations: [review('10.1234/d')] });
    expect(carryInsights(byDoi, [doiOld], [otherDoi])).toEqual(byDoi);
  });
});
