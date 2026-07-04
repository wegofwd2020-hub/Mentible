import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  deriveState,
  getExportStatus,
  setFormatStatus,
  type FormatStatus,
} from "@/storage/exportStatus";

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe("exportStatus store", () => {
  it("returns an empty status for an unknown book", async () => {
    expect(await getExportStatus("nope")).toEqual({});
  });

  it("stores and reads per-format status independently", async () => {
    await setFormatStatus("b1", "epub", { state: "done", compiledAt: "2026-07-04T10:00:00Z" });
    await setFormatStatus("b1", "pdf", { state: "generating", jobId: "j1" });

    const s = await getExportStatus("b1");
    expect(s.epub?.state).toBe("done");
    expect(s.pdf?.state).toBe("generating");
    expect(s.pdf?.jobId).toBe("j1");
  });

  it("overwrites the same format on re-set", async () => {
    await setFormatStatus("b1", "pdf", { state: "generating", jobId: "j1" });
    await setFormatStatus("b1", "pdf", { state: "failed", error: "boom" });
    const s = await getExportStatus("b1");
    expect(s.pdf).toEqual({ state: "failed", error: "boom" });
  });
});

describe("deriveState", () => {
  const done = (sourceUpdatedAt?: string): FormatStatus => ({
    state: "done",
    compiledAt: "2026-07-04T10:00:00Z",
    sourceUpdatedAt,
  });

  it("is 'none' with no record", () => {
    expect(deriveState(undefined, "2026-07-04T10:00:00Z")).toBe("none");
  });

  it("passes through generating and failed", () => {
    expect(deriveState({ state: "generating" }, undefined)).toBe("generating");
    expect(deriveState({ state: "failed", error: "x" }, undefined)).toBe("failed");
  });

  it("is 'done' when the book has not changed since export", () => {
    expect(deriveState(done("2026-07-04T10:00:00Z"), "2026-07-04T10:00:00Z")).toBe("done");
  });

  it("is 'stale' when the book was edited after the export", () => {
    expect(deriveState(done("2026-07-04T10:00:00Z"), "2026-07-04T12:00:00Z")).toBe("stale");
  });

  it("is 'done' (not stale) when the export is newer than the last edit", () => {
    expect(deriveState(done("2026-07-04T12:00:00Z"), "2026-07-04T10:00:00Z")).toBe("done");
  });

  it("stays 'done' when timestamps are missing (can't prove staleness)", () => {
    expect(deriveState(done(undefined), "2026-07-04T12:00:00Z")).toBe("done");
  });
});
