// Build-time feature flags. Each flag is read from an EXPO_PUBLIC_FLAG_* env var
// and baked into the bundle at build time, so a flag is fixed per build: flip it
// by setting the var in mobile/.env.local (or the build env) and rebuilding.
//
// Off by default. A flag is ON only when its env var is exactly "1".
//
// IMPORTANT: Expo inlines EXPO_PUBLIC_* only for LITERAL access like
// process.env["EXPO_PUBLIC_FLAG_X"]. A dynamic lookup (process.env[name]) is NOT
// inlined and silently reads undefined in the built app. So every flag gets its
// own literal line below; do not refactor these into a loop over names.
//
// To add a flag:
//   1. add a line below:  newThing: process.env["EXPO_PUBLIC_FLAG_NEW_THING"] === "1",
//   2. gate the code:     if (FLAGS.newThing) { ... }
//   3. if it is user-facing, add it to FEATURES + a Help topic (CLAUDE.md, Definition of Done)
//   4. remove the flag once the feature ships everywhere.

export const FLAGS = {
  // Example (uncomment to use):
  // newThing: process.env["EXPO_PUBLIC_FLAG_NEW_THING"] === "1",
} as const;

export type FlagName = keyof typeof FLAGS;
