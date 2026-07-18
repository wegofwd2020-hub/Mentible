# Android Release Signing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Sign release APKs with a private, maintainer-held key instead of the public React Native debug key, and ship a re-release (vc14) with the migration communicated.

**Architecture:** Managed Expo workflow — inject `signingConfigs.release` via a committed Expo config plugin (a manual `build.gradle` edit would be lost on prebuild); keystore + passwords live in a gitignored `mobile/credentials/` dir outside the regenerated `android/`; the release buildType uses the real key only when the credentials are present (else debug fallback, so fresh clones / CI still build).

**Tech Stack:** Expo config plugins (`@expo/config-plugins` `withAppBuildGradle`), Gradle signing, `keytool`, `apksigner`, `gh`.

## Global Constraints

- **Branch: `chore/android-release-signing`** (off `main`, already created).
- **No secret ever committed.** The keystore (`*.keystore`/`*.jks`) and the real `keystore.properties` must be gitignored and never staged. Only the config plugin, the `.example`, `.gitignore` entries, docs, and the `app.json` bump are committed.
- **Never echo the private key or the generated passwords to the transcript/logs.** Write passwords straight into the gitignored file; print only non-secret confirmations (e.g. the cert SHA, which is public).
- **Keystore lives OUTSIDE `android/`** (`mobile/credentials/`), which `expo prebuild --clean` would otherwise wipe.
- **Debug fallback must keep working:** a prebuild+build with no credentials present must still succeed (debug-signed).
- **Release recipe** (established): asset name `Mentible.apk`, published on **`wegofwd2020-hub/mambakkam-net`** (NOT the Mentible repo), tag `mentible-0.2.2-vc<N>`, target `main`; the landing pulls `/releases/latest/download/Mentible.apk`.
- **Signature migration:** the new key changes the signature → existing installs cannot update in place. Release notes MUST state a one-time uninstall+reinstall is required.

---

## Task 1: Committed signing infrastructure (config plugin, example, gitignore, registration, docs)

**Files:**
- Create: `mobile/plugins/withReleaseSigning.js`
- Create: `mobile/credentials/keystore.properties.example`
- Modify: `mobile/app.json` (register the plugin)
- Modify: `.gitignore` (protect `mobile/credentials/` + keystores)
- Create: `docs/android-release-signing.md`
- Test: manual verification (Expo prebuild output + git status) — no unit test framework for prebuild output.

**Interfaces:**
- Produces: an Expo config plugin `withReleaseSigning(config)` that patches `app/build.gradle` at prebuild to add `signingConfigs.release` (loading `../credentials/keystore.properties` if present) and make `buildTypes.release` use it when the properties file exists.

- [ ] **Step 1: Write the config plugin**

Create `mobile/plugins/withReleaseSigning.js`:

```js
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

// Exposed for a unit-style assertion in the plan's verification.
module.exports.injectSigning = injectSigning;
```

- [ ] **Step 2: Register the plugin in app.json**

In `mobile/app.json`, add the plugin to the `expo.plugins` array (after the existing entries):

```json
"plugins": [
  "expo-router",
  ["expo-secure-store", { "configureAndroidBackup": false }],
  "./plugins/withReleaseSigning.js"
]
```

- [ ] **Step 3: Add the credentials template**

Create `mobile/credentials/keystore.properties.example`:

```properties
# Copy to keystore.properties (same dir, gitignored) and fill in. Paths are
# relative to mobile/android/ (the gradle root), so ../credentials/ = this dir.
storeFile=../credentials/mentible-release.keystore
storePassword=CHANGE_ME
keyAlias=mentible
keyPassword=CHANGE_ME
```

- [ ] **Step 4: Gitignore the secrets**

In `.gitignore`, add (keep the existing `mobile/*.jks` line):

```gitignore
# Android release signing — never commit the key or its passwords
mobile/credentials/*
!mobile/credentials/keystore.properties.example
*.keystore
```

- [ ] **Step 5: Verify the plugin transform (idempotent + correct)**

Run this one-off check (uses the real current build.gradle as input if present, else a minimal fixture):

```bash
cd mobile
node -e '
const { injectSigning } = require("./plugins/withReleaseSigning.js");
const fs = require("fs");
const src = fs.existsSync("android/app/build.gradle")
  ? fs.readFileSync("android/app/build.gradle","utf8")
  : "android {\n    signingConfigs {\n        debug { storeFile file(\"debug.keystore\") }\n    }\n    buildTypes {\n        release {\n            signingConfig signingConfigs.debug\n            shrinkResources false\n        }\n    }\n}";
const once = injectSigning(src);
const twice = injectSigning(once);
if (!once.includes("mentible-release-signing")) throw new Error("marker not injected");
if (!/signingConfig \(rootProject.file\(.*\).exists\(\) \? signingConfigs.release : signingConfigs.debug\)/.test(once)) throw new Error("release buildType not repointed");
if (once !== twice) throw new Error("NOT idempotent");
console.log("OK: injected + idempotent");
'
```
Expected: `OK: injected + idempotent`. (If it throws "anchor not found", the local build.gradle is from a template variant — inspect and update the anchor.)

