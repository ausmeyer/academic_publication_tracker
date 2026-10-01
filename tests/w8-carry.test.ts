import { describe, expect, it } from 'vitest';
import { analyzeInsights } from '../src/core/insights';
import { carryInsights, paperKey } from '../src/core/insights-data';
import { carryForwardCuration } from '../src/core/curation';
import { mergeWorks } from '../src/core/merge';
import type { InsightsSettings, SourceId, Work } from '../src/types';
import { settings, work } from './insights-helpers';

const prov = (source: SourceId, sourceId: string) => ({
  source,
  sourceId,
  citations: 5,
  retrievedAt: '2026-09-01T00:00:00Z',
  url: '',
});
const authors = ['Alex Other', 'Kim Lee', 'Jane Scholar'];
const title = 'Forecasting seasonal influenza with ensemble models';
/** The old copy came only from Google Scholar, without a DOI. */
const scholarOnly = work('old', {
  id: 'scholar:cluster-1',
  doi: '',
  title,
  year: 2021,
  authors,
  notes: 'my notes',
  tags: ['core'],
  provenance: [prov('scholar', 'cluster-1')],
});
/** In the refresh the paper comes from Crossref with a DOI and shares no provider record. */
const fromCrossref = (doi: string, extra: Partial<Work> = {}) =>
  work(doi, {
    id: `crossref:${doi}`,
    doi,
    title,
    year: 2021,
    authors,
    provenance: [prov('crossref', doi)],
    ...extra,
  });
const reviewed = (key: string): InsightsSettings =>
  settings({
    annotations: [{ key, authors, complete: true, role: 'corresponding' }],
    annualCitations: [{ key, year: 2024, citations: 3, source: 'scholar' }],
  });
const keys = (carried: InsightsSettings) => ({
  annotations: carried.annotations.map((r) => r.key),
  annual: carried.annualCitations.map((r) => r.key),
});

describe('a refresh that matches a paper only by its title', () => {
  it('keeps its confirmed role and annual counts, as it keeps its notes and tags', () => {
    const fresh = fromCrossref('10.5555/flu');
    const [carried] = carryForwardCuration([fresh], [scholarOnly]);
    const insights = carryInsights(reviewed('scholar:cluster-1'), [scholarOnly], [carried]);
    const after = analyzeInsights([carried], insights, 'all', 2026);
    expect({
      notes: carried.notes,
      tags: carried.tags,
      role: after.rows[0].role,
      annual: after.annual.length,
    }).toEqual({ notes: 'my notes', tags: ['core'], role: 'corresponding', annual: 1 });
  });

  it('leaves the rows where they are when two fresh records have that title', () => {
    const fresh = [fromCrossref('10.5555/flu'), fromCrossref('10.5555/flu-preprint')];
    expect(keys(carryInsights(reviewed('scholar:cluster-1'), [scholarOnly], fresh))).toEqual({
      annotations: ['scholar:cluster-1'],
      annual: ['scholar:cluster-1'],
    });
  });

  it('does not take a title match that merging does not confirm', () => {
    // Same title and year, but no author in common: another paper.
    const other = fromCrossref('10.5555/other', { authors: ['Pat Doe', 'Sam Roe'] });
    expect(keys(carryInsights(reviewed('scholar:cluster-1'), [scholarOnly], [other]))).toEqual({
      annotations: ['scholar:cluster-1'],
      annual: ['scholar:cluster-1'],
    });
  });

  it('never moves the rows of a paper with a DOI to a record with another DOI', () => {
    const old = fromCrossref('10.5555/flu');
    const renamed = fromCrossref('10.5555/flu-v2');
    expect(keys(carryInsights(reviewed('10.5555/flu'), [old], [renamed]))).toEqual({
      annotations: ['10.5555/flu'],
      annual: ['10.5555/flu'],
    });
  });

  it('prefers an identifier match to a title match', () => {
    const byProvider = work('p', {
      id: 'openalex:W1',
      doi: '',
      title: 'An unrelated-looking title after the provider corrected it',
      year: 2021,
      authors,
      provenance: [prov('scholar', 'cluster-1')],
    });
    const byTitle = fromCrossref('10.5555/flu');
    const carried = carryInsights(
      reviewed('scholar:cluster-1'),
      [scholarOnly],
      [byTitle, byProvider],
    );
    expect(keys(carried)).toEqual({ annotations: ['openalex:W1'], annual: ['openalex:W1'] });
  });
});

