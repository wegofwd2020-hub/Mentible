# Tamil STT Capture — Slice 2 (Capture UI) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the mobile capture UI so a project owner can upload an interview audio file (mp3/m4a/wav) and land a transcript artifact via the existing async job-polling loop.

**Architecture:** Mirror the existing trust generate flow (`generateFormat` → `useGenerateVersionJob` → `pollJob`), but the submit is a multipart `POST /api/v1/trust/projects/{id}/transcribe`. A platform-aware upload module isolates the web-`File` vs native-`uri` FormData branch (expo-file-system is native-only). On `done`, refresh the project so the new `artifact(format='transcript')` appears; the review screen (navigation target) is slice 3.

**Tech Stack:** React Native + Expo (SDK 53, Hermes), expo-document-picker, expo-router, Jest + RNTL.

**Spec:** `docs/superpowers/specs/2026-09-04-tamil-stt-capture-design.md` (§6.1 Upload, §6.3 Help gate, §7 slice 2)

## Global Constraints

- Backend endpoint is LIVE on main: `POST /api/v1/trust/projects/{project_id}/transcribe`, multipart fields `file` (required), `language` (default `"ta"`), `title?`, `provider_id?`, `model?`, `api_key?`; **owner-only**; returns `202` `{job_id, status}` (`VersionGenerateJobOut`); poll `GET /api/v1/jobs/{job_id}`, result `{artifact_id, version_id, version_no}`.
- **Never** use `expo-file-system` on the web path (native-only; breaks web — repo trap). Web reads the picked uri with `fetch()`.
- STT-capable providers are `groq` and `openai` only. Managed default = backend `stt_default_provider` (groq). Do not send an anthropic key as a BYOK STT key.
- Import `Alert` from `@/lib/alert` (RN-web no-ops `Alert.alert`).
- Managed transcription needs Pro: mirror the existing `knownNotPro` nudge (fail-open while plan loads / Pro).
- **DoD Help gate:** a new user-facing feature MUST add a `FEATURES` key + a matching Help topic in the SAME PR, or `mobile/__tests__/help/coverage.test.ts` fails.
- Run the FULL `npx jest` (no filter) before finishing — a screen edit can break an untouched guard test.
- Slice 2 does NOT create `trust/transcript/[artifactId].tsx` and does NOT navigate to it (slice 3).

---

### Task 1: Platform-aware audio-upload FormData module

**Files:**
- Create: `mobile/src/api/audioUpload.ts`
- Test: `mobile/__tests__/api/audioUpload.test.ts`

**Interfaces:**
- Consumes: `Platform` from `react-native`.
- Produces:
  - `interface PickedAudio { uri: string; name: string; mimeType: string; size: number }`
  - `buildAudioForm(asset: PickedAudio, fields: { language: string; title?: string; providerId?: string; apiKey?: string }): Promise<FormData>` — native appends `{ uri, name, type }`; web `fetch(uri)`→`blob`→append as `File`. Appends `language` always; appends `title`/`provider_id`/`api_key` only when defined.

- [ ] **Step 1: Write the failing test (native branch)**

