// Immutable get/set by dotted path, for the schema-driven panel (PLAN.md §9.4).

export function getPath(root: unknown, path: string): unknown {
  let node: unknown = root;
  for (const key of path.split('.')) {
    if (node === null || typeof node !== 'object') return undefined;
    node = (node as Record<string, unknown>)[key];
  }
  return node;
}

/** A copy of `root` with `value` at `path`; everything off the path is shared, nothing is mutated. */
export function setPath<T>(root: T, path: string, value: unknown): T {
  const keys = path.split('.');
  const copy = (node: unknown, i: number): unknown => {
    if (i === keys.length) return value;
    const obj = (node !== null && typeof node === 'object' ? node : {}) as Record<string, unknown>;
    const key = keys[i] as string;
    return { ...obj, [key]: copy(obj[key], i + 1) };
  };
  return copy(root, 0) as T;
}
