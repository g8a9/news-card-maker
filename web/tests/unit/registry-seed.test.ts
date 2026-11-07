// The MVP outlet registry (PLAN.md §6.1, M6). `npm run registry:check` verifies the live URLs.
import { describe, expect, it } from 'vitest';
import { findOutlet } from '../../src/core/registry.ts';
import { defaultStyle } from '../../src/render/style.ts';
import { OUTLETS, styleForNewCard } from '../../src/state/defaults.ts';

const HEX = /^#[0-9a-fA-F]{6}$/;

describe('outlets.json', () => {
  it('has the ten outlets of the MVP seed', () => {
    expect(OUTLETS.length).toBeGreaterThanOrEqual(10);
  });

  it('uses unique ids and claims each domain once', () => {
    const ids = OUTLETS.map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    const domains = OUTLETS.flatMap((o) => o.domains);
    expect(new Set(domains).size).toBe(domains.length);
  });

  it.each(OUTLETS.map((o) => [o.id, o] as const))('%s is well formed', (_id, o) => {
    expect(o.name.trim()).not.toBe('');
    expect(o.domains.length).toBeGreaterThan(0);
    for (const d of o.domains) expect(d).toMatch(/^[a-z0-9.-]+\.[a-z]{2,}$/);
    for (const c of [o.colors?.brand, o.colors?.paper]) if (c) expect(c).toMatch(HEX);
    for (const logo of [o.logo?.wordmark, o.logo?.icon]) {
      if (!logo) continue;
      expect(logo.url).toMatch(/^https:\/\//);
      for (const treatment of [logo.onDark, logo.onLight]) {
        if (treatment) expect(['mono', 'original']).toContain(treatment);
      }
    }
    for (const feed of o.feeds ?? []) expect(feed).toMatch(/^https:\/\//);
    expect(['ok', 'blocked', undefined]).toContain(o.fetch);
    expect(o.verified).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('references publisher or Wikimedia-hosted logos instead of bundling files', () => {
    for (const o of OUTLETS) {
      const url = o.logo?.wordmark?.url ?? o.logo?.icon?.url;
      expect(url, `${o.id} has a logo`).toBeTruthy();
    }
  });

  it('marks the outlets that block automated readers', () => {
    const blocked = OUTLETS.filter((o) => o.fetch === 'blocked').map((o) => o.id);
    expect(blocked).toEqual(expect.arrayContaining(['economist', 'nyt', 'ft']));
  });

  it('matches the hosts people paste', () => {
    for (const [host, id] of [
      ['www.economist.com', 'economist'],
      ['www.nytimes.com', 'nyt'],
      ['www.theguardian.com', 'guardian'],
      ['www.bbc.co.uk', 'bbc'],
      ['www.bbc.com', 'bbc'],
      ['www.ft.com', 'ft'],
      ['www.404media.co', '404-media'],
      ['news.ycombinator.com', 'hacker-news'],
      ['www.theverge.com', 'verge'],
      ['www.ilpost.it', 'il-post'],
      ['www.corriere.it', 'corriere'],
    ] as const) {
      expect(findOutlet(OUTLETS, host)?.id, host).toBe(id);
    }
  });

  it('only sets style defaults the app knows', () => {
    for (const o of OUTLETS) {
      const style = styleForNewCard(defaultStyle(), o);
      if (o.defaults?.theme) expect(style.theme, o.id).toBe(o.defaults.theme);
      if (o.defaults?.template) expect(style.template, o.id).toBe(o.defaults.template);
      if (o.defaults?.headlineFont)
        expect(style.fonts.headline, o.id).toBe(o.defaults.headlineFont);
    }
  });
});
