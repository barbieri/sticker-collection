import type { SerialEntry, StickerSpec } from '../types';
import { normalizeStickerCode } from './sticker-code';

export interface SpecRuntime {
  specId: string;
  spec: StickerSpec;
  serials: SerialEntry[];
  serialByCode: Map<string, number>;
  byNumber: (serial: number) =>
    | {
        section: StickerSpec['sections'][number];
        group: StickerSpec['sections'][number]['items'][number];
        item: StickerSpec['sections'][number]['items'][number]['items'][number];
      }
    | undefined;
  byID: (humanId: string) =>
    | {
        section: StickerSpec['sections'][number];
        group: StickerSpec['sections'][number]['items'][number];
        item: StickerSpec['sections'][number]['items'][number]['items'][number];
      }
    | undefined;
}

interface EmbeddedSpecPayload {
  branding: StickerSpec['branding'];
  sections: StickerSpec['sections'];
  lookup: {
    numberToIndexes: [number, number, number][];
    idToNumber: Record<string, number>;
  };
}

function normalizeCompactHumanId(input: string): string {
  return normalizeStickerCode(input)
    .replace(/-/g, '')
    .replace(/(\D)0+(\d)/g, '$1$2');
}

function assertValidSpec(spec: unknown): asserts spec is EmbeddedSpecPayload {
  const s = spec as EmbeddedSpecPayload;
  if (!s || !Array.isArray(s.sections))
    throw new Error('Invalid embedded spec: sections is required');
  if (
    !s.lookup ||
    !Array.isArray(s.lookup.numberToIndexes) ||
    typeof s.lookup.idToNumber !== 'object'
  ) {
    throw new Error('Invalid embedded spec: lookup is required');
  }
}

export function resolveName(name: string | Record<string, string>, locale = 'en-US'): string {
  if (typeof name === 'string') return name;
  return name[locale] ?? name['en-US'] ?? Object.values(name)[0] ?? '';
}

export async function loadSpec(specId: string): Promise<SpecRuntime> {
  const raw = window.__APP_CONFIG__?.specData;
  assertValidSpec(raw);

  const spec: StickerSpec = {
    branding: raw.branding,
    sections: raw.sections,
  };

  const byNumber: SpecRuntime['byNumber'] = (serial) => {
    const indexes = raw.lookup.numberToIndexes[serial];
    if (!indexes) return undefined;
    const [sectionIndex, groupIndex, itemIndex] = indexes;
    const section = spec.sections[sectionIndex];
    const group = section?.items[groupIndex];
    const item = group?.items[itemIndex];
    if (!section || !group || !item) return undefined;
    return { section, group, item };
  };

  const byID: SpecRuntime['byID'] = (humanId) => {
    const serial = raw.lookup.idToNumber[normalizeCompactHumanId(humanId)];
    if (typeof serial !== 'number') return undefined;
    return byNumber(serial);
  };

  const serials: SerialEntry[] = [];
  const serialByCode = new Map<string, number>();
  for (let serial = 0; serial < raw.lookup.numberToIndexes.length; serial += 1) {
    const ref = byNumber(serial);
    if (!ref) continue;
    serials.push({ serial, groupId: ref.group.id, itemId: ref.item.id, itemName: ref.item.name });
    serialByCode.set(`${ref.group.id}${ref.item.id}`, serial);
    serialByCode.set(normalizeStickerCode(`${ref.group.id}${ref.item.id}`), serial);
  }

  return { specId, spec, serials, serialByCode, byNumber, byID };
}
