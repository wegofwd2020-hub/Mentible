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

test("validateFeedUrl blocks loopback / private / link-local hosts", () => {
  for (const u of [
    "https://localhost/f", "https://127.0.0.1/f", "https://10.0.0.1/f",
    "https://172.16.0.1/f", "https://192.168.1.1/f", "https://169.254.169.254/f",
    "https://[::1]/f",
  ]) {
    expect(() => validateFeedUrl(u)).toThrow(FeedSourceError);
  }
});

test("validateFeedUrl allows normal public hosts", () => {
  expect(validateFeedUrl("https://m.gutenberg.org/ebooks.opds/")).toContain("gutenberg.org");
  expect(validateFeedUrl("https://8.8.8.8/f")).toContain("8.8.8.8");
});

test("streaming body over the cap → FeedParseError (cap not defeated by missing content-length)", async () => {
  // A Response whose body streams > MAX_FEED_BYTES in chunks, with NO content-length.
  const big = new Uint8Array(1024 * 1024); // 1 MiB chunk
  let sent = 0;
  const target = MAX_FEED_BYTES + 1;
  const reader = {
    read: async () => {
      if (sent > target) return { done: true, value: undefined };
      sent += big.byteLength;
      return { done: false, value: big };
    },
    cancel: async () => {},
  };
  const fake = async () => ({
    ok: true, status: 200,
    headers: { get: () => null }, // no content-length
    body: { getReader: () => reader },
    text: async () => { throw new Error("should not buffer via text()"); },
  }) as unknown as Response;
  await expect(fetchFeed("https://ex.org/f", fake as any)).rejects.toBeInstanceOf(FeedParseError);
});

test("streaming body under the cap → decoded text", async () => {
  const enc = new TextEncoder().encode("<feed/>");
  let done = false;
  const reader = { read: async () => (done ? { done: true, value: undefined } : ((done = true), { done: false, value: enc })), cancel: async () => {} };
  const fake = async () => ({
    ok: true, status: 200, headers: { get: () => null },
    body: { getReader: () => reader }, text: async () => "unused",
  }) as unknown as Response;
  await expect(fetchFeed("https://ex.org/f", fake as any)).resolves.toBe("<feed/>");
});

test("fetchFeed requests the feed URL itself on native", async () => {
  const seen: string[] = [];
  const fake = (async (u: string) => {
    seen.push(u);
    return { ok: true, status: 200, headers: { get: () => null }, text: async () => "<feed/>" } as any;
  }) as unknown as typeof fetch;

  await fetchFeed("https://ex.org/f.opds", fake);
  expect(seen[0]).toBe("https://ex.org/f.opds"); // no proxy on native
});

it("sends a descriptive User-Agent on the feed request", async () => {
  const fetchImpl = jest.fn().mockResolvedValue({
    ok: true, status: 200, headers: { get: () => null }, text: async () => "<feed/>",
  } as unknown as Response);
  await fetchFeed("https://www.gutenberg.org/ebooks.opds/", fetchImpl);
  const [, init] = fetchImpl.mock.calls[0];
  expect((init.headers as Record<string, string>)["User-Agent"]).toMatch(/Mentible/);
});
