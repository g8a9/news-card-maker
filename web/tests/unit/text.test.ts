import { describe, expect, it } from 'vitest';
import {
  cleanText,
  decodeEntities,
  fold,
  formatAuthors,
  isInstitutionalAuthor,
  isJunkSection,
  isLegalEntityName,
  mostlyRtl,
  splitAuthors,
  stripTags,
  stripTitleSuffix,
  tokenOverlap,
  tokens,
  truncate,
} from '../../src/core/text.ts';

describe('decodeEntities', () => {
  it.each([
    ['Citt&#233;', 'Città'.replace('à', 'é')],
    ['one&#44; two', 'one, two'],
    ['caf&eacute; &amp; bar', 'café & bar'],
    ['&#x27;quoted&#x27;', "'quoted'"],
    ['&lt;b&gt;', '<b>'],
    ['plain text', 'plain text'],
    ['AT&T and R&D', 'AT&T and R&D'],
  ])('decodes %s', (input, expected) => {
    expect(decodeEntities(input)).toBe(expected);
  });

  it('decodes a second time for double-encoded text', () => {
    expect(decodeEntities('Tom &amp;amp; Jerry')).toBe('Tom & Jerry');
    expect(decodeEntities('one&amp;#44; two')).toBe('one, two');
  });

  it('never builds markup from text that looks like tags', () => {
    expect(decodeEntities('a </textarea><img src=x onerror=alert(1)> &amp; b')).toBe(
      'a </textarea><img src=x onerror=alert(1)> & b',
    );
  });
});

describe('cleanText', () => {
  it('normalises to NFC, drops zero-width characters and soft hyphens, collapses whitespace', () => {
    expect(cleanText('  Café​   in­side \n the\tbox  ')).toBe('Café inside the box');
  });

  it('turns non-breaking spaces into spaces and keeps quote styles as written', () => {
    expect(cleanText("“Smart” quotes and 'straight' ones")).toBe(
      "“Smart” quotes and 'straight' ones",
    );
  });

  it('strips tags from loose text', () => {
    expect(stripTags('<p>Hello <b>world</b> &amp; friends</p>')).toBe('Hello world & friends');
  });

  it('truncates on a word boundary with an ellipsis', () => {
    expect(truncate('one two three four five six seven', 20)).toBe('one two three four…');
    expect(truncate('short', 20)).toBe('short');
  });
});

describe('matching helpers', () => {
  it('folds case, diacritics, articles and punctuation', () => {
    expect(fold('The Guardian')).toBe('guardian');
    expect(fold('la Repubblica')).toBe('repubblica');
    expect(fold('EL PAÍS')).toBe('pais');
    expect(fold('Ansa.it')).toBe('ansait');
  });

  it('tokenises Latin words and CJK bigrams', () => {
    expect(tokens('Hello, wörld 42')).toEqual(['hello', 'world', '42']);
    expect(tokens('ロボット掃除機')).toEqual(['ロボ', 'ボッ', 'ット', 'ト掃', '掃除', '除機']);
    expect(tokenOverlap('big storm hits coast', 'Storm hits the coast hard')).toBe(0.75);
    expect(tokenOverlap('', 'anything')).toBe(0);
  });
});

