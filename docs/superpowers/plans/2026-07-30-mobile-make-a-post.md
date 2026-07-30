# Mobile "Make a post" (Posts tab) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a mobile **Posts** tab where the user pastes source text and gets 3 platform-scoped social-post variants (LinkedIn / X) from `POST /api/v1/derivatives/post`, with copy-to-clipboard.

**Architecture:** Mirror the existing generate stack — a per-endpoint client file (like `trustClient.ts`) → a stateless generate-style hook (like `useGenerateTopic`) → a single screen (like `reviews.tsx`). The endpoint is **synchronous** (returns variants in the response body — no job/poll). BYOK-only: the hook reads the saved Anthropic key and always sends it; no managed path this slice.

**Tech Stack:** React Native + Expo (expo-router), TypeScript, Jest + React Native Testing Library. New dependency: `expo-clipboard`.

## Global Constraints
- **BYOK-only this slice.** The Anthropic key is read via `loadApiKey("anthropic")` and sent in the request body; a missing key is a hard, friendly failure (never a silent managed fallback). The key is **never** stored in state, logged, or rendered.
- **Endpoint is synchronous.** No `pollUntilDone`, no `job_id`. One awaited call returns `{platform, variants, provenance}`.
- **Tab label is "Posts"**, route is `posts` — NOT "Publish" (that word already names the book-export flow, `FLOW.publish`). Feature key is `make-a-post`.
- **Demo-excluded.** The Posts tab needs a backend + a key; add it to the `...(IS_DEMO ? [] : [...])` group in `TopNavBar` `ORDER`, exactly like `projects`/`reviews`. No `RequireSignIn` (the BYOK path is anonymous server-side — `optional_user`).
- **House style (labels.ts / ADR-006):** authoritative, peer-to-peer, no "generate with AI / prompt / chatbot" phrasing in user copy.
- **DoD gate:** a new `FEATURES` key REQUIRES a matching Help topic in the same PR (`__tests__/help/coverage.test.ts` fails otherwise).
- **Mobile test command:** `cd mobile && npm test -- <path>`. **Typecheck gate:** `cd mobile && npx tsc --noEmit` (baseline 0 errors — keep it 0).
- **Web-safe:** import `Alert` only from `@/lib/alert`; the clipboard wrapper must not throw on web.

---

### Task 1: `derivativesClient.ts` — types + `makePost`

**Files:**
- Create: `mobile/src/api/derivativesClient.ts`
- Test: `mobile/__tests__/api/derivativesClient.test.ts`

**Interfaces:**
- Consumes: `ApiError`, `resolveBaseUrl` from `@/api/client`; `IS_DEMO` from `@/constants/demo`.
- Produces: `Platform`, `PostVariant`, `MakePostRequest`, `MakePostResponse` types; `makePost(req: MakePostRequest): Promise<MakePostResponse>`.

- [ ] **Step 1: Write the failing test**

`mobile/__tests__/api/derivativesClient.test.ts`:
```ts
import { makePost } from "@/api/derivativesClient";
import { ApiError } from "@/api/client";

const RESPONSE = {
  platform: "linkedin",
  variants: [
    { hook: "h0", body: "b0", hashtags: ["#a"], cta: null },
    { hook: "h1", body: "b1", hashtags: ["#a"], cta: "read more" },
    { hook: "h2", body: "b2", hashtags: ["#a"], cta: null },
  ],
  provenance: "ai-generated",
};

function mockFetchOnce(status: number, body: unknown) {
  (global as unknown as { fetch: jest.Mock }).fetch = jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
    headers: { get: () => null },
  });
}

afterEach(() => jest.restoreAllMocks());

it("POSTs to /derivatives/post with the exact body and returns the parsed response", async () => {
  mockFetchOnce(200, RESPONSE);
  const out = await makePost({
    source_text: "Stormwater basics.",
    platform: "linkedin",
    tone: "punchy",
    api_key: "sk-ant-xxxxxxxxxxxxxxxxxxxx",
    provider_id: "anthropic",
  });
  expect(out.variants).toHaveLength(3);
  expect(out.provenance).toBe("ai-generated");
  const fetchMock = (global as unknown as { fetch: jest.Mock }).fetch;
  const [url, init] = fetchMock.mock.calls[0];
  expect(url).toMatch(/\/api\/v1\/derivatives\/post$/);
  expect(init.method).toBe("POST");
  const sent = JSON.parse(init.body);
  expect(sent.source_text).toBe("Stormwater basics.");
  expect(sent.platform).toBe("linkedin");
  expect(sent.api_key).toBe("sk-ant-xxxxxxxxxxxxxxxxxxxx");
  expect(sent.provider_id).toBe("anthropic");
});

it("throws ApiError on a non-2xx response", async () => {
  mockFetchOnce(502, { detail: "generated content failed validation" });
  await expect(
    makePost({ source_text: "x", platform: "x", api_key: "sk-ant-xxxxxxxxxxxxxxxxxxxx" }),
  ).rejects.toBeInstanceOf(ApiError);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && npm test -- __tests__/api/derivativesClient.test.ts`
