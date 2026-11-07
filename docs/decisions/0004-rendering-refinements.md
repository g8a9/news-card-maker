# 0004: Refinements to rendering and fitting

- **Status:** accepted, 2026-11-07
- **Plan reference:** §6.6 (themes), §7.2 (templates), §7.4 (fitting), §7.6 (frame)

Rendering all 399 combinations of the dev gallery (every template × theme × size, plus a dozen edge-case
fixtures) in Chromium, Firefox and WebKit turned up places where the plan's numbers gave poor results.
Every change is covered by a unit test or by `web/tests/e2e/gallery.spec.ts`.

## Changes

1. **The fitter holds the deck to one line while it searches for the headline size** (§7.4 step 1), then
   gives the deck back as many lines as fit (step 2). Searching with a three-line deck made the headline
   collapse to its minimum size at 16:9 even when a single line of deck would have fitted. As a last resort
   (after dropping optional fields) the headline may go a quarter below the template minimum before the
   fitter reports an overflow. The "headline floor" of the Headline template is 3.4u instead of 5u for the
   same reason: 5u overflowed on very long headlines. Typical headlines still land between 5u and 8u.

2. **Classic proportions in fixed sizes.** About 50% of the height for the image left no room for masthead,
   headline, deck and meta at 16:9, 1.91:1 and 2:1. The image now takes 46% (landscape), 40% for very wide
   sizes (≥ 1.8:1), 45% (square) and 40% (portrait), the body's vertical padding is 3.6u instead of 5u, and
   gaps are slightly tighter. Auto height is unchanged (1.91:1 image, 5u padding).

3. **Tall and square cards get larger headline bounds** (×1.3 portrait, ×1.12 square): a 9:16 card has far
   more room than a 16:9 one, and a 4.4u headline looked lost in it.

4. **Brand theme: muted text reaches 4.5:1.** §6.6 says "muted = ink at 72%". On mid-tone brand colours
   (404 Media's `#E50B4F` measures 2.9:1) that is unreadable, found by the property test over random brand
   colours. The blend starts at 72% and is firmed up until it reaches 4.5:1.

5. **Split stacks its meta line** (date and author above, URL below) because the text column is too narrow
   for both on one line.

6. **Frame "Blur" backdrop without a blur filter.** The image is shrunk to 32 px and scaled back up with
   smoothing, then dimmed. It looks like a blur, works in every browser, and needs no `ctx.filter`, which
   Safari supported late. The result is a JPEG data URL, so exports never depend on CSS filters.

7. **Colour maths and types.** `culori/fn` needs `modeLrgb` registered for `wcagContrast`. The package ships
   no types, and installing `@types/culori` at the repo root changes how the proxy workspace resolves
   `Response`/`BodyInit`, so `web/src/types/culori.d.ts` declares only the functions we use.

8. **Image and logo URLs are validated before the media block is built**, not only when the attribute is set,
   so a rejected URL never leaves an empty image frame on the card.

## Consequences

A card at a fixed size shows its subtitle in more cases and never overflows (zero overflows across 399
gallery cards in three engines). Where something still has to give, `describeFit()` produces the note the
editor shows ("Subtitle hidden to fit: try Auto height or a taller size").
