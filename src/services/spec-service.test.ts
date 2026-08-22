import { describe, expect, it } from 'vitest';
import { messages } from '../i18n/messages';
import { loadSpec, resolveName } from './spec-service';

describe('resolveName', () => {
  it('handles string and localized object with fallback', () => {
    expect(resolveName('Plain', 'pt-BR')).toBe('Plain');
    expect(resolveName({ 'en-US': 'Hello', 'pt-BR': 'Ola' }, 'pt-BR')).toBe('Ola');
    expect(resolveName({ 'en-US': 'Hello' }, 'fr-FR')).toBe('Hello');
    expect(resolveName({ 'es-ES': 'Hola' }, 'fr-FR')).toBe('Hola');
    expect(resolveName({}, 'fr-FR')).toBe('');
  });
});

describe('loadSpec', () => {
  const baseConfig = {
    specId: 'test-spec',
    locale: 'en-US' as const,
    messages: messages['en-US'],
  };

  it('throws when embedded spec is invalid', async () => {
    Object.defineProperty(globalThis, 'window', { value: {}, configurable: true });
    window.__APP_CONFIG__ = { ...baseConfig, specData: {} };
    await expect(loadSpec('x')).rejects.toThrow('Invalid embedded spec: sections is required');

    window.__APP_CONFIG__ = {
      ...baseConfig,
      specData: { sections: [] },
    };
    await expect(loadSpec('x')).rejects.toThrow('Invalid embedded spec: lookup is required');
  });

  it('loads runtime and resolves lookups', async () => {
    Object.defineProperty(globalThis, 'window', { value: {}, configurable: true });
    window.__APP_CONFIG__ = {
      ...baseConfig,
      specData: {
        branding: { title: 'World Cup' },
        sections: [
          {
            id: 'A',
            name: 'Section A',
            items: [
              {
                id: 'MEX',
                name: 'Mexico',
                items: [
                  { id: '01', name: 'One' },
                  { id: '02', name: { 'en-US': 'Two' } },
                ],
              },
            ],
          },
        ],
        lookup: {
          numberToIndexes: [
            [0, 0, 0],
            [0, 0, 1],
            [9, 9, 9],
          ],
          idToNumber: {
            MEX1: 0,
            MEX2: 1,
          },
        },
      },
    };

    const runtime = await loadSpec('wc2026');
    expect(runtime.specId).toBe('wc2026');
    expect(runtime.serials).toHaveLength(2);
    expect(runtime.byNumber(0)?.item.id).toBe('01');
    expect(runtime.byNumber(2)).toBeUndefined();
    expect(runtime.byNumber(99)).toBeUndefined();
    expect(runtime.byID('MEX-01')?.item.id).toBe('01');
    expect(runtime.byID('missing')).toBeUndefined();
    expect(runtime.serialByCode.get('MEX01')).toBe(0);
    expect(runtime.serialByCode.get('MEX-1')).toBe(0);
  });
});
