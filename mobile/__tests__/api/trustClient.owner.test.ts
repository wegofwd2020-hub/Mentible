import { listOwnedProjects, createProject, createArtifact, createVersion, invite } from "@/api/trustClient";

const okJson = (b: unknown) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(b) } as Response);
beforeEach(() => jest.restoreAllMocks());

it("createProject POSTs body + bearer", async () => {
  const spy = jest.spyOn(global, "fetch").mockImplementation(() => okJson({ id: "p1", title: "T", status: "active", created_at: null }));
  const out = await createProject({ title: "T" }, "tok");
  expect(out.id).toBe("p1");
  const [url, init] = spy.mock.calls[0];
  expect(String(url)).toContain("/api/v1/trust/projects");
  expect((init as RequestInit).method).toBe("POST");
  expect((init as RequestInit).body).toBe(JSON.stringify({ title: "T" }));
  expect((init as RequestInit).headers).toMatchObject({ Authorization: "Bearer tok" });
});

it("listOwnedProjects GETs the list", async () => {
  jest.spyOn(global, "fetch").mockImplementation(() => okJson([{ id: "p1", title: "T", status: "active", created_at: null }]));
  expect(await listOwnedProjects("tok")).toHaveLength(1);
});

it("createArtifact / createVersion / invite hit the right URLs", async () => {
  const spy = jest.spyOn(global, "fetch")
    .mockImplementation(() => okJson({ id: "x", artifact_id: "a", version_no: 1, created_at: null, project_id: "p1", role: "cornerstone", format: "book", title: null, invited_email: "e@x.z", revoked_at: null }));
  await createArtifact("p1", { role: "cornerstone", format: "book" }, "tok");
  await createVersion("a", { content: { text: "hi" } }, "tok");
  await invite("p1", "E@X.Z", "reviewer", "tok");
  const urls = spy.mock.calls.map((c) => String(c[0]));
  expect(urls[0]).toContain("/api/v1/trust/projects/p1/artifacts");
  expect(urls[1]).toContain("/api/v1/trust/artifacts/a/versions");
  expect(urls[2]).toContain("/api/v1/trust/projects/p1/invitations");
});
