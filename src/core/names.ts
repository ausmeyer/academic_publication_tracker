/**
 * Personal-name parsing and matching shared by duplicate detection, author-role analysis and
 * provider queries. Sources disagree on order and form ("Nicholas G Reich", "Reich, Nicholas G",
 * "Reich NG", "NG Reich"), so every comparison goes through this one tolerant parser.
 */

export type NameMatch = 'exact' | 'compatible';

interface Token {
  /** Spelling as supplied (diacritics kept, periods removed). */
  text: string;
  /** Folded form used for comparison. */
  key: string;
  /** Folded form with German umlauts written out ("Müller" is "mueller"), for spellings like "Mueller". */
  alt: string;
  /** True when the token stands for a longer given name. */
  initial: boolean;
  /** The second or later part of a hyphenated given name ("An" in "Yi-An"); it cannot be left out. */
  bound?: boolean;
}
interface ParsedName {
  family: Token[];
  given: Token[];
  suffix: string;
  /** Drops a second surname ("María José García López" read as García): stands for any such name. */
  partial?: boolean;
  /** Read from four or more words, so a surname may have been left out or added. */
  long?: boolean;
}

const SPECIAL_LETTERS: Record<string, string> = {
  ß: 'ss',
  æ: 'ae',
  œ: 'oe',
  ø: 'o',
  ł: 'l',
  đ: 'd',
  ð: 'd',
  þ: 'th',
  ı: 'i',
};
// Hyphen, non-breaking hyphen, figure/en/em dash, minus and their small/fullwidth forms.
const DASHES = /[\u2010-\u2015\u2212\ufe58\ufe63\uff0d]/g;
const SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv']);
const PARTICLES = new Set([
  'van',
  'von',
  'der',
  'den',
  'de',
  'del',
  'della',
  'di',
  'da',
  'do',
  'dos',
  'das',
  'du',
  'la',
  'le',
  'les',
  'el',
  'al',
  'bin',
  'ibn',
  'ben',
  'ter',
  'ten',
  'st',
  'san',
  'af',
  'av',
  'zu',
  'zur',
  'op',
  'ap',
]);

// Particles that are never a given name; "Di Wang" and "Le Wang" keep "Di"/"Le" as given names.
const SURE_PARTICLES = new Set([
  'von',
  'der',
  'den',
  'del',
  'della',
  'dos',
  'ter',
  'ten',
  'zu',
  'zur',
  'af',
  'av',
  'ibn',
]);
// Also given names ("Bin Wang", "Van Nguyen"): a particle only when written in lower case.
const AMBIGUOUS_PARTICLES = new Set(['van', 'bin', 'das']);

