import { getVersion } from "@/api/trustClient";

describe("trustClient.getVersion", () => {
  afterEach(() => jest.restoreAllMocks());

  it("GETs the version and returns its content", async () => {
    const payload = {
      id: "v1", artifact_id: "a1", version_no: 2,
      content: { sections: [{ heading: "H", body: "B", source_ids: [] }] },
      generation_meta: null, is_validated: false, recorded_via: null, created_at: null,
    };
    const fetchMock = jest.spyOn(global, "fetch").mockResolvedValue(
      { ok: true, status: 200, json: async () => payload } as Response,
    );
    const v = await getVersion("v1", "tok");
    expect(v.content.sections[0].heading).toBe("H");
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain("/api/v1/trust/versions/v1");
  });
});