Expected: FAIL — cannot find module `@/api/derivativesClient`.

- [ ] **Step 3: Write minimal implementation**

`mobile/src/api/derivativesClient.ts`:
```ts
import { ApiError, resolveBaseUrl } from "./client";
import { IS_DEMO } from "@/constants/demo";

export type Platform = "linkedin" | "x";

export interface PostVariant {
  hook: string;
  body: string;
  hashtags: string[];
  cta?: string | null;
}

export interface MakePostRequest {
  source_text: string;
  platform: Platform;
  tone?: string;
  api_key: string; // BYOK-only this slice — always sent (never logged/stored)
  provider_id?: string; // default "anthropic"; omit → server default
  model?: string;
}

export interface MakePostResponse {
  platform: string;
  variants: PostVariant[]; // exactly 3 (server-enforced)
  provenance: string; // "ai-generated"
}

// Turn source text into platform-scoped social posts. Synchronous endpoint —
// the variants come back in the response body (no job/poll). Key-free client
// shape (no JWT): the caller populates api_key in the request; this module
// never reads or stores it. Mirrors trustClient's own fetch wrapper.
export async function makePost(req: MakePostRequest): Promise<MakePostResponse> {
  // A demo build has no backend; the Posts tab is hidden there, but never let a
  // request leave the device regardless (mirrors submitGenerate).
  if (IS_DEMO) throw new Error("Making a post is disabled in this demo build.");
  const res = await fetch(`${resolveBaseUrl()}/api/v1/derivatives/post`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider_id: "anthropic", ...req }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new ApiError(res.status, body);
  }
  return res.json() as Promise<MakePostResponse>;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mobile && npm test -- __tests__/api/derivativesClient.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add mobile/src/api/derivativesClient.ts mobile/__tests__/api/derivativesClient.test.ts
git commit -m "feat(posts): derivativesClient.makePost + types (ADR-037 D8)"
```

---

### Task 2: `useMakePost` hook

**Files:**
- Create: `mobile/src/hooks/useMakePost.ts`
- Test: `mobile/__tests__/hooks/useMakePost.test.ts`

**Interfaces:**
- Consumes: `makePost`, `Platform`, `PostVariant` from `@/api/derivativesClient`; `ApiError` from `@/api/client`.
- Produces: `useMakePost({ getApiKey }: { getApiKey: () => Promise<string | null> }) => { status, error, variants, provenance, run, reset }` where `status: "idle"|"generating"|"done"|"failed"`, `run: (args: { sourceText: string; platform: Platform; tone?: string }) => Promise<void>`.

- [ ] **Step 1: Write the failing test**

