# 0001: Capture library: `@zumer/snapdom`, not `modern-screenshot`

- **Status:** accepted, 2026-11-07
- **Plan reference:** D4, §8.1, §15 M5 ("spike first")

## Context

PLAN.md D4 names `modern-screenshot` as the default and `@zumer/snapdom` as the alternative, to be chosen
by a spike in M5. The card is DOM + CSS, so the exported PNG has to match what the browser shows.

## Method

`web/dev/spike.ts` and `web/tests/e2e/spike.spec.ts` (run with `CAPTURE_SPIKE=1 npx playwright test spike
--workers=1`; kept so the numbers can be reproduced). For 13 cards from the dev gallery (every template,
five themes, RTL, CJK, emoji, a long German compound, fixed and auto sizes, three frames including the blurred
backdrop), in Chromium, Firefox and WebKit at a device scale factor of 2:

1. Playwright screenshots the card element: that is "what the browser shows".
2. Each library captures the same element at `scale: 2`, twice in a fresh page (first and second capture).
3. Both images are composited on grey and compared pixel by pixel: the share of pixels whose channel
   differs by more than 32/255, plus capture time.

Versions: `modern-screenshot` 4.7.0, `@zumer/snapdom` 3.7.1, Playwright 1.65 (Chromium, Firefox 150-series,
WebKit 27.2).

## Results

Mean over the 13 cards (worst card in brackets). "Differing" is the share of pixels that visibly differ.

| Engine   | Library           | Differing       | Capture, first / second |
| -------- | ----------------- | --------------- | ----------------------- |
| Chromium | modern-screenshot | 0.31% (1.0%)    | 84 / 77 ms              |
| Chromium | snapdom           | 0.38% (1.6%)    | 65 / 38 ms              |
| Firefox  | modern-screenshot | **4.1%** (6.0%) | 292 / 277 ms            |
| Firefox  | snapdom           | 0.64% (1.5%)    | 78 / 30 ms              |
| WebKit   | modern-screenshot | 0.66% (1.2%)    | 302 / 288 ms            |
| WebKit   | snapdom           | 0.67% (1.2%)    | 138 / 61 ms             |

- **Fidelity.** Fixed-size cards are essentially identical to the browser in Chromium for both libraries
  (≤ 0.06%). The ~1% on auto-height cards is a one-pixel row from fractional heights in the reference
  screenshot and affects both libraries equally. `modern-screenshot` is clearly worse in Firefox on every card
  (3% to 6%); `snapdom` is within 1.5% everywhere. In WebKit they are level.
- **Speed.** `snapdom` is 1.2× to 5× faster in every engine, and its second capture is about twice as fast as
  its first (resource caching).
- **First-capture reliability.** In these engines the first capture was as good as the second for both
  libraries, so the "images or fonts missing from the first draw" failure the plan warns about did not show up.
  Playwright's WebKit is not Safari: this still needs a check in real Safari (see `docs/qa.md`).
- **Fonts.** Both embed the same-origin Fontsource faces correctly, including CJK/Arabic/Hebrew fallbacks that
  come from system fonts (they are rasterised as the browser draws them).

## Decision

Use `@zumer/snapdom` behind the adapter in `web/src/export/capture.ts` (`renderToBlob`). Keep
`modern-screenshot` as a dev dependency so the spike stays reproducible; it is not in the production bundle.
Swapping libraries later means changing that one file.

## Consequences

- The capture runs on an unscaled clone of the card in an off-screen host, so the preview's `transform: scale()`
  never leaks into the export.
- The "warm-up capture" for Safari (PLAN.md §8.1) is kept as a cheap safeguard even though the spike did not
  need it: the first background render in a WebKit browser is discarded and repeated.
- snapdom's own limits (16,384 px per side in Safari, area guards) sit above ours (§8.1 area limit), so our
  scale guard is the one that applies.