```typescript
// mobile/__tests__/api/audioUpload.test.ts
import { buildAudioForm } from "@/api/audioUpload";

// Default RN test env reports Platform.OS === "ios" (native) — the native branch.
// A tiny FormData shim records appended parts so we can assert on them.
class FakeFormData {
  parts: { name: string; value: unknown; filename?: string }[] = [];
  append(name: string, value: unknown, filename?: string) {
    this.parts.push({ name, value, filename });
  }
}

describe("buildAudioForm (native)", () => {
  beforeEach(() => {
    (global as unknown as { FormData: unknown }).FormData = FakeFormData;
  });

  it("appends the file as {uri,name,type} and only the defined fields", async () => {
    const form = (await buildAudioForm(
      { uri: "file:///a.mp3", name: "a.mp3", mimeType: "audio/mpeg", size: 10 },
      { language: "ta", providerId: "groq", apiKey: "sk-x" },
    )) as unknown as FakeFormData;

    const file = form.parts.find((p) => p.name === "file");
    expect(file?.value).toEqual({ uri: "file:///a.mp3", name: "a.mp3", type: "audio/mpeg" });
    expect(form.parts.find((p) => p.name === "language")?.value).toBe("ta");
    expect(form.parts.find((p) => p.name === "provider_id")?.value).toBe("groq");
    expect(form.parts.find((p) => p.name === "api_key")?.value).toBe("sk-x");
    // title omitted -> not appended
    expect(form.parts.find((p) => p.name === "title")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it, verify it fails** — `npx jest audioUpload` → FAIL (module not found).

- [ ] **Step 3: Implement**

```typescript
// mobile/src/api/audioUpload.ts
import { Platform } from "react-native";

export interface PickedAudio {
  uri: string;
  name: string;
  mimeType: string;
  size: number;
}

export interface AudioFormFields {
  language: string;
  title?: string;
  providerId?: string;
  apiKey?: string;
}

// Build the multipart body for POST /transcribe. The file part differs by
// platform: on native the picked uri is a file:// path that RN's FormData
// streams from {uri,name,type}; on web the uri is a blob/data URL we must
// fetch into a Blob (expo-file-system is native-only — never import it here).
export async function buildAudioForm(asset: PickedAudio, fields: AudioFormFields): Promise<FormData> {
  const form = new FormData();
  if (Platform.OS === "web") {
    const blob = await (await fetch(asset.uri)).blob();
    form.append("file", blob, asset.name);
  } else {
    form.append("file", { uri: asset.uri, name: asset.name, type: asset.mimeType } as unknown as Blob);
  }
  form.append("language", fields.language);
  if (fields.title) form.append("title", fields.title);
  if (fields.providerId) form.append("provider_id", fields.providerId);
  if (fields.apiKey) form.append("api_key", fields.apiKey);
  return form;
}
```

- [ ] **Step 4: Run test, verify PASS** — `npx jest audioUpload`.

- [ ] **Step 5: Commit** — `feat(stt): platform-aware audio-upload FormData builder`.

---

### Task 2: `transcribeAudio` API client + result type

**Files:**
- Modify: `mobile/src/api/trustClient.ts`
- Test: `mobile/__tests__/api/transcribeAudio.test.ts`

**Interfaces:**
- Consumes: `buildAudioForm`, `PickedAudio` (Task 1); `resolveBaseUrl`, `ApiError` (existing in `./client`).
- Produces:
  - `interface TranscribeJobOut { job_id: string; status: string }`
  - `interface TranscribeJobResult { artifact_id: string; version_id: string; version_no: number }`
  - `async function transcribeAudio(projectId: string, args: { asset: PickedAudio; language: string; title?: string; providerId?: string; apiKey?: string }, token: string): Promise<TranscribeJobOut>`

- [ ] **Step 1: Write the failing test**

```typescript
// mobile/__tests__/api/transcribeAudio.test.ts
import { transcribeAudio } from "@/api/trustClient";

jest.mock("@/api/client", () => ({
  resolveBaseUrl: () => "https://api.test",
  ApiError: class ApiError extends Error { constructor(public status: number, body: string) { super(body); } },
}));