`mobile/__tests__/hooks/useMakePost.test.ts`:
```ts
import { renderHook, act, waitFor } from "@testing-library/react-native";
import { useMakePost } from "@/hooks/useMakePost";
import { ApiError } from "@/api/client";
import * as client from "@/api/derivativesClient";

jest.mock("@/api/derivativesClient", () => ({ makePost: jest.fn() }));
const makePost = client.makePost as jest.Mock;

const VARIANTS = [
  { hook: "h0", body: "b0", hashtags: ["#a"], cta: null },
  { hook: "h1", body: "b1", hashtags: ["#a"], cta: null },
  { hook: "h2", body: "b2", hashtags: ["#a"], cta: null },
];

beforeEach(() => jest.clearAllMocks());

it("sends the key and platform, then exposes the variants on success", async () => {
  makePost.mockResolvedValue({ platform: "linkedin", variants: VARIANTS, provenance: "ai-generated" });
  const getApiKey = jest.fn().mockResolvedValue("sk-ant-xxxxxxxxxxxxxxxxxxxx");
  const { result } = renderHook(() => useMakePost({ getApiKey }));

  await act(async () => {
    await result.current.run({ sourceText: "Stormwater.", platform: "linkedin", tone: "punchy" });
  });

  expect(makePost).toHaveBeenCalledWith(
    expect.objectContaining({
      source_text: "Stormwater.",
      platform: "linkedin",
      tone: "punchy",
      api_key: "sk-ant-xxxxxxxxxxxxxxxxxxxx",
      provider_id: "anthropic",
    }),
  );
  await waitFor(() => expect(result.current.status).toBe("done"));
  expect(result.current.variants).toHaveLength(3);
  expect(result.current.provenance).toBe("ai-generated");
});

it("fails without calling makePost when no key is saved", async () => {
  const getApiKey = jest.fn().mockResolvedValue(null);
  const { result } = renderHook(() => useMakePost({ getApiKey }));
  await act(async () => {
    await result.current.run({ sourceText: "x", platform: "x" });
  });
  expect(makePost).not.toHaveBeenCalled();
  await waitFor(() => expect(result.current.status).toBe("failed"));
  expect(result.current.error).toMatch(/api key/i);
});

it("surfaces ApiError.userMessage on failure", async () => {
  makePost.mockRejectedValue(new ApiError(502, JSON.stringify({ detail: "generated content failed validation" })));
  const getApiKey = jest.fn().mockResolvedValue("sk-ant-xxxxxxxxxxxxxxxxxxxx");
  const { result } = renderHook(() => useMakePost({ getApiKey }));
  await act(async () => {
    await result.current.run({ sourceText: "x", platform: "linkedin" });
  });
  await waitFor(() => expect(result.current.status).toBe("failed"));
  expect(result.current.error).toBe("generated content failed validation");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && npm test -- __tests__/hooks/useMakePost.test.ts`
Expected: FAIL — cannot find module `@/hooks/useMakePost`.

- [ ] **Step 3: Write minimal implementation**

`mobile/src/hooks/useMakePost.ts`:
```ts
import { useCallback, useState } from "react";
import { ApiError } from "@/api/client";
import { makePost, type Platform, type PostVariant } from "@/api/derivativesClient";

export type MakePostStatus = "idle" | "generating" | "done" | "failed";

interface UseMakePostArgs {
  // Resolve the BYOK key lazily so it is read at run time, never held in state.
  getApiKey: () => Promise<string | null>;
}

export interface RunPostArgs {
  sourceText: string;
  platform: Platform;
  tone?: string;
}

export interface UseMakePostResult {
  status: MakePostStatus;
  error: string | null;
  variants: PostVariant[];
  provenance: string | null;
  run: (args: RunPostArgs) => Promise<void>;
  reset: () => void;
}

// Stateless one-shot: source text -> 3 platform-scoped post variants over the
// synchronous /derivatives/post endpoint (no polling). BYOK-only — a missing
// key is a friendly hard failure, mirroring useGenerateTopic's guard.
export function useMakePost({ getApiKey }: UseMakePostArgs): UseMakePostResult {
  const [status, setStatus] = useState<MakePostStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [variants, setVariants] = useState<PostVariant[]>([]);
  const [provenance, setProvenance] = useState<string | null>(null);

  const reset = useCallback(() => {
    setStatus("idle");
    setError(null);
    setVariants([]);
    setProvenance(null);
  }, []);

  const run = useCallback(
    async ({ sourceText, platform, tone }: RunPostArgs): Promise<void> => {
      setError(null);
      setStatus("generating");

      const apiKey = await getApiKey();
      if (!apiKey) {
        setError("No API key saved. Go to Settings and paste your Anthropic key.");
        setStatus("failed");
        return;
      }

      try {
        const res = await makePost({
          source_text: sourceText,
          platform,
          ...(tone ? { tone } : {}),
          api_key: apiKey,
          provider_id: "anthropic",
        });
        setVariants(res.variants);
        setProvenance(res.provenance);
        setStatus("done");
      } catch (err) {
        setError(
          err instanceof ApiError
            ? err.userMessage()
            : err instanceof Error
              ? err.message
              : "Could not make a post.",
        );
        setStatus("failed");
      }
    },
    [getApiKey],
  );

  return { status, error, variants, provenance, run, reset };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mobile && npm test -- __tests__/hooks/useMakePost.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add mobile/src/hooks/useMakePost.ts mobile/__tests__/hooks/useMakePost.test.ts
git commit -m "feat(posts): useMakePost hook — BYOK, no-poll (ADR-037 D8)"
```

