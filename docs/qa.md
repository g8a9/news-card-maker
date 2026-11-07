# Manual QA checklist

Automated tests cover a lot (see `AGENTS.md`), but a few things need a real browser or a real slides app.
Tick a row when you have checked it, with the date and the browser or app version. Nothing below has been
ticked yet: the implementation was verified with Playwright's Chromium, Firefox and WebKit builds only.

## Copy to the clipboard (PLAN.md §8.2, M5 acceptance)

| Browser (desktop)   | Check                                                                                                                                                                                                                                                            | Status |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Chrome              | **Copy image** puts a PNG on the clipboard; paste into a slide shows the card at 2×                                                                                                                                                                              | ☐      |
| Firefox (127+)      | Same. The Promise-valued `ClipboardItem` is created inside the click handler                                                                                                                                                                                     | ☐      |
| Safari (macOS)      | Same. This is the one most likely to differ: Safari only accepts an image that is handed to `ClipboardItem` as a Promise inside the gesture, and it may draw the first capture without some fonts or images (the app discards one warm-up capture, PLAN.md §8.1) | ☐      |
| Safari (macOS)      | Press Copy straight after the card appears (before the 600 ms pre-render): the picture must still be complete                                                                                                                                                    | ☐      |
| Any                 | Block clipboard access for the site: the "Copy the image" dialog appears with the picture and a working Download button                                                                                                                                          | ☐      |
| iOS / iPadOS Safari | Download or Share works at 2×; a 4× export of a tall card shows "(reduced)" under the preview (16.7 megapixel canvas limit)                                                                                                                                      | ☐      |

Automated: Chromium reads the clipboard back and checks the PNG and its size (`tests/e2e/export.spec.ts`);
Firefox and WebKit only check that Copy either succeeds or opens the fallback dialog, because tests cannot
read their clipboard.

## Pasting into slides

| App                    | Check                                                                                                                       | Status |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------ |
| Google Slides (Chrome) | Paste: the card keeps its rounded, transparent corners on a light and on a dark slide                                       | ☐      |
| PowerPoint for Mac     | Paste, then resize: no jagged edges at 2×. Alt text from "Copy alt text" arrives with the picture (extra E4, not built yet) | ☐      |
| PowerPoint for Windows | Paste from Chrome and from Edge                                                                                             | ☐      |
| Keynote                | Paste: transparency is kept                                                                                                 | ☐      |

## Export

| Check                                                                                                                                                                                       | Status |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 4× export of a 16:9 card (4800 × 2700) opens and looks sharp                                                                                                                                | ☐      |
| JPEG export of a Dark or Paper card has no white edges (it is filled with the card colour)                                                                                                  | ☐      |
| WebP export (Chrome, Safari 17+) opens in Preview and in a browser; Firefox does not offer it (snapdom's WebP export does not finish there, see the comment in `web/src/export/capture.ts`) | ☐      |
| Frame with the "Blurred image" backdrop, shadow "Strong": no banding at 2×                                                                                                                  | ☐      |

## Live sites

| Check                                                                                      | Status |
| ------------------------------------------------------------------------------------------ | ------ |
| Paste five articles from outlets you read; headline, outlet, date and image are right      | ☐      |
| The bookmarklet works on a live Economist article in Chrome and in Safari (M6 acceptance)  | ☐      |
| `npm run smoke -- --proxy <deployed proxy>` report has no surprises after the first deploy | ☐      |

## Keyboard and accessibility

| Check                                                                                                                                      | Status |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| Whole flow with the keyboard only in Chrome, Firefox and Safari (Safari needs "Press Tab to highlight each item" turned on, or Option+Tab) | ☐      |
| VoiceOver reads the preview as a picture with the generated alt text and announces toasts                                                  | ☐      |
