import { listFeedback } from "@/api/adminClient";

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

beforeEach(() => jest.clearAllMocks());

test("listFeedback builds the query string and returns rows", async () => {
  mockFetch.mockResolvedValueOnce({
    ok: true, status: 200,
    json: async () => ({ rows: [{ id: "1", name: "Jane" }], next_cursor: "c2" }),
  });
  const res = await listFeedback("tok", { type: "bug", q: "upload", limit: 25 });
  const url = mockFetch.mock.calls[0][0] as string;
  expect(url).toContain("/api/v1/admin/feedback?");
  expect(url).toContain("type=bug");
  expect(url).toContain("q=upload");
  expect(res.rows[0].name).toBe("Jane");
  expect(res.next_cursor).toBe("c2");
});