---

### Task 3: `clipboard` wrapper + `expo-clipboard` dependency

**Files:**
- Create: `mobile/src/lib/clipboard.ts`
- Test: `mobile/__tests__/lib/clipboard.test.ts`
- Modify: `mobile/package.json` (adds `expo-clipboard` — done via `expo install`, do not hand-edit the version)

**Interfaces:**
- Consumes: `expo-clipboard` `setStringAsync`.
- Produces: `copyText(text: string): Promise<void>`.

- [ ] **Step 1: Install the dependency**

Run: `cd mobile && npx expo install expo-clipboard`
Expected: `expo-clipboard` added to `package.json` dependencies at an Expo-SDK-compatible version.

- [ ] **Step 2: Write the failing test**

`mobile/__tests__/lib/clipboard.test.ts`:
```ts
import { copyText } from "@/lib/clipboard";
import * as Clipboard from "expo-clipboard";

jest.mock("expo-clipboard", () => ({ setStringAsync: jest.fn().mockResolvedValue(true) }));

it("writes the given text to the clipboard", async () => {
  await copyText("hello world");
  expect(Clipboard.setStringAsync).toHaveBeenCalledWith("hello world");
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd mobile && npm test -- __tests__/lib/clipboard.test.ts`
Expected: FAIL — cannot find module `@/lib/clipboard`.

- [ ] **Step 4: Write minimal implementation**

`mobile/src/lib/clipboard.ts`:
```ts
import * as Clipboard from "expo-clipboard";

// Copy plain text to the system clipboard. Isolated behind this wrapper so the
// screen depends on `@/lib/clipboard` (mockable) rather than the native module,
// and so a web build has one place to swap the impl if ever needed.
// expo-clipboard's setStringAsync is web-safe (uses the Clipboard API).
export async function copyText(text: string): Promise<void> {
  await Clipboard.setStringAsync(text);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd mobile && npm test -- __tests__/lib/clipboard.test.ts`
Expected: PASS (1 test).

- [ ] **Step 6: Commit**

```bash
git add mobile/src/lib/clipboard.ts mobile/__tests__/lib/clipboard.test.ts mobile/package.json mobile/package-lock.json
git commit -m "feat(posts): expo-clipboard + copyText wrapper (ADR-037 D8)"
```

---

### Task 4: `posts.tsx` screen

**Files:**
- Create: `mobile/app/(tabs)/posts.tsx`
- Test: `mobile/__tests__/screens/Posts.test.tsx`

**Interfaces:**
- Consumes: `useMakePost` (`@/hooks/useMakePost`), `copyText` (`@/lib/clipboard`), `loadApiKey` (`@/secure/keyStore`), `PageContainer` (`@/components/PageContainer`), theme tokens (`@/constants/theme`), `PostVariant` (`@/api/derivativesClient`).
- Produces: default-export React component `PostsScreen`; an exported pure helper `assemblePost(v: PostVariant): string` (imported by the test).

