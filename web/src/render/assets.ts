// Prepares the pre-baked assets a card needs (PLAN.md §6.4, §7.6, §8.4): a grayscale or dimmed
// image, a recoloured logo, a blurred frame backdrop. Everything is a canvas-derived data URL, so the
// exported PNG never depends on CSS filters or masks.
import { bakeImage, blurredBackdrop } from '../brand/imagefx.ts';
import { chooseTreatment, isSvgLogo, logoStats, recolorLogo } from '../brand/logo.ts';
import { buildTheme } from '../brand/theme.ts';
import type { Outlet } from '../core/registry.ts';
import { type ArticleModel, effective } from '../core/types.ts';
import type { RenderAssets } from './parts.ts';
import type { CardStyle } from './style.ts';

export async function prepareAssets(
  article: ArticleModel,
  style: CardStyle,
  outlet?: Outlet | null,
): Promise<RenderAssets> {
  const assets: RenderAssets = {};
  const image = effective(article.fields.image);
  const logo = effective(article.fields.logo);
  const tokens = buildTheme(style.theme, {
    brand: style.accent ?? article.brand.color ?? null,
    paper: article.brand.paper ?? null,
  });

  if (image && style.show.image && style.template !== 'headline') {
    // The Mono theme means greyscale images unless the user picked a different effect.
    const filter =
      style.theme === 'mono' && style.imageFilter === 'none' ? 'grayscale' : style.imageFilter;
    try {
      assets.imageSrc =
        filter === 'grayscale' || filter === 'dim'
          ? await bakeImage(image.objectUrl, filter)
          : image.objectUrl;
    } catch {
      assets.imageSrc = image.objectUrl;
    }
  }

  if (logo && style.show.logo) {
    const stats = await logoStats(logo.objectUrl);
    const darkSurface =
      style.theme === 'dark' || style.theme === 'brand' || style.theme === 'image';
    const wordmarkHints = outlet?.logo?.[logo.ref.kind === 'wordmark' ? 'wordmark' : 'icon'];
    const hint = darkSurface ? wordmarkHints?.onDark : wordmarkHints?.onLight;
    const treatment = chooseTreatment({ choice: style.logoStyle, theme: style.theme, stats, hint });
    assets.logoOpaque =
      treatment === 'original' && stats?.opaqueCorners === true && logo.ref.kind !== 'wordmark';
    try {
      assets.logoSrc =
        treatment === 'mono'
          ? await recolorLogo(logo.objectUrl, tokens.ink, isSvgLogo(logo))
          : logo.objectUrl;
    } catch {
      assets.logoSrc = logo.objectUrl;
    }
  }

  if (style.frame.enabled && style.frame.background.kind === 'blur' && image) {
    try {
      assets.frameBlurSrc = await blurredBackdrop(image.objectUrl);
    } catch {
      assets.frameBlurSrc = null;
    }
  }
  return assets;
}
