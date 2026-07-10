module.exports = function (api) {
  const isTest = api.env("test");
  api.cache.using(() => isTest);
  return {
    presets: ["babel-preset-expo"],
    // Jest's CJS transform doesn't lower dynamic import() the way Metro does at
    // bundle time, so `await import("mermaid")` (mobile/src/reader/enhance.ts)
    // hits Jest's native-ESM guard under plain babel-jest. This plugin rewrites
    // import() to a require()-backed Promise, test-env only — it never touches
    // the Metro/RN bundle.
    plugins: isTest ? ["dynamic-import-node"] : [],
  };
};
