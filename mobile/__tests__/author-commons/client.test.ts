import {
  ApiError,
  getAuthorCommons,
  hideAuthorCommons,
  listAuthorCommons,
} from "@/api/client";

const fetchMock = jest.fn();

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
});

describe("listAuthorCommons", () => {
  it("sends query and page in the URL and the Bearer token", async () => {
    fetchMock.mockResolvedValue(
      json({ items: [], total: 0, page: 2, page_size: 20 }),
    );

    const result = await listAuthorCommons("tok-123", { query: "algebra", page: 2 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    const parsed = new URL(String(url));
    expect(parsed.pathname).toMatch(/\/api\/v1\/author-commons$/);
    expect(parsed.searchParams.get("query")).toBe("algebra");
    expect(parsed.searchParams.get("page")).toBe("2");
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: "Bearer tok-123",
    });
    expect(result).toEqual({ items: [], total: 0, page: 2, page_size: 20 });
  });

  it("sends language when given and omits it otherwise", async () => {
    fetchMock.mockResolvedValue(json({ items: [], total: 0, page: 1, page_size: 20 }));

    await listAuthorCommons("tok", { language: "fr" });
    const withLang = new URL(String(fetchMock.mock.calls[0][0]));
    expect(withLang.searchParams.get("language")).toBe("fr");

    fetchMock.mockClear();
    fetchMock.mockResolvedValue(json({ items: [], total: 0, page: 1, page_size: 20 }));
    await listAuthorCommons("tok", {});
    const bare = new URL(String(fetchMock.mock.calls[0][0]));
    expect(bare.searchParams.has("language")).toBe(false);
  });

  it("throws ApiError on a non-OK response", async () => {
    fetchMock.mockResolvedValue(json({ detail: "nope" }, 401));

    await expect(listAuthorCommons("tok", {})).rejects.toMatchObject({
      status: 401,
    });
    await expect(listAuthorCommons("tok", {})).rejects.toBeInstanceOf(ApiError);
  });
});

describe("getAuthorCommons", () => {
  it("returns the detail with description", async () => {
    const detail = {
      book_id: "b1",
      title: "T",
      author_name: "A",
      account_name: "Acct",
      version: 1,
      published_at: "2026-11-01T00:00:00Z",
      formats: ["epub"],
      language: "en",
      cover_svg: null,
      description: "About it",
    };
    fetchMock.mockResolvedValue(json(detail));

    const result = await getAuthorCommons("tok", "b1");

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/api\/v1\/author-commons\/b1$/);
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: "Bearer tok",
    });
    expect(result).toEqual(detail);
  });

  it("throws ApiError with status 404 when the entry is missing", async () => {
    fetchMock.mockResolvedValue(json({ detail: "not found" }, 404));

    const err = await getAuthorCommons("tok", "missing").catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(404);
  });
});

describe("hideAuthorCommons", () => {
  it("POSTs to the library hide route with the Bearer token", async () => {
    fetchMock.mockResolvedValue(json({ status: "hidden" }));

    await expect(hideAuthorCommons("tok", "b1")).resolves.toBeUndefined();

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/api\/v1\/library\/b1\/hide$/);
    expect((init as RequestInit).method).toBe("POST");
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: "Bearer tok",
    });
  });

  it("throws ApiError on 403 (not the owner)", async () => {
    fetchMock.mockResolvedValue(json({ detail: "not the owner" }, 403));

    const err = await hideAuthorCommons("tok", "b1").catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(403);
  });
});
