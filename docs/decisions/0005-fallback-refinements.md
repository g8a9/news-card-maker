# 0005: Refinements to the fallbacks (bookmarklet, page source, manual mode)

- **Status:** accepted, 2026-11-07
- **Plan reference:** §9.2, §9.5 (states), §11 (bookmarklet)

M6 follows the plan. These are the places where building it forced a decision the plan leaves open, or
where the result differs from the sketch. Each one is covered by a unit or end-to-end test.

## Changes

1. **The bookmarklet bundle is compile-checked.** esbuild starts its IIFE output with a `"use strict";`
   directive, and `void("use strict";…)` is a syntax error: the first build of the bookmarklet would not
   have run in any browser. A unit test caught it. `scripts/build-bookmarklet.ts` now strips the directive
   and compiles the result with `node:vm` (without running it), so a bookmarklet that cannot parse fails
   the build. The unit tests also compile the code the install dialog hands out.

2. **Microdata is not collected.** §11 lists what the collector copies, and microdata is not on the list.
   It would also mean copying the article's own element, which usually wraps the body text (§12.3 forbids
   handling that). A page that describes its author and image only through microdata therefore loses
   those two fields through the bookmarklet; **Paste page source** keeps them. Every other fixture gives
   the same title, subtitle, outlet, date, author, image and canonical link whether the whole page or the
   collected subset is extracted (`bookmarklet-collector.test.ts`).

3. **The hash is dropped before it is decoded.** The receiver removes `#bm=…` from the address first
   (§11 step 4 comes before the pipeline), so a reload or a bookmark never carries the page's data, even
   when the data turns out to be invalid. `hashchange` is handled too, for a bookmarklet run on the app's
   own tab. Invalid data ends on the landing page with a message.

4. **A page we could not read at all replaces the card.** §9.5 asks for an empty state when nothing was
   found. The stage, the action bar and the settings panel are hidden and the message with its three
   actions is shown in the middle; Copy, Download and the image-paste shortcut are off. Partial pages
   (some fields found) keep the card with a banner above it.

5. **Dropped files are handled for the whole page.** A browser opens a file that is dropped where nothing
   handles it, which would throw the card away. `ui/file-drop.ts` takes `.html` files (to the paste dialog,
   with the file ready), images (to the card's image when there is a card) and says so for anything else.
   The stage and the dialog handle their own drops first and mark them as handled.

6. **The page address is optional in the paste dialog.** Saved pages and View Source copies usually say
   where they came from: the "saved from url" comment browsers add, the canonical link, `og:url` or
   `<base>`, checked in that order (`core/source.ts`). Only when none of them gives an address does the
   dialog ask. A chosen or dropped file is held in memory and shown by name instead of being poured into
   the text box, and it is decoded with the charset the page declares.

7. **Manual mode goes through the same model.** `core/manual.ts` builds an `Extraction` whose candidates
   come from the user (or the registry, for the picked outlet's name, logos and colour), so everything
   after it works unchanged. The link is optional: without one, the card prints no address. The outlet
   picker is a list of the registry's outlets sorted by name, plus a free-text name for any other.

8. **The one `javascript:` URL in the app.** `h()` refuses any URL attribute that is not http(s), `blob:` or
   `data:image/`, so the install dialog sets the bookmarklet link's `href` with `setAttribute`. Nothing
   extracted from a page flows into it: it is our own bundle plus this page's address. Clicking it in the
   page is cancelled (the CSP would block it anyway) and explains that it is meant to be dragged.
