import { canonicalJson } from './canonical';
import { sha256Hex } from './db';
import type { KeyMaterial } from './db';

const SIGN_ALG: EcKeyGenParams = { name: 'ECDSA', namedCurve: 'P-256' };
const ENC_ALG: EcKeyGenParams = { name: 'ECDH', namedCurve: 'P-256' };

/** Solo i campi pubblici di una chiave EC: elimina d, key_ops, ext e qualunque campo superfluo. */
export function publicJwk(jwk: JsonWebKey): JsonWebKey {
  if (jwk.kty !== 'EC' || jwk.crv !== 'P-256' || typeof jwk.x !== 'string' || typeof jwk.y !== 'string') throw new Error('Chiave pubblica non valida');
  return { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y };
}

export async function keyIdOf(signPublic: JsonWebKey, encPublic: JsonWebKey): Promise<string> {
  return sha256Hex(canonicalJson({ enc: publicJwk(encPublic), sign: publicJwk(signPublic), v: 1 }));
}

/** Impronta mostrata alle persone: 6 gruppi da 4 caratteri (96 bit), da confrontare a voce o di persona. */
export function formatFingerprint(keyId: string): string {
  return keyId.slice(0, 24).toUpperCase().match(/.{4}/g)!.join(' ');
}

export async function generateIdentity(): Promise<KeyMaterial> {
  const sign = await crypto.subtle.generateKey(SIGN_ALG, true, ['sign', 'verify']);
  const enc = await crypto.subtle.generateKey(ENC_ALG, true, ['deriveBits']);
  const signPublic = publicJwk(await crypto.subtle.exportKey('jwk', sign.publicKey));
  const encPublic = publicJwk(await crypto.subtle.exportKey('jwk', enc.publicKey));
  // Le private vengono reimportate come NON estraibili: la versione estraibile esiste solo in memoria per pochi istanti.
  const signPrivate = await crypto.subtle.importKey('jwk', await crypto.subtle.exportKey('jwk', sign.privateKey), SIGN_ALG, false, ['sign']);
  const encPrivate = await crypto.subtle.importKey('jwk', await crypto.subtle.exportKey('jwk', enc.privateKey), ENC_ALG, false, ['deriveBits']);
  return { signPrivate, signPublic, encPrivate, encPublic, keyId: await keyIdOf(signPublic, encPublic) };
}

export function importVerifyKey(jwk: JsonWebKey): Promise<CryptoKey> {
  return crypto.subtle.importKey('jwk', publicJwk(jwk), SIGN_ALG, false, ['verify']);
}

export function importEncPublic(jwk: JsonWebKey): Promise<CryptoKey> {
  return crypto.subtle.importKey('jwk', publicJwk(jwk), ENC_ALG, false, []);
}

export async function sign(key: CryptoKey, data: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, data));
}

export async function verify(jwk: JsonWebKey, signature: Uint8Array<ArrayBuffer>, data: Uint8Array<ArrayBuffer>): Promise<boolean> {
  return crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, await importVerifyKey(jwk), signature, data);
}
