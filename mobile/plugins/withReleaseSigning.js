// Expo config plugin: inject a real release signing config into the generated
// android/app/build.gradle at prebuild time. Idempotent, and fails LOUD if the
// Expo template anchors move (so a silent no-op can't ship debug-signed).
const { withAppBuildGradle } = require("@expo/config-plugins");

const MARKER = "mentible-release-signing";

function injectSigning(src) {
  if (src.includes(MARKER)) return src; // already patched — idempotent

  // 1. Add signingConfigs.release right after the `signingConfigs {` opener.
  const scAnchor = "signingConfigs {";
  if (!src.includes(scAnchor)) {
    throw new Error("[withReleaseSigning] anchor `signingConfigs {` not found — Expo template changed; update the plugin.");
  }
  const releaseBlock = `signingConfigs {
        // ${MARKER}
        release {
            def mentibleProps = rootProject.file("../credentials/keystore.properties")
            if (mentibleProps.exists()) {
                def props = new Properties()
                props.load(new FileInputStream(mentibleProps))
                storeFile rootProject.file(props['storeFile'])
                storePassword props['storePassword']
                keyAlias props['keyAlias']
                keyPassword props['keyPassword']
            }
        }`;
  src = src.replace(scAnchor, releaseBlock);

  // 2. Point the RELEASE buildType at signingConfigs.release when the credentials
  //    exist (else keep debug). The release `signingConfig signingConfigs.debug`
  //    is the one immediately followed by `shrinkResources` — the debug buildType's
  //    is not, so this uniquely targets release. Whitespace-tolerant.
  const relRe = /signingConfig\s+signingConfigs\.debug(\s*\n\s*shrinkResources)/;
  if (!relRe.test(src)) {
    throw new Error("[withReleaseSigning] release buildType anchor not found — Expo template changed; update the plugin.");
  }
  src = src.replace(
    relRe,
    `signingConfig (rootProject.file("../credentials/keystore.properties").exists() ? signingConfigs.release : signingConfigs.debug)$1`
  );

  return src;
}

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    cfg.modResults.contents = injectSigning(cfg.modResults.contents);
    return cfg;
  });
};

// Exposed for the idempotency/transform assertion.
module.exports.injectSigning = injectSigning;
