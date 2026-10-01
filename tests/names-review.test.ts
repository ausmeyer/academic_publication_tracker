import { describe, expect, it } from 'vitest';
import { nameKeys, nameMatch, nameVariants } from '../src/core/names';

describe('given names that are also surname particles', () => {
  it.each([
    ['Bin Wang', 'Wang, Bin'],
    ['Bin Wang', 'Wang B'],
    ['Bin Wang', 'B. Wang'],
    ['Van Nguyen', 'Nguyen, Van'],
    ['Van Nguyen', 'Nguyen V'],
  ])('%s matches %s', (a, b) => {
    expect(nameMatch(a, b)).not.toBeNull();
    expect(nameMatch(b, a)).not.toBeNull();
  });

  it.each([
    ['Bin Wang', 'Xiaoming Wang'],
    ['Bin Wang', 'Wei Wang'],
    ['Van Nguyen', 'Thi Nguyen'],
  ])('%s is not %s', (a, b) => {
    expect(nameMatch(a, b)).toBeNull();
  });

  it('reads a capitalised Bin or Van as a given name, and sends surname-first variants', () => {
    expect(nameKeys('Bin Wang')).toEqual(['wang:b']);
    expect(nameVariants('Bin Wang')).toContain('Wang B');
    expect(nameVariants('Van Nguyen')).toContain('Nguyen V');
  });

  it('keeps a lower-case particle with the surname when no given name is typed', () => {
    expect(nameKeys('van Gogh')).toEqual(['gogh']);
    expect(nameKeys('bin Abdullah')).toEqual(['abdullah']);
    expect(nameKeys('van der Berg')).toEqual(['berg']);
    expect(nameKeys('Von Neumann')).toEqual(['neumann']);
    expect(nameKeys('Van Der Berg')).toEqual(['berg']);
  });
});

describe('Russian-style patronymic initials are not generational suffixes', () => {
  it.each([
    ['Ivan V. Ivanov', 'Ivanov IV'],
    ['Ivan V. Ivanov', 'Ivanov, I.V.'],
    ['Ivan I. Petrov', 'Petrov II'],
    ['John R. Smith', 'Smith JR'],
    ['John R. Smith', 'Smith, J.R.'],
    ['Stephen R. Jones', 'Jones SR'],
  ])('%s matches %s', (a, b) => {
    expect(nameMatch(a, b)).not.toBeNull();
    expect(nameMatch(b, a)).not.toBeNull();
  });

  it('still reads a suffix that follows a given name and surname', () => {
    expect(nameMatch('John Smith Jr', 'John Smith')).toBe('compatible');
    expect(nameMatch('John Smith III', 'John Smith')).toBe('compatible');
    expect(nameMatch('Smith, John, III', 'John Smith III')).toBe('exact');
    expect(nameMatch('John Smith Jr', 'John Smith III')).toBeNull();
    expect(nameMatch('Smith Jr, John', 'John Smith')).not.toBeNull();
  });
});

describe('hyphenated given names are one name', () => {
  it.each([
    ['Yi-An Chen', 'Yi Chen'],
    ['Marie-Claude Dupont', 'Marie Dupont'],
    ['Jean-Pierre Martin', 'Jean Martin'],
  ])('%s is not %s', (a, b) => {
    expect(nameMatch(a, b)).toBeNull();
    expect(nameMatch(b, a)).toBeNull();
  });

  it.each([
    ['Yi-An Chen', 'Y.-A. Chen'],
    ['Yi-An Chen', 'Yian Chen'],
    ['Yi-An Chen', 'Chen YA'],
    ['Yi-An Chen', 'Chen Y'],
    ['Yi-An Chen', 'Chen, Yi-An'],
    ['Jean-Pierre Martin', 'J-P Martin'],
    ['Jean-Pierre Martin', 'Martin JP'],
  ])('%s matches %s', (a, b) => {
    expect(nameMatch(a, b)).not.toBeNull();
    expect(nameMatch(b, a)).not.toBeNull();
  });

  it('still allows a middle name to be left out', () => {
    expect(nameMatch('Nicholas G Reich', 'Nicholas Reich')).toBe('compatible');
    expect(nameMatch('Marie Claude Dupont', 'Marie Dupont')).toBe('compatible');
  });
});

describe('other naming conventions', () => {
  it.each([
    ['WANG Wei', 'Wei Wang'],
    ['MÜLLER Hans', 'Hans Müller'],
    ['Hans-Peter Müller', 'H.-P. Mueller'],
    ['Jürgen Schröder', 'Juergen Schroeder'],
    ['Müller, Hans', 'Mueller H'],
    ['María José García López', 'García MJ'],
    ['María José García López', 'García López, María José'],
    ['Ana María Pérez Gómez', 'Pérez AM'],
    ['Jan van der Berg', 'Berg J'],
  ])('%s matches %s', (a, b) => {
    expect(nameMatch(a, b)).not.toBeNull();
    expect(nameMatch(b, a)).not.toBeNull();
  });

  it.each([
    ['Hans Müller', 'Hans Miller'],
    ['Wei Wang', 'Wei Li'],
    ['Nicholas G Reich', 'Reich AG'],
  ])('%s is not %s', (a, b) => {
    expect(nameMatch(a, b)).toBeNull();
  });

  it('gives the first-surname reading of a Spanish name a key of its own', () => {
    expect(nameKeys('María José García López')).toEqual(
      expect.arrayContaining(['lopez:m', 'garcialopez:m', 'garcia:m']),
    );
  });

  it('keeps transliterated and plain spellings of one surname in the same duplicate key', () => {
    const umlaut = nameKeys('Hans Müller');
    const plain = nameKeys('Hans Mueller');
    expect(umlaut.some((key) => plain.includes(key))).toBe(true);
  });
});
