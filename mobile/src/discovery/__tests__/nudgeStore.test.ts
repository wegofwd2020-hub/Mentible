import AsyncStorage from "@react-native-async-storage/async-storage";
import { loadDismissed, dismissNudge } from "../nudgeStore";

beforeEach(async () => { await AsyncStorage.clear(); });

it("returns [] when nothing dismissed", async () => {
  expect(await loadDismissed()).toEqual([]);
});

it("persists a dismissed key", async () => {
  await dismissNudge("chapter-quiz");
  expect(await loadDismissed()).toEqual(["chapter-quiz"]);
});

it("is idempotent — dismissing twice keeps one entry", async () => {
  await dismissNudge("chapter-quiz");
  await dismissNudge("chapter-quiz");
  expect(await loadDismissed()).toEqual(["chapter-quiz"]);
});

it("returns [] on corrupt storage", async () => {
  await AsyncStorage.setItem("sbq_dismissed_nudges", "not json");
  expect(await loadDismissed()).toEqual([]);
});
