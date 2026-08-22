import type { CollectionState } from '../types';

const PREFIX = 'sticker-collection:v1';

export function keyFor(spec: string, name: string): string {
  return `${PREFIX}:collection:${spec}:${name}`;
}

export function saveCollection(state: CollectionState): void {
  localStorage.setItem(keyFor(state.spec, state.name), JSON.stringify(state));
  const raw = localStorage.getItem(`${PREFIX}:registry`);
  const registry = raw ? (JSON.parse(raw) as Array<{ spec: string; name: string }>) : [];
  if (!registry.some((entry) => entry.spec === state.spec && entry.name === state.name)) {
    registry.push({ spec: state.spec, name: state.name });
    localStorage.setItem(`${PREFIX}:registry`, JSON.stringify(registry));
  }
}

export function loadCollection(spec: string, name: string): CollectionState | null {
  const value = localStorage.getItem(keyFor(spec, name));
  return value ? (JSON.parse(value) as CollectionState) : null;
}
