import { deleteFeedback, listFeedback, setFeedbackArchived } from "@/api/adminClient";

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

beforeEach(() => jest.clearAllMocks());

test("listFeedback builds the query string and returns rows", async () => {
  mockFetch.mockResolvedValueOnce({
    ok: true, status: 200,
    json: async () => ({ rows: [{ id: "1", name: "Jane" }], next_cursor: "c2" }),
  });
  const res = await listFeedback("tok", { type: "bug", q: "upload", status: "archived", limit: 25 });
  const url = mockFetch.mock.calls[0][0] as string;
  expect(url).toContain("/api/v1/admin/feedback?");
  expect(url).toContain("type=bug");
  expect(url).toContain("q=upload");
  expect(url).toContain("status=archived");
  expect(res.rows[0].name).toBe("Jane");
  expect(res.next_cursor).toBe("c2");
});

test("setFeedbackArchived POSTs the archive flag", async () => {
  mockFetch.mockResolvedValueOnce({ ok: true, status: 204 });
  await setFeedbackArchived("tok", "abc", true);
  const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
  expect(url).toContain("/api/v1/admin/feedback/abc/archive");
  expect(opts.method).toBe("POST");
  expect(JSON.parse(opts.body as string)).toEqual({ archived: true });
});

test("deleteFeedback sends DELETE and tolerates a 204 body", async () => {
  mockFetch.mockResolvedValueOnce({ ok: true, status: 204 });
  await expect(deleteFeedback("tok", "abc")).resolves.toBeUndefined();
  const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
  expect(url).toContain("/api/v1/admin/feedback/abc");
  expect(opts.method).toBe("DELETE");
});
