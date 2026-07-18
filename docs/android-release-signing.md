# Android release signing

Release APKs are signed with a **private** keystore held only by the maintainer
(not the public React Native debug key). See the design spec:
`docs/superpowers/specs/2026-07-18-android-release-signing-design.md` (#328).

## Credentials (never committed)
- `mobile/credentials/mentible-release.keystore` — the private key.
- `mobile/credentials/keystore.properties` — its passwords (shape in `keystore.properties.example`).

Both are gitignored. **Back them up out-of-band. Losing either means the app can
never be updated again** — a new key = a new signature = every user must reinstall.

## How signing is wired
`mobile/plugins/withReleaseSigning.js` (an Expo config plugin) injects
`signingConfigs.release` into `android/app/build.gradle` at `expo prebuild`. The
release buildType uses the real key **only when** `mobile/credentials/keystore.properties`
exists; otherwise it falls back to debug signing, so a fresh clone / CI still builds.
The plugin is idempotent and throws if the Expo template anchors move (so it can
never silently ship a debug-signed release).

## Build a signed release
```bash
cd mobile && npx expo prebuild -p android
cd android && ANDROID_HOME=~/Android/Sdk ./gradlew :app:assembleRelease
# APK: mobile/android/app/build/outputs/apk/release/app-release.apk
# Verify it is the real key (must NOT be CN=Android Debug):
"$ANDROID_HOME"/build-tools/*/apksigner verify --print-certs \
  mobile/android/app/build/outputs/apk/release/app-release.apk
```

## Release
Publish on `wegofwd2020-hub/mambakkam-net` as asset `Mentible.apk`, tag
`mentible-0.2.2-vcN`, target `main`. The landing page pulls
`/releases/latest/download/Mentible.apk`.

## Migration note (one-time)
The move from the debug key to the private key changes the app signature, so the
first private-key release cannot install over a debug-signed build — users must
uninstall the old app once, then install the new one. Subsequent updates install
normally.
