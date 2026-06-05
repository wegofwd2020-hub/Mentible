import AsyncStorage from "@react-native-async-storage/async-storage";
import { DEFAULT_GENERATION_PARAMS, type GenerationParams } from "@/types/generationParams";

// Global default generation template — seeds new books and drives the one-off
// Query screen. Per-book templates (Book.generationParams) override it. Stored
// as a single AsyncStorage entry, same local-first pattern as bookStore.
const KEY = "sbq_default_gen_params";

export async function loadDefaultParams(): Promise<GenerationParams> {
  const raw = await AsyncStorage.getItem(KEY);
  if (!raw) return { ...DEFAULT_GENERATION_PARAMS };
  try {
    // Merge over the defaults so a stored value missing a newer field is safe.
    return { ...DEFAULT_GENERATION_PARAMS, ...(JSON.parse(raw) as Partial<GenerationParams>) };
  } catch {
    return { ...DEFAULT_GENERATION_PARAMS };
  }
}

export async function saveDefaultParams(params: GenerationParams): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(params));
}
