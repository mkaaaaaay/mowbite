import {createHash} from 'node:crypto';
import {describe, expect, it} from 'vitest';
import {sha256Hex, sha256Js} from './sha256';

const text = (s: string) => new TextEncoder().encode(s);

describe('sha256', () => {
  it('gives the known test vectors without crypto.subtle (FIPS 180-2)', () => {
    expect(sha256Js(text(''))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Js(text('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256Js(text('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'))).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    );
    expect(sha256Js(text('a'.repeat(1_000_000)))).toBe('cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0');
  });

  it('is the same as node and crypto.subtle at the block edges and for a large file', async () => {
    const bytes = Uint8Array.from({length: 2 << 20}, (_, i) => (i * 31 + (i >> 8)) & 0xff);
    for (const n of [1, 55, 56, 63, 64, 65, 119, 120, 128, 1000, bytes.length]) {
      const part = bytes.slice(0, n);
      const node = createHash('sha256').update(part).digest('hex');
      expect(sha256Js(part), `${n} bytes`).toBe(node);
      expect(await sha256Hex(part), `${n} bytes`).toBe(node);
    }
  });
});