describe("transcribeAudio", () => {
  const asset = { uri: "file:///a.mp3", name: "a.mp3", mimeType: "audio/mpeg", size: 1 };

  it("POSTs multipart to /transcribe with a bearer token and returns the job", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ job_id: "j1", status: "queued" }),
    });
    (global as unknown as { fetch: unknown }).fetch = fetchMock;

    const out = await transcribeAudio("p1", { asset, language: "ta" }, "tok");

    expect(out).toEqual({ job_id: "j1", status: "queued" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.test/api/v1/trust/projects/p1/transcribe");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer tok");
    // multipart: must NOT hand-set Content-Type (the boundary is auto-added)
    expect(init.headers["Content-Type"]).toBeUndefined();
    expect(init.body).toBeInstanceOf(FormData);
  });

  it("throws ApiError on a non-ok response", async () => {
    (global as unknown as { fetch: unknown }).fetch = jest
      .fn()
      .mockResolvedValue({ ok: false, status: 413, text: async () => "too large" });
    await expect(transcribeAudio("p1", { asset, language: "ta" }, "tok")).rejects.toMatchObject({ status: 413 });
  });
});
```

- [ ] **Step 2: Run it, verify it fails** — `npx jest transcribeAudio` → FAIL.

- [ ] **Step 3: Implement** — add near the other `trustClient` exports:

```typescript
import { buildAudioForm, type PickedAudio } from "@/api/audioUpload";

export interface TranscribeJobOut { job_id: string; status: string }
export interface TranscribeJobResult { artifact_id: string; version_id: string; version_no: number }

// Submit an audio file for transcription. Multipart (not the JSON trustFetch):
// we must let fetch set the multipart boundary, so no Content-Type header here.
// Returns the async job; poll GET /api/v1/jobs/{job_id} for the transcript version.
export async function transcribeAudio(
  projectId: string,
  args: { asset: PickedAudio; language: string; title?: string; providerId?: string; apiKey?: string },
  token: string,
): Promise<TranscribeJobOut> {
  const body = await buildAudioForm(args.asset, {
    language: args.language,
    title: args.title,
    providerId: args.providerId,
    apiKey: args.apiKey,
  });
  const res = await fetch(`${resolveBaseUrl()}/api/v1/trust/projects/${projectId}/transcribe`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new ApiError(res.status, text);
  }
  return res.json() as Promise<TranscribeJobOut>;
}
```

*(Note: `resolveBaseUrl`/`ApiError` are already imported at the top of `trustClient.ts` — reuse the existing import, add only the `audioUpload` import.)*

- [ ] **Step 4: Run test, verify PASS** — `npx jest transcribeAudio`.

- [ ] **Step 5: Commit** — `feat(stt): transcribeAudio multipart client + result types`.

---

### Task 3: `useTranscribeJob` submit-then-poll hook

**Files:**
- Create: `mobile/src/hooks/useTranscribeJob.ts`
- Test: `mobile/__tests__/hooks/useTranscribeJob.test.tsx`

**Interfaces:**
- Consumes: `transcribeAudio`, `TranscribeJobResult` (Task 2); `pollJob` (`@/api/pollJob`); `ApiError` (`@/api/client`); `PickedAudio` (`@/api/audioUpload`).
- Produces:
  - `interface RunTranscribeArgs { projectId: string; asset: PickedAudio; language: string; title?: string; providerId?: string; apiKey?: string; accessToken: string; onPhase?: (p: "queued" | "running") => void }`
  - `useTranscribeJob(intervalMs?): { status: "idle"|"transcribing"|"done"|"failed"; error: string | null; run: (args: RunTranscribeArgs) => Promise<TranscribeJobResult> }`

- [ ] **Step 1: Write the failing test**

```typescript
// mobile/__tests__/hooks/useTranscribeJob.test.tsx
import { renderHook, act } from "@testing-library/react-native";
import { useTranscribeJob } from "@/hooks/useTranscribeJob";

jest.mock("@/api/trustClient", () => ({
  transcribeAudio: jest.fn().mockResolvedValue({ job_id: "j1", status: "queued" }),
}));
jest.mock("@/api/pollJob", () => ({
  pollJob: jest.fn().mockResolvedValue({ artifact_id: "a1", version_id: "v1", version_no: 1 }),
}));
jest.mock("@/api/client", () => ({ ApiError: class extends Error {} }));

