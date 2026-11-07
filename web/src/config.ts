/** Base URL of the fetch proxy (the Cloudflare Worker), without a trailing slash. */
export const PROXY_URL: string = (import.meta.env.VITE_PROXY_URL ?? '').replace(/\/+$/, '');

/** Where the app is served from (`/` in dev, `/news-card-maker/` on GitHub Pages). */
export const APP_BASE: string = import.meta.env.BASE_URL;
