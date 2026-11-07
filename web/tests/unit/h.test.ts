import { describe, expect, it } from 'vitest';
import { h, isSafeUrl, svg } from '../../src/render/h.ts';

describe('h()', () => {
  it('puts strings in as text nodes, never as markup', () => {
    const el = h('p', null, '<img src=x onerror=alert(1)>', ' & <b>bold</b>');
    expect(el.textContent).toBe('<img src=x onerror=alert(1)> & <b>bold</b>');
    expect(el.querySelector('img, b')).toBeNull();
    expect(el.childNodes.length).toBe(2);
  });

  it('skips empty children and accepts numbers and nodes', () => {
    const el = h('div', null, null, undefined, false, 5, h('span', null, 'x'));
    expect(el.textContent).toBe('5x');
  });

  it('sets classes, data attributes, custom properties and plain attributes', () => {
    const el = h('div', {
      class: 'a b',
      dataset: { x: 1, y: null },
      style: { '--u': '12px', color: 'red', display: null },
      lang: 'it',
      hidden: true,
      'aria-label': 'Label',
    });
    expect(el.className).toBe('a b');
    expect(el.dataset.x).toBe('1');
    expect('y' in el.dataset).toBe(false);
    expect(el.style.getPropertyValue('--u')).toBe('12px');
    expect(el.style.color).toBe('red');
    expect(el.lang).toBe('it');
    expect(el.hasAttribute('hidden')).toBe(true);
    expect(el.getAttribute('aria-label')).toBe('Label');
  });

  it('refuses event-handler and markup-injecting attributes', () => {
    for (const name of ['onclick', 'onerror', 'srcdoc', 'innerHTML', 'outerHTML', 'textContent']) {
      expect(() => h('div', { [name]: 'x' }), name).toThrow(/not allowed/);
    }
  });

  it('attaches listeners through `on`', () => {
    let clicks = 0;
    const el = h('button', { on: { click: () => clicks++ } }, 'go');
    el.click();
    expect(clicks).toBe(1);
  });

  it('only accepts safe URLs for src and href', () => {
    expect(h('img', { src: 'https://e.com/a.png' }).getAttribute('src')).toBe(
      'https://e.com/a.png',
    );
    expect(h('img', { src: 'blob:http://localhost/abc' }).getAttribute('src')).toBe(
      'blob:http://localhost/abc',
    );
    expect(h('img', { src: 'data:image/png;base64,AAAA' }).hasAttribute('src')).toBe(true);
    for (const bad of [
      'javascript:alert(1)',
      'data:text/html,<p>',
      'data:image/svg+xml;base64,AAAA\u0000',
      'file:///etc/passwd',
      '//evil.test/a.png',
      'vbscript:x',
    ]) {
      const el = h('a', { href: bad });
      expect(el.hasAttribute('href'), bad).toBe(bad === 'data:image/svg+xml;base64,AAAA\u0000');
    }
  });

  it('isSafeUrl knows the allowed schemes', () => {
    expect(isSafeUrl(' https://e.com ')).toBe(true);
    expect(isSafeUrl('HTTP://e.com')).toBe(true);
    expect(isSafeUrl('data:image/svg+xml,<svg/>')).toBe(true);
    expect(isSafeUrl('data:image/gif;base64,R0lG')).toBe(true);
    expect(isSafeUrl('data:text/plain,hi')).toBe(false);
    expect(isSafeUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeUrl('')).toBe(false);
  });
});

describe('svg()', () => {
  it('creates namespaced elements and refuses handlers', () => {
    const el = svg('svg', { viewBox: '0 0 10 10' }, svg('path', { d: 'M0 0L10 10' }));
    expect(el.namespaceURI).toBe('http://www.w3.org/2000/svg');
    expect(el.querySelector('path')?.getAttribute('d')).toBe('M0 0L10 10');
    expect(() => svg('svg', { onload: 'x' })).toThrow(/not allowed/);
  });
});
