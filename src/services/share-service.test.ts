import { describe, expect, it } from 'vitest';
import {
  exportDuplicates,
  exportMissing,
  formatTextStickerList,
  parseSharedData,
  parseTextStickerList,
  type TextShareEntry,
} from './share-service';

describe('share-service', () => {
  it('exports missing and duplicates payloads', async () => {
    const missing = await exportMissing('spec-1', 'n', [3, 4], 255);
    const dup = await exportDuplicates('spec-1', 'n', [5, 6], 255);

    const missingParsed = await parseSharedData(missing, 255);
    const dupParsed = await parseSharedData(dup, 255);

    expect(missingParsed).toEqual({ spec: 'spec-1', name: 'n', missing: [3, 4] });
    expect(dupParsed).toEqual({ spec: 'spec-1', name: 'n', duplicates: [5, 6] });
  });

  it('parses empty shared data params', async () => {
    const parsed = await parseSharedData(new URLSearchParams(), 255);
    expect(parsed).toEqual({ spec: '', name: '' });
  });

  it('formats text sticker lists by group in spec order', () => {
    const entries: TextShareEntry[] = [
      { serial: 1, groupId: 'FWC', itemId: '00' },
      { serial: 2, groupId: 'FWC', itemId: '2' },
      { serial: 3, groupId: 'FWC', itemId: '3' },
      { serial: 4, groupId: 'RSA', itemId: '1' },
    ];

    expect(formatTextStickerList(entries, [1, 2, 2, 4])).toBe('FWC: 00 2 (x2)\nRSA: 1');
  });

  it('parses resilient text sticker lists', () => {
    const entries: TextShareEntry[] = [
      { serial: 1, groupId: 'MEX', itemId: '1' },
      { serial: 2, groupId: 'MEX', itemId: '2' },
      { serial: 3, groupId: 'MEX', itemId: '3' },
      { serial: 4, groupId: 'MEX', itemId: '6' },
      { serial: 5, groupId: 'MEX', itemId: '7' },
      { serial: 6, groupId: 'RSA', itemId: '1' },
      { serial: 7, groupId: 'RSA', itemId: '2' },
      { serial: 8, groupId: 'RSA', itemId: '3' },
      { serial: 9, groupId: 'RSA', itemId: '4' },
      { serial: 10, groupId: 'RSA', itemId: '5' },
      { serial: 11, groupId: 'KOR', itemId: '1' },
      { serial: 12, groupId: 'KOR', itemId: '2' },
      { serial: 13, groupId: 'KOR', itemId: '3' },
      { serial: 14, groupId: 'BRA', itemId: '1' },
      { serial: 15, groupId: 'BRA', itemId: '2' },
      { serial: 16, groupId: 'CAN', itemId: '1' },
      { serial: 17, groupId: 'CAN', itemId: '2' },
      { serial: 18, groupId: 'CAN', itemId: '3' },
      { serial: 19, groupId: 'CAN', itemId: '4' },
    ];

    expect(
      parseTextStickerList(
        entries,
        `
          MEX 1 2 3 RSA 4 5 MEX 6 7
          RSA: 1 2 3
          KOR: 1, 2, 3
          BRA-1, BRA-2
          CAN-1 (x2), CAN: 2, 3 (x3) , 4 x 5
          CAN-1 CAN-1
        `,
      ),
    ).toEqual([
      1, 2, 3, 9, 10, 4, 5, 6, 7, 8, 11, 12, 13, 14, 15, 16, 16, 17, 18, 18, 18, 19, 19, 19, 19, 19,
      16, 16,
    ]);
  });

  it('ignores text without known groups or known item ids', () => {
    const entries: TextShareEntry[] = [{ serial: 1, groupId: 'CAN', itemId: '1' }];

    expect(parseTextStickerList([], 'CAN 1')).toEqual([]);
    expect(parseTextStickerList(entries, '1 2 3 CAN 99')).toEqual([]);
    expect(parseTextStickerList(entries, 'CAN 1 x 0')).toEqual([]);
  });
});