**Notes for the implementer:**
- NO `RequireSignIn` — the BYOK path is anonymous; the no-key case is handled by the hook's `failed` state + error text.
- Read `mobile/app/(tabs)/reviews.tsx` for the `PageContainer` shell + `StyleSheet` idiom, and `mobile/src/constants/theme.ts` for available tokens (`colors`, `spacing`, `radius`, `typography`). Match that styling vocabulary; do not invent new global tokens.
- The platform toggle = two `Pressable`s styled as a segmented control (no segmented-control component exists in `src/components/`). Default `linkedin`.
- Wire the key: `useMakePost({ getApiKey: () => loadApiKey("anthropic") })`.
- Copy acknowledgement = a transient inline "Copied" label on the pressed card (track a `copiedIndex` state; clear via `setTimeout`), NOT the alert shim.

- [ ] **Step 1: Write the failing test**

`mobile/__tests__/screens/Posts.test.tsx`:
```ts
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import PostsScreen, { assemblePost } from "@/../app/(tabs)/posts";

jest.mock("@/hooks/useMakePost", () => ({ useMakePost: jest.fn() }));
jest.mock("@/lib/clipboard", () => ({ copyText: jest.fn().mockResolvedValue(undefined) }));
jest.mock("@/secure/keyStore", () => ({ loadApiKey: jest.fn().mockResolvedValue("sk-ant-x") }));

import { useMakePost } from "@/hooks/useMakePost";
import { copyText } from "@/lib/clipboard";

const VARIANTS = [
  { hook: "Hook 0", body: "Body 0", hashtags: ["#one"], cta: "Read more" },
  { hook: "Hook 1", body: "Body 1", hashtags: ["#two"], cta: null },
  { hook: "Hook 2", body: "Body 2", hashtags: ["#three"], cta: null },
];

function mockHook(over: Record<string, unknown>) {
  (useMakePost as jest.Mock).mockReturnValue({
    status: "idle", error: null, variants: [], provenance: null,
    run: jest.fn(), reset: jest.fn(), ...over,
  });
}

beforeEach(() => jest.clearAllMocks());

it("disables Generate until source text is entered", () => {
  mockHook({});
  render(<PostsScreen />);
  const btn = screen.getByLabelText("Make posts");
  expect(btn.props.accessibilityState?.disabled).toBe(true);
  fireEvent.changeText(screen.getByLabelText("Source text"), "Stormwater basics.");
  expect(screen.getByLabelText("Make posts").props.accessibilityState?.disabled).toBe(false);
});

it("renders 3 variant cards and the AI-generated tag when done", () => {
  mockHook({ status: "done", variants: VARIANTS, provenance: "ai-generated" });
  render(<PostsScreen />);
  expect(screen.getByText("Hook 0")).toBeTruthy();
  expect(screen.getByText("Hook 2")).toBeTruthy();
  expect(screen.getByText(/ai-generated/i)).toBeTruthy();
});

it("copies the assembled post when a Copy button is pressed", async () => {
  mockHook({ status: "done", variants: VARIANTS, provenance: "ai-generated" });
  render(<PostsScreen />);
  fireEvent.press(screen.getByLabelText("Copy post 1"));
  await waitFor(() => expect(copyText).toHaveBeenCalledWith(assemblePost(VARIANTS[0])));
});

it("shows the error text on failure", () => {
  mockHook({ status: "failed", error: "No API key saved. Go to Settings and paste your Anthropic key." });
  render(<PostsScreen />);
  expect(screen.getByText(/no api key saved/i)).toBeTruthy();
});

it("assemblePost joins hook, body, hashtags and cta", () => {
  expect(assemblePost(VARIANTS[0])).toBe("Hook 0\n\nBody 0\n\n#one\n\nRead more");
  expect(assemblePost(VARIANTS[1])).toBe("Hook 1\n\nBody 1\n\n#two");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && npm test -- __tests__/screens/Posts.test.tsx`
Expected: FAIL — cannot find module `@/../app/(tabs)/posts`.

- [ ] **Step 3: Write minimal implementation**