describe('carrying Insights rows never moves them to another paper', () => {
  let seed = 31;
  const random = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
  it('when different papers share a title and Scholar re-clusters between refreshes', () => {
    const wrong: string[] = [];
    let movedByTitle = 0;
    for (let trial = 0; trial < 150; trial++) {
      // Three papers share each title; their authors tell them apart.
      const papers = Array.from({ length: 12 }, (_, p) => ({
        p,
        doi: random() < 0.5 ? `10.7777/t${trial}p${p}` : '',
        title: `Shared title ${trial} group ${p % 4} about influenza forecasting`,
      }));
      const copies = (fresh: boolean) =>
        papers.flatMap((paper) => {
          const out: Work[] = [];
          const add = (source: SourceId, sourceId: string, doi: string) =>
            out.push(
              work(`${source}:${sourceId}`, {
                id: `${source}:${sourceId}`,
                doi,
                title: paper.title,
                year: 2020,
                authors: [`Author${paper.p} Person`, `Second${paper.p} Writer`],
                provenance: [prov(source, sourceId)],
              }),
            );
          if (random() < 0.6) add('crossref', `c${trial}-${paper.p}`, paper.doi);
          // Scholar's cluster IDs change between the two searches.
          if (random() < 0.7) add('scholar', `s${trial}-${paper.p}-${fresh ? 'b' : 'a'}`, '');
          if (random() < 0.3) add('pubmed', `${trial}${paper.p}`, random() < 0.5 ? paper.doi : '');
          return out;
        });
      const previous = mergeWorks(copies(false));
      const fresh = carryForwardCuration(mergeWorks(copies(true)), previous);
      const paperOf = (w: Work) => Number(/Author(\d+) Person/.exec(w.authors.join(' '))![1]);
      const annotations = [
        ...new Map(
          previous.map((old) => [
            paperKey(old),
            { key: paperKey(old), authors: [`paper ${paperOf(old)}`], complete: true },
          ]),
        ).values(),
      ];
      const carried = carryInsights(settings({ annotations }), previous, fresh);
      const freshByKey = new Map(fresh.map((w) => [paperKey(w), w]));
      // Old records known only from Scholar can be found again by nothing but their title.
      const scholarOnly = new Set(
        previous
          .filter((w) => w.provenance.every((p) => p.source === 'scholar'))
          .map((w) => paperKey(w)),
      );
      carried.annotations.forEach((row, i) => {
        const target = freshByKey.get(row.key);
        if (target && row.authors[0] !== `paper ${paperOf(target)}`)
          wrong.push(JSON.stringify({ trial, row, target: target.id }));
        if (scholarOnly.has(annotations[i].key) && row.key !== annotations[i].key) movedByTitle++;
      });
    }
    expect(wrong).toEqual([]);
    // The title fallback was really exercised.
    expect(movedByTitle).toBeGreaterThan(50);
  });
});

describe('carrying Insights rows at the limits', () => {
  it('matches 20,000 papers by title alone quickly', () => {
    const previous = Array.from({ length: 20000 }, (_, i) =>
      work(`s${i}`, {
        id: `scholar:${i}`,
        doi: '',
        title: `A study of seasonal influenza forecasting number ${i}`,
        authors: [`Author${i} Person`, 'Jane Scholar'],
        provenance: [prov('scholar', `${i}`)],
      }),
    );
    const fresh = previous.map((w, i) => ({
      ...w,
      id: `crossref:10.8888/${i}`,
      doi: `10.8888/${i}`,
      provenance: [prov('crossref', `10.8888/${i}`)],
    }));
    const saved = settings({
      annotations: previous.map((w) => ({ key: paperKey(w), authors, complete: true })),
      annualCitations: Array.from({ length: 100000 }, (_, k) => ({
        key: paperKey(previous[k % 20000]),
        year: 2000 + Math.floor(k / 20000),
        citations: k % 50,
        source: 'scholar' as const,
      })),
    });
    const started = performance.now();
    const carried = carryInsights(saved, previous, fresh);
    const elapsed = performance.now() - started;
    const freshKeys = new Set(fresh.map(paperKey));
    expect(carried.annotations.every((r) => freshKeys.has(r.key))).toBe(true);
    expect(carried.annualCitations.every((r) => freshKeys.has(r.key))).toBe(true);
    // About half a second here, like the title matching of the notes. The bound only has to tell
    // that from a quadratic blow-up (minutes), so it survives a machine that is busy with other work.
    expect(elapsed).toBeLessThan(30_000);
  }, 120_000);
});
