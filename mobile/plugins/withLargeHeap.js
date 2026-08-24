// Config plugin: set android:largeHeap="true" on <application>.
//
// The native EPUB file cipher (react-native-aes-gcm-crypto) is file-based (no
// Hermes/JS buffer) but NOT streaming — decryptFile/encryptFile read the whole
// file into a JVM ByteArray and (de)crypt to a second full ByteArray. A 30MB
// EPUB needs ~64MB transient Android/JVM heap; on a default-heap device under
// load the native PULL OOM'd (device-verify, growth limit ~201MB). largeHeap
// raises the per-process Dalvik heap ceiling so 30MB EPUBs decrypt without OOM.
//
// Expo has no app.json field for this, so it's a withAndroidManifest mod.
const { withAndroidManifest } = require("expo/config-plugins");

module.exports = function withLargeHeap(config) {
  return withAndroidManifest(config, (cfg) => {
    const app = cfg.modResults.manifest.application?.[0];
    if (app) app.$["android:largeHeap"] = "true";
    return cfg;
  });
};
