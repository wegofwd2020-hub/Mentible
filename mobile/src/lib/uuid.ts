// A UUID generator that works across runtimes. React Native's Hermes engine has
// no global `crypto`, so calling `crypto.randomUUID()` there throws
// "Property 'crypto' doesn't exist". Prefer the platform's crypto.randomUUID
// when present (web, newer engines) and otherwise fall back to an RFC-4122 v4
// built from Math.random. These ids (topic ids, request ids) need uniqueness,
// not cryptographic strength, so the fallback is fine.
export function randomUUID(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    const v = ch === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
