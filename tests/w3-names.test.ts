import { describe, expect, it } from 'vitest';
import { analyzeInsights } from '../src/core/insights';
import { nameMatch } from '../src/core/names';
import { settings, work } from './insights-helpers';

const classify = (byline: string[], author: string, aliases: string[] = []) =>
  analyzeInsights([work('x', { authors: byline })], settings({ author, aliases }), 'all').rows[0];
/** How many bylines nameMatch accepts for the author or any alias. */
const expected = (byline: string[], author: string, aliases: string[]) =>
  author.trim()
    ? byline.filter((name) =>
        [author, ...aliases].some((target) => target.trim() && nameMatch(name, target)),
      ).length
    : 0;

describe('author-name matching of surnames with particles inside them', () => {
  it.each([
    ['Maria Garcia de la Cruz', 'Garcia de la Cruz, Maria'],
    ['Maria Garcia de la Cruz', 'Garcia de la Cruz M'],
    ['Garcia de la Cruz, Maria', 'Garcia de la Cruz, Maria'],
    ['João Paulo Mendes da Silva', 'Mendes da Silva JP'],
    ['João Paulo Mendes da Silva', 'Mendes da Silva, João Paulo'],
    ['Ana Silva dos Santos', 'Silva dos Santos, Ana'],
    ['Maria Garcia de la Cruz', 'Garcia Cruz, Maria'],
    ['Maria Garcia de la Cruz', 'Garcia-Cruz, Maria'],
    ['Maria Garcia de la Cruz', 'Maria Garcia-Cruz'],
  ])('finds the byline %s for the author %s', (byline, author) => {
    expect(nameMatch(byline, author)).not.toBeNull();
    const row = classify([byline, 'Alex Other'], author);
    expect([row.matches, row.role]).toEqual([1, 'first']);
  });

  it('finds a byline written with an umlaut for an author typed without it', () => {
    expect(nameMatch('Hans Müller', 'Hans Mueller')).not.toBeNull();
    expect(classify(['Hans Müller', 'Alex Other'], 'Hans Mueller').role).toBe('first');
    expect(classify(['Alex Other', 'Müller H'], 'Hans Mueller', ['Mueller, H']).role).toBe('last');
  });

  it('still leaves other people with a similar surname unmatched', () => {
    expect(classify(['Maria Garcia', 'Alex Other'], 'Garcia de la Cruz, Maria').role).toBe(
      'unclassified',
    );
    expect(classify(['Maria Cruz', 'Alex Other'], 'Garcia de la Cruz, Maria').role).toBe(
      'unclassified',
    );
  });
});

describe('author-name matching against the shared name matcher, with compound surnames', () => {
  let seed = 11;
  const random = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
  const pick = <T>(values: T[]) => values[Math.floor(random() * values.length)];
  const givens = ['Maria', 'João Paulo', 'Ana', 'Jose Luis', 'Carmen', 'Hans', 'Yi-An', 'J', 'AG'];
  const first = ['Garcia', 'Mendes', 'Silva', 'Fernandez', 'Müller', 'Mueller', "O'Brien", 'Nze'];
  const particles = ['de', 'da', 'dos', 'del', 'de la', 'van der', 'y', 'von', 'bin'];
  const last = ['Cruz', 'Silva', 'Santos', 'Castro', 'Berg', 'Ndong', 'Schmidt', 'Smith-Jones'];
  /** Surnames as sources print them: plain, with a particle inside, hyphenated or shortened. */
  const surname = () => {
    const [a, b] = [pick(first), pick(last)];
    return pick([
      a,
      b,
      `${a} ${pick(particles)} ${b}`,
      `${a}-${b}`,
      `${a} ${b}`,
      `${pick(particles)} ${b}`,
    ]);
  };
  const initials = (given: string) =>
    given
      .split(/[\s-]+/)
      .map((part) => (/^\p{Lu}+$/u.test(part) ? part : part[0]))
      .join('');
  const render = (given: string, family: string) =>
    pick([
      `${given} ${family}`,
      `${family}, ${given}`,
      `${family} ${initials(given)}`,
      `${initials(given)} ${family}`,
      `${given} ${family}`.toUpperCase(),
      `${family}, ${[...initials(given)].map((c) => `${c}.`).join(' ')}`,
      `${given} ${family} Jr.`,
    ]);

  it('finds exactly the bylines that nameMatch accepts', () => {
    let accepted = 0;
    for (let trial = 0; trial < 6000; trial++) {
      const family = surname();
      const given = pick(givens);
      // Mostly the same person written another way, sometimes someone else.
      const author = render(
        random() < 0.8 ? given : pick(givens),
        random() < 0.7 ? family : surname(),
      );
      const aliases = random() < 0.2 ? [render(given, surname())] : [];
      const byline = [render(given, family), 'Alex Other'];
      const count = expected(byline, author, aliases);
      if (count) accepted++;
      const row = classify(byline, author, aliases);
      expect(row.matches, JSON.stringify({ byline, author, aliases })).toBe(count);
    }
    // The generator must produce plenty of matches, or the comparison proves nothing.
    expect(accepted).toBeGreaterThan(1500);
  });
});
