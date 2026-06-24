import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  applyStepStatuses,
  firstPendingStep,
  isComplete,
  loadFirstRunState,
  relaunchStep,
  resetFirstRun,
  setStepStatus,
  STEP_ORDER,
  subscribeFirstRun,
} from "../../src/onboarding/firstRunState";

const STORAGE_KEY = "mentible_firstrun_v1";
const LEGACY_KEY = "mentible_onboarding_seen_v1";

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe("firstRunState", () => {
  it("seeds a fresh run when nothing is stored", async () => {
    const s = await loadFirstRunState();
    expect(s).toMatchObject({ signup: "pending", key: "pending", tour: "pending" });
    expect(firstPendingStep(s)).toBe("signup");
    expect(isComplete(s)).toBe(false);
  });

  it("migrates legacy onboarding-seen users to all-skipped", async () => {
    await AsyncStorage.setItem(LEGACY_KEY, "1");
    const s = await loadFirstRunState();
    expect(s).toMatchObject({ signup: "skipped", key: "skipped", tour: "skipped" });
    expect(firstPendingStep(s)).toBeNull();
    expect(isComplete(s)).toBe(true);
  });

  it("advances to the next pending step as steps resolve", async () => {
    await loadFirstRunState();
    let s = await setStepStatus("signup", "done");
    expect(firstPendingStep(s)).toBe("key");
    s = await setStepStatus("key", "skipped");
    expect(firstPendingStep(s)).toBe("tour");
    s = await setStepStatus("tour", "done");
    expect(firstPendingStep(s)).toBeNull();
    expect(isComplete(s)).toBe(true);
  });

  it("applies several step statuses at once", async () => {
    const s = await applyStepStatuses({ signup: "skipped", key: "skipped" });
    expect(s).toMatchObject({ signup: "skipped", key: "skipped", tour: "pending" });
    expect(firstPendingStep(s)).toBe("tour");
  });

  it("persists across loads", async () => {
    await setStepStatus("signup", "done");
    const reloaded = await loadFirstRunState();
    expect(reloaded.signup).toBe("done");
  });

  it("coerces unknown stored values to pending", async () => {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ signup: "bogus", key: "done" }));
    const s = await loadFirstRunState();
    expect(s.signup).toBe("pending");
    expect(s.key).toBe("done");
    expect(s.tour).toBe("pending");
  });

  it("relaunchStep re-arms a completed step", async () => {
    await applyStepStatuses({ signup: "done", key: "done", tour: "done" });
    const s = await relaunchStep("tour");
    expect(s.tour).toBe("pending");
    expect(firstPendingStep(s)).toBe("tour");
  });

  it("resetFirstRun returns everything to pending", async () => {
    await applyStepStatuses({ signup: "done", key: "done", tour: "done" });
    const s = await resetFirstRun();
    expect(s).toMatchObject({ signup: "pending", key: "pending", tour: "pending" });
  });

  it("notifies subscribers on change and stops after unsubscribe", async () => {
    const seen: string[] = [];
    const unsubscribe = subscribeFirstRun((s) => seen.push(s.key));
    await setStepStatus("key", "done");
    expect(seen).toContain("done");
    unsubscribe();
    await setStepStatus("key", "skipped");
    expect(seen).not.toContain("skipped");
  });

  it("orders steps signup → key → tour", () => {
    expect([...STEP_ORDER]).toEqual(["signup", "key", "tour"]);
  });
});