`mobile/app/(tabs)/posts.tsx`:
```tsx
import { useCallback, useState } from "react";
import {
  ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { PageContainer } from "@/components/PageContainer";
import { useMakePost } from "@/hooks/useMakePost";
import { copyText } from "@/lib/clipboard";
import { loadApiKey } from "@/secure/keyStore";
import { type Platform, type PostVariant } from "@/api/derivativesClient";
import { colors, radius, spacing, typography } from "@/constants/theme";

const PLATFORMS: { id: Platform; label: string }[] = [
  { id: "linkedin", label: "LinkedIn" },
  { id: "x", label: "X" },
];

// One shareable string per variant: hook, body, hashtags, then cta if present.
export function assemblePost(v: PostVariant): string {
  const tags = v.hashtags.join(" ");
  const base = `${v.hook}\n\n${v.body}\n\n${tags}`;
  return v.cta ? `${base}\n\n${v.cta}` : base;
}

export default function PostsScreen() {
  const { status, error, variants, provenance, run } = useMakePost({
    getApiKey: () => loadApiKey("anthropic"),
  });
  const [source, setSource] = useState("");
  const [platform, setPlatform] = useState<Platform>("linkedin");
  const [tone, setTone] = useState("");
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const busy = status === "generating";
  const canGenerate = source.trim().length > 0 && !busy;

  const onGenerate = useCallback(() => {
    void run({ sourceText: source.trim(), platform, ...(tone.trim() ? { tone: tone.trim() } : {}) });
  }, [run, source, platform, tone]);

  const onCopy = useCallback(async (v: PostVariant, i: number) => {
    await copyText(assemblePost(v));
    setCopiedIndex(i);
    setTimeout(() => setCopiedIndex((cur) => (cur === i ? null : cur)), 1500);
  }, []);

  return (
    <PageContainer>
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.label}>Source</Text>
        <TextInput
          accessibilityLabel="Source text"
          style={styles.source}
          multiline
          placeholder="Paste the text you want to turn into posts…"
          placeholderTextColor={colors.textMuted}
          value={source}
          onChangeText={setSource}
        />

        <Text style={styles.label}>Platform</Text>
        <View style={styles.segment}>
          {PLATFORMS.map((p) => {
            const active = p.id === platform;
            return (
              <Pressable
                key={p.id}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={`Platform: ${p.label}`}
                onPress={() => setPlatform(p.id)}
                style={[styles.segmentBtn, active && styles.segmentBtnActive]}
              >
                <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{p.label}</Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={styles.label}>Tone (optional)</Text>
        <TextInput
          accessibilityLabel="Tone"
          style={styles.tone}
          placeholder="e.g. punchy, professional"
          placeholderTextColor={colors.textMuted}
          value={tone}
          onChangeText={setTone}
        />

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Make posts"
          accessibilityState={{ disabled: !canGenerate }}
          disabled={!canGenerate}
          onPress={onGenerate}
          style={[styles.generate, !canGenerate && styles.generateDisabled]}
        >
          {busy ? <ActivityIndicator color={colors.tileOnGlyph} /> : <Text style={styles.generateText}>Make posts</Text>}
        </Pressable>

        {status === "failed" && error ? <Text style={styles.error}>{error}</Text> : null}

        {status === "done" && variants.length > 0 ? (
          <View style={styles.results}>
            <Text style={styles.provenance}>{provenance ?? "ai-generated"}</Text>
            {variants.map((v, i) => (
              <View key={i} style={styles.card}>
                <Text style={styles.hook}>{v.hook}</Text>
                <Text style={styles.postBody}>{v.body}</Text>
                {v.hashtags.length > 0 ? <Text style={styles.hashtags}>{v.hashtags.join(" ")}</Text> : null}
                {v.cta ? <Text style={styles.cta}>{v.cta}</Text> : null}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Copy post ${i + 1}`}
                  onPress={() => void onCopy(v, i)}
                  style={styles.copyBtn}
                >
                  <Text style={styles.copyText}>{copiedIndex === i ? "Copied" : "Copy"}</Text>
                </Pressable>
              </View>
            ))}
          </View>
        ) : null}
      </ScrollView>
    </PageContainer>
  );
}