/** Lowercase, drop diacritics and fold letters that do not decompose (ø, æ, ł, ß, ı …). */
export function foldText(value: string): string {
  return value
    .replace(/[\u00b4\u02bc\u2019\u2032`]/g, "'") // before NFKD, which turns ´ into a space
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .replace(DASHES, '-')
    .toLowerCase()
    .replace(/[ßæœøłđðþı]/g, (letter) => SPECIAL_LETTERS[letter])
    .replace(/\s+/g, ' ')
    .trim();
}

const GERMAN_DIGRAPHS: Record<string, string> = {
  ä: 'ae',
  ö: 'oe',
  ü: 'ue',
  Ä: 'Ae',
  Ö: 'Oe',
  Ü: 'Ue',
};
const APOSTROPHES = /['’`´]/g;
const tokenKey = (text: string) => foldText(text).replace(APOSTROPHES, '');
const tokenAlt = (text: string) =>
  foldText(text.normalize('NFC').replace(/[äöüÄÖÜ]/g, (letter) => GERMAN_DIGRAPHS[letter])).replace(
    APOSTROPHES,
    '',
  );
const token = (text: string, initial = false, bound = false): Token => ({
  text,
  key: tokenKey(text),
  alt: tokenAlt(text),
  initial,
  ...(bound ? { bound } : {}),
});
/** "AG" is two initials; "J-P" is two initials of one hyphenated name, so the second is bound. */
const initialTokens = (word: string) =>
  word
    .split('-')
    .flatMap((part, p) => [...part].map((letter, l) => token(letter, true, p > 0 && l === 0)));

/** Given-name words: "AG" and "J-P" are runs of initials; "JOHN" (4+) and "John" are names. */
function givenTokens(words: string[], allCaps: boolean): Token[] {
  const out: Token[] = [];
  for (const word of words) {
    const parts = word.split('-');
    parts.forEach((part, index) => {
      if (!part) return;
      const initials = /^\p{Lu}{2,3}$/u.test(part) && !(allCaps && part.length > 2);
      const made = initials ? initialTokens(part) : [token(part, [...part].length === 1)];
      // Only a part that follows a hyphen is bound to the part before it.
      if (index > 0) made[0] = { ...made[0], bound: true };
      out.push(...made);
    });
  }
  return out;
}

/**
 * Splits off "Jr", "Sr", "II", "III" and "IV". In capitals, "IV" and "JR" are also the initials of a
 * patronymic ("Ivanov IV", "Smith JR"), so they are a suffix only after a given name and a surname.
 */
function splitSuffix(value: string): { text: string; suffix: string } {
  const segments = value
    .split(',')
    .map((segment) => segment.trim())
    .filter(Boolean);
  const suffixOf = (word: string, afterGivenName: boolean) => {
    const lower = word.replace(/\.$/, '').toLowerCase();
    if (!SUFFIXES.has(lower)) return '';
    return /^\p{Lu}+$/u.test(word) && !afterGivenName ? '' : lower;
  };
  let suffix = '';
  if (segments.length >= 3) {
    // "Meyer, Jr., Austin G.": the suffix sits between the surname and the given names.
    const at = segments.findIndex((segment, index) => index > 0 && suffixOf(segment, true));
    if (at > 0) suffix = suffixOf(segments.splice(at, 1)[0], true);
  }
  if (!suffix && segments.length >= 2) {
    // "Smith, John, III" and "John Smith, Jr": a segment of its own.
    suffix = suffixOf(
      segments[segments.length - 1],
      segments.length >= 3 || segments[0].includes(' '),
    );
    if (suffix) segments.pop();
    else if (segments.length === 2) {
      // "Smith Jr, John": the suffix follows the surname.
      const words = segments[0].split(' ');
      suffix = words.length > 1 ? suffixOf(words[words.length - 1], true) : '';
      if (suffix) segments[0] = words.slice(0, -1).join(' ');
    }
  }
  if (!suffix && segments.length) {
    const words = segments[segments.length - 1].split(' ');
    suffix =
      words.length > 1
        ? suffixOf(words[words.length - 1], words.length >= 3 || segments.length >= 2)
        : '';
    if (suffix) segments[segments.length - 1] = words.slice(0, -1).join(' ');
  }
  return { text: segments.join(', '), suffix };
}

function parse(raw: string): ParsedName[] {
  const { text, suffix } = splitSuffix(raw.replace(DASHES, '-').replace(/\s+/g, ' ').trim());
  const cleaned = text.replace(/\./g, '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return [];
  const letters = cleaned.replace(/[^\p{L}]/gu, '');
  const allCaps =
    letters.length >= 4 && letters === letters.toUpperCase() && letters !== letters.toLowerCase();
  const segments = cleaned
    .split(',')
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (!segments.length) return [];
  if (segments.length >= 2) {
    return [
      {
        family: segments[0].split(' ').map((word) => token(word)),
        given: givenTokens(segments.slice(1).join(' ').split(' '), allCaps),
        suffix,
      },
    ];
  }
  const words = segments[0].split(' ');
  // "van der Berg" alone is a surname with particles, not a given name "van" plus "der Berg".
  // "Bin Wang" and "Van Nguyen" are a given name and a surname: those words are particles only in
  // lower case ("van Gogh", "bin Abdullah").
  const prefix = words.slice(0, -1).map((word) => foldText(word));
  const lowerCase = words[0] === words[0].toLowerCase();
  if (
    words.length === 1 ||
    (prefix.every((word) => PARTICLES.has(word)) &&
      (prefix.length > 1 ||
        SURE_PARTICLES.has(prefix[0]) ||
        (AMBIGUOUS_PARTICLES.has(prefix[0]) && lowerCase)))
  )
    return [{ family: words.map((word) => token(word)), given: [], suffix }];
  const result: ParsedName[] = [];
  const last = words[words.length - 1];
  // "Reich NG": trailing initials make the leading words the surname (PubMed / Europe PMC style).
  if (/^\p{Lu}(?:-?\p{Lu}){0,2}$/u.test(last))
    result.push({
      family: words.slice(0, -1).map((word) => token(word)),
      given: initialTokens(last),
      suffix,
    });
  // "Given [Middle] Family", keeping surname particles ("van der Berg") with the surname.
  let cut = words.length - 1;
  while (cut > 1 && PARTICLES.has(foldText(words[cut - 1]))) cut--;
  result.push({
    family: words.slice(cut).map((word) => token(word)),
    given: givenTokens(words.slice(0, cut), allCaps),
    suffix,
  });
  // "David Nze Ndong" may be a compound surname ("Nze-Ndong"): also read the last two words as one.
  const before = cut - 1;
  if (
    words.length >= 3 &&
    before >= 1 &&
    !PARTICLES.has(foldText(words[before])) &&
    !/^\p{Lu}{1,3}$/u.test(words[before])
  )
    result.push({
      family: words.slice(before).map((word) => token(word)),
      given: givenTokens(words.slice(0, before), allCaps),
      suffix,
    });
  // "WANG Wei": a word in capitals among other words is the surname, wherever it stands.
  const capitals = words.filter((word) => /^\p{Lu}[\p{Lu}-]{2,}$/u.test(word));
  if (!allCaps && capitals.length === 1)
    result.push({
      family: [token(capitals[0])],
      given: givenTokens(
        words.filter((word) => word !== capitals[0]),
        allCaps,
      ),
      suffix,
    });
  // "María José García López": Spanish names carry two surnames, and indexes often keep the first.
  const first = words.length - 2;
  if (
    words.length >= 4 &&
    cut === words.length - 1 &&
    !PARTICLES.has(foldText(words[first])) &&
    !words.slice(0, first).some((word) => PARTICLES.has(foldText(word))) &&
    !/^\p{Lu}{1,3}$/u.test(words[first]) &&
    !/^\p{Lu}{1,3}$/u.test(last)
  )
    result.push({
      family: [token(words[first])],
      given: givenTokens(words.slice(0, first), allCaps),
      suffix,
      partial: true,
    });
  if (words.length >= 4) for (const reading of result) reading.long = true;
  return result;
}

const cache = new Map<string, ParsedName[]>();
function candidates(raw: string): ParsedName[] {
  let parsed = cache.get(raw);
  if (!parsed) {
    if (cache.size > 50_000) cache.clear();
    parsed = parse(raw);
    cache.set(raw, parsed);
  }
  return parsed;
}

type Spelling = 'key' | 'alt';
const joinKeys = (tokens: Token[], spelling: Spelling = 'key') =>
  tokens.map((part) => part[spelling].replace(/-/g, '')).join('');
/** Surname used for matching: hyphen/space insensitive, ignoring particles ("van der Berg" ~ "Berg"). */
const familyKey = (name: ParsedName, spelling: Spelling = 'key') =>
  joinKeys(
    name.family.filter((part, i, all) => i === all.length - 1 || !PARTICLES.has(part.key)),
    spelling,
  );
const canonical = (name: ParsedName) =>
  `${name.given.map((part) => part.key).join(' ')}|${joinKeys(name.family)}`;
const sameGiven = (a: Token, b: Token) =>
  a.key === b.key ||
  a.alt === b.alt ||
  (a.key.length === 1 && b.key.startsWith(a.key)) ||
  (b.key.length === 1 && a.key.startsWith(b.key));

/** Given names in order; omitted middle names are fine and "Yi-An" may be written "Yian". */
function givenCompatible(a: Token[], b: Token[]): boolean {
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (sameGiven(a[i], b[j])) {
      i++;
      j++;
    } else if (i + 1 < a.length && a[i].key + a[i + 1].key === b[j].key) {
      i += 2;
      j++;
    } else if (j + 1 < b.length && b[j].key + b[j + 1].key === a[i].key) {
      i++;
      j += 2;
    } else return false;
  }
  // One list ended first: what is left of the other is an omitted middle name, except the second half
  // of a hyphenated name that was written out in full on both sides ("Yi" is not "Yi-An"; "Y" is).
  const rest = i < a.length ? a.slice(i) : b.slice(j);
  const last = i < a.length ? b[b.length - 1] : a[a.length - 1];
  return !(rest[0]?.bound && !rest[0].initial && last && !last.initial);
}

function compare(a: ParsedName, b: ParsedName): NameMatch | null {
  // A reading that dropped a surname could be any name that dropped one: it is compared only with
  // names that cannot have left one out, and it is never an exact match.
  if ((a.partial && b.long) || (b.partial && a.long)) return null;
  if (familyKey(a) !== familyKey(b) && familyKey(a, 'alt') !== familyKey(b, 'alt')) return null;
  if (a.suffix && b.suffix && a.suffix !== b.suffix) return null;
  if ((a.given.length === 0) !== (b.given.length === 0)) return null;
  if (!givenCompatible(a.given, b.given)) return null;
  const same = canonical(a) === canonical(b);
  return same && !a.partial && !b.partial && Boolean(a.suffix) === Boolean(b.suffix)
    ? 'exact'
    : 'compatible';
}

/**
 * Compares two personal names regardless of order or form. Given names are compared in order;
 * initials match the names they abbreviate and omitted middle names are allowed. Returns 'exact'
 * for the same spelling (after folding) and 'compatible' when identity needs a human check.
 */
export function nameMatch(a: string, b: string): NameMatch | null {
  let best: NameMatch | null = null;
  for (const left of candidates(a))
    for (const right of candidates(b)) {
      const match = compare(left, right);
      if (match === 'exact') return 'exact';
      if (match) best = 'compatible';
    }
  return best;
}

/** True when any reading of the two names shares a surname (given names are ignored). */
export function sameFamily(a: string, b: string): boolean {
  return candidates(a).some((left) =>
    candidates(b).some(
      (right) =>
        familyKey(left) === familyKey(right) || familyKey(left, 'alt') === familyKey(right, 'alt'),
    ),
  );
}

/** True for a word that begins a surname as a particle ("van", "de", "bin"), in any capitalisation. */
export const isParticle = (word: string): boolean => PARTICLES.has(foldText(word));

/** True when a reading of `name` has exactly these words as its surname, particles included. */
export function hasSurname(name: string, surname: string): boolean {
  const wanted = surname
    .trim()
    .split(/\s+/)
    .map((word) => token(word));
  return candidates(name).some(
    (reading) =>
      joinKeys(reading.family) === joinKeys(wanted) ||
      joinKeys(reading.family, 'alt') === joinKeys(wanted, 'alt'),
  );
}

/**
 * "Wang Xiaoming": a name typed surname-first. True when `candidate` has that surname and the same
 * given names, however the syllables are spaced or hyphenated; typed given names are never taken to
 * be longer than typed, so initials in the candidate do not match a full name.
 */
export function surnameFirstMatch(typed: string, candidate: string): boolean {
  const [family, ...given] = typed.replace(DASHES, '-').replace(/\./g, '').trim().split(/\s+/);
  if (!family || !given.length) return false;
  const wantedFamily = [token(family)];
  const wantedGiven = givenTokens(given, false);
  return candidates(candidate).some((reading) =>
    (['key', 'alt'] as const).some(
      (spelling) =>
        familyKey(reading, spelling) === joinKeys(wantedFamily, spelling) &&
        joinKeys(reading.given, spelling) === joinKeys(wantedGiven, spelling),
    ),
  );
}

/** Duplicate-detection keys ("surname:first initial") for every plausible reading of a name. */
export function nameKeys(raw: string): string[] {
  return [
    ...new Set(
      candidates(raw).flatMap((name) =>
        (['key', 'alt'] as const).map((spelling) => {
          const initial = name.given[0]?.[spelling][0];
          return initial ? `${familyKey(name, spelling)}:${initial}` : familyKey(name, spelling);
        }),
      ),
    ),
  ];
}

/** Spellings to send to biomedical indexes: as typed, surname + given names, surname + initials. */
export function nameVariants(raw: string): string[] {
  const typed = raw.trim();
  const [name] = candidates(raw);
  if (!name || !name.given.length) return [typed];
  const family = name.family.map((part) => part.text).join(' ');
  const variants = [typed];
  if (!name.given.every((part) => part.initial))
    variants.push(`${family} ${name.given.map((part) => part.text).join(' ')}`);
  variants.push(`${family} ${name.given.map((part) => [...part.text][0].toUpperCase()).join('')}`);
  return [...new Set(variants)];
}
