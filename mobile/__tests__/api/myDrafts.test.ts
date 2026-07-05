import { myDrafts } from "@/api/client";

describe("myDrafts client", () => {
  const fetchMock = jest.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it("GETs /drafts/mine with a bearer token", async () => {
    fetchMock.mockReturnValue(
      Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([{ book_id: "b1", title: "T", version: "1.0", comment_count: 3, last_comment_at: null }]) } as Response),
    );
    const rows = await myDrafts("tok");
    expect(rows[0].comment_count).toBe(3);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/api\/v1\/drafts\/mine$/);
    expect(init.headers.Authorization).toBe("Bearer tok");
  });
});
