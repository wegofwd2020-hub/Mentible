// The network seam: validate an https feed URL and fetch its raw text under caps,
// with the no-auth guardrail (spec P0-8/P0-9). No auth is ever sent; content is
// never stored. `fetchImpl` is injectable so tests never touch the network.
import { FeedParseError, FeedSourceError } from "./errors";

export const MAX_FEED_BYTES = 8 * 1024 * 1024;

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
  return trimmed;
}

export async function fetchFeed(url: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const clean = validateFeedUrl(url);
  let resp: Response;
  try {
    resp = await fetchImpl(clean, { method: "GET" });
  } catch (err) {
    throw new FeedSourceError(`Could not reach the feed: ${(err as Error).message}`);
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
  const body = await resp.text();
  if (body.length > MAX_FEED_BYTES) {
    throw new FeedParseError("That feed is too large to add.");
  }
  return body;
}
