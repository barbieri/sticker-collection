import { decodeSerials, encodeSerials } from './codec';
import { normalizeStickerCode } from './sticker-code';

export interface TextShareEntry {
  serial: number;
  groupId: string;
  itemId: string;
}

export async function exportMissing(
  spec: string,
  name: string,
  missing: number[],
  maxSerial: number,
): Promise<URLSearchParams> {
  const params = new URLSearchParams();
  params.set('spec', spec);
  params.set('name', name);
  params.set('missing', await encodeSerials(missing, maxSerial));
  return params;
}

export async function exportDuplicates(
  spec: string,
  name: string,
  duplicates: number[],
  maxSerial: number,
): Promise<URLSearchParams> {
  const params = new URLSearchParams();
  params.set('spec', spec);
  params.set('name', name);
  params.set('duplicates', await encodeSerials(duplicates, maxSerial));
  return params;
}

export async function parseSharedData(
  params: URLSearchParams,
  maxSerial: number,
): Promise<{ spec: string; name: string; missing?: number[]; duplicates?: number[] }> {
  const spec = params.get('spec') ?? '';
  const name = params.get('name') ?? '';
  const duplicates = params.get('duplicates');
  const missing = params.get('missing');
  const parsed: { spec: string; name: string; missing?: number[]; duplicates?: number[] } = {
    spec,
    name,
  };
  if (duplicates) parsed.duplicates = await decodeSerials(duplicates, maxSerial);
  if (missing) parsed.missing = await decodeSerials(missing, maxSerial);
  return parsed;
}

const normalizeTextShareToken = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const normalizedCodeKey = (groupId: string, itemId: string): string =>
  normalizeStickerCode(`${groupId}${itemId}`).replace(/-/g, '');

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function formatTextStickerList(entries: TextShareEntry[], serials: number[]): string {
  const selected = new Map<number, number>();
  for (const serial of serials) selected.set(serial, (selected.get(serial) ?? 0) + 1);
  const lines: string[] = [];
  let currentGroup = '';
  let currentItems: string[] = [];
  const flush = (): void => {
    if (!currentGroup || currentItems.length === 0) return;
    lines.push(`${currentGroup}: ${currentItems.join(' ')}`);
  };
  for (const entry of entries) {
    const count = selected.get(entry.serial) ?? 0;
    if (entry.groupId !== currentGroup) {
      flush();
      currentGroup = entry.groupId;
      currentItems = [];
    }
    if (count === 0) continue;
    currentItems.push(count > 1 ? `${entry.itemId} (x${count})` : entry.itemId);
  }
  flush();
  return lines.join('\n');
}

export function parseTextStickerList(entries: TextShareEntry[], text: string): number[] {
  const normalizedGroups = new Map<string, string>();
  const serialByCode = new Map<string, number>();
  for (const entry of entries) {
    const normalizedGroup = normalizeTextShareToken(entry.groupId);
    normalizedGroups.set(normalizedGroup, entry.groupId);
    serialByCode.set(normalizedCodeKey(entry.groupId, entry.itemId), entry.serial);
  }
  const groupIds = Array.from(normalizedGroups.keys()).sort((a, b) => b.length - a.length);
  if (groupIds.length === 0) return [];
  const groupRegex = new RegExp(`^(?:${groupIds.map(escapeRegExp).join('|')})$`);
  const tokens = normalizeTextShareToken(text).split(' ').filter(Boolean);
  const serials: number[] = [];
  let groupId = '';
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] as string;
    if (groupRegex.test(token)) {
      groupId = normalizedGroups.get(token) as string;
      continue;
    }
    if (!groupId || !/^\d+$/.test(token)) continue;
    const serial = serialByCode.get(normalizedCodeKey(groupId, token));
    if (typeof serial !== 'number') continue;
    let count = 1;
    const next = tokens[index + 1] ?? '';
    const nextNext = tokens[index + 2] ?? '';
    const compactRepeat = next.match(/^X(\d+)$/);
    if (compactRepeat) {
      count = Math.max(0, Number.parseInt(compactRepeat[1] as string, 10));
      index += 1;
    } else if (next === 'X' && /^\d+$/.test(nextNext)) {
      count = Math.max(0, Number.parseInt(nextNext, 10));
      index += 2;
    }
    for (let repeat = 0; repeat < count; repeat += 1) serials.push(serial);
  }
  return serials;
}
