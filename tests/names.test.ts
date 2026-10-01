import { describe, expect, it } from 'vitest';
import { foldText, nameKeys, nameMatch, nameVariants, sameFamily } from '../src/core/names';

describe('foldText', () => {
  it('lowercases and folds diacritics and letters that do not decompose', () => {
    expect(foldText('Łukasz Nowak')).toBe('lukasz nowak');
    expect(foldText('Bjørn Dæhlen')).toBe('bjorn daehlen');
    expect(foldText('Straße')).toBe('strasse');
    expect(foldText('İstanbul')).toBe('istanbul');
    expect(foldText('José Ángel Núñez')).toBe('jose angel nunez');
    expect(foldText('  Müller   Ünal ')).toBe('muller unal');
  });
});

describe('nameMatch', () => {
  it.each([
    ['Nicholas G Reich', 'Nicholas G. Reich'],
    ['Reich, Nicholas G', 'Nicholas G Reich'],
    ['NICHOLAS G REICH', 'Nicholas G Reich'],
    ['Łukasz Nowak', 'Lukasz Nowak'],
    ['Bjørn Dæhlen', 'Bjorn Daehlen'],
    ['José Ángel Núñez', 'Jose Angel Nunez'],
    ['Meyer, Jr., Austin G.', 'Austin G Meyer Jr'],
    ["Conor O'Brien", 'Conor OBrien'],
    ['Austin G Meyer', 'Austin G Meyer'],
    ['Madonna', 'madonna'],
  ])('treats %s and %s as the same spelling', (a, b) => {
    expect(nameMatch(a, b)).toBe('exact');
    expect(nameMatch(b, a)).toBe('exact');
  });

  it.each([
    ['Reich NG', 'Nicholas G Reich'],
    ['Piwowar HA', 'Heather A Piwowar'],
    ['AG Meyer', 'Austin G Meyer'],
    ['A. G. Meyer', 'Austin G Meyer'],
    ['Meyer, A.G.', 'Austin G Meyer'],
    ['Meyer A', 'Austin G Meyer'],
    ['Austin Meyer', 'Austin G Meyer'],
    ['Jan van der Berg', 'J Berg'],
    ['van der Berg J', 'Jan van der Berg'],
    ['de la Cruz M', 'Maria de la Cruz'],
    ['Jean-Philippe Crouzé', 'Crouze JP'],
    ['Jean-Philippe Crouzé', 'J-P Crouze'],
    ['Smith J', 'Smith JA'],
    ['Li Y', 'Yan Li'],
    ['Austin G. Meyer Jr.', 'Austin G Meyer'],
    ['PIWOWAR HA', 'Heather A Piwowar'],
    ['Ma G', 'Guang Ma'],
  ])('treats %s and %s as compatible (initials or omitted middle names)', (a, b) => {
    expect(nameMatch(a, b)).toBe('compatible');
    expect(nameMatch(b, a)).toBe('compatible');
  });

  it.each([
    ['JOHN SCHOLAR', 'Jane Scholar'],
    ['JILL SCHOLAR', 'Jane Scholar'],
    ['Anna Jones', 'Anna Smith-Jones'],
    ['Reich NG', 'Reich NB'],
    ['Smith J', 'Smith K'],
    ['Ma G', 'Meyer AG'],
    ['John Smith Jr', 'John Smith Sr'],
    ['Maria Anna Jones', 'Anna Jones'],
    ['Madonna', 'Cher'],
    ['Meyer', 'Austin Meyer'],
  ])('does not match %s with %s', (a, b) => {
    expect(nameMatch(a, b)).toBeNull();
    expect(nameMatch(b, a)).toBeNull();
  });
});

describe('sameFamily', () => {
  it('compares surnames across name orders and ignores given names', () => {
    expect(sameFamily('Reich NG', 'Nicholas G Reich')).toBe(true);
    expect(sameFamily('Meyer', 'Austin G Meyer')).toBe(true);
    expect(sameFamily('Jan van der Berg', 'Berg J')).toBe(true);
    expect(sameFamily('Ma G', 'Meyer AG')).toBe(false);
  });
});

describe('nameKeys', () => {
  it('gives family:initial keys for every plausible reading of a name', () => {
    expect(nameKeys('Nicholas G Reich')).toEqual(['reich:n']);
    expect(nameKeys('Reich, Nicholas G')).toEqual(['reich:n']);
    expect(nameKeys('AG Meyer')).toEqual(['meyer:a']);
    expect(nameKeys('Jan van der Berg')).toEqual(['berg:j']);
    expect(nameKeys('José Núñez')).toEqual(['nunez:j']);
    expect(nameKeys('Madonna')).toEqual(['madonna']);
    expect(nameKeys('Reich NG')).toContain('reich:n');
  });

  it('lets a Vancouver byline and a full name share a key', () => {
    const shared = nameKeys('Reich NG').filter((key) => nameKeys('Nicholas G Reich').includes(key));
    expect(shared).toEqual(['reich:n']);
  });
});

