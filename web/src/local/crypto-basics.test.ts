import { describe, expect, it } from 'vitest';
import { canonicalJson } from './canonical';
import { sha256Hex } from './db';
import { formatFingerprint, generateIdentity, keyIdOf, sign, verify } from './keys';
import { sha256Sync } from './sha256';

describe('sha256Sync', () => {
  it('coincide con WebCrypto su vettori noti e casuali', async () => {
    expect(sha256Sync('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Sync('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    for (const len of [1, 55, 56, 63, 64, 65, 119, 1000, 70_000]) {
      const buf = crypto.getRandomValues(new Uint8Array(Math.min(len, 65536)));
      const data = len > 65536 ? new Uint8Array([...buf, ...buf.slice(0, len - 65536)]) : buf;
      expect(sha256Sync(data)).toBe(await sha256Hex(data));
    }
    expect(sha256Sync('Pèndulum ’ squat 😀')).toBe(await sha256Hex('Pèndulum ’ squat 😀'));
  });
});

describe('canonicalJson', () => {
  it("non dipende dall'ordine delle chiavi e omette undefined", () => {
    expect(canonicalJson({ b: 1, a: { d: [1, { y: 2, x: 1 }], c: null }, u: undefined })).toBe('{"a":{"c":null,"d":[1,{"x":1,"y":2}]},"b":1}');
    expect(canonicalJson({ a: 1, b: 2 })).toBe(canonicalJson({ b: 2, a: 1 }));
  });
  it('rifiuta numeri non finiti', () => {
    expect(() => canonicalJson({ a: Number.NaN })).toThrow();
  });
});

describe('identità locale', () => {
  it('chiavi private non estraibili, firma verificabile, impronta stabile', async () => {
    const id = await generateIdentity();
    expect(id.signPrivate.extractable).toBe(false);
    expect(id.encPrivate.extractable).toBe(false);
    await expect(crypto.subtle.exportKey('jwk', id.signPrivate)).rejects.toThrow();
    expect(id.signPublic).not.toHaveProperty('d');
    expect(id.encPublic).not.toHaveProperty('d');
    const msg = new TextEncoder().encode('pacchetto');
    const sig = await sign(id.signPrivate, msg);
    expect(await verify(id.signPublic, sig, msg)).toBe(true);
    expect(await verify(id.signPublic, sig, new TextEncoder().encode('pacchettO'))).toBe(false);
    expect(await keyIdOf(id.signPublic, id.encPublic)).toBe(id.keyId);
    expect(formatFingerprint(id.keyId)).toMatch(/^([0-9A-F]{4} ){5}[0-9A-F]{4}$/);
    const other = await generateIdentity();
    expect(other.keyId).not.toBe(id.keyId);
  });
});
