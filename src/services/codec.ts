function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(value: string): Uint8Array {
  const b64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  const bin = atob(padded);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function compress(bytes: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream('gzip');
  const stable = Uint8Array.from(bytes);
  const stream = new Blob([stable]).stream().pipeThrough(cs);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function decompress(bytes: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('gzip');
  const stable = Uint8Array.from(bytes);
  const stream = new Blob([stable]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function encodeSerials(serials: number[], maxSerial: number): Promise<string> {
  const useU16 = maxSerial > 255;
  const body = useU16 ? new Uint16Array(serials) : new Uint8Array(serials);
  const payload = new Uint8Array(body.buffer);
  const zipped = await compress(payload);
  return `${zipped.byteLength}.${toBase64Url(zipped)}`;
}

export async function decodeSerials(encoded: string, maxSerial: number): Promise<number[]> {
  const sep = encoded.indexOf('.');
  if (sep <= 0 || sep >= encoded.length - 1) throw new Error('Invalid encoded payload');
  const compressedSizeText = encoded.slice(0, sep);
  const b64 = encoded.slice(sep + 1);

  const compressedSize = Number(compressedSizeText);
  if (!Number.isInteger(compressedSize) || compressedSize < 0) {
    throw new Error(`Invalid compressed payload size (${compressedSizeText}`);
  }

  const zipped = fromBase64Url(b64);
  if (zipped.byteLength !== compressedSize) {
    throw new Error(`Compressed payload size mismatch (${zipped.byteLength} != ${compressedSize})`);
  }

  const body = await decompress(zipped);
  if (maxSerial > 255) {
    if (body.byteLength % 2 !== 0) {
      throw new Error(`Invalid payload length for 16-bit width: ${body.byteLength}`);
    }
    return Array.from(new Uint16Array(body.buffer, body.byteOffset, body.byteLength / 2));
  }
  return Array.from(body);
}
