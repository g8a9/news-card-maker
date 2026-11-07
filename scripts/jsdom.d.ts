// Minimal typings for the one corner of jsdom the scripts use. (Installing @types/jsdom at the repo
// root changes how the proxy workspace resolves Response/BodyInit, so we declare just what we need.)
declare module 'jsdom' {
  export class JSDOM {
    constructor(html?: string, options?: { contentType?: string; url?: string });
    readonly window: Window & typeof globalThis;
  }
}
