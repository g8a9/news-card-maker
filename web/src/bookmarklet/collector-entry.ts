// The bookmarklet itself: bundled and minified into one expression by scripts/build-bookmarklet.ts.
// "__NCM_APP_URL__" is replaced with the app's address when the install dialog is shown.
import { collectPage } from './collector.ts';
import { encodePayload } from './payload.ts';

(async () => {
  const payload = await encodePayload(collectPage(document, location.href));
  // The same tab, so no popup blocker and no window.opener problems; the fragment stays in the browser.
  location.href = `__NCM_APP_URL__#bm=${payload}`;
})();
