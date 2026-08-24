// Build-provenance stamp — lets a device-verify prove the running app == the
// built commit. `version`/`versionCode` come from expo-constants (baked into
// the bundle from app.json at build time); `sha` comes from EXPO_PUBLIC_GIT_SHA,
// which babel-preset-expo statically inlines at bundle time (same mechanism as
// EXPO_PUBLIC_API_BASE_URL in src/api/client.ts) — absent in a local dev build,
// baked by the release build command.
import Constants from "expo-constants";

export function buildInfo(): { version: string; versionCode: number | null; sha: string } {
  const version = Constants.expoConfig?.version ?? "unknown";
  const versionCode = (Constants.expoConfig as any)?.android?.versionCode ?? null;
  const sha = process.env["EXPO_PUBLIC_GIT_SHA"] || "dev";
  return { version, versionCode, sha };
}

export function buildLabel(): string {
  const b = buildInfo();
  const vc = b.versionCode != null ? ` (vc${b.versionCode})` : "";
  return `${b.version}${vc} · ${b.sha}`;
}
