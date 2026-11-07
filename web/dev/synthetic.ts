// Synthetic articles, images and logos for the dev gallery, visual tests and the README screenshots
// (PLAN.md §13.2). Everything is generated locally on a canvas: no third-party pictures or logos.
import type {
  ArticleModel,
  Candidate,
  LoadedImage,
  LoadedLogo,
  PartialDate,
} from '../src/core/types.ts';

const field = <T>(value: T | null): { value: T | null; options: Candidate<T>[] } => ({
  value,
  options: value === null ? [] : [{ value, source: 'user', score: 1 }],
});

export const date = (y: number, m: number, d: number): PartialDate => ({
  raw: `${y}-${m}-${d}`,
  y,
  m,
  d,
  offsetMin: null,
});

function toBlobUrl(canvas: HTMLCanvasElement, type = 'image/png'): Promise<string> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(URL.createObjectURL(blob)) : reject(new Error('toBlob failed'))),
      type,
      0.92,
    ),
  );
}

/** A photo-like placeholder: layered gradients and soft shapes, seeded by hue. */
export async function syntheticPhoto(
  hue: number,
  width = 1600,
  height = 840,
): Promise<LoadedImage> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  const sky = ctx.createLinearGradient(0, 0, 0, height);
  sky.addColorStop(0, `hsl(${hue} 55% 62%)`);
  sky.addColorStop(0.55, `hsl(${(hue + 25) % 360} 60% 78%)`);
  sky.addColorStop(1, `hsl(${(hue + 40) % 360} 35% 30%)`);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = `hsl(${hue} 30% 24%)`;
  ctx.beginPath();
  ctx.moveTo(0, height);
  for (let x = 0; x <= width; x += 40)
    ctx.lineTo(x, height * 0.72 - Math.sin(x / 190 + hue) * height * 0.07 - Math.cos(x / 70) * 14);
  ctx.lineTo(width, height);
  ctx.fill();
  ctx.fillStyle = `hsl(${(hue + 200) % 360} 40% 18% / 0.85)`;
  for (let i = 0; i < 9; i++) {
    const w = width * (0.04 + ((i * 37) % 7) / 90);
    const h = height * (0.12 + ((i * 53) % 9) / 40);
    ctx.fillRect(width * (0.06 + i * 0.105), height * 0.78 - h, w, h);
  }
  const sun = ctx.createRadialGradient(
    width * 0.72,
    height * 0.3,
    10,
    width * 0.72,
    height * 0.3,
    height * 0.28,
  );
  sun.addColorStop(0, 'rgba(255,255,255,0.95)');
  sun.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = sun;
  ctx.fillRect(0, 0, width, height);
  const objectUrl = await toBlobUrl(canvas, 'image/jpeg');
  return { ref: { url: `synthetic:photo-${hue}`, width, height }, objectUrl, width, height };
}

/** A typographic wordmark, drawn in `color` on a transparent background. */
export async function syntheticWordmark(name: string, color: string): Promise<LoadedLogo> {
  const canvas = document.createElement('canvas');
  canvas.width = 760;
  canvas.height = 190;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  ctx.fillStyle = color;
  ctx.font = '700 120px Georgia, "Times New Roman", serif';
  ctx.textBaseline = 'middle';
  const text = name;
  const measured = ctx.measureText(text).width;
  canvas.width = Math.ceil(measured + 20);
  ctx.fillStyle = color;
  ctx.font = '700 120px Georgia, "Times New Roman", serif';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 10, 98);
  const objectUrl = await toBlobUrl(canvas);
  return {
    ref: {
      url: `synthetic:wordmark-${name}`,
      kind: 'wordmark',
      width: canvas.width,
      height: canvas.height,
    },
    objectUrl,
    width: canvas.width,
    height: canvas.height,
    analysis: { aspect: canvas.width / canvas.height },
  };
}

/** An app-icon style logo: coloured rounded square with a letter (has its own opaque background). */
export async function syntheticIcon(letter: string, color: string): Promise<LoadedLogo> {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 256, 256);
  ctx.fillStyle = '#fff';
  ctx.font = '700 170px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(letter, 128, 136);
  const objectUrl = await toBlobUrl(canvas);
  return {
    ref: { url: `synthetic:icon-${letter}`, kind: 'icon', width: 256, height: 256 },
    objectUrl,
    width: 256,
    height: 256,
    analysis: { aspect: 1 },
  };
}

