import { transcribeAudio } from "@/api/trustClient";

jest.mock("@/api/client", () => ({
  resolveBaseUrl: () => "https://api.test",
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, body: string) {
      super(body);
      this.status = status;
    }
  },
}));

const asset = { uri: "file:///a.mp3", name: "a.mp3", mimeType: "audio/mpeg", size: 1 };

describe("transcribeAudio", () => {
  it("POSTs multipart to /transcribe with a bearer token and returns the job", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ job_id: "j1", status: "queued" }),
    });
    (global as unknown as { fetch: unknown }).fetch = fetchMock;

    const out = await transcribeAudio("p1", { asset, language: "ta" }, "tok");

    expect(out).toEqual({ job_id: "j1", status: "queued" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.test/api/v1/trust/projects/p1/transcribe");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer tok");
    // multipart: must NOT hand-set Content-Type (the boundary is auto-added)
    expect(init.headers["Content-Type"]).toBeUndefined();
    expect(init.body).toBeInstanceOf(FormData);
  });

  it("throws ApiError on a non-ok response", async () => {
    (global as unknown as { fetch: unknown }).fetch = jest
      .fn()
      .mockResolvedValue({ ok: false, status: 413, text: async () => "too large" });
    await expect(transcribeAudio("p1", { asset, language: "ta" }, "tok")).rejects.toMatchObject({ status: 413 });
  });
});
