export function normalizeStickerCode(input: string): string {
  const cleaned = input.trim().toUpperCase().replace(/\s+/g, '').replace(/-/g, '');
  const match = cleaned.match(/^([A-Z]+)(\d+)$/);
  if (!match) return cleaned;
  const [, group, numRaw] = match as [string, string, string];
  const num = String(Number.parseInt(numRaw, 10));
  return `${group}-${num}`;
}
