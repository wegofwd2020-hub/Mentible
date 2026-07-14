import AsyncStorage from "@react-native-async-storage/async-storage";
import { getPrefs, putPrefs, defaultPrefs } from "../shelfPrefsStore";

beforeEach(async () => {
  await AsyncStorage.clear();
});

test("absent → defaults (hideMature true, a language string)", async () => {
  const p = await getPrefs();
  expect(p.hideMature).toBe(true);
  expect(typeof p.language).toBe("string");
  expect(p).toEqual(defaultPrefs());
});

test("round-trips a saved pref", async () => {
  await putPrefs({ language: "fr", hideMature: false });
  expect(await getPrefs()).toEqual({ language: "fr", hideMature: false });
});

test("corrupt blob → defaults", async () => {
  await AsyncStorage.setItem("sbq_open_shelves_prefs", "not json");
  expect(await getPrefs()).toEqual(defaultPrefs());
});
