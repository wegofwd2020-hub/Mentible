import { FeedSourceError, FeedParseError, FeedRefreshError } from "../errors";

test("error classes carry a stable name and message", () => {
  expect(new FeedParseError("bad").name).toBe("FeedParseError");
  expect(new FeedRefreshError("x").message).toBe("x");
  expect(new FeedParseError("y")).toBeInstanceOf(Error);
});

test("FeedSourceError can flag authRequired", () => {
  const e = new FeedSourceError("needs login", { authRequired: true });
  expect(e.name).toBe("FeedSourceError");
  expect(e.authRequired).toBe(true);
  expect(new FeedSourceError("plain").authRequired).toBeUndefined();
});
