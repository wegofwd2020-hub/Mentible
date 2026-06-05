import AsyncStorage from "@react-native-async-storage/async-storage";
import { loadDefaultParams, saveDefaultParams } from "@/storage/settingsStore";
import { DEFAULT_GENERATION_PARAMS } from "@/types/generationParams";

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe("settingsStore default generation params", () => {
  it("returns the built-in defaults when nothing is saved", async () => {
    expect(await loadDefaultParams()).toEqual(DEFAULT_GENERATION_PARAMS);
  });

  it("round-trips saved params", async () => {
    const p = { ...DEFAULT_GENERATION_PARAMS, level: "expert", depth: "deep" as const, pages: 7 };
    await saveDefaultParams(p);
    expect(await loadDefaultParams()).toEqual(p);
  });

  it("merges saved params over defaults (forward-compatible)", async () => {
    // Simulate an older stored value missing a newer field.
    await AsyncStorage.setItem("sbq_default_gen_params", JSON.stringify({ level: "professional" }));
    const loaded = await loadDefaultParams();
    expect(loaded.level).toBe("professional");
    expect(loaded.depth).toBe(DEFAULT_GENERATION_PARAMS.depth);
    expect(loaded.format).toBe("lesson");
  });
});