describe('nameVariants', () => {
  it('keeps the given-first spellings used by the biomedical indexes', () => {
    expect(nameVariants('Jane Scholar')).toEqual(['Jane Scholar', 'Scholar Jane', 'Scholar J']);
    expect(nameVariants('Austin G Meyer')).toEqual([
      'Austin G Meyer',
      'Meyer Austin G',
      'Meyer AG',
    ]);
    expect(nameVariants('J Scholar')).toEqual(['J Scholar', 'Scholar J']);
    expect(nameVariants('Jan van der Berg')).toEqual([
      'Jan van der Berg',
      'van der Berg Jan',
      'van der Berg J',
    ]);
    expect(nameVariants('José Núñez')).toEqual(['José Núñez', 'Núñez José', 'Núñez J']);
  });

  it('builds sensible variants from surname-first input instead of mangling it', () => {
    expect(nameVariants('Meyer, Austin G')).toEqual([
      'Meyer, Austin G',
      'Meyer Austin G',
      'Meyer AG',
    ]);
    expect(nameVariants('Reich NG')).toEqual(['Reich NG']);
    expect(nameVariants('Madonna')).toEqual(['Madonna']);
  });
});

describe('degenerate input', () => {
  it('never throws and never matches empty or punctuation-only names', () => {
    for (const odd of ['', '   ', '.', ',', '-', 'Jr', '.,;']) {
      expect(() => nameMatch(odd, 'Austin G Meyer')).not.toThrow();
      expect(nameMatch(odd, 'Austin G Meyer')).toBeNull();
      expect(nameKeys(odd).length).toBeLessThanOrEqual(1);
      expect(nameVariants(odd)).toEqual([odd.trim()]);
      expect(sameFamily(odd, 'Austin G Meyer')).toBe(false);
    }
  });

  it('recognises one author spelled four ways in a real-world mix of provider bylines', () => {
    const bylines = [
      'Nicholas G Reich',
      'Nicholas G. Reich',
      'Reich NG',
      'Reich, Nicholas G',
      'N. G. Reich',
    ];
    for (const a of bylines) for (const b of bylines) expect(nameMatch(a, b)).not.toBeNull();
    expect(nameMatch('Nicholas G Reich', 'Reich NB')).toBeNull();
  });
});

describe('spellings seen in real provider data', () => {
  it.each([
    // Unicode hyphens (U+2010) are common in Wiley/PNAS bylines
    ['Yanli Zhang‐James', 'Yanli Zhang-James', 'exact'],
    ['Qi‐Jun Hong', 'Qi-Jun Hong', 'exact'],
    ['Li–Ming Wu', 'Li-Ming Wu', 'exact'],
    // hyphenated given names written joined, or spaced
    ['Yi-An Ma', 'Yian Ma', 'compatible'],
    ['Yi An Ma', 'Yi-An Ma', 'exact'],
    ['Y-A Ma', 'Yian Ma', 'compatible'],
    // compound surnames written with a hyphen, a space, or as Vancouver initials
    ['David Nze Ndong', 'Nze-Ndong D', 'compatible'],
    ['David Nze Ndong', 'David Nze-Ndong', 'exact'],
    ['Anna Smith Jones', 'Anna Smith-Jones', 'exact'],
    ['Zhang-James Y', 'Yanli Zhang-James', 'compatible'],
    // middle initials with and without periods
    ['Jeffrey L. Shaman', 'Shaman JL', 'compatible'],
    ['T. Alex Perkins', 'Perkins TA', 'compatible'],
  ])('%s vs %s -> %s', (a, b, expected) => {
    expect(nameMatch(a, b)).toBe(expected);
    expect(nameMatch(b, a)).toBe(expected);
  });

  it('still keeps different compound surnames apart', () => {
    expect(nameMatch('Anna Jones', 'Anna Smith-Jones')).toBeNull();
    expect(nameMatch('Anna Smith', 'Anna Smith-Jones')).toBeNull();
    expect(nameMatch('Yi-An Ma', 'Yu Ma')).toBeNull();
  });

  it('folds Unicode dashes in plain text too', () => {
    expect(foldText('Beta‐Lactamase – review')).toBe('beta-lactamase - review');
  });
});

describe('surname particles', () => {
  it('reads a particle-only prefix as part of a lone surname', () => {
    expect(nameKeys('van der Berg')).toEqual(['berg']);
    expect(nameVariants('van der Berg')).toEqual(['van der Berg']);
    expect(nameMatch('van der Berg', 'van der Berg')).toBe('exact');
    expect(sameFamily('van der Berg', 'Jan van der Berg')).toBe(true);
    expect(nameMatch('van der Berg', 'Jan van der Berg')).toBeNull();
    expect(nameKeys('de la Cruz')).toEqual(['cruz']);
  });

  it('does not mistake short given names or middle initials for particles', () => {
    expect(nameVariants('Di Wang')).toEqual(['Di Wang', 'Wang Di', 'Wang D']);
    expect(nameVariants('Wei Y Zhang')).toEqual(['Wei Y Zhang', 'Zhang Wei Y', 'Zhang WY']);
    expect(nameMatch('Di Wang', 'D Wang')).toBe('compatible');
    expect(nameMatch('Le Wang', 'Wang L')).toBe('compatible');
    expect(nameKeys('Al Green')).toEqual(['green:a']);
  });
});
