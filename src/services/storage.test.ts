import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CollectionState } from '../types';
import { keyFor, loadCollection, saveCollection } from './storage';

const makeState = (): CollectionState => ({
  spec: 'wc2026',
  name: 'album-a',
  owned: [1, 2],
  duplicates: [2],
});

describe('storage', () => {
  beforeEach(() => {
    const mem = new Map<string, string>();
    Object.defineProperty(globalThis, 'localStorage', {
      value: {
        getItem: (key: string): string | null => mem.get(key) ?? null,
        setItem: (key: string, value: string): void => {
          mem.set(key, value);
        },
        clear: (): void => {
          mem.clear();
        },
      },
      configurable: true,
    });
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('builds storage keys', () => {
    expect(keyFor('s', 'n')).toBe('sticker-collection:v1:collection:s:n');
  });

  it('saves collection and adds unique registry entry', () => {
    const state = makeState();
    saveCollection(state);
    saveCollection(state);

    expect(loadCollection(state.spec, state.name)).toEqual(state);
    const registry = JSON.parse(localStorage.getItem('sticker-collection:v1:registry') ?? '[]');
    expect(registry).toEqual([{ spec: state.spec, name: state.name }]);
  });

  it('loads null when collection is absent', () => {
    expect(loadCollection('missing', 'collection')).toBeNull();
  });
});