- [ ] **Step 6: Write the signing doc**

Create `docs/android-release-signing.md`:

```markdown
# Android release signing

Release APKs are signed with a **private** keystore held only by the maintainer
(not the public RN debug key). See spec `docs/superpowers/specs/2026-07-18-android-release-signing-design.md`.

## Credentials (never committed)
- `mobile/credentials/mentible-release.keystore` — the private key.
- `mobile/credentials/keystore.properties` — its passwords (see `.example`).
Both are gitignored. **Back them up out-of-band. Losing either means the app can
never be updated again** (a new key = a new signature = every user must reinstall).

## How signing is wired
`mobile/plugins/withReleaseSigning.js` (Expo config plugin) injects `signingConfigs.release`
into `android/app/build.gradle` at `expo prebuild`. The release buildType uses the
real key only when `mobile/credentials/keystore.properties` exists; otherwise it
falls back to debug signing (so a fresh clone / CI still builds).

## Build a signed release
    cd mobile && npx expo prebuild -p android
    cd android && ANDROID_HOME=~/Android/Sdk ./gradlew :app:assembleRelease
    # APK: mobile/android/app/build/outputs/apk/release/app-release.apk
    # verify it is the real key (NOT CN=Android Debug):
    $ANDROID_HOME/build-tools/*/apksigner verify --print-certs <apk>

## Release
Publish on wegofwd2020-hub/mambakkam-net as asset `Mentible.apk`, tag `mentible-0.2.2-vcN`.
```

- [ ] **Step 7: Confirm no secret is staged, then commit**

```bash
cd /home/sivam/Documents/code/projects/AIStuff/STEM_studybuddy/Mentible
git add mobile/plugins/withReleaseSigning.js mobile/credentials/keystore.properties.example .gitignore docs/android-release-signing.md mobile/app.json
git status --porcelain   # MUST NOT list any .keystore or a bare keystore.properties
git commit -m "chore(android): private release signing via Expo config plugin (#328)

Injects signingConfigs.release into build.gradle at prebuild (managed Expo
workflow), reading a gitignored mobile/credentials/keystore.properties; release
builds use the real key when present, else fall back to debug. Adds the template,
gitignore protection, and a signing doc. No secret committed."
```

---

## Task 2: Generate the key, build + release the real-key-signed vc14

**Files:**
- Create (gitignored, local): `mobile/credentials/mentible-release.keystore`, `mobile/credentials/keystore.properties`
- Modify: `mobile/app.json` (`versionCode` 13 → 14)

**Interfaces:** Consumes Task 1's plugin + credentials layout.

- [ ] **Step 1: Generate the private keystore (no secret echoed)**

```bash
cd /home/sivam/Documents/code/projects/AIStuff/STEM_studybuddy/Mentible
mkdir -p mobile/credentials
# Strong random passwords, written straight to the gitignored properties file — never printed.
python3 - <<'PY'
import secrets, subprocess, pathlib, os
pw = secrets.token_urlsafe(24)
ks = "mobile/credentials/mentible-release.keystore"
kt = subprocess.run(["bash","-lc","command -v keytool || ls /usr/lib/jvm/*/bin/keytool | head -1"],capture_output=True,text=True).stdout.strip()
subprocess.run([kt,"-genkeypair","-v","-keystore",ks,"-alias","mentible",
  "-keyalg","RSA","-keysize","2048","-validity","10000",
  "-storepass",pw,"-keypass",pw,
  "-dname","CN=Mentible, OU=Mentible, O=wegofwd2020, L=Unknown, ST=Unknown, C=US"],check=True)
pathlib.Path("mobile/credentials/keystore.properties").write_text(
  f"storeFile=../credentials/mentible-release.keystore\nstorePassword={pw}\nkeyAlias=mentible\nkeyPassword={pw}\n")
os.chmod("mobile/credentials/keystore.properties",0o600); os.chmod(ks,0o600)
print("keystore generated + keystore.properties written (passwords NOT shown)")
PY
```

- [ ] **Step 2: Confirm the secrets are untracked**

