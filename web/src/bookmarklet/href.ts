// Turns the generated bookmarklet body into a `javascript:` URL for a given app address.
import { BOOKMARKLET_BODY } from './generated.ts';

const PLACEHOLDER = '__NCM_APP_URL__';

export function bookmarkletHref(appUrl: string): string {
  const app = new URL(appUrl).href.replace(/[\\"'`]/g, encodeURIComponent);
  // A bookmarklet's code is percent-decoded when it runs, so encode it once to keep every character as written.
  return `javascript:${encodeURI(BOOKMARKLET_BODY.replace(PLACEHOLDER, app))}`;
}
