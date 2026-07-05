/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["**/__tests__/**/*.test.ts"],
  // marked@10+ ships ESM-only (package.json "type":"module", no "require"
  // export condition) — Jest's CJS runtime can't `require()` that directly.
  // marked still publishes a UMD build for legacy bundlers; redirect the
  // "marked" specifier to it so Jest's own (non-native) CJS wrapping applies.
  moduleNameMapper: {
    "^marked$": "<rootDir>/node_modules/marked/lib/marked.umd.js",
  },
};