```bash
git ls-files --error-unmatch mobile/credentials/mentible-release.keystore 2>&1 | grep -q "did not match" && echo "keystore untracked ✓"
git ls-files --error-unmatch mobile/credentials/keystore.properties 2>&1 | grep -q "did not match" && echo "properties untracked ✓"
git status --porcelain mobile/credentials/   # should show ONLY the .example (already committed) — nothing else
```
Expected: both "untracked ✓"; no keystore/properties in `git status`.

- [ ] **Step 3: Bump versionCode to 14**

Edit `mobile/app.json`: `"versionCode": 13` → `"versionCode": 14`. Commit:
```bash
git add mobile/app.json && git commit -m "chore(android): bump versionCode to 14 for the real-key-signed release"
```

- [ ] **Step 4: Prebuild (applies the plugin) + build the signed APK**

```bash
cd mobile && npx expo prebuild -p android 2>&1 | tail -5
grep -q "mentible-release-signing" android/app/build.gradle && echo "plugin applied ✓" || { echo "PLUGIN NOT APPLIED — stop"; exit 1; }
cd android && ANDROID_HOME=~/Android/Sdk ./gradlew :app:assembleRelease 2>&1 | tail -5
```
Expected: "plugin applied ✓"; `BUILD SUCCESSFUL`.

- [ ] **Step 5: Verify the APK is signed with the NEW private key**

```bash
APKSIGNER=$(ls $ANDROID_HOME/build-tools/*/apksigner | sort | tail -1)
"$APKSIGNER" verify --print-certs mobile/android/app/build/outputs/apk/release/app-release.apk | grep -iE "Signer .* certificate DN|SHA-256"
```
Expected: DN shows `CN=Mentible` (NOT `CN=Android Debug`); the SHA-256 is NOT the debug cert `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`. If it still shows Android Debug, the credentials weren't picked up — stop and diagnose.

- [ ] **Step 6: Publish the release (mambakkam-net, asset Mentible.apk)**

```bash
cp mobile/android/app/build/outputs/apk/release/app-release.apk /tmp/Mentible.apk
cat > /tmp/notes-vc14.md <<'MD'
**Security: new app signing key.**

This build is signed with Mentible's own private release key (previous builds used the public React Native debug key, which anyone could forge). Signing integrity is now real.

⚠ **One-time reinstall required.** Because the signing key changed, this cannot install over a previous version — **uninstall the old Mentible app first, then install this one.** Future updates will install normally.

_versionCode 14 · versionName 0.2.2_
MD
gh release create mentible-0.2.2-vc14 --repo wegofwd2020-hub/mambakkam-net --target main \
  --title "Mentible — Android (full build) v0.2.2 · versionCode 14" \
  --notes-file /tmp/notes-vc14.md "/tmp/Mentible.apk#Mentible.apk"
```

- [ ] **Step 7: Verify the live download + it's latest**

```bash
gh api repos/wegofwd2020-hub/mambakkam-net/releases/latest --jq '{tag: .tag_name, asset: .assets[0].name}'
curl -sIL -o /dev/null -w "landing apk → %{http_code}\n" "https://github.com/wegofwd2020-hub/mambakkam-net/releases/latest/download/Mentible.apk"
```
Expected: latest tag `mentible-0.2.2-vc14`; landing apk → 200.

- [ ] **Step 8: ⚠ Backup handoff (maintainer action — cannot be automated)**

Tell the maintainer, explicitly: **back up `mobile/credentials/mentible-release.keystore` and
`mobile/credentials/keystore.properties` out-of-band NOW** (password manager / offline copy). If either
is lost, no future build can update the installed app — every user would have to reinstall again. This
is the one step no automation can do for them.

## Self-Review (completed)

- **Spec coverage:** G1 private key → T2 S1; G2 secrets out of git → T1 S3/S4 + T2 S2 (untracked
  asserts); G3 dev/CI fallback → T1 plugin conditional + S5 idempotency check; G4 re-release vc14 → T2
  S3-S7; G5 docs + backup → T1 S6 + T2 S8. §4 verification → T1 S5 + T2 S2/S5/S7. R1 backup → T2 S8;
  R3 no-echo → T2 S1 (passwords written, not printed); R4 fail-loud anchors → T1 plugin throws.
- **Placeholder scan:** none — every step has concrete code/commands + expected output.
- **Type/name consistency:** `withReleaseSigning`/`injectSigning`/`MARKER "mentible-release-signing"`,
  `mobile/credentials/keystore.properties`, storeFile `../credentials/mentible-release.keystore`, alias
  `mentible`, asset `Mentible.apk`, repo `mambakkam-net`, tag `mentible-0.2.2-vc14` — consistent across tasks.