const asset = { uri: "file:///a.mp3", name: "a.mp3", mimeType: "audio/mpeg", size: 1 };

it("submits then polls and resolves the transcript version", async () => {
  const { result } = renderHook(() => useTranscribeJob(1));
  let out;
  await act(async () => {
    out = await result.current.run({ projectId: "p1", asset, language: "ta", accessToken: "tok" });
  });
  expect(out).toEqual({ artifact_id: "a1", version_id: "v1", version_no: 1 });
  expect(result.current.status).toBe("done");
});
```

- [ ] **Step 2: Run it, verify it fails** — `npx jest useTranscribeJob` → FAIL.

- [ ] **Step 3: Implement** (mirror `useGenerateVersionJob.ts`)

```typescript
// mobile/src/hooks/useTranscribeJob.ts
import { useCallback, useState } from "react";
import { ApiError } from "@/api/client";
import { pollJob } from "@/api/pollJob";
import { transcribeAudio, type TranscribeJobResult } from "@/api/trustClient";
import type { PickedAudio } from "@/api/audioUpload";

export type TranscribeJobUiStatus = "idle" | "transcribing" | "done" | "failed";

const POLL_INTERVAL_MS = 3_000;

export interface RunTranscribeArgs {
  projectId: string;
  asset: PickedAudio;
  language: string;
  title?: string;
  providerId?: string;
  apiKey?: string;
  accessToken: string;
  onPhase?: (p: "queued" | "running") => void;
}

export interface UseTranscribeJobResult {
  status: TranscribeJobUiStatus;
  error: string | null;
  run: (args: RunTranscribeArgs) => Promise<TranscribeJobResult>;
}

// Submit an audio upload then poll /jobs/{id} until done|failed. Mirrors
// useGenerateVersionJob: the hook owns the submit, the ui status/error state,
// and the transcription-specific timeout/failure messages; pollJob owns the loop.
export function useTranscribeJob(intervalMs = POLL_INTERVAL_MS): UseTranscribeJobResult {
  const [status, setStatus] = useState<TranscribeJobUiStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (args: RunTranscribeArgs): Promise<TranscribeJobResult> => {
      setError(null);
      setStatus("transcribing");
      try {
        const submitted = await transcribeAudio(
          args.projectId,
          { asset: args.asset, language: args.language, title: args.title, providerId: args.providerId, apiKey: args.apiKey },
          args.accessToken,
        );
        const result = await pollJob<TranscribeJobResult>(submitted.job_id, args.accessToken, {
          intervalMs,
          timeoutMessage: "Timed out waiting for transcription",
          failedMessage: "Transcription failed",
          onPhase: args.onPhase,
        });
        setStatus("done");
        return result;
      } catch (err) {
        const message =
          err instanceof ApiError ? err.userMessage() : err instanceof Error ? err.message : "Transcription failed";
        setStatus("failed");
        setError(message);
        throw err instanceof Error ? err : new Error(message);
      }
    },
    [intervalMs],
  );

  return { status, error, run };
}
```

- [ ] **Step 4: Run test, verify PASS** — `npx jest useTranscribeJob`.

- [ ] **Step 5: Commit** — `feat(stt): useTranscribeJob submit-then-poll hook`.

---

### Task 4: `transcribeAudio` action on `useTrustProject`

**Files:**
- Modify: `mobile/src/hooks/useTrustProject.ts`
- Test: `mobile/__tests__/hooks/useTrustProject.transcribe.test.tsx` (or extend an existing useTrustProject test)

**Interfaces:**
- Consumes: `useTranscribeJob` (Task 3); existing `resolveGenProvider`, `loadApiKey`, `accessToken`, `knownNotPro`, `refresh`.
- Produces (added to the hook's return object):
  - `transcribeAudio(asset: PickedAudio, opts?: { title?: string; language?: string; onPhase?: (p: "queued" | "running") => void }): Promise<TranscribeJobResult>`

**STT provider resolution rule:** resolve the gen provider; if it is `groq` or `openai` (STT-capable) AND a key is saved for it → BYOK (`providerId` + `apiKey`); otherwise omit both → backend uses the managed `stt_default_provider`. Managed still needs Pro: reuse the `knownNotPro` nudge (message references audio).

- [ ] **Step 1: Write the failing test** — assert that with a saved groq key the hook forwards `providerId:"groq"` + `apiKey`, and that a `knownNotPro` user with no key gets the "Add a key … to transcribe" throw. Mock `useTranscribeJob` to capture args, `loadApiKey`/`loadDefaultParams` for the provider/key, `useBillingPlan` for the plan.

```typescript
// sketch — capture the args useTranscribeJob.run receives
const run = jest.fn().mockResolvedValue({ artifact_id: "a1", version_id: "v1", version_no: 1 });
jest.mock("@/hooks/useTranscribeJob", () => ({ useTranscribeJob: () => ({ status: "idle", error: null, run }) }));
jest.mock("@/storage/settingsStore", () => ({ loadDefaultParams: async () => ({ provider: "groq" }) }));
jest.mock("@/secure/keyStore", () => ({ loadApiKey: async () => "gsk-x" }));
// ...render useTrustProject, call transcribeAudio(asset), assert run got providerId:"groq", apiKey:"gsk-x"
```

- [ ] **Step 2: Run it, verify it fails.**

- [ ] **Step 3: Implement** — add the STT-capable set + callback, wire into the return object:

```typescript
// near resolveGenProvider
const STT_CAPABLE = new Set(["groq", "openai"]);

