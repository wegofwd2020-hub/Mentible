import { loadThemeName, saveThemeName } from "@/theme/themeStore";

jest.mock("@react-native-async-storage/async-storage", () => {
  let store: Record<string, string> = {};
  return {
    __esModule: true,
    default: {
      getItem: jest.fn(async (k: string) => store[k] ?? null),
      setItem: jest.fn(async (k: string, v: string) => { store[k] = v; }),
      __reset: () => { store = {}; },
    },
  };
});
import AsyncStorage from "@react-native-async-storage/async-storage";

beforeEach(() => (AsyncStorage as unknown as { __reset: () => void }).__reset());

it("returns null when nothing saved", async () => {
  expect(await loadThemeName()).toBeNull();
});

it("round-trips a valid theme name", async () => {
  await saveThemeName("gilded-noir");
  expect(await loadThemeName()).toBe("gilded-noir");
});

it("returns null for an unknown/legacy stored value", async () => {
  await (AsyncStorage as unknown as { setItem: (k: string, v: string) => Promise<void> }).setItem("theme_name", "neon");
  expect(await loadThemeName()).toBeNull();
});

it("is fail-safe when storage throws", async () => {
  (AsyncStorage.getItem as jest.Mock).mockRejectedValueOnce(new Error("disk"));
  expect(await loadThemeName()).toBeNull();
});
