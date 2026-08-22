import { describe, expect, it } from 'vitest';
import { normalizeStickerCode } from './sticker-code';

describe('normalizeStickerCode', () => {
  it('normalizes known sticker code patterns', () => {
    expect(normalizeStickerCode(' mex-01 ')).toBe('MEX-1');
    expect(normalizeStickerCode('MEX1')).toBe('MEX-1');
  });

  it('returns cleaned value when pattern does not match', () => {
    expect(normalizeStickerCode('abc_12')).toBe('ABC_12');
  });
});
