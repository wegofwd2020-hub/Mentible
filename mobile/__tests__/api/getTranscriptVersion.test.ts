import { getTranscriptVersion } from "@/api/trustClient";

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

it("GETs /versions/{id} and returns the transcript content", async () => {
  const body = {
    id: "v1",
    artifact_id: "a1",
    version_no: 1,
    is_validated: false,
    recorded_via: null,
    created_at: null,
    content: {
      language: "ta",
      segments: [{ text: "வணக்கம்", start: 0, end: 1.2, confidence: 0.4, speaker: null }],
      stt_meta: { provider: "groq", model: "whisper-large-v3" },
    },
  };
  const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => body, text: async () => "" });
  (global as unknown as { fetch: unknown }).fetch = fetchMock;

  const out = await getTranscriptVersion("v1", "tok");
  expect(fetchMock.mock.calls[0][0]).toBe("https://api.test/api/v1/trust/versions/v1");
  expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer tok");
  expect(out.content.segments[0]).toMatchObject({ text: "வணக்கம்", confidence: 0.4, speaker: null });
  expect(out.content.stt_meta?.provider).toBe("groq");
});