/** A transparent, single-colour glyph logo (no background): recolours cleanly in mono. */
export async function syntheticGlyph(color: string): Promise<LoadedLogo> {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(128, 128, 100, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillRect(118, 60, 20, 136);
  const objectUrl = await toBlobUrl(canvas);
  return {
    ref: { url: 'synthetic:glyph', kind: 'icon', width: 256, height: 256 },
    objectUrl,
    width: 256,
    height: 256,
    analysis: { aspect: 1 },
  };
}

export interface SyntheticSpec {
  id: string;
  title: string;
  description?: string;
  kicker?: string;
  siteName: string;
  authors?: string[];
  published?: PartialDate;
  modified?: PartialDate;
  url: string;
  lang?: string;
  dir?: 'ltr' | 'rtl';
  brand?: string;
  paper?: string;
  image?: number | null; // hue, or null for none
  logo?: 'wordmark' | 'icon' | 'glyph' | null;
  imageSize?: [number, number];
}

export const SPECS: SyntheticSpec[] = [
  {
    id: 'standard',
    title: 'Council approves harbour tram line after late vote',
    description:
      'Councillors backed the scheme by 31 votes to 29, ending a decade of argument over the waterfront.',
    kicker: 'Transport',
    siteName: 'The Courier',
    authors: ['Jane Roe'],
    published: date(2026, 11, 6),
    modified: date(2026, 11, 7),
    url: 'https://www.thecourier.example/transport/2026/nov/06/council-approves-harbour-tram-line',
    lang: 'en',
    brand: '#052962',
    image: 205,
    logo: 'wordmark',
  },
  {
    id: 'long',
    title:
      'Regulators say the merger of the two largest regional ferry operators could raise prices on twelve island routes unless the companies agree to sell a third of their combined fleet within eighteen months',
    description:
      'The competition authority published a 140-page assessment on Friday, concluding that passengers on the smaller routes would have no practical alternative, and giving the operators until the end of January to respond with remedies that go well beyond the offer made in the summer.',
    kicker: 'Business',
    siteName: 'The Courier',
    authors: ['Jane Roe', 'Sam Okafor', 'Priya Raman', 'Luca Verdi'],
    published: date(2026, 11, 6),
    url: 'https://www.thecourier.example/business/2026/nov/06/regulators-warn-ferry-merger-could-raise-prices-island-routes-competition-authority-assessment',
    lang: 'en',
    brand: '#B3261E',
    image: 340,
    logo: 'wordmark',
  },
  {
    id: 'short',
    title: 'Rates held',
    siteName: 'Ledger',
    published: date(2026, 11, 6),
    url: 'https://www.ledger.example/rates',
    lang: 'en',
    brand: '#0B6E4F',
    image: 140,
    logo: 'icon',
  },
  {
    id: 'cjk',
    title: '国産ロボット掃除機、新モデルで障害物検知を大幅強化',
    description:
      'メーカーは11月発売の新モデルで、カメラとLiDARを組み合わせた検知方式を採用したと発表した。',
    siteName: 'ITnews',
    published: date(2026, 11, 6),
    url: 'https://www.itnews.example/articles/2611/06/news042.html',
    lang: 'ja',
    brand: '#E64415',
    image: 20,
    logo: 'glyph',
  },
  {
    id: 'arabic',
    title: 'ارتفاع أسعار النفط بعد قرار المنتجين بخفض الإنتاج للشهر الثالث على التوالي',
    description: 'قفزت الأسعار أكثر من ثلاثة في المئة بعد اجتماع المنتجين الرئيسيين في فيينا.',
    kicker: 'اقتصاد',
    siteName: 'الأخبار',
    published: date(2026, 11, 6),
    url: 'https://www.alakhbar.example/news/2026/11/06/economy-1',
    lang: 'ar',
    dir: 'rtl',
    brand: '#7A3E9D',
    image: 285,
    logo: 'icon',
  },
  {
    id: 'hebrew',
    title: 'הממשלה אישרה את התקציב החדש לאחר דיון סוער שנמשך עד שעות הבוקר',
    description: 'השרים תמכו בהצעה ברוב של שמונה עשר מול שישה.',
    siteName: 'חדשות',
    published: date(2026, 11, 6),
    url: 'https://news.example/il/2026/11/06/item',
    lang: 'he',
    dir: 'rtl',
    brand: '#1A5FB4',
    image: 215,
    logo: 'icon',
  },
  {
    id: 'german',
    title:
      'Donaudampfschifffahrtsgesellschaftskapitänsmützenhersteller verkündet Rekordgewinn und plant Übernahme',
    description:
      'Wirtschaftsprüfungsgesellschaften bezweifeln die Bewertungsgrundlagen der Transaktion.',
    kicker: 'Wirtschaft',
    siteName: 'DER KURIER',
    published: date(2026, 11, 6),
    url: 'https://www.derkurier.example/wirtschaft/hafen-ausbau-a-123.html',
    lang: 'de',
    brand: '#E64415',
    image: 25,
    logo: 'wordmark',
  },
  {
    id: 'italian',
    title: 'Città, perché l’università è più cara: così è già cambiata la vita degli studenti',
    description:
      'Affitti, trasporti e tasse: il costo medio di un anno fuori sede supera i dodicimila euro.',
    kicker: 'Cronaca',
    siteName: 'Il Giornale Test',
    authors: ['Luca Verdi'],
    published: date(2026, 11, 6),
    url: 'https://www.ilgiornale.example/cronaca/2026/11/06/universita-costi',
    lang: 'it',
    brand: '#8C1D40',
    image: 350,
    logo: 'wordmark',
  },
  {
    id: 'emoji',
    title: 'Launch day 🚀: the team shipped 🎉 and nobody slept 😴',
    description: 'A behind-the-scenes look at the final 48 hours ☕',
    siteName: 'TechWire',
    published: date(2026, 11, 6),
    url: 'https://techwire.example/2026/11/06/launch-day/',
    lang: 'en',
    brand: '#2A6FDB',
    image: 175,
    logo: 'icon',
  },
  {
    id: 'no-image',
    title: 'City hall will keep the winter market open until the end of January',
    description: 'Traders asked for six more weeks after strong sales in December.',
    siteName: 'The Courier',
    published: date(2026, 11, 6),
    url: 'https://www.thecourier.example/city/winter-market',
    lang: 'en',
    brand: '#052962',
    image: null,
    logo: 'wordmark',
  },
  {
    id: 'monogram',
    title: 'Fishing quotas cut for the third year running',
    siteName: 'Harbour Gazette',
    published: date(2026, 11, 6),
    url: 'https://harbourgazette.example/news/quotas',
    lang: 'en',
    brand: '#0F766E',
    image: null,
    logo: null,
  },
  {
    id: 'hn',
    title: 'A tiny static site generator in 200 lines',
    kicker: 'Show HN',
    description: 'example.test',
    siteName: 'Hacker News',
    authors: ['dhouston'],
    published: date(2026, 11, 6),
    url: 'https://news.ycombinator.com/item?id=4242',
    lang: 'en',
    brand: '#FF6600',
    image: null,
    logo: 'glyph',
  },
];

export async function makeArticle(spec: SyntheticSpec): Promise<ArticleModel> {
  const brand = spec.brand ?? '#052962';
  const image =
    spec.image === null || spec.image === undefined
      ? null
      : await syntheticPhoto(spec.image, ...(spec.imageSize ?? [1600, 840]));
  let logo: LoadedLogo | null = null;
  if (spec.logo === 'wordmark') logo = await syntheticWordmark(spec.siteName, '#161616');
  else if (spec.logo === 'icon')
    logo = await syntheticIcon(Array.from(spec.siteName)[0] ?? 'N', brand);
  else if (spec.logo === 'glyph') logo = await syntheticGlyph(brand);

  return {
    inputUrl: spec.url,
    finalUrl: spec.url,
    citeUrl: spec.url,
    provenance: ['manual'],
    status: 'ok',
    fields: {
      title: field(spec.title),
      description: field(spec.description ?? null),
      kicker: field(spec.kicker ?? null),
      siteName: field(spec.siteName),
      authors: field(spec.authors ?? null),
      published: field(spec.published ?? null),
      modified: field(spec.modified ?? null),
      image: field(image),
      logo: field(logo),
    },
    imageCandidates: [],
    logoCandidates: [],
    brand: { color: brand, paper: spec.paper, palette: [brand] },
    lang: spec.lang,
    dir: spec.dir ?? 'ltr',
  };
}
