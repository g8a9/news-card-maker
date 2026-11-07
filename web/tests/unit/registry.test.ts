import { describe, expect, it } from 'vitest';
import { findOutlet, findOutletById, type Outlet } from '../../src/core/registry.ts';

const outlets: Outlet[] = [
  { id: 'guardian', name: 'The Guardian', domains: ['theguardian.com', 'guardian.co.uk'] },
  { id: 'bbc', name: 'BBC News', domains: ['bbc.co.uk', 'bbc.com'] },
  { id: 'bbc-sport', name: 'BBC Sport', domains: ['sport.bbc.co.uk'] },
];

describe('findOutlet', () => {
  it.each([
    ['theguardian.com', 'guardian'],
    ['www.theguardian.com', 'guardian'],
    ['amp.theguardian.com', 'guardian'],
    ['GUARDIAN.CO.UK', 'guardian'],
    ['www.bbc.com', 'bbc'],
    ['feeds.bbci.co.uk', null],
    ['nottheguardian.com', null],
    ['theguardian.com.evil.example', null],
    ['', null],
  ])('matches %s', (host, id) => {
    expect(findOutlet(outlets, host)?.id ?? null).toBe(id);
  });

  it('prefers the longest matching domain', () => {
    expect(findOutlet(outlets, 'sport.bbc.co.uk')?.id).toBe('bbc-sport');
    expect(findOutlet(outlets, 'news.bbc.co.uk')?.id).toBe('bbc');
  });

  it('finds by id', () => {
    expect(findOutletById(outlets, 'bbc')?.name).toBe('BBC News');
    expect(findOutletById(outlets, 'nope')).toBeNull();
  });
});