describe('stripTitleSuffix (PLAN.md §5.6.3)', () => {
  const base = {
    anchors: [] as string[],
    siteNames: [] as string[],
    hostLabels: [] as string[],
    sections: [] as string[],
    registrySuffixes: [] as string[],
  };

  it('drops a trailing site name', () => {
    expect(
      stripTitleSuffix('Chipmaker delays new fab by a year | TechCrunch', {
        ...base,
        siteNames: ['TechCrunch'],
        hostLabels: ['techcrunch'],
      }),
    ).toBe('Chipmaker delays new fab by a year');
  });

  it('drops section plus domain (ANSA style)', () => {
    expect(
      stripTitleSuffix('Manovra, via libera dal Senato - Ultima ora - Ansa.it', {
        ...base,
        siteNames: ['Agenzia ANSA'],
        hostLabels: ['ansa', 'ansa.it'],
        sections: ['Ultima ora'],
      }),
    ).toBe('Manovra, via libera dal Senato');
  });

  it('drops several trailing segments (Al Jazeera style)', () => {
    expect(
      stripTitleSuffix('Probe reaches the outer ring | Space News | Al Jazeera', {
        ...base,
        siteNames: ['Al Jazeera'],
        sections: ['Space News'],
        hostLabels: ['aljazeera'],
      }),
    ).toBe('Probe reaches the outer ring');
  });

  it('prefers a trusted anchor over guessing (Corriere style)', () => {
    expect(
      stripTitleSuffix('Il ponte resta chiuso fino a marzo | Luca Verdi', {
        ...base,
        anchors: ['Il ponte resta chiuso fino a marzo'],
      }),
    ).toBe('Il ponte resta chiuso fino a marzo');
  });

  it('applies registry suffixes', () => {
    expect(
      stripTitleSuffix('Tram line approved | The Outlet Network', {
        ...base,
        registrySuffixes: ['| The Outlet Network'],
      }),
    ).toBe('Tram line approved');
  });

  it('never strips from the front', () => {
    expect(
      stripTitleSuffix('Opinion | The case for patience on rates', {
        ...base,
        siteNames: ['Opinion'],
        sections: ['Opinion'],
      }),
    ).toBe('Opinion | The case for patience on rates');
  });

  it('keeps segments that are not noise', () => {
    expect(
      stripTitleSuffix('Rates up - what it means for savers - Money Desk', {
        ...base,
        siteNames: ['The Outlet'],
      }),
    ).toBe('Rates up - what it means for savers - Money Desk');
  });

  it('refuses to strip down to almost nothing', () => {
    expect(
      stripTitleSuffix('Why? - BBC News', {
        ...base,
        siteNames: ['BBC News'],
        hostLabels: ['bbc'],
      }),
    ).toBe('Why? - BBC News');
  });

  it('handles all separator styles', () => {
    for (const sep of [' | ', ' - ', ' – ', ' — ', ' · ', ' • ', ' :: ', ' » ', ' / ']) {
      expect(
        stripTitleSuffix(`A perfectly fine headline here${sep}Daily Outlet`, {
          ...base,
          siteNames: ['Daily Outlet'],
        }),
      ).toBe('A perfectly fine headline here');
    }
  });
});

describe('authors and names', () => {
  it('splits bylines in several languages', () => {
    expect(splitAuthors('By Jane Roe, Sam Okafor and Priya Raman')).toEqual([
      'Jane Roe',
      'Sam Okafor',
      'Priya Raman',
    ]);
    expect(splitAuthors('Di Luca Verdi e Anna Neri')).toEqual(['Luca Verdi', 'Anna Neri']);
    expect(splitAuthors('Von Hans Müller und Eva Braun')).toEqual(['Hans Müller', 'Eva Braun']);
    expect(splitAuthors('https://example.test/profile/jane')).toEqual([]);
  });

  it('recognises institutional authors', () => {
    expect(isInstitutionalAuthor('Al Jazeera Staff', ['Al Jazeera'])).toBe(true);
    expect(isInstitutionalAuthor('Agenzia ANSA', [])).toBe(true);
    expect(isInstitutionalAuthor('DER SPIEGEL', ['DER SPIEGEL'])).toBe(true);
    expect(isInstitutionalAuthor('Jane Roe', ['The Courier'])).toBe(false);
  });

  it('formats author lists', () => {
    expect(formatAuthors(['A'], 'en')).toBe('A');
    expect(formatAuthors(['A', 'B'], 'en')).toBe('A and B');
    expect(formatAuthors(['A', 'B', 'C'], 'en')).toBe('A, B, and C');
    expect(formatAuthors(['A', 'B', 'C', 'D'], 'en')).toBe('A et al.');
    expect(formatAuthors([], 'en')).toBe('');
  });

  it('spots legal-entity names', () => {
    for (const name of [
      'Ediciones EL PAÍS S.L.',
      'Acme Ltd',
      'Foo GmbH',
      'Bar Media Group',
      'Baz Inc.',
      'X Publishing',
    ]) {
      expect(isLegalEntityName(name), name).toBe(true);
    }
    for (const name of ['The Guardian', 'Bloomberg', 'BBC News']) {
      expect(isLegalEntityName(name), name).toBe(false);
    }
  });

  it('rejects junk section values', () => {
    for (const v of ['tags', 'News', 'home', 'x', '', 'uncategorized'])
      expect(isJunkSection(v), v).toBe(true);
    for (const v of ['Politics', 'Transport', 'Ultima ora'])
      expect(isJunkSection(v), v).toBe(false);
  });

  it('detects right-to-left text by script', () => {
    expect(mostlyRtl('ارتفاع أسعار النفط')).toBe(true);
    expect(mostlyRtl('הממשלה אישרה את התקציב')).toBe(true);
    expect(mostlyRtl('Plain English with one שלום')).toBe(false);
    expect(mostlyRtl('')).toBe(false);
  });
});
