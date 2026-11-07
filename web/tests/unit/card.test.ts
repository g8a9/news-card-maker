import { describe, expect, it } from 'vitest';
import { renderCard } from '../../src/render/card.ts';
import { altText, cardContent, ellipsizeMiddle, resolveLocale } from '../../src/render/content.ts';
import { type CardStyle, defaultStyle } from '../../src/render/style.ts';
import { day, loadedImage, loadedLogo, makeModel } from './card-helpers.ts';

const NOW = new Date(Date.UTC(2026, 10, 7, 12));
const render = (
  model = makeModel(),
  mutate: (s: CardStyle) => void = () => {},
  extra: Parameters<typeof renderCard>[0] extends infer I ? Partial<I> : never = {},
) => {
  const style = defaultStyle();
  mutate(style);
  return renderCard({ article: model, style, hostLocale: 'en', now: NOW, ...extra });
};
const text = (root: Element, sel: string) => root.querySelector(sel)?.textContent ?? null;

describe('renderCard: structure', () => {
  it('builds a Classic card with every part', () => {
    const { card } = render(makeModel(), (s) => {
      s.show.kicker = true;
      s.show.authors = true;
    });
    expect(card.tagName).toBe('ARTICLE');
    expect(card.className).toContain('nc-card');
    expect(card.className).toContain('nc-t-classic');
    expect(card.className).toContain('nc-theme-light');
    expect(card.className).toContain('nc-auto');
    expect(text(card, '.nc-headline')).toBe('Council approves harbour tram line after late vote');
    expect(text(card, '.nc-deck')).toBe('Councillors backed the scheme by 31 votes to 29.');
    expect(text(card, '.nc-kicker')).toBe('Transport');
    expect(text(card, '.nc-meta-start')).toBe('Nov 6, 2026 · Jane Roe');
    expect(text(card, '.nc-meta-url')).toMatch(/^thecourier\.test\/transport.*…/);
    expect(text(card, '.nc-meta-url')).toMatch(/tram-line$/);
    expect(card.querySelector('.nc-media img')?.getAttribute('src')).toBe('blob:test/image');
    expect(card.querySelector('.nc-masthead img.nc-logo-wordmark')).not.toBeNull();
  });

  it('sizes everything in u: --u is width / 100, fixed sizes set --h', () => {
    const auto = render();
    expect(auto.card.style.getPropertyValue('--w')).toBe('1200px');
    expect(auto.card.style.getPropertyValue('--u')).toBe('12px');
    expect(auto.card.style.getPropertyValue('--h')).toBe('');
    const fixed = render(makeModel(), (s) => {
      s.size = { preset: '1:1', width: 0, height: null };
    });
    expect(fixed.card.style.getPropertyValue('--w')).toBe('1080px');
    expect(fixed.card.style.getPropertyValue('--h')).toBe('1080px');
    expect(fixed.card.style.getPropertyValue('--u')).toBe('10.8px');
    expect(fixed.card.className).toContain('nc-fixed');
    expect(fixed.size).toEqual({ width: 1080, height: 1080 });
  });

  it('puts the theme tokens on the card root', () => {
    const { card } = render(makeModel(), (s) => {
      s.theme = 'dark';
    });
    expect(card.style.getPropertyValue('--bg')).toBe('#121214');
    expect(card.style.getPropertyValue('--ink')).toBe('#F4F4F5');
    expect(card.style.getPropertyValue('--accent')).toMatch(/^#[0-9A-F]{6}$/);
  });

  it('carries lang and dir from the article', () => {
    const rtl = render(makeModel({ lang: 'ar', dir: 'rtl', title: 'ارتفاع أسعار النفط' }));
    expect(rtl.card.getAttribute('lang')).toBe('ar');
    expect(rtl.card.getAttribute('dir')).toBe('rtl');
    const none = render(makeModel({ lang: undefined }));
    expect(none.card.hasAttribute('lang')).toBe(false);
    expect(none.card.getAttribute('dir')).toBe('ltr');
  });

  it('is exposed as an element with alt text for the stage', () => {
    const r = render();
    expect(r.alt).toBe(
      'News headline from The Courier: “Council approves harbour tram line after late vote” (Nov 6, 2026)',
    );
    expect(r.root).toBe(r.card);
    expect(r.width).toBe(1200);
  });
});

describe('renderCard: safety (PLAN.md §12.4)', () => {
  const evil = '<img src=x onerror=alert(1)><script>alert(1)</script>';

  it('renders hostile strings as text only', () => {
    const r = render(
      makeModel({
        title: evil,
        description: evil,
        kicker: evil,
        siteName: evil,
        authors: [evil],
        citeUrl: `https://e.com/${encodeURIComponent(evil)}`,
      }),
      (s) => {
        s.show.kicker = true;
        s.show.authors = true;
      },
    );
    expect(r.card.querySelector('script')).toBeNull();
    expect(r.card.querySelectorAll('img').length).toBe(2); // the media image and the logo, both ours
    for (const img of r.card.querySelectorAll('img'))
      expect(img.hasAttribute('onerror')).toBe(false);
    expect(text(r.card, '.nc-headline')).toBe(evil);
    expect(text(r.card, '.nc-kicker')).toBe(evil);
  });

  it('drops image sources that are not http(s), blob or data:image', () => {
    const model = makeModel({
      image: loadedImage('javascript:alert(1)'),
      logo: loadedLogo('wordmark', 'data:text/html,<p>'),
    });
    const r = render(model);
    expect(r.card.querySelector('.nc-media')).toBeNull(); // no usable image: no media block
    expect(r.card.querySelector('img.nc-logo')).toBeNull();
  });

  it('never uses markup-injecting APIs', () => {
    // The whole card is built with h(); there is no string-to-HTML path to test beyond the above.
    const r = render();
    expect(r.card.outerHTML).not.toMatch(/on\w+=/i);
  });
});

describe('renderCard: toggles', () => {
  it('hides what is switched off', () => {
    const r = render(makeModel(), (s) => {
      s.show.description = false;
      s.show.date = false;
      s.show.url = false;
      s.show.image = false;
      s.show.logo = false;
    });
    expect(r.card.querySelector('.nc-deck')).toBeNull();
    expect(r.card.querySelector('.nc-meta')).toBeNull();
    expect(r.card.querySelector('.nc-media')).toBeNull();
    expect(r.card.querySelector('.nc-top-bar')).not.toBeNull(); // Classic without an image gets an accent bar
    expect(r.card.querySelector('img')).toBeNull();
    expect(text(r.card, '.nc-site')).toBe('The Courier'); // name only
  });

  it('keeps the kicker and authors off by default and on request', () => {
    expect(render().card.querySelector('.nc-kicker')).toBeNull();
    expect(render().card.querySelector('.nc-authors')).toBeNull();
    const on = render(makeModel(), (s) => {
      s.show.kicker = true;
      s.show.authors = true;
    });
    expect(on.card.querySelector('.nc-kicker')).not.toBeNull();
    expect(on.card.querySelector('.nc-authors')?.textContent).toBe('Jane Roe');
  });

  it('shows "Updated" only when the modification is more than a day later', () => {
    const model = makeModel({ modified: day(2026, 11, 8) });
    const on = render(model, (s) => (s.show.updated = true));
    expect(text(on.card, '.nc-meta-start')).toBe('Nov 6, 2026 · Updated Nov 8, 2026');
    const sameDay = render(
      makeModel({ modified: day(2026, 11, 7) }),
      (s) => (s.show.updated = true),
    );
    expect(text(sameDay.card, '.nc-meta-start')).toBe('Nov 6, 2026');
  });

  it('shows "Accessed {today}"', () => {
    const r = render(makeModel(), (s) => (s.show.accessed = true));
    expect(text(r.card, '.nc-meta-start')).toMatch(/^Nov 6, 2026 · Accessed Nov 7, 2026$/);
  });

  it('formats URLs in three styles', () => {
    const model = makeModel({ citeUrl: 'https://www.example.com/world/story?id=3' });
    expect(text(render(model).card, '.nc-meta-url')).toBe('example.com/world/story?id=3');
    expect(text(render(model, (s) => (s.urlStyle = 'full')).card, '.nc-meta-url')).toBe(
      'https://www.example.com/world/story?id=3',
    );
    expect(text(render(model, (s) => (s.urlStyle = 'domain')).card, '.nc-meta-url')).toBe(
      'example.com',
    );
  });

  it('falls back to "Untitled" when there is no headline', () => {
    expect(text(render(makeModel({ title: null })).card, '.nc-headline')).toBe('Untitled');
  });

  it('prefers the user override to the extracted value', () => {
    const model = makeModel();
    model.fields.title.override = 'My own headline';
    expect(text(render(model).card, '.nc-headline')).toBe('My own headline');
  });
});

describe('renderCard: masthead', () => {
  it('shows a wordmark alone, without repeating the name', () => {
    const r = render();
    expect(r.card.querySelector('.nc-logo-wordmark')).not.toBeNull();
    expect(r.card.querySelector('.nc-site')).toBeNull();
  });

  it('shows an icon next to the name', () => {
    const r = render(makeModel({ logo: loadedLogo('icon') }));
    expect(r.card.querySelector('.nc-logo-icon')).not.toBeNull();
    expect(text(r.card, '.nc-site')).toBe('The Courier');
  });

  it('draws a monogram when there is no logo', () => {
    const r = render(makeModel({ logo: null, siteName: 'The Harbour Gazette' }));
    expect(text(r.card, '.nc-monogram')).toBe('H');
    expect(text(r.card, '.nc-site')).toBe('The Harbour Gazette');
  });

  it('honours the site-name setting', () => {
    expect(
      render(makeModel(), (s) => (s.show.siteName = true)).card.querySelector('.nc-site'),
    ).not.toBeNull();
    expect(
      render(
        makeModel({ logo: loadedLogo('icon') }),
        (s) => (s.show.siteName = false),
      ).card.querySelector('.nc-site'),
    ).toBeNull();
  });

  it('uses a pre-baked logo and rounds app-icon logos', () => {
    const r = render(makeModel({ logo: loadedLogo('icon') }), () => {}, {
      assets: { logoSrc: 'data:image/png;base64,AAAA', logoOpaque: true },
    });
    const img = r.card.querySelector('img.nc-logo');
    expect(img?.getAttribute('src')).toBe('data:image/png;base64,AAAA');
    expect(img?.className).toContain('nc-logo-rounded');
  });

  it('has no masthead when there is nothing to show', () => {
    const r = render(makeModel({ logo: null, siteName: null }));
    expect(r.card.querySelector('.nc-masthead')).toBeNull();
  });
});

describe('renderCard: templates', () => {
  it('Split puts the image after the text column and flips with imagePosition', () => {
    const r = render(makeModel(), (s) => (s.template = 'split'));
    expect(r.card.className).toContain('nc-t-split');
    expect([...r.card.children].map((c) => c.className.split(' ')[0])).toEqual([
      'nc-body',
      'nc-media',
    ]);
    expect(
      render(makeModel(), (s) => {
        s.template = 'split';
        s.imagePosition = 'start';
      }).card.className,
    ).toContain('nc-img-start');
  });

  it('Split falls back to the Classic structure in portrait sizes', () => {
    const r = render(makeModel(), (s) => {
      s.template = 'split';
      s.size = { preset: '9:16', width: 1080, height: 1920 };
    });
    expect(r.card.dataset.template).toBe('classic');
    expect(r.card.dataset.requested).toBe('split');
    expect(r.card.className).toContain('nc-t-classic');
    expect(r.card.className).not.toContain('nc-t-split');
  });

  it('Headline has an accent bar and no image', () => {
    const r = render(makeModel(), (s) => (s.template = 'headline'));
    expect(r.card.querySelector('.nc-bar')).not.toBeNull();
    expect(r.card.querySelector('.nc-media')).toBeNull();
  });

  it('extras that are not built yet fall back to Classic', () => {
    const r = render(makeModel(), (s) => (s.template = 'hero'));
    expect(r.card.dataset.template).toBe('classic');
  });

  it('Classic sets the media height: 1.91:1 in auto mode, about half the card in fixed landscape', () => {
    expect(render().card.style.getPropertyValue('--media-h')).toBe(`${1200 / 1.91}px`);
    const fixed = render(
      makeModel(),
      (s) => (s.size = { preset: '16:9', width: 1200, height: 675 }),
    );
    expect(Number.parseFloat(fixed.card.style.getPropertyValue('--media-h'))).toBeCloseTo(
      675 * 0.46,
      1,
    );
  });

  it('headline bounds scale with the user setting and the card shape', () => {
    const base = render(
      makeModel(),
      (s) => (s.size = { preset: '16:9', width: 1200, height: 675 }),
    );
    const big = render(makeModel(), (s) => {
      s.size = { preset: '16:9', width: 1200, height: 675 };
      s.headlineScale = 1.25;
    });
    const portrait = render(
      makeModel(),
      (s) => (s.size = { preset: '9:16', width: 1080, height: 1920 }),
    );
    expect(Number(big.card.dataset.maxU)).toBeCloseTo(Number(base.card.dataset.maxU) * 1.25, 5);
    expect(Number(portrait.card.dataset.maxU)).toBeGreaterThan(Number(base.card.dataset.maxU));
    const clamped = render(makeModel(), (s) => (s.headlineScale = 9));
    expect(Number(clamped.card.dataset.autoU)).toBeCloseTo(4.4 * 1.25, 5);
  });
});

describe('renderCard: style options', () => {
  it('applies alignment, density and border classes', () => {
    const r = render(makeModel(), (s) => {
      s.align = 'center';
      s.density = 'airy';
      s.border = 'hairline';
    });
    expect(r.card.className).toContain('nc-align-center');
    expect(r.card.className).toContain('nc-density-airy');
    expect(r.card.className).toContain('nc-border-hairline');
  });

  it('applies the image focal point and zoom', () => {
    const r = render(makeModel(), (s) => {
      s.imageFocus = { x: 0.25, y: 0.75 };
      s.imageZoom = 1.5;
    });
    const img = r.card.querySelector<HTMLElement>('.nc-media img');
    expect(img?.style.getPropertyValue('--fx')).toBe('25%');
    expect(img?.style.getPropertyValue('--fy')).toBe('75%');
    expect(img?.style.getPropertyValue('--zoom')).toBe('1.5');
  });

  it('picks fonts: Newsreader by default, the outlet hint, and the user choice', () => {
    expect(render().card.style.getPropertyValue('--font-head')).toContain('Newsreader Variable');
    expect(render().card.style.getPropertyValue('--head-weight')).toBe('600');
    const sans = render(makeModel(), () => {}, {
      outlet: { id: 'x', name: 'X', domains: ['x.test'], fonts: { headline: 'sans' } },
    });
    expect(sans.card.style.getPropertyValue('--font-head')).toContain('Inter Tight Variable');
    expect(sans.card.style.getPropertyValue('--head-weight')).toBe('650');
    const chosen = render(makeModel(), (s) => (s.fonts.headline = 'source-serif'));
    expect(chosen.card.style.getPropertyValue('--font-head')).toContain('Source Serif 4 Variable');
  });

  it('uses the CJK, Arabic, Hebrew and emoji fallbacks in every stack', () => {
    const stack = render().card.style.getPropertyValue('--font-head');
    for (const family of [
      'Hiragino',
      'Noto Sans Arabic',
      'Noto Sans Hebrew',
      'Apple Color Emoji',
      'Noto Color Emoji',
    ]) {
      expect(stack + render().card.style.getPropertyValue('--font-body'), family).toContain(family);
    }
  });
});

describe('renderCard: frame (PLAN.md §7.6)', () => {
  it('is off by default: the card is the export target', () => {
    const r = render();
    expect(r.root).toBe(r.card);
  });

  it('wraps the card and widens the root by the padding', () => {
    const r = render(makeModel(), (s) => {
      s.frame.enabled = true;
      s.frame.padding = 6;
    });
    expect(r.root).not.toBe(r.card);
    expect(r.root.className).toBe('nc-frame');
    expect(r.root.firstElementChild).toBe(r.card);
    expect(r.width).toBe(1200 + 2 * 6 * 12);
    expect(r.root.style.getPropertyValue('--frame-pad')).toBe('6');
    expect(r.root.style.getPropertyValue('--shadow')).toContain('rgba(0, 0, 0, 0.18)');
  });

  it('supports every background kind and shadow', () => {
    const kinds: Array<[CardStyle['frame']['background'], RegExp]> = [
      [{ kind: 'transparent' }, /transparent/],
      [{ kind: 'solid', value: '#112233' }, /rgb\(17, 34, 51\)|#112233/i],
      [{ kind: 'gradient', value: 'sunset' }, /linear-gradient/],
      [{ kind: 'gradient', value: 'does-not-exist' }, /linear-gradient/],
      [{ kind: 'brand' }, /rgb|#/],
    ];
    for (const [background, expected] of kinds) {
      const r = render(makeModel(), (s) => {
        s.frame.enabled = true;
        s.frame.background = background;
      });
      expect(
        `${r.root.style.backgroundColor} ${r.root.style.backgroundImage}`,
        background.kind,
      ).toMatch(expected);
    }
    for (const shadow of ['none', 'soft', 'medium', 'strong'] as const) {
      const r = render(makeModel(), (s) => {
        s.frame.enabled = true;
        s.frame.shadow = shadow;
      });
      expect(r.root.style.getPropertyValue('--shadow')).not.toBe('');
    }
  });

  it('uses the blurred backdrop when provided and ignores unsafe ones', () => {
    const blur = (src: string | null) =>
      render(
        makeModel(),
        (s) => {
          s.frame.enabled = true;
          s.frame.background = { kind: 'blur' };
        },
        { assets: { frameBlurSrc: src } },
      );
    expect(blur('data:image/jpeg;base64,AAAA').root.style.backgroundImage).toContain(
      'data:image/jpeg',
    );
    expect(blur('javascript:alert(1)').root.style.backgroundImage).not.toContain('javascript');
    expect(blur(null).root.style.backgroundImage).toContain('linear-gradient');
  });
});

describe('cardContent', () => {
  const style = defaultStyle();

  it('resolves the locale: auto, article or explicit', () => {
    const model = makeModel({ lang: 'it' });
    expect(resolveLocale({ ...style, locale: 'auto' }, model, 'en-GB')).toBe('en-GB');
    expect(resolveLocale({ ...style, locale: 'article' }, model, 'en-GB')).toBe('it');
    expect(resolveLocale({ ...style, locale: 'de' }, model, 'en-GB')).toBe('de');
    expect(
      resolveLocale({ ...style, locale: 'article' }, makeModel({ lang: undefined }), 'en-GB'),
    ).toBe('en-GB');
  });

  it('formats dates in the chosen locale and style', () => {
    const model = makeModel({ lang: 'it' });
    const c = (over: Partial<CardStyle>) =>
      cardContent(model, { ...style, ...over }, { hostLocale: 'en', now: NOW, width: 1200 });
    expect(c({ locale: 'article', dateFormat: 'long' }).date).toBe('6 novembre 2026');
    expect(c({ dateFormat: 'iso' }).date).toBe('2026-11-06');
    expect(c({ locale: 'de', dateFormat: 'medium' }).date).toBe('06.11.2026');
  });

  it('localises the Updated and Accessed labels, falling back to English', () => {
    const model = makeModel({ modified: day(2026, 11, 9) });
    const on = { ...style, show: { ...style.show, updated: true, accessed: true } };
    expect(
      cardContent(model, { ...on, locale: 'it' }, { hostLocale: 'en', now: NOW, width: 1200 })
        .updated,
    ).toMatch(/^Aggiornato /);
    expect(
      cardContent(model, { ...on, locale: 'de' }, { hostLocale: 'en', now: NOW, width: 1200 })
        .accessed,
    ).toMatch(/^Abgerufen /);
    expect(
      cardContent(model, { ...on, locale: 'ja' }, { hostLocale: 'en', now: NOW, width: 1200 })
        .updated,
    ).toMatch(/^Updated /);
  });

  it('formats author lists, with "et al." beyond three', () => {
    const on = { ...style, show: { ...style.show, authors: true } };
    const two = makeModel({ authors: ['A B', 'C D'] });
    expect(cardContent(two, on, { hostLocale: 'en', now: NOW, width: 1200 }).authors).toBe(
      'A B and C D',
    );
    const many = makeModel({ authors: ['A', 'B', 'C', 'D'] });
    expect(cardContent(many, on, { hostLocale: 'en', now: NOW, width: 1200 }).authors).toBe(
      'A et al.',
    );
  });

  it('ellipsizes long URLs in the middle', () => {
    expect(ellipsizeMiddle('example.com/short', 40)).toBe('example.com/short');
    const long = `example.com/${'a'.repeat(100)}/end-of-the-path`;
    const out = ellipsizeMiddle(long, 40);
    expect(out.length).toBe(40);
    expect(out).toContain('…');
    expect(out.startsWith('example.com/')).toBe(true);
    expect(out.endsWith('end-of-the-path')).toBe(true);
  });

  it('builds alt text', () => {
    const c = cardContent(makeModel({ siteName: null, published: null }), style, {
      hostLocale: 'en',
      now: NOW,
      width: 1200,
    });
    expect(altText(c)).toBe('News headline: “Council approves harbour tram line after late vote”');
  });
});
