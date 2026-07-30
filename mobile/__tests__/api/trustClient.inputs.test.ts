import { addProjectInput } from "@/api/trustClient";

function mockFetchOnce(status: number, body: unknown) {
  (global as unknown as { fetch: jest.Mock }).fetch = jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300, status,
    json: async () => body, text: async () => JSON.stringify(body),
    headers: { get: () => null },
  });
}
afterEach(() => jest.restoreAllMocks());

it("POSTs a project input with the JWT and returns the created input", async () => {
  const created = { id: "i1", kind: "note", title: "T", content: "c", source_ref: null, created_at: null };
  mockFetchOnce(200, created);
  const out = await addProjectInput("p1", { kind: "note", title: "T", content: "c" }, "tok");
  expect(out.id).toBe("i1");
  const [url, init] = (global as unknown as { fetch: jest.Mock }).fetch.mock.calls[0];
  expect(url).toMatch(/\/trust\/projects\/p1\/inputs$/);
  expect(init.method).toBe("POST");
  expect(init.headers.Authorization).toBe("Bearer tok");
  expect(JSON.parse(init.body)).toMatchObject({ kind: "note", content: "c" });
});
