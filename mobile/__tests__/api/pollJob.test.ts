import { pollJob } from "@/api/pollJob";
import { ApiError } from "@/api/client";

function mockJobSequence(views: object[]) {
  const fn = jest.fn();
  views.forEach((v) => fn.mockResolvedValueOnce({ ok: true, status: 200, json: async () => v, text: async () => JSON.stringify(v), headers: { get: () => null } }));
  (global as unknown as { fetch: jest.Mock }).fetch = fn;
  return fn;
}
afterEach(() => jest.restoreAllMocks());

it("resolves result on done and fires onPhase for queued/running only", async () => {
  mockJobSequence([{ status: "queued" }, { status: "running" }, { status: "done", result: { v: 1 } }]);
  const phases: string[] = [];
  const r = await pollJob<{ v: number }>("j1", "tok", { intervalMs: 1, timeoutMessage: "t/o", failedMessage: "fail", onPhase: (p) => phases.push(p) });
  expect(r).toEqual({ v: 1 });
  expect(phases).toEqual(["queued", "running"]);
});

it("throws job.error on failed", async () => {
  mockJobSequence([{ status: "failed", error: "bad key" }]);
  await expect(pollJob("j1", "tok", { intervalMs: 1, timeoutMessage: "t/o", failedMessage: "fail" })).rejects.toThrow("bad key");
});

it("throws failedMessage on failed with no error, and on done without result", async () => {
  mockJobSequence([{ status: "failed" }]);
  await expect(pollJob("j1", "tok", { intervalMs: 1, timeoutMessage: "t/o", failedMessage: "fail" })).rejects.toThrow("fail");
  mockJobSequence([{ status: "done" }]);
  await expect(pollJob("j1", "tok", { intervalMs: 1, timeoutMessage: "t/o", failedMessage: "fail" })).rejects.toThrow("fail");
});

it("rejects with timeoutMessage past the deadline", async () => {
  mockJobSequence([{ status: "queued" }, { status: "queued" }]);
  await expect(pollJob("j1", "tok", { intervalMs: 1, timeoutMs: 0, timeoutMessage: "t/o", failedMessage: "fail" })).rejects.toThrow("t/o");
});

it("throws ApiError on a non-ok fetch", async () => {
  (global as unknown as { fetch: jest.Mock }).fetch = jest.fn().mockResolvedValue({ ok: false, status: 500, text: async () => "boom", headers: { get: () => null } });
  const err = await pollJob("j1", "tok", { intervalMs: 1, timeoutMessage: "t/o", failedMessage: "fail" }).catch((e: unknown) => e);
  expect(err).toBeInstanceOf(ApiError);
  expect((err as ApiError).status).toBe(500); // the response status round-trips into ApiError.status
});