const styles = StyleSheet.create({
  body: { padding: spacing.md, gap: spacing.sm },
  label: { fontSize: typography.sizeSm, fontWeight: "600", color: colors.text, marginTop: spacing.sm },
  source: {
    minHeight: 120, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    padding: spacing.sm, color: colors.text, textAlignVertical: "top",
  },
  tone: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    padding: spacing.sm, color: colors.text,
  },
  segment: { flexDirection: "row", gap: spacing.xs },
  segmentBtn: {
    paddingVertical: spacing.xs, paddingHorizontal: spacing.md,
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
  },
  segmentBtnActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  segmentText: { color: colors.text, fontWeight: "600" },
  segmentTextActive: { color: colors.tileOnGlyph },
  generate: {
    marginTop: spacing.md, backgroundColor: colors.primary, borderRadius: radius.md,
    paddingVertical: spacing.sm, alignItems: "center",
  },
  generateDisabled: { opacity: 0.5 },
  generateText: { color: colors.tileOnGlyph, fontWeight: "700" },
  error: { color: colors.error, marginTop: spacing.sm },
  results: { marginTop: spacing.md, gap: spacing.sm },
  provenance: { fontSize: typography.sizeXs, color: colors.textMuted, fontStyle: "italic" },
  card: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, gap: spacing.xs },
  hook: { fontWeight: "700", color: colors.text },
  postBody: { color: colors.text },
  hashtags: { color: colors.primary },
  cta: { color: colors.text, fontWeight: "600" },
  copyBtn: { alignSelf: "flex-start", paddingVertical: spacing.xs, paddingHorizontal: spacing.md, borderRadius: radius.sm, backgroundColor: colors.tileOffFace },
  copyText: { color: colors.tileOffGlyph, fontWeight: "600" },
});
```

**Token check:** all tokens used above are verified present in `mobile/src/constants/theme.ts` (`colors`: `text` `textMuted` `border` `primary` `error` `tileOnGlyph` `tileOffFace` `tileOffGlyph`; `spacing`: `xs` `sm` `md`; `radius`: `sm` `md`; `typography`: `sizeXs` `sizeSm`). Do NOT add new global tokens. `npx tsc --noEmit` (Step 4) catches any typo.

- [ ] **Step 4: Run test + typecheck to verify pass**

Run: `cd mobile && npm test -- __tests__/screens/Posts.test.tsx && npx tsc --noEmit`
Expected: PASS (5 tests) + 0 type errors.

- [ ] **Step 5: Commit**

```bash
git add mobile/app/(tabs)/posts.tsx mobile/__tests__/screens/Posts.test.tsx
git commit -m "feat(posts): Posts screen — paste → platform → 3 variants + copy (ADR-037 D8)"
```

---

### Task 5: Navigation, labels, Help, demo-exclusion (DoD wiring)

**Files:**
- Modify: `mobile/app/(tabs)/_layout.tsx` — register the route.
- Modify: `mobile/src/components/TopNavBar.tsx` — `TABS.posts` + add `"posts"` to the demo-excluded `ORDER` group.
- Modify: `mobile/src/constants/labels.ts` — `NAV.posts`.
- Modify: `mobile/src/help-content/features.ts` — `make-a-post` feature key.
- Modify: `mobile/src/help-content/topics.ts` — a topic with `featureKey: "make-a-post"`.

**Interfaces:**
- Consumes: nothing new. This task wires the Task 4 screen into navigation + satisfies the Help coverage gate.
- Produces: a reachable **Posts** tab (non-demo builds) with in-app Help.

- [ ] **Step 1: Register the route**

In `mobile/app/(tabs)/_layout.tsx`, add after the `reviews` line:
```tsx
      <Tabs.Screen name="posts" />
```

- [ ] **Step 2: Add the NAV label**

In `mobile/src/constants/labels.ts`, add to the `NAV` object (after `reviews`):
```ts
  posts: "Posts",
```

- [ ] **Step 3: Add the tab tile + demo-excluded order**

In `mobile/src/components/TopNavBar.tsx`:
- Add to the `TABS` map (after the `reviews` entry):
```ts
  posts: { label: NAV.posts, active: "megaphone", inactive: "megaphone-outline" },