// inside useTrustProject, after generateFormat:
const { run: runTranscribeJob } = useTranscribeJob();

const transcribeAudio = useCallback(
  async (asset: PickedAudio, opts?: { title?: string; language?: string; onPhase?: (p: "queued" | "running") => void }): Promise<TranscribeJobResult> => {
    const gen = await resolveGenProvider();
    const sttProvider = STT_CAPABLE.has(gen) ? gen : undefined;
    const key = sttProvider ? await loadApiKey(sttProvider) : null;
    // No BYOK STT key and not Pro -> managed is unavailable to this user.
    if (!key && knownNotPro) {
      throw new Error("Transcription needs your managed plan or a Groq/OpenAI key saved in Settings.");
    }
    if (!accessToken) throw new Error("Not signed in");
    const result = await runTranscribeJob({
      projectId,
      asset,
      language: opts?.language ?? "ta",
      title: opts?.title,
      providerId: key ? sttProvider : undefined,
      apiKey: key ?? undefined,
      accessToken,
      onPhase: opts?.onPhase,
    });
    await refresh();
    return result;
  },
  [accessToken, knownNotPro, projectId, refresh, runTranscribeJob],
);
```

Add imports (`useTranscribeJob`, `PickedAudio`, `TranscribeJobResult`) and add `transcribeAudio` to the returned object.

- [ ] **Step 4: Run test, verify PASS.**

- [ ] **Step 5: Commit** — `feat(stt): transcribeAudio action on useTrustProject`.

---

### Task 5: `Mp3UploadSheet` component

**Files:**
- Create: `mobile/src/components/trust/Mp3UploadSheet.tsx`
- Create: `mobile/src/storage/pickAudioFile.ts`
- Test: `mobile/__tests__/components/Mp3UploadSheet.test.tsx`

**Interfaces:**
- `pickAudioFile(): Promise<PickedAudio | null>` — DocumentPicker for audio (`audio/mpeg`, `audio/mp4`, `audio/x-m4a`, `audio/wav`, `audio/x-wav`, `*/*` fallback; `copyToCacheDirectory: true`); maps the asset to `PickedAudio`; returns null on cancel.
- `Mp3UploadSheet` props: `{ visible: boolean; busy: boolean; onClose: () => void; onSubmit: (asset: PickedAudio, opts: { title?: string; language: string }) => void }`. A Modal with: pick-file button (shows chosen name + size), optional title `TextInput`, a language selector (Tamil default; a couple of options), a size guard against `audioMaxBytes` (surface an inline error over the client cap; keep the cap as a const with a comment that the backend is the real gate), Submit (disabled until a file is picked or while `busy`), Cancel. `useThemedStyles`; `Alert` from `@/lib/alert`.

- [ ] **Step 1: Write the failing test** — render with `visible`, mock `pickAudioFile` to return an asset, press the pick button then Submit, assert `onSubmit` fires with the asset and `language: "ta"`. (Mock `expo-document-picker`.)

- [ ] **Step 2: Run it, verify it fails.**

- [ ] **Step 3: Implement** `pickAudioFile.ts` then `Mp3UploadSheet.tsx`. Follow `pickBookFile.ts`'s DocumentPicker shape; follow an existing themed Modal component for styling (e.g. the invite/metadata modals). Language options: `[{ code: "ta", label: "Tamil" }, { code: "en", label: "English" }]`, default `ta`.

- [ ] **Step 4: Run test, verify PASS.**

- [ ] **Step 5: Commit** — `feat(stt): Mp3UploadSheet + pickAudioFile`.

---

### Task 6: Capture card in the project screen + Help topic

**Files:**
- Modify: `mobile/app/trust/[projectId].tsx` (the `SourcesSection` / capture area)
- Modify: `mobile/src/help-content/features.ts`
- Modify: `mobile/src/help-content/topics.ts`
- Test: `mobile/__tests__/help/coverage.test.ts` (existing gate — must stay green)

**Interfaces:**
- Consumes: `useTrustProject().transcribeAudio`, `Mp3UploadSheet`, `pickAudioFile`.

- [ ] **Step 1 (Help, test-first via the gate):** add to `FEATURES` in `features.ts`:

```typescript
{ key: "capture-audio", label: "Transcribing an interview (audio → transcript)" },
```

- [ ] **Step 2: Run the gate, verify it FAILS** — `npx jest coverage` → fails: feature `capture-audio` has no topic.

- [ ] **Step 3: Add the matching topic** in `topics.ts` with `featureKey: "capture-audio"` — explain: owner-only; upload mp3/m4a/wav; Tamil default; runs on your managed plan or a saved Groq/OpenAI key; lands a transcript you review next (slice 3). Follow the existing topic object shape.

- [ ] **Step 4: Run the gate, verify PASS** — `npx jest coverage`.

- [ ] **Step 5: Wire the Capture card** into `SourcesSection` (owner-only, `isOwner` guard already threaded there). A `Card` with title **"Upload interview (audio)"**, a short line ("Transcribe an mp3/m4a/wav into an editable transcript"), and a Button that opens `Mp3UploadSheet`. On submit: call `transcribeAudio(asset, { title, language })`; show a busy/phase indicator; on success `Alert` "Transcript ready — find it in this project's artifacts" and close the sheet (the `await refresh()` inside the action surfaces the new artifact). On error, `Alert` the message. Do NOT navigate to `trust/transcript/[artifactId]` (slice 3).

- [ ] **Step 6: Run the FULL suite** — `npx jest` (no filter). Fix any untouched guard/snapshot that the screen edit disturbed.

- [ ] **Step 7: Commit** — `feat(stt): capture card in project screen + Help topic`.

---

## Verification (post-tasks)

- `npx jest` (full, green) + `npx tsc --noEmit` (or the repo's typecheck script).
- `mobile:verify` on emulator: open a project you own → Upload interview → pick a short audio → observe queued→running→done → transcript artifact appears in the project. (Requires the prod/staging backend to be on #510 with a managed STT key, OR the local backend — note in the PR that prod is pre-#510 so device E2E runs against local until prod refresh.)
