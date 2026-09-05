import { buildAudioForm } from "@/api/audioUpload";

// Default RN test env reports Platform.OS === "ios" (native) — the native
// branch. A tiny FormData shim records appended parts so we can assert on them.
class FakeFormData {
  parts: { name: string; value: unknown; filename?: string }[] = [];
  append(name: string, value: unknown, filename?: string) {
    this.parts.push({ name, value, filename });
  }
}

describe("buildAudioForm (native)", () => {
  beforeEach(() => {
    (global as unknown as { FormData: unknown }).FormData = FakeFormData;
  });

  it("appends the file as {uri,name,type} and only the defined fields", async () => {
    const form = (await buildAudioForm(
      { uri: "file:///a.mp3", name: "a.mp3", mimeType: "audio/mpeg", size: 10 },
      { language: "ta", providerId: "groq", apiKey: "sk-x" },
    )) as unknown as FakeFormData;

    const file = form.parts.find((p) => p.name === "file");
    expect(file?.value).toEqual({ uri: "file:///a.mp3", name: "a.mp3", type: "audio/mpeg" });
    expect(form.parts.find((p) => p.name === "language")?.value).toBe("ta");
    expect(form.parts.find((p) => p.name === "provider_id")?.value).toBe("groq");
    expect(form.parts.find((p) => p.name === "api_key")?.value).toBe("sk-x");
    // title omitted -> not appended
    expect(form.parts.find((p) => p.name === "title")).toBeUndefined();
  });

  it("omits provider_id and api_key when not given (managed default)", async () => {
    const form = (await buildAudioForm(
      { uri: "file:///b.wav", name: "b.wav", mimeType: "audio/wav", size: 5 },
      { language: "ta", title: "Interview 1" },
    )) as unknown as FakeFormData;

    expect(form.parts.find((p) => p.name === "title")?.value).toBe("Interview 1");
    expect(form.parts.find((p) => p.name === "provider_id")).toBeUndefined();
    expect(form.parts.find((p) => p.name === "api_key")).toBeUndefined();
  });
});
