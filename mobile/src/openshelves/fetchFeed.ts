// The network seam: validate an https feed URL and fetch its raw text under caps,
// with the no-auth guardrail (spec P0-8/P0-9). No auth is ever sent; content is
// never stored. `fetchImpl` is injectable so tests never touch the network.
import { FeedParseError, FeedSourceError } from "./errors";
import { feedRequestUrl, proxyErrorFor, usesFeedProxy } from "./feedTransport";

export const MAX_FEED_BYTES = 8 * 1024 * 1024;

// Descriptive UA so Gutenberg/OPDS hosts don't rate-limit us as an anonymous bot.
// (On web the request targets our own backend and browsers drop the forbidden
// User-Agent header — harmless; the meaningful UA reaches the upstream host from
// the backend proxy, see backend/src/shelves/feed_fetch.py.)
export const FEED_USER_AGENT = "Mentible (+https://mambakkam.net/mentible)";

// SSRF guard: block literal loopback/private/link-local hosts (incl. the
// 169.254.169.254 cloud metadata address). Known residual: this blocks literal
// private-IP hosts but not DNS rebinding (a public hostname that resolves to a
// private IP) — full protection needs resolve-then-check, which `fetch` doesn't
// expose. Acceptable for a device client; revisit if this seam is ever lifted
// server-side.
function isBlockedHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, ""); // strip IPv6 brackets
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (h === "" || h === "0.0.0.0" || h === "::" || h === "::1") return true;
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const a = Number(m[1]), b = Number(m[2]);
    if (a === 127 || a === 10 || a === 0) return true;          // loopback / private / this-host
    if (a === 172 && b >= 16 && b <= 31) return true;           // private
    if (a === 192 && b === 168) return true;                    // private
    if (a === 169 && b === 254) return true;                    // link-local incl. 169.254.169.254 metadata
  }
  if (h.startsWith("fc") || h.startsWith("fd")) return true;    // IPv6 unique-local fc00::/7
  if (h.startsWith("fe80")) return true;                        // IPv6 link-local
  return false;
}

export function validateFeedUrl(url: string): string {
  const trimmed = (url ?? "").trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new FeedSourceError("That doesn't look like a valid URL.");
  }
  if (parsed.protocol !== "https:") {
    throw new FeedSourceError("Feed URLs must use https.");
  }
  if (isBlockedHost(parsed.hostname)) {
    throw new FeedSourceError("That host isn't allowed.");
  }
  return trimmed;
}

export async function fetchFeed(url: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const clean = validateFeedUrl(url);
  let resp: Response;
  try {
    resp = await fetchImpl(feedRequestUrl(clean), {
      method: "GET",
      headers: { "User-Agent": FEED_USER_AGENT },
    });
  } catch (err) {
    throw new FeedSourceError(`Could not reach the feed: ${(err as Error).message}`);
  }
  if (usesFeedProxy && !resp.ok) {
    throw await proxyErrorFor(resp);    // the backend already classified it
  }
  if (resp.status === 401 || resp.status === 403) {
    throw new FeedSourceError("Authenticated repos aren't supported yet.", { authRequired: true });
  }
  if (!resp.ok) {
    throw new FeedSourceError(`The feed responded with an error (HTTP ${resp.status}).`);
  }
  const declared = resp.headers.get("content-length");
  if (declared && Number(declared) > MAX_FEED_BYTES) {
    throw new FeedParseError("That feed is too large to add.");
  }
  const reader = (resp.body as any)?.getReader?.();
  if (reader) {
    // Stream + hard byte cap (web / stream-capable runtimes). Abort as soon as we
    // cross the cap so an unbounded / no-content-length body can't OOM us.
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > MAX_FEED_BYTES) {
          try { await reader.cancel(); } catch { /* ignore */ }
          throw new FeedParseError("That feed is too large to add.");
        }
        chunks.push(value);
      }
    }
    const merged = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) { merged.set(c, off); off += c.byteLength; }
    return new TextDecoder("utf-8").decode(merged);
  }
  // Fallback (RN/Hermes has no streaming response body): the content-length
  // precheck above is the primary guard; body.length is a best-effort backstop.
  const body = await resp.text();
  if (body.length > MAX_FEED_BYTES) {
    throw new FeedParseError("That feed is too large to add.");
  }
  return body;
}
