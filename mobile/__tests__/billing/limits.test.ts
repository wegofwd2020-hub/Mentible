import { limitHits, planLabel } from "@/billing/limits";
import type { ManagedStatus, PlanStatus } from "@/api/billingClient";

const FREE: PlanStatus = {
  is_pro: false,
  plan_name: "Free",
  caps: { max_projects: 2, max_generations: 20, gen_window_days: 30, max_storage_bytes: 500 * 1024 * 1024 },
  usage: { projects: 1, generations: 3, storage_bytes: 10 * 1024 * 1024 },
  at_project_cap: false,
  at_generation_cap: false,
  at_storage_cap: false,
  features: [],
};

const MANAGED: ManagedStatus = {
  entitlement: {
    plan_id: "managed_basic",
    plan_display: "Managed Basic",
    status: "active",
    period_start: "2026-11-01T00:00:00Z",
    period_end: "2026-12-01T00:00:00Z",
  },
  usage: { cost_micros: 500_000, input_tokens: 0, output_tokens: 0, events: 4 },
  allowance_micros: 1_000_000,
  window_start: "2026-11-01T00:00:00Z",
};

describe("planLabel", () => {
  it("is null when the plan is unknown (fail open)", () => {
    expect(planLabel(null)).toBeNull();
  });

  it("uses the server's plan_name when present", () => {
    expect(planLabel({ ...FREE, plan_name: "Managed Basic" })).toBe("Managed Basic");
  });

  it("falls back to Pro or Free from is_pro for an older backend", () => {
    const { plan_name: _omit, ...older } = FREE;
    expect(planLabel({ ...older, is_pro: true } as PlanStatus)).toBe("Pro");
    expect(planLabel({ ...older, is_pro: false } as PlanStatus)).toBe("Free");
  });
});

describe("limitHits", () => {
  it("returns nothing when no limit is reached", () => {
    expect(limitHits(FREE, null)).toEqual([]);
  });

  it("returns nothing when the status is unknown", () => {
    expect(limitHits(null, null)).toEqual([]);
  });

  it("names the generations limit with the numbers", () => {
    const hits = limitHits({ ...FREE, at_generation_cap: true, usage: { ...FREE.usage, generations: 20 } }, null);
    expect(hits.map((h) => h.key)).toEqual(["generations"]);
    expect(hits[0].message).toContain("20 of 20 generations");
    expect(hits[0].message).toContain("30 days");
  });

  it("names the projects limit", () => {
    const hits = limitHits({ ...FREE, at_project_cap: true, usage: { ...FREE.usage, projects: 2 } }, null);
    expect(hits.map((h) => h.key)).toEqual(["projects"]);
    expect(hits[0].message).toContain("2 of 2 projects");
  });

  it("names the storage limit in MB", () => {
    const hits = limitHits(
      { ...FREE, at_storage_cap: true, usage: { ...FREE.usage, storage_bytes: 500 * 1024 * 1024 } },
      null,
    );
    expect(hits.map((h) => h.key)).toEqual(["storage"]);
    expect(hits[0].message).toContain("500 of 500 MB");
  });

  it("names the managed token allowance when it's used up", () => {
    const used: ManagedStatus = { ...MANAGED, usage: { ...MANAGED.usage, cost_micros: 1_000_000 } };
    const hits = limitHits(FREE, used);
    expect(hits.map((h) => h.key)).toEqual(["tokens"]);
    expect(hits[0].message).toContain("Managed Basic token allowance");
    expect(hits[0].message).toContain("own API key");
  });

  it("does not flag the token allowance while there is room, or when unlimited (0)", () => {
    expect(limitHits(FREE, MANAGED)).toEqual([]);
    expect(limitHits(FREE, { ...MANAGED, allowance_micros: 0, usage: { ...MANAGED.usage, cost_micros: 9e9 } })).toEqual([]);
  });

  it("never shows free-plan caps to a Pro account", () => {
    const pro = { ...FREE, is_pro: true, at_generation_cap: true, at_storage_cap: true };
    expect(limitHits(pro, null)).toEqual([]);
  });

  it("can report several limits at once, in display order", () => {
    const many = {
      ...FREE,
      at_generation_cap: true,
      at_project_cap: true,
      at_storage_cap: true,
    };
    expect(limitHits(many, null).map((h) => h.key)).toEqual(["generations", "projects", "storage"]);
  });
});
