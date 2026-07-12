import { validateFeedUrl, fetchFeed, MAX_FEED_BYTES } from "../fetchFeed";
import { FeedSourceError, FeedParseError } from "../errors";

function res(body: string, init: { status?: number; headers?: Record<string, string> } = {}) {
  return {
    ok: (init.status ?? 200) >= 200 && (init.status ?? 200) < 300,
    status: init.status ?? 200,
    headers: { get: (k: string) => (init.headers ?? {})[k.toLowerCase()] ?? null },
    text: async () => body,
  } as unknown as Response;
}

test("validateFeedUrl accepts https, rejects http and junk", () => {
  expect(validateFeedUrl("  https://ex.org/f.atom ")).toBe("https://ex.org/f.atom");
  expect(() => validateFeedUrl("http://ex.org/f")).toThrow(FeedSourceError);
  expect(() => validateFeedUrl("not a url")).toThrow(FeedSourceError);
});

test("fetchFeed returns body on 200", async () => {
  const fake = async () => res("<feed/>");
  await expect(fetchFeed("https://ex.org/f", fake as any)).resolves.toBe("<feed/>");
});

test("401/403 → FeedSourceError authRequired", async () => {
  const fake = async () => res("", { status: 401 });
  await expect(fetchFeed("https://ex.org/f", fake as any)).rejects.toMatchObject({
    name: "FeedSourceError",
    authRequired: true,
  });
});

test("other non-2xx → FeedSourceError (not authRequired)", async () => {
  const fake = async () => res("", { status: 500 });
  const err = await fetchFeed("https://ex.org/f", fake as any).catch((e) => e);
  expect(err).toBeInstanceOf(FeedSourceError);
  expect(err.authRequired).toBeUndefined();
});

test("oversized body (content-length) → FeedParseError", async () => {
  const fake = async () => res("x", { headers: { "content-length": String(MAX_FEED_BYTES + 1) } });
  await expect(fetchFeed("https://ex.org/f", fake as any)).rejects.toBeInstanceOf(FeedParseError);
});

test("oversized body (no content-length, long text) → FeedParseError", async () => {
  const fake = async () => res("x".repeat(MAX_FEED_BYTES + 1));
  await expect(fetchFeed("https://ex.org/f", fake as any)).rejects.toBeInstanceOf(FeedParseError);
});
