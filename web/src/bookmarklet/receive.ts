// The app's side of the bookmarklet (PLAN.md §11): reads `#bm=…` on arrival.
import { decodePayload, type Payload } from './payload.ts';

/** The payload in the URL fragment, or null when there is none. Throws when there is one that is invalid. */
export async function readBookmarklet(hash: string): Promise<Payload | null> {
  if (!hash.startsWith('#bm=')) return null;
  return decodePayload(hash.slice(4));
}

export const hasBookmarklet = (hash: string): boolean => hash.startsWith('#bm=');
