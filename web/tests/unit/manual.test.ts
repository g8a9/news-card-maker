import { describe, expect, it } from 'vitest';
import { manualExtraction } from '../../src/core/manual.ts';
import { effective } from '../../src/core/types.ts';
import { PipelineError, type PipelineEvent, resolveManual } from '../../src/net/pipeline.ts';
import { OUTLETS } from '../../src/state/defaults.ts';
import { NOW } from './helpers.ts';

const guardian = OUTLETS.find((o) => o.id === 'guardian') ?? null;
const options = { proxyUrl: 'http://proxy.test', outlets: OUTLETS, enrich: false, now: NOW };

describe('manualExtraction', () => {
  it('turns typed fields into candidates with the user as their source', () => {
    const e = manualExtraction(
      {
        title: '  A typed headline ',
        description: 'A deck',
        siteName: 'Local Paper',
        date: '2026-11-06',
      },
      null,
      NOW,
    );
    expect(e.title).toEqual([{ value: 'A typed headline', source: 'user', score: 1 }]);
    expect(e.description[0]?.value).toBe('A deck');
    expect(e.siteName[0]).toMatchObject({ value: 'Local Paper', source: 'user' });
    expect(e.published[0]?.value).toMatchObject({ y: 2026, m: 11, d: 6, offsetMin: null });
    expect(e.images).toEqual([]);
    expect(e.logos).toEqual([]);
  });

  it('brings the outlet name, logos and colour along from the registry', () => {
    const e = manualExtraction({ title: 'T' }, guardian, NOW);
    expect(e.siteName[0]).toMatchObject({ value: 'The Guardian', source: 'registry' });
    expect(e.logos[0]).toMatchObject({ source: 'registry', value: { kind: 'wordmark' } });
    expect(e.colors[0]).toMatchObject({ value: '#052962', source: 'registry' });
  });

  it('falls back to the host of the link when nothing names the outlet', () => {
    const e = manualExtraction({ title: 'T', url: 'https://www.example.org/a' }, null, NOW);
    expect(e.siteName[0]).toMatchObject({ value: 'example.org', source: 'url' });
  });

  it('knows right-to-left text', () => {
    expect(manualExtraction({ title: 'مجلس المدينة يوافق على خط الترام' }, null).dir).toBe('rtl');
    expect(manualExtraction({ title: 'City council approves tram line' }, null).dir).toBe('ltr');
  });

  it('leaves out a date it cannot read', () => {
    expect(manualExtraction({ title: 'T', date: 'not a date' }, null, NOW).published).toEqual([]);
  });
});

describe('resolveManual', () => {
  it('builds a finished card from an outlet and a headline', async () => {
    const events: PipelineEvent[] = [];
    const model = await resolveManual(
      { title: 'Hand-written headline', outletId: 'guardian', date: '2026-11-05' },
      { ...options, onEvent: (e) => events.push(e) },
    );
    expect(model.provenance).toEqual(['manual']);
    expect(model.status).toBe('ok');
    expect(effective(model.fields.title)).toBe('Hand-written headline');
    expect(effective(model.fields.siteName)).toBe('The Guardian');
    expect(model.brand).toMatchObject({ outletId: 'guardian', color: '#052962' });
    expect(model.logoCandidates.length).toBeGreaterThan(0);
    expect(model.citeUrl).toBe('');
    expect(model.finalUrl).toBe('');
    expect(events.map((e) => e.stage)).toEqual(['content', 'done']);
  });

  it('cleans the link and recognises the outlet from it', async () => {
    const model = await resolveManual(
      { title: 'T', url: 'https://www.theguardian.com/world/2026/nov/06/a?utm_source=x#top' },
      options,
    );
    expect(model.citeUrl).toBe('https://www.theguardian.com/world/2026/nov/06/a');
    expect(model.brand.outletId).toBe('guardian');
  });

  it('lets the picked outlet win over the link', async () => {
    const model = await resolveManual(
      { title: 'T', outletId: 'bbc', url: 'https://www.theguardian.com/a' },
      options,
    );
    expect(model.brand.outletId).toBe('bbc');
  });

  it('accepts a name typed by hand with no link at all', async () => {
    const model = await resolveManual({ title: 'T', siteName: 'Radio Locale' }, options);
    expect(effective(model.fields.siteName)).toBe('Radio Locale');
    expect(model.brand.outletId).toBeUndefined();
    expect(model.dir).toBe('ltr');
  });

  it('refuses a link that is not http(s)', async () => {
    await expect(
      resolveManual({ title: 'T', url: 'ftp://example.org/a' }, options),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(resolveManual({ title: 'T', url: 'nonsense' }, options)).rejects.toBeInstanceOf(
      PipelineError,
    );
  });
});
