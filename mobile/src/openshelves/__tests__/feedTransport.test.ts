import { Platform } from "react-native";
import { feedRequestUrl, proxyErrorFor, usesFeedProxy } from "../feedTransport";
import { FeedParseError, FeedSourceError } from "../errors";

jest.mock("@/api/client", () => ({ resolveBaseUrl: () => "https://api.test" }));

const FEED = "https://m.gutenberg.org/ebooks/2701.opds";

test("native fetches the feed directly (ADR-028: device -> source)", () => {
  expect(Platform.OS).not.toBe("web"); // jest-expo runs the native preset
  expect(usesFeedProxy).toBe(false);
  expect(feedRequestUrl(FEED, false)).toBe(FEED);
});

test("web routes through the backend, with the feed URL encoded as a query param", () => {
  expect(feedRequestUrl(FEED, true)).toBe(
    "https://api.test/api/v1/shelves/feed?url=https%3A%2F%2Fm.gutenberg.org%2Febooks%2F2701.opds",
  );
});

test("a feed URL carrying its own query string survives encoding intact", () => {
  const withQuery = "https://ex.org/search.opds?q=whale&sort=downloads";
  const proxied = feedRequestUrl(withQuery, true);
  // The whole feed URL must sit in ONE query param — its & must not split ours.
  const parsed = new URL(proxied);
  expect(parsed.searchParams.get("url")).toBe(withQuery);
});

test("auth_required maps to FeedSourceError{authRequired}", async () => {
  const resp = {
    json: async () => ({ detail: { code: "auth_required", message: "Authenticated repos aren't supported yet." } }),
    status: 502,
  } as Response;
  const err = await proxyErrorFor(resp);
  expect(err).toBeInstanceOf(FeedSourceError);
  expect((err as FeedSourceError).authRequired).toBe(true);
});

test("too_large maps to FeedParseError", async () => {
  const resp = {
    json: async () => ({ detail: { code: "too_large", message: "That feed is too large to add." } }),
    status: 413,
  } as Response;
  expect(await proxyErrorFor(resp)).toBeInstanceOf(FeedParseError);
});

test("an unparseable error body still yields a usable message", async () => {
  const resp = {
    json: async () => { throw new Error("not json"); },
    status: 500,
  } as unknown as Response;
  const err = await proxyErrorFor(resp);
  expect(err).toBeInstanceOf(FeedSourceError);
  expect(err.message).toMatch(/could not reach the feed/i);
});
