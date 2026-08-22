import { describe, expect, it } from 'vitest';
import { decodeSerials, encodeSerials } from './codec';

describe('serial codec', () => {
  it('encodes and decodes 8-bit serials with dot delimiter', async () => {
    const serials = [0, 1, 2, 7, 42, 255];
    const encoded = await encodeSerials(serials, 255);

    expect(encoded).toContain('.');
    expect(encoded).not.toContain(':');
    await expect(decodeSerials(encoded, 255)).resolves.toEqual(serials);
  });

  it('encodes and decodes 16-bit serials', async () => {
    const serials = [0, 1, 256, 511, 4096, 65535];
    const encoded = await encodeSerials(serials, 65535);

    await expect(decodeSerials(encoded, 65535)).resolves.toEqual(serials);
  });

  it('rejects malformed encoded payload', async () => {
    await expect(decodeSerials('invalid', 255)).rejects.toThrow('Invalid encoded payload');
  });

  it('rejects invalid compressed size and size mismatch', async () => {
    await expect(decodeSerials('x.abc', 255)).rejects.toThrow('Invalid compressed payload size');
    const encoded = await encodeSerials([1, 2, 3], 255);
    const dot = encoded.indexOf('.');
    const bad = `0${encoded.slice(dot)}`;
    await expect(decodeSerials(bad, 255)).rejects.toThrow('Compressed payload size mismatch');
  });

  it('rejects odd payload length when maxSerial requires 16-bit', async () => {
    const encoded = await encodeSerials([1, 2, 3], 255);
    await expect(decodeSerials(encoded, 65535)).rejects.toThrow(
      'Invalid payload length for 16-bit width',
    );
  });
});