```
- Extend the demo-excluded group in `ORDER`:
```ts
  ...(IS_DEMO ? [] : ["projects", "reviews", "posts"]),
```

- [ ] **Step 4: Add the Help feature key**

In `mobile/src/help-content/features.ts`, add to the `FEATURES` array:
```ts
  { key: "make-a-post", label: "Make a post" },
```

- [ ] **Step 5: Run the coverage test to verify it now FAILS (feature without a topic)**

Run: `cd mobile && npm test -- __tests__/help/coverage.test.ts`
Expected: FAIL — `make-a-post` has no topic. (This proves the gate works.)

- [ ] **Step 6: Add the Help topic**

In `mobile/src/help-content/topics.ts`, add a topic object to `HELP_TOPICS`:
```ts
  {
    id: "make-a-post",
    title: "Make a post from your writing",
    featureKey: "make-a-post",
    keywords: ["post", "posts", "share", "linkedin", "x", "twitter", "social", "promote", "publish"],
    blocks: [
      {
        kind: "text",
        text: "The Posts tab turns any writing into short, platform-ready social posts. Paste the source text, pick LinkedIn or X, optionally give it a tone, and you get three distinct drafts to choose from. Each draft is yours to copy and post — Mentible does not publish for you.",
      },
      {
        kind: "steps",
        steps: [
          "Add an Anthropic API key in Settings — the Posts tab uses your key (BYOK).",
          "Open Posts and paste the source text you want to promote.",
          "Choose the platform (LinkedIn or X) and, if you like, a tone.",
          "Make the posts, then copy the draft you want and share it yourself.",
        ],
      },
    ],
  },
```

- [ ] **Step 7: Run the full DoD + typecheck gate**

Run: `cd mobile && npm test -- __tests__/help/coverage.test.ts && npx tsc --noEmit`
Expected: PASS (coverage clean) + 0 type errors.

- [ ] **Step 8: Commit**

```bash
git add mobile/app/(tabs)/_layout.tsx mobile/src/components/TopNavBar.tsx mobile/src/constants/labels.ts mobile/src/help-content/features.ts mobile/src/help-content/topics.ts
git commit -m "feat(posts): register Posts tab + Help topic, demo-excluded (ADR-037 D8)"
```

---

## Final verification (after all tasks)

Run the full mobile gate:
```bash
cd mobile && npm test && npx tsc --noEmit
```
Expected: entire suite green (including the new derivativesClient/useMakePost/clipboard/Posts/coverage tests) + 0 type errors.

Manual smoke (optional, not CI): the `mobile:verify` skill can build+run the app to click Posts → paste → generate against a real backend + a saved key. Not required for merge; note if skipped.

## Self-Review notes (author)
- **Spec coverage:** derivativesClient (spec §"New files") = Task 1; useMakePost = Task 2; clipboard wrapper + expo-clipboard dep = Task 3; posts screen + assemblePost + platform toggle + copy + provenance + error = Task 4; nav/labels/help/demo (spec §"Touched files" + DoD gate) = Task 5. Testing section = the per-task tests + final gate.
- **Deviations from spec (deliberate, noted):** (1) route/label `posts`/"Posts" not `publish`/"Publish" — avoids the `FLOW.publish` book-export collision (recorded in Global Constraints). (2) Hook takes an injected `getApiKey` (matches `useGenerateTopic`) rather than importing `loadApiKey` internally — better testability; the screen supplies `() => loadApiKey("anthropic")`. (3) No `RequireSignIn` — BYOK is anonymous server-side.
- **Type consistency:** `Platform`, `PostVariant`, `MakePostRequest`/`Response` defined in Task 1, imported unchanged by Tasks 2 & 4; `useMakePost` signature in Task 2 matches its use in Task 4; `assemblePost` defined + exported in Task 4 and imported by its test.
- **Open risk flagged in Task 4:** theme token names (`colors.textMuted`, `colors.danger`, `typography.sizeSm`) are assumed — Task 4 Step 3 includes an explicit token-existence check + tsc gate to catch a wrong name.
