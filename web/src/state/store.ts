// A tiny store (PLAN.md §10): get(), set(), subscribe(selector, cb). State changes apply at once;
// subscribers are notified in one batch per frame, only when their selected value changed.

type Equals = (a: unknown, b: unknown) => boolean;

interface Subscription<S> {
  selector: (state: S) => unknown;
  callback: (value: never, previous: never) => void;
  equals: Equals;
  last: unknown;
}

export interface Store<S> {
  get(): S;
  set(update: Partial<S> | ((state: S) => S)): void;
  subscribe<T>(
    selector: (state: S) => T,
    callback: (value: T, previous: T) => void,
    options?: { equals?: Equals; immediate?: boolean },
  ): () => void;
  /** Notify subscribers now instead of at the next frame (tests, and code that must read the DOM next). */
  flush(): void;
}

/** Equal when every element is identical (for selectors that return tuples). */
export const shallowEqual: Equals = (a, b) => {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  }
  return false;
};

export function createStore<S extends object>(initial: S): Store<S> {
  let state = initial;
  const subscriptions = new Set<Subscription<S>>();
  let scheduled = false;

  const flush = () => {
    scheduled = false;
    for (const sub of [...subscriptions]) {
      if (!subscriptions.has(sub)) continue;
      const value = sub.selector(state);
      if (sub.equals(value, sub.last)) continue;
      const previous = sub.last;
      sub.last = value;
      sub.callback(value as never, previous as never);
    }
  };

  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    // requestAnimationFrame does not fire in background tabs; the timer is the backstop.
    let done = false;
    const run = () => {
      if (done) return;
      done = true;
      flush();
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
    setTimeout(run, 50);
  };

  return {
    get: () => state,
    set(update) {
      const next = typeof update === 'function' ? update(state) : { ...state, ...update };
      if (next === state) return;
      state = next;
      schedule();
    },
    subscribe(selector, callback, options = {}) {
      const sub: Subscription<S> = {
        selector,
        callback: callback as Subscription<S>['callback'],
        equals: options.equals ?? Object.is,
        last: selector(state),
      };
      subscriptions.add(sub);
      if (options.immediate) callback(sub.last as never, sub.last as never);
      return () => subscriptions.delete(sub);
    },
    flush,
  };
}
