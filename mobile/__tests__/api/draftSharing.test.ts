import { addInvitation, ApiError, postComment, sharedWithMe } from "@/api/client";

const okJson = (data: unknown) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(data) } as Response);

describe("draft sharing client", () => {
  const fetchMock = jest.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it("addInvitation POSTs the email with a bearer token", async () => {
    fetchMock.mockReturnValue(okJson({ ok: true }));
    await addInvitation("b1", "Alice@x.com", "tok");
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/api\/v1\/drafts\/b1\/invitations$/);
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer tok");
    expect(JSON.parse(init.body)).toEqual({ email: "Alice@x.com" });
  });

  it("postComment returns the created comment", async () => {
    fetchMock.mockReturnValue(okJson({ id: 1, version: "1.0", body: "hi", author_response: null }));
    const c = await postComment("b1", "1.0", "hi", "tok");
    expect(c.id).toBe(1);
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/drafts\/b1\/comments$/);
  });

  it("sharedWithMe GETs the list", async () => {
    fetchMock.mockReturnValue(okJson([{ book_id: "b1", title: "T" }]));
    const items = await sharedWithMe("tok");
    expect(items[0].book_id).toBe("b1");
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/drafts\/shared-with-me$/);
  });

  it("rejects with ApiError (status 429) on a rate-limited response", async () => {
    fetchMock.mockReturnValue(
      Promise.resolve({
        ok: false,
        status: 429,
        text: () => Promise.resolve(JSON.stringify({ detail: "slow down" })),
        headers: { get: (h: string) => (h === "Retry-After" ? "30" : null) },
      } as unknown as Response),
    );
    const err = await addInvitation("b1", "alice@x.com", "tok").catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(429);
    expect((err as ApiError).userMessage()).toMatch(/generating too fast/i);
  });
});
