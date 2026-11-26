import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  computeChallengeHash,
  generateRoomId,
  generateToken,
  isValidMessage,
  sha256Hex,
} from '../../src/net/protocol.js';

// Room ids, tokens and the passcode challenge hash. The hash must be the same with and without
// crypto.subtle (plain-HTTP pages fall back to the JavaScript SHA-256): host and guest may differ.

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Runs fn with globalThis.crypto replaced. */
function withCrypto(crypto, fn) {
  vi.stubGlobal('crypto', crypto);
  return fn();
}

describe('generateRoomId and generateToken', () => {
  it('makes room ids of cj- and 12 hex digits', () => {
    const ids = new Set(Array.from({ length: 20 }, generateRoomId));
    expect(ids.size).toBe(20);
    for (const id of ids) expect(id).toMatch(/^cj-[0-9a-f]{12}$/);
  });

  it('still makes distinct room ids without randomUUID', () => {
    const ids = withCrypto({}, () => [generateRoomId(), generateRoomId()]);
    expect(ids[0]).not.toBe(ids[1]);
    for (const id of ids) expect(id).toMatch(/^cj-[0-9a-z]{9,}$/);
  });

  it('makes tokens of 32 hex digits, or long random text without getRandomValues', () => {
    expect(generateToken()).toMatch(/^[0-9a-f]{32}$/);
    expect(generateToken()).not.toBe(generateToken());
    const fallback = withCrypto({}, generateToken);
    expect(fallback).toMatch(/^[0-9a-z]{12,}$/);
  });
});

describe('sha256Hex', () => {
  const VECTORS = [
    ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
    [
      'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq',
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    ],
  ];

  it.each(VECTORS)('hashes %j to the standard digest', async (input, hex) => {
    expect(await sha256Hex(input)).toBe(hex);
  });

  it.each(['', 'abc', 'nonce:合言葉', 'x'.repeat(200)])(
    'gives the same digest for %j without crypto.subtle',
    async (input) => {
      const native = await sha256Hex(input);
      const fallback = await withCrypto({}, () => sha256Hex(input));
      expect(fallback).toBe(native);
    },
  );
});

describe('computeChallengeHash', () => {
  it('hashes the nonce and passcode together', async () => {
    expect(await computeChallengeHash('n', 'p')).toBe(await sha256Hex('n:p'));
    expect(await computeChallengeHash('n')).toBe(await sha256Hex('n:'));
    expect(await computeChallengeHash('n', null)).toBe(await sha256Hex('n:'));
    expect(await computeChallengeHash('n', 'p')).not.toBe(await computeChallengeHash('n', 'q'));
  });
});

describe('isValidMessage', () => {
  it.each([
    [{ type: 'ping' }, true],
    [{ type: 5 }, false],
    [{}, false],
    [null, false],
    ['ping', false],
  ])('%j is a message: %s', (msg, ok) => {
    expect(isValidMessage(msg)).toBe(ok);
  });
});
