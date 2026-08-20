// expo-crypto is a native module — mock it with real CSPRNG bytes (node's
// crypto.randomBytes) so each call returns fresh, non-deterministic randomness.
// A deterministic mock would make every generateRecoveryKey() call return the
// SAME key, which would break the "wrong recovery key can't unwrap" assertion.
// require() is done lazily inside the factory to satisfy jest's out-of-scope-
// variable guard on jest.mock() factories.
jest.mock("expo-crypto", () => ({
  getRandomBytes: (n: number) => new Uint8Array(require("crypto").randomBytes(n)),
}));

import { generateRecoveryKey, generateKey, deriveKEK, seal, open, randomSalt } from "@/crypto/envelope";
const enc = new TextEncoder(), dec = new TextDecoder();

it("seal/open round-trips and detects tampering (AEAD)", () => {
  const k = generateKey();
  const { nonce, ct } = seal(k, enc.encode("hello world"));
  expect(dec.decode(open(k, nonce, ct))).toBe("hello world");
  const bad = Uint8Array.from(ct); bad[0] ^= 1;
  expect(() => open(k, nonce, bad)).toThrow();
});

it("recovery key → KEK is deterministic (same key+salt), and a wrong key can't unwrap", () => {
  const rk = generateRecoveryKey(); const salt = randomSalt();
  const kek1 = deriveKEK(rk, salt); const kek2 = deriveKEK(rk, salt);
  expect(Buffer.from(kek1)).toEqual(Buffer.from(kek2));
  const lmk = generateKey(); const wrapped = seal(kek1, lmk);
  expect(Buffer.from(open(deriveKEK(rk, salt), wrapped.nonce, wrapped.ct))).toEqual(Buffer.from(lmk));
  expect(() => open(deriveKEK(generateRecoveryKey(), salt), wrapped.nonce, wrapped.ct)).toThrow();
});

it("full envelope: recovery→KEK→LMK→DK→book round-trips", () => {
  const rk = generateRecoveryKey(), salt = randomSalt();
  const kek = deriveKEK(rk, salt), lmk = generateKey(), dk = generateKey();
  const wLmk = seal(kek, lmk), wDk = seal(lmk, dk);
  const book = JSON.stringify({ id: "b1", updatedAt: "2026-01-01" });
  const encBook = seal(dk, enc.encode(book));
  const lmk2 = open(deriveKEK(rk, salt), wLmk.nonce, wLmk.ct);
  const dk2 = open(lmk2, wDk.nonce, wDk.ct);
  expect(dec.decode(open(dk2, encBook.nonce, encBook.ct))).toBe(book);
});
