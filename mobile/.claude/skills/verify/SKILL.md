---
name: verify
description: Build, run, and drive the Mentible Android app on an emulator to observe real runtime behaviour (device smoke tests).
---

# Verifying mobile/ on a real Android emulator

CI mocks every native module (`expo-image-manipulator`, `expo-file-system`,
`expo-image-picker`), so anything that depends on **native** behaviour is
verified by-construction only in jest. Use this to observe it for real.

## Build + launch (cold build ~17 min)

```bash
# 1. Emulator (AVDs: studybuddy_pixel, studybuddy_tablet)
~/Android/Sdk/emulator/emulator -avd studybuddy_pixel -no-snapshot-load -no-boot-anim &

# 2. Debug APK  (Expo Go does NOT work — see gotchas)
cd mobile/android && ./gradlew assembleDebug        # do NOT pipe to `tail`; it hides all progress
~/Android/Sdk/platform-tools/adb install -r -t app/build/outputs/apk/debug/app-debug.apk

# 3. Metro + connect
cd mobile && npx expo start --port 8081
~/Android/Sdk/platform-tools/adb reverse tcp:8081 tcp:8081
~/Android/Sdk/platform-tools/adb shell monkey -p com.wegofwd2020.studybuddyq -c android.intent.category.LAUNCHER 1
```

Package: `com.wegofwd2020.studybuddyq`. Deep-link scheme: `mentible://`
(e.g. `adb shell am start -a android.intent.action.VIEW -d "mentible://book/import" com.wegofwd2020.studybuddyq`)
— far faster than tapping through nav.

## Getting past the sign-in gate without signing in

Authoring surfaces are wrapped in `RequireSignIn`, and `canEdit = authStatus !== "signed_out"`.
`AuthProvider` sets status `"unavailable"` when the Supabase client is null, and
**`"unavailable"` renders children** — so with no Supabase config you get full
authoring access with no sign-in.

Setting `EXPO_PUBLIC_SUPABASE_URL=""` on the `expo start` command **does not
work** (the client still gets built). What works: move `.env.local` aside and
restart Metro with `--clear`.

```bash
mv .env.local .env.local.bak && npx expo start --port 8081 --clear
# ... verify ...
mv .env.local.bak .env.local        # ALWAYS restore — it holds the user's real keys
```
Confirm it took: the header's "Sign in" avatar disappears.

## Reading app-private storage

These AVDs are `google_apis` (not Play), so **`adb root` works** — no `run-as` needed:

```bash
adb root
adb shell "find /data/data/com.wegofwd2020.studybuddyq -path '*media*' -type f"
adb pull <path> ./local-copy
```
- Attached media: `files/media/<bookId>/<imageId>.<ext>`
- Books (AsyncStorage): `databases/RKStorage`, table `catalystLocalStorage`,
  keys `sbq_book_<id>`. Query a *specific* key — other books' prose contains
  words like "base64" and will produce false positives.

## Seeding a book with content (no LLM call)

`attachImage` refuses a topic with no content, and generating needs a real LLM.
Instead craft a `.book.zip` (`book.json` + `media/<name>`) and import it via
`mentible://book/import` → "Choose a book file" (files must be pushed to
`/sdcard/Download/`; use the picker drawer → Downloads). Minimum book.json:
`title` + `toc.subjects[]` + `content[topicId]` with a `lesson`.

## Gotchas

- **Expo Go is unusable**: the installed build (2.32.19) predates SDK 53 —
  "Project is incompatible with this version of Expo Go". Must use a debug build.
- `./gradlew ... | tail -N` buffers everything until exit; you'll see zero
  progress. Watch `ps aux | grep clang` instead, or don't pipe.
- Tap the picker only *after* it renders (~5 s); an early tap is silently lost.
- Media files land under `media/<bookId>/` keyed by a **freshly minted** UUID,
  never the id from an imported bundle (path-traversal fix).
