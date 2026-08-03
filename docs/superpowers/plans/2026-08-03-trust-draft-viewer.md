# Trust Draft Content Viewer + Edit + Regenerate — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a full-screen surface to read an artifact version's content, edit it per-section (saved as a new immutable version), and regenerate it from sources with optional guidance — reachable from the Drafts and Feedback panels.

**Architecture:** One new backend read endpoint (`GET /trust/versions/{id}`, guarded owner-or-reviewer) + a `guidance` field on the existing generate endpoint. Save-edit reuses the existing `create_version` endpoint untouched. Mobile gets a new route `app/trust/version/[versionId].tsx` and tappable version rows. Versions are append-only: every edit/regenerate is a new version; approval never carries forward.

**Tech Stack:** FastAPI · asyncpg · Pydantic v2 · pytest + fastapi TestClient · React Native + Expo Router · Jest + RNTL.

## Global Constraints

- Design spec: `docs/superpowers/specs/2026-08-03-trust-draft-viewer-design.md`.
- No RLS / no tenant column — authorization stays app-level via `require_project_access` (backend rule #4 / ADR-037).
- Edit/regenerate/save remain **owner-only** (`need_owner=True`); read is **owner OR reviewer**.
- Versions are **append-only** — never UPDATE/DELETE an `artifact_version` or `approval`.
- SME surfaces are Navy Trust themed: wrap the screen in `SmeThemeScope`, use `useThemedStyles(makeStyles)` with `(c: Palette)`, and Fraunces for headings via `FRAUNCES.bold`/`FRAUNCES.semibold` (never add `fontWeight` alongside a Fraunces family — it synths faux-bold on web).
- RN string/enum literals inside `makeStyles` need `as const` (percentage dims, `"row"`, `"center"`, etc.) or tsc fails `NamedStyles`.
- API key never logged / never in a URL / only in the `/generate` request body (ADR-001). Guidance text is the owner's own prompt input — cap length, do not log alongside key material.
- Definition of Done: any new user-facing feature needs a `FEATURES` key + a Help topic in the SAME change (coverage test `mobile/__tests__/help/coverage.test.ts` enforces it).
- Run the REAL typecheck (`npx tsc --noEmit`) before claiming a mobile task done — Jest does not typecheck.
- Backend tests that touch the DB are skipped without `DATABASE_URL`; run them against the local test DB.

---

### Task 1: Backend — version read endpoint (`GET /trust/versions/{id}`)

**Files:**
- Modify: `backend/src/trust/artifact_repo.py` (add `get_version`)
- Modify: `backend/src/trust/schemas.py` (add `VersionDetailOut`)
- Modify: `backend/src/trust/router.py` (add the route)
- Test: `backend/tests/test_trust_router.py`

**Interfaces:**
- Consumes: `access.project_id_for_version(conn, version_id=)` (exists), `require_project_access` (exists), `approval_repo.get_approval(conn, version_id=)` (exists).
- Produces: `GET /api/v1/trust/versions/{version_id}` → `VersionDetailOut{ id, artifact_id, version_no, content: dict, generation_meta: dict|None, is_validated: bool, recorded_via: str|None, created_at }`. `artifact_repo.get_version(conn, *, version_id) -> ArtifactVersion | None`.

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/test_trust_router.py`:

```python
def test_get_version_owner_reviewer_read_stranger_403_and_404():
    with TestClient(app) as c:
        owner = f"o-{uuid.uuid4()}"
        owner_email = f"{owner}@x.z"
        _as(owner, owner_email)
        pid = c.post("/api/v1/trust/projects", json={"title": "Guide", "topic": "t"}).json()["id"]
        art = c.post(
            f"/api/v1/trust/projects/{pid}/artifacts",
            json={"role": "cornerstone", "format": "book"},
        ).json()
        vid = c.post(
            f"/api/v1/trust/artifacts/{art['id']}/versions",
            json={"content": {"sections": [{"heading": "H", "body": "B", "source_ids": []}]}},
        ).json()["id"]

        # owner reads content
        r = c.get(f"/api/v1/trust/versions/{vid}")
        assert r.status_code == 200
        body = r.json()
        assert body["content"]["sections"][0]["heading"] == "H"
        assert body["is_validated"] is False

        # invite a reviewer, redeem membership, reviewer can read
        reviewer = f"r-{uuid.uuid4()}"
        reviewer_email = f"{reviewer}@x.z"
        c.post(f"/api/v1/trust/projects/{pid}/invitations", json={"email": reviewer_email})
        _as(reviewer, reviewer_email)
        c.post("/api/v1/trust/session/sync")  # redeem invite → membership
        assert c.get(f"/api/v1/trust/versions/{vid}").status_code == 200

        # a stranger is 403
        _as(f"x-{uuid.uuid4()}", f"x-{uuid.uuid4()}@x.z")
        assert c.get(f"/api/v1/trust/versions/{vid}").status_code == 403

        # unknown version is 404
        _as(owner, owner_email)
        assert c.get(f"/api/v1/trust/versions/{uuid.uuid4()}").status_code == 404
```

- [ ] **Step 2: Run the test — verify it fails**

Run: `cd backend && python -m pytest tests/test_trust_router.py::test_get_version_owner_reviewer_read_stranger_403_and_404 -v`
Expected: FAIL (404 route not found / AttributeError `get_version`).

- [ ] **Step 3: Add `get_version` to `artifact_repo.py`**

After `list_versions` (around line 90):

```python
async def get_version(conn, *, version_id) -> ArtifactVersion | None:
    r = await conn.fetchrow(f"SELECT {_V} FROM artifact_version WHERE id = $1", version_id)
    return _version(r) if r else None
```

- [ ] **Step 4: Add `VersionDetailOut` to `schemas.py`**

After `VersionSummaryOut` (around line 78):

```python
class VersionDetailOut(BaseModel):
    id: str
    artifact_id: str
    version_no: int
    content: dict
    generation_meta: dict | None = None
    is_validated: bool
    recorded_via: str | None = None
    created_at: datetime | None
```

- [ ] **Step 5: Add the route to `router.py`**

Place after `create_version` (before `generate_version`). `project_id_for_version` is already imported.

```python
@router.get("/versions/{version_id}", response_model=schemas.VersionDetailOut)
async def get_version(
    version_id: uuid.UUID,
    principal: Principal = Depends(require_active_user),
    conn: asyncpg.Connection = Depends(get_conn),
) -> schemas.VersionDetailOut:
    project_id = await project_id_for_version(conn, version_id=version_id)
    if project_id is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "version not found")
    account = await _account(conn, principal)
    await _require_role(conn, account, project_id, need_owner=False)  # owner OR reviewer
    v = await artifact_repo.get_version(conn, version_id=version_id)
    if v is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "version not found")
    ap = await approval_repo.get_approval(conn, version_id=version_id)
    return schemas.VersionDetailOut(
        id=str(v.id),
        artifact_id=str(v.artifact_id),
        version_no=v.version_no,
        content=v.content or {"sections": []},
        generation_meta=v.generation_meta,
        is_validated=ap is not None,
        recorded_via=ap.recorded_via if ap else None,
        created_at=v.created_at,
    )
```

- [ ] **Step 6: Run the test — verify it passes**

Run: `cd backend && python -m pytest tests/test_trust_router.py::test_get_version_owner_reviewer_read_stranger_403_and_404 -v`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/src/trust/artifact_repo.py backend/src/trust/schemas.py backend/src/trust/router.py backend/tests/test_trust_router.py
git commit -m "feat(trust): GET /versions/{id} returns draft content (owner or reviewer)"
```

---

### Task 2: Backend — optional `guidance` on regenerate

**Files:**
- Modify: `backend/src/trust/schemas.py` (`DraftGenerateIn.guidance`)
- Modify: `backend/src/trust/draft_prompt.py` (`build_draft_prompt(..., guidance=None)`)
- Modify: `backend/src/trust/generate.py` (`generate_draft(..., guidance=None)`)
- Modify: `backend/src/trust/router.py` (pass `body.guidance`, store in `generation_meta`)
- Test: `backend/tests/test_trust_draft.py`

**Interfaces:**
- Consumes: existing `generate_draft` / `build_draft_prompt` signatures.
- Produces: `DraftGenerateIn.guidance: str | None` (≤500). `build_draft_prompt(sources, artifact_format, topic, audience, goal, guidance=None)`. `generate_draft(*, sources, artifact_format, topic, audience, goal, provider_id, api_key, model, guidance=None)`. New version's `generation_meta` gains `"guidance"` when present.

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/test_trust_draft.py`:

```python
def test_prompt_includes_guidance_when_present():
    p = build_draft_prompt(_SOURCES, "guide", "stormwater", "engineers", "size pipes", "focus on cost")
    assert "focus on cost" in p


def test_prompt_omits_guidance_when_absent():
    base = build_draft_prompt(_SOURCES, "guide", "stormwater", "engineers", "size pipes")
    assert "Additional guidance" not in base
```

- [ ] **Step 2: Run — verify it fails**

Run: `cd backend && python -m pytest tests/test_trust_draft.py -k guidance -v`
Expected: FAIL (`build_draft_prompt` takes no `guidance`).

- [ ] **Step 3: Thread `guidance` through the prompt**

`draft_prompt.py` — change signature and append a bounded line before the SOURCES block:

```python
def build_draft_prompt(sources, artifact_format, topic, audience, goal, guidance=None) -> str:
```

Inside, after `ctx_line = ...` add:

```python
    guidance_line = f"\n\nAdditional guidance from the author: {guidance}" if guidance else ""
```

and insert `{guidance_line}` into the returned string immediately after the "Invent nothing…" sentence (before `\n\nSOURCES:`):

```python
        f"Invent nothing beyond the sources — if the sources do not cover something, omit it.{guidance_line}\n\n"
```

- [ ] **Step 4: Thread `guidance` through `generate_draft`**

`generate.py`:

```python
def generate_draft(
    *, sources, artifact_format, topic, audience, goal, provider_id, api_key, model, guidance=None
) -> _DraftOutput:
    prompt = build_draft_prompt(sources, artifact_format, topic, audience, goal, guidance)
```

- [ ] **Step 5: Add the field + wire the router**

`schemas.py` `DraftGenerateIn` — add field (place after `model`):

```python
    guidance: str | None = Field(default=None, max_length=500)
```

`router.py` `generate_version` — pass guidance into the threaded call:

```python
            goal=p.goal,
            provider_id=body.provider_id,
            api_key=api_key,
            model=model,
            guidance=body.guidance,
```

and add it to the stored `generation_meta` (only when present):

```python
        generation_meta={
            "kind": "draft",
            "model": model,
            "provider_id": body.provider_id,
            "source_input_ids": cited,
            **({"guidance": body.guidance} if body.guidance else {}),
        },
```

- [ ] **Step 6: Run — verify prompt tests pass + no regressions**

Run: `cd backend && python -m pytest tests/test_trust_draft.py -v`
Expected: PASS (all, including the two new).

- [ ] **Step 7: Commit**

```bash
git add backend/src/trust/schemas.py backend/src/trust/draft_prompt.py backend/src/trust/generate.py backend/src/trust/router.py backend/tests/test_trust_draft.py
git commit -m "feat(trust): optional author guidance on draft regeneration"
```

---

### Task 3: Mobile — client + hook (`getVersion`, guidance on generate)

**Files:**
- Modify: `mobile/src/api/trustClient.ts`
- Modify: `mobile/src/hooks/useTrustProject.ts`
- Test: `mobile/__tests__/api/trustClient.generate.test.ts` (extend) and a new `mobile/__tests__/api/trustClient.version.test.ts`

**Interfaces:**
- Produces: `VersionDetailView { id; artifact_id; version_no; content: { sections: DraftSection[] }; generation_meta: Record<string, unknown> | null; is_validated: boolean; recorded_via: string | null; created_at: string | null }` with `DraftSection { heading: string; body: string; source_ids: string[] }`. `trustClient.getVersion(versionId, token): Promise<VersionDetailView>`. `trustClient.generateVersion(artifactId, { api_key; provider_id?; model?; guidance? }, token)`. `useTrustProject.generateVersion(artifactId, opts?: { guidance?: string })`.

- [ ] **Step 1: Write the failing test**

Create `mobile/__tests__/api/trustClient.version.test.ts`:

```ts
import { getVersion } from "@/api/trustClient";

describe("trustClient.getVersion", () => {
  afterEach(() => jest.restoreAllMocks());

  it("GETs the version and returns its content", async () => {
    const payload = {
      id: "v1", artifact_id: "a1", version_no: 2,
      content: { sections: [{ heading: "H", body: "B", source_ids: [] }] },
      generation_meta: null, is_validated: false, recorded_via: null, created_at: null,
    };
    const fetchMock = jest.spyOn(global, "fetch").mockResolvedValue(
      { ok: true, status: 200, json: async () => payload } as Response,
    );
    const v = await getVersion("v1", "tok");
    expect(v.content.sections[0].heading).toBe("H");
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain("/api/v1/trust/versions/v1");
  });
});
```

- [ ] **Step 2: Run — verify it fails**

Run: `cd mobile && npx jest __tests__/api/trustClient.version.test.ts`
Expected: FAIL (`getVersion` not exported).

- [ ] **Step 3: Add `getVersion` + types + guidance to `trustClient.ts`**

Add interfaces near `VersionSummaryView`:

```ts
export interface DraftSection { heading: string; body: string; source_ids: string[] }
export interface VersionDetailView {
  id: string; artifact_id: string; version_no: number;
  content: { sections: DraftSection[] };
  generation_meta: Record<string, unknown> | null;
  is_validated: boolean; recorded_via: string | null; created_at: string | null;
}
```

Add the function (after `getProject`):

```ts
export async function getVersion(versionId: string, token: string): Promise<VersionDetailView> {
  return (await trustFetch<VersionDetailView>(`/versions/${versionId}`, token, { method: "GET" })) as VersionDetailView;
}
```

Extend `generateVersion`'s body type:

```ts
export async function generateVersion(
  artifactId: string, body: { api_key: string; provider_id?: string; model?: string; guidance?: string }, token: string,
): Promise<VersionCreatedView> {
```

- [ ] **Step 4: Thread guidance through the hook**

`useTrustProject.ts` — change `generateVersion`:

```ts
  const generateVersion = useCallback(async (artifactId: string, opts?: { guidance?: string }) => {
    const key = await loadApiKey("anthropic");
    if (!key) throw new Error("No API key saved. Add an Anthropic key in Settings to generate a draft.");
    if (!accessToken) throw new Error("Not signed in");
    const v = await generateVersionApi(artifactId, { api_key: key, provider_id: "anthropic", guidance: opts?.guidance }, accessToken);
    await refresh(); return v;
  }, [accessToken, refresh]);
```

- [ ] **Step 5: Add a guidance assertion to the existing generate client test**

In `mobile/__tests__/api/trustClient.generate.test.ts`, add a case asserting `guidance` is serialized into the POST body when provided (follow the file's existing fetch-mock pattern; assert `JSON.parse(fetchMock.mock.calls[0][1].body).guidance === "focus on cost"`).

- [ ] **Step 6: Run — verify pass + tsc**

Run: `cd mobile && npx jest __tests__/api/trustClient.version.test.ts __tests__/api/trustClient.generate.test.ts && npx tsc --noEmit`
Expected: PASS, tsc clean.

- [ ] **Step 7: Commit**

```bash
git add mobile/src/api/trustClient.ts mobile/src/hooks/useTrustProject.ts mobile/__tests__/api/trustClient.version.test.ts mobile/__tests__/api/trustClient.generate.test.ts
git commit -m "feat(trust): mobile getVersion client + guidance on generate"
```

---

### Task 4: Mobile — version screen, read mode

**Files:**
- Create: `mobile/app/trust/version/[versionId].tsx`
- Test: `mobile/__tests__/screens/TrustVersion.read.test.tsx`

**Interfaces:**
- Consumes: `getVersion` (Task 3), `useTrustProject` (for `project.inputs` → citation labels), `useAuth().accessToken`, `SmeThemeScope`, `useThemedStyles`, `FRAUNCES`.
- Produces: route `/trust/version/[versionId]` reading params `versionId`, `artifactId`, `projectId`. Read mode renders each section (heading + body + citation chips) and a `v{n}` + validated/`recorded_via` header.

- [ ] **Step 1: Write the failing test**

Create `mobile/__tests__/screens/TrustVersion.read.test.tsx`:

```tsx
import React from "react";
import { render, waitFor } from "@testing-library/react-native";

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ versionId: "v1", artifactId: "a1", projectId: "p1" }),
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
}));
jest.mock("@/auth/AuthProvider", () => ({ useAuth: () => ({ accessToken: "tok", status: "signed_in" }) }));
jest.mock("@/hooks/useTrustProject", () => ({
  useTrustProject: () => ({ project: { my_role: "owner", inputs: [] }, addVersion: jest.fn(), generateVersion: jest.fn(), approve: jest.fn() }),
}));
jest.mock("@/api/trustClient", () => ({
  getVersion: jest.fn(async () => ({
    id: "v1", artifact_id: "a1", version_no: 2,
    content: { sections: [{ heading: "Enrollment windows", body: "Sign up during IEP.", source_ids: [] }] },
    generation_meta: null, is_validated: false, recorded_via: null, created_at: null,
  })),
}));

import TrustVersion from "@/app/trust/version/[versionId]";

it("renders the draft sections", async () => {
  const { getByText } = render(<TrustVersion />);
  await waitFor(() => expect(getByText("Enrollment windows")).toBeTruthy());
  expect(getByText("Sign up during IEP.")).toBeTruthy();
});
```

- [ ] **Step 2: Run — verify it fails**

Run: `cd mobile && npx jest __tests__/screens/TrustVersion.read.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Create the read-mode screen**

Create `mobile/app/trust/version/[versionId].tsx`:

```tsx
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { PageContainer } from "@/components/PageContainer";
import { useAuth } from "@/auth/AuthProvider";
import { getVersion, type VersionDetailView } from "@/api/trustClient";
import { useTrustProject } from "@/hooks/useTrustProject";
import { ApiError } from "@/api/client";
import { radius, spacing, typography, type Palette } from "@/constants/theme";
import { FRAUNCES } from "@/constants/fonts";
import { SmeThemeScope, useTheme, useThemedStyles } from "@/theme";

type Styles = ReturnType<typeof makeStyles>;

function TrustVersionInner() {
  const { versionId, artifactId, projectId } = useLocalSearchParams<{
    versionId: string; artifactId: string; projectId: string;
  }>();
  const router = useRouter();
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { accessToken } = useAuth();
  const { project } = useTrustProject(String(projectId));
  const [version, setVersion] = useState<VersionDetailView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!accessToken) return;
    let live = true;
    void (async () => {
      try {
        const v = await getVersion(String(versionId), accessToken);
        if (live) setVersion(v);
      } catch (e) {
        if (live) setError(e instanceof ApiError ? e.userMessage() : "This draft version no longer exists.");
      }
    })();
    return () => { live = false; };
  }, [accessToken, versionId]);

  // input id -> "S1".."Sn", mirroring the backend's label mapping (inputs order).
  const labelFor = useMemo(() => {
    const m = new Map<string, string>();
    (project?.inputs ?? []).forEach((inp, i) => m.set(inp.id, `S${i + 1}`));
    return m;
  }, [project]);

  if (error) return <View style={styles.center}><Text style={styles.error}>{error}</Text></View>;
  if (!version) return <View style={styles.center}><ActivityIndicator color={theme.primary} /></View>;

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.body}>
      <PageContainer style={{ flex: 1 }}>
        <View style={styles.headerRow}>
          <Text style={styles.title}>v{version.version_no}</Text>
          {version.is_validated ? <Text style={styles.chip}>Validated ✓</Text> : null}
        </View>
        {version.content.sections.map((s, i) => (
          <View key={i} style={styles.section}>
            <Text style={styles.heading}>{s.heading}</Text>
            <Text style={styles.bodyText}>{s.body}</Text>
            {s.source_ids.length > 0 ? (
              <View style={styles.citeRow}>
                {s.source_ids.map((id) => (
                  <Text key={id} style={styles.cite}>{labelFor.get(id) ?? "cited"}</Text>
                ))}
              </View>
            ) : null}
          </View>
        ))}
        <Pressable accessibilityRole="button" accessibilityLabel="Back" style={styles.backBtn} onPress={() => router.back()}>
          <Text style={styles.backText}>Back</Text>
        </Pressable>
      </PageContainer>
    </ScrollView>
  );
}

export default function TrustVersion() {
  return (
    <SmeThemeScope>
      <TrustVersionInner />
    </SmeThemeScope>
  );
}

const makeStyles = (c: Palette) => ({
  scroll: { flex: 1 as const },
  body: { padding: spacing.md, gap: spacing.md },
  center: { flex: 1 as const, alignItems: "center" as const, justifyContent: "center" as const, padding: spacing.xl },
  headerRow: { flexDirection: "row" as const, alignItems: "center" as const, justifyContent: "space-between" as const },
  title: { color: c.text, fontSize: typography.sizeXxl, fontFamily: FRAUNCES.bold, letterSpacing: -0.56 },
  section: { backgroundColor: c.surface, borderRadius: radius.md, borderWidth: 1, borderColor: c.border, padding: spacing.md, gap: spacing.sm },
  heading: { color: c.text, fontSize: typography.sizeLg, fontFamily: FRAUNCES.semibold, letterSpacing: -0.36 },
  bodyText: { color: c.text, fontSize: typography.sizeMd, lineHeight: 22 as const },
  citeRow: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: spacing.xs },
  cite: { color: c.textMuted, fontSize: typography.sizeSm, borderWidth: 1, borderColor: c.border, borderRadius: radius.sm, paddingHorizontal: spacing.xs },
  chip: { color: c.primaryText, backgroundColor: c.primary, fontSize: typography.sizeSm, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 2 as const },
  error: { color: c.error, fontSize: typography.sizeMd },
  backBtn: { alignSelf: "flex-start" as const, paddingVertical: spacing.sm },
  backText: { color: c.primary, fontSize: typography.sizeMd },
});
```

> Note: if `@/app/...` is not resolvable in Jest config, import the screen in the test via a relative path (`../../app/trust/version/[versionId]`). Verify against the existing `TrustProjectDetail.test.tsx` import style and match it.

- [ ] **Step 4: Run — verify it passes + tsc**

Run: `cd mobile && npx jest __tests__/screens/TrustVersion.read.test.tsx && npx tsc --noEmit`
Expected: PASS, tsc clean.

- [ ] **Step 5: Commit**

```bash
git add "mobile/app/trust/version/[versionId].tsx" mobile/__tests__/screens/TrustVersion.read.test.tsx
git commit -m "feat(trust): version screen — read draft content"
```

---

### Task 5: Mobile — version screen edit mode (save = new version)

**Files:**
- Modify: `mobile/app/trust/version/[versionId].tsx`
- Test: `mobile/__tests__/screens/TrustVersion.edit.test.tsx`

**Interfaces:**
- Consumes: `useTrustProject().addVersion(artifactId, content)` (exists), `@/lib/alert`.
- Produces: an Edit toggle (owner only) → per-section editable heading/body, add/remove section → Save calls `addVersion(artifactId, { sections })` then navigates to the new version. Editing a `is_validated` version first confirms via `Alert.alert`.

- [ ] **Step 1: Write the failing test**

Create `mobile/__tests__/screens/TrustVersion.edit.test.tsx`. Mock as in Task 4 but capture `addVersion`:

```tsx
const addVersion = jest.fn(async () => ({ id: "v3", artifact_id: "a1", version_no: 3, created_at: null }));
const push = jest.fn();
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ versionId: "v1", artifactId: "a1", projectId: "p1" }),
  useRouter: () => ({ push, back: jest.fn() }),
}));
jest.mock("@/auth/AuthProvider", () => ({ useAuth: () => ({ accessToken: "tok", status: "signed_in" }) }));
jest.mock("@/hooks/useTrustProject", () => ({
  useTrustProject: () => ({ project: { my_role: "owner", inputs: [] }, addVersion, generateVersion: jest.fn(), approve: jest.fn() }),
}));
jest.mock("@/api/trustClient", () => ({
  getVersion: jest.fn(async () => ({
    id: "v1", artifact_id: "a1", version_no: 2,
    content: { sections: [{ heading: "H", body: "B", source_ids: [] }] },
    generation_meta: null, is_validated: false, recorded_via: null, created_at: null,
  })),
}));

import React from "react";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import TrustVersion from "@/app/trust/version/[versionId]";

it("edits a section and saves as a new version", async () => {
  const { getByText, getByLabelText } = render(<TrustVersion />);
  await waitFor(() => expect(getByText("H")).toBeTruthy());
  fireEvent.press(getByLabelText("Edit draft"));
  fireEvent.changeText(getByLabelText("Section 1 body"), "B edited");
  fireEvent.press(getByLabelText("Save as new version"));
  await waitFor(() => expect(addVersion).toHaveBeenCalledWith("a1", { sections: [{ heading: "H", body: "B edited", source_ids: [] }] }));
});
```

- [ ] **Step 2: Run — verify it fails**

Run: `cd mobile && npx jest __tests__/screens/TrustVersion.edit.test.tsx`
Expected: FAIL (no "Edit draft" control).

- [ ] **Step 3: Add edit state + UI to the screen**

In `TrustVersionInner`, add:

```tsx
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<{ heading: string; body: string; source_ids: string[] }[]>([]);
  const [saving, setSaving] = useState(false);
  const isOwner = project?.my_role === "owner";

  const startEdit = () => {
    const go = () => { setDraft(version!.content.sections.map((s) => ({ ...s }))); setEditing(true); };
    if (version!.is_validated) {
      Alert.alert(
        "Edit a validated draft?",
        `This creates a new version. The approval on v${version!.version_no} stays; the new version will need re-approval.`,
        [{ text: "Cancel", style: "cancel" }, { text: "Edit", onPress: go }],
      );
    } else { go(); }
  };

  const save = async () => {
    setSaving(true);
    try {
      const v = await addVersion(String(artifactId), { sections: draft });
      router.push({ pathname: "/trust/version/[versionId]", params: { versionId: v.id, artifactId: String(artifactId), projectId: String(projectId) } });
      setEditing(false);
    } catch (e) {
      Alert.alert("Couldn't save", e instanceof ApiError ? e.userMessage() : "Please try again.");
    } finally { setSaving(false); }
  };
```

Add imports: `TextInput` from `react-native`, `Alert` from `@/lib/alert`, and pull `addVersion` from the `useTrustProject` destructure. When `editing`, render each `draft[i]` as a heading `TextInput` + a body `TextInput` (`accessibilityLabel={`Section ${i+1} body`}`), an "Add section" button (`setDraft([...draft, { heading: "", body: "", source_ids: [] }])`), a per-section remove, and a Save button (`accessibilityLabel="Save as new version"`, `disabled={saving}`). When not editing and `isOwner`, render an Edit button (`accessibilityLabel="Edit draft"`, `onPress={startEdit}`). Add matching styles (`input`, `editRow`, `saveBtn`, etc.) to `makeStyles` following the Task 4 style patterns, each RN literal `as const`.

- [ ] **Step 4: Run — verify pass + tsc + no regressions on read test**

Run: `cd mobile && npx jest __tests__/screens/TrustVersion.edit.test.tsx __tests__/screens/TrustVersion.read.test.tsx && npx tsc --noEmit`
Expected: PASS, tsc clean.

- [ ] **Step 5: Commit**

```bash
git add "mobile/app/trust/version/[versionId].tsx" mobile/__tests__/screens/TrustVersion.edit.test.tsx
git commit -m "feat(trust): version screen — per-section edit saves a new version"
```

---

### Task 6: Mobile — version screen regenerate (with guidance)

**Files:**
- Modify: `mobile/app/trust/version/[versionId].tsx`
- Test: `mobile/__tests__/screens/TrustVersion.regenerate.test.tsx`

**Interfaces:**
- Consumes: `useTrustProject().generateVersion(artifactId, { guidance })` (Task 3).
- Produces: a Regenerate control (owner only) with an optional guidance `TextInput` → calls `generateVersion(artifactId, { guidance })` → navigates to the new version. Validated version confirms first (same copy as edit).

- [ ] **Step 1: Write the failing test**

Create `mobile/__tests__/screens/TrustVersion.regenerate.test.tsx` (mocks as Task 5, capture `generateVersion`):

```tsx
const generateVersion = jest.fn(async () => ({ id: "v3", artifact_id: "a1", version_no: 3, created_at: null }));
// ...same expo-router push mock, auth mock, getVersion mock (is_validated:false)...
jest.mock("@/hooks/useTrustProject", () => ({
  useTrustProject: () => ({ project: { my_role: "owner", inputs: [] }, addVersion: jest.fn(), generateVersion, approve: jest.fn() }),
}));

it("regenerates with guidance", async () => {
  const { getByText, getByLabelText } = render(<TrustVersion />);
  await waitFor(() => expect(getByText("H")).toBeTruthy());
  fireEvent.press(getByLabelText("Regenerate draft"));
  fireEvent.changeText(getByLabelText("Regeneration guidance"), "focus on 2026 costs");
  fireEvent.press(getByLabelText("Generate new version"));
  await waitFor(() => expect(generateVersion).toHaveBeenCalledWith("a1", { guidance: "focus on 2026 costs" }));
});
```

- [ ] **Step 2: Run — verify it fails**

Run: `cd mobile && npx jest __tests__/screens/TrustVersion.regenerate.test.tsx`
Expected: FAIL (no "Regenerate draft" control).

- [ ] **Step 3: Add regenerate state + UI**

Add to `TrustVersionInner`:

```tsx
  const [regen, setRegen] = useState(false);
  const [guidance, setGuidance] = useState("");
  const [genBusy, setGenBusy] = useState(false);

  const openRegen = () => {
    const go = () => setRegen(true);
    if (version!.is_validated) {
      Alert.alert(
        "Regenerate a validated draft?",
        `This creates a new version. The approval on v${version!.version_no} stays; the new version will need re-approval.`,
        [{ text: "Cancel", style: "cancel" }, { text: "Regenerate", onPress: go }],
      );
    } else { go(); }
  };

  const doRegen = async () => {
    setGenBusy(true);
    try {
      const v = await generateVersion(String(artifactId), { guidance: guidance.trim() || undefined });
      router.push({ pathname: "/trust/version/[versionId]", params: { versionId: v.id, artifactId: String(artifactId), projectId: String(projectId) } });
      setRegen(false); setGuidance("");
    } catch (e) {
      Alert.alert("Couldn't regenerate", e instanceof Error ? e.message : "Try again.");
    } finally { setGenBusy(false); }
  };
```

Pull `generateVersion` from the hook destructure. Render (owner, not editing): a "Regenerate draft" button (`accessibilityLabel="Regenerate draft"`, `onPress={openRegen}`); when `regen`, a guidance `TextInput` (`accessibilityLabel="Regeneration guidance"`, `placeholder="Optional: focus on…"`, `maxLength={500}`) + a "Generate new version" button (`accessibilityLabel="Generate new version"`, `disabled={genBusy}`, `onPress={doRegen}`). Reuse styles from Task 5.

- [ ] **Step 4: Run — verify pass + tsc + full screen suite**

Run: `cd mobile && npx jest __tests__/screens/TrustVersion && npx tsc --noEmit`
Expected: PASS (read, edit, regenerate), tsc clean.

- [ ] **Step 5: Commit**

```bash
git add "mobile/app/trust/version/[versionId].tsx" mobile/__tests__/screens/TrustVersion.regenerate.test.tsx
git commit -m "feat(trust): version screen — regenerate with optional guidance"
```

---

### Task 7: Mobile — tappable version rows open the screen

**Files:**
- Modify: `mobile/app/trust/[projectId].tsx` (DraftsPanel + FeedbackPanel version rows)
- Test: `mobile/__tests__/screens/TrustProjectDetail.open-version.test.tsx`

**Interfaces:**
- Consumes: `useRouter().push` with the version route + params `{ versionId, artifactId, projectId }`.
- Produces: each version row is a `Pressable` that navigates to `/trust/version/[versionId]`. A new `onOpenVersion(artifactId, versionId)` handler threaded into both panels.

- [ ] **Step 1: Write the failing test**

Create `mobile/__tests__/screens/TrustProjectDetail.open-version.test.tsx` modeled on the existing `TrustProjectDetail.test.tsx` (reuse its mock/setup). Seed a project with one artifact + one version, render, press the version row (`getByLabelText("Open version 1")`), assert `push` called with `pathname: "/trust/version/[versionId]"` and `params.versionId`.

- [ ] **Step 2: Run — verify it fails**

Run: `cd mobile && npx jest __tests__/screens/TrustProjectDetail.open-version.test.tsx`
Expected: FAIL (row not pressable / no label).

- [ ] **Step 3: Thread `onOpenVersion` + make rows pressable**

In `trust/[projectId].tsx`:
- Import `useRouter`; in `TrustProjectDetailInner` add `const router = useRouter();` and

```tsx
  const onOpenVersion = (artifactId: string, versionId: string) =>
    router.push({ pathname: "/trust/version/[versionId]", params: { versionId, artifactId, projectId: String(projectId) } });
```

- Pass `onOpenVersion` into `<DraftsPanel>` and `<FeedbackPanel>` (add to their prop types).
- In both panels, wrap each version row's content in a `Pressable` with `accessibilityRole="button"`, `accessibilityLabel={`Open version ${v.version_no}`}`, `onPress={() => onOpenVersion(artifact.id, v.id)}`. Keep the existing `styles.versionRow` layout; the Approve button in FeedbackPanel stays a separate control (do not nest it inside the row Pressable — render it as a sibling so the tap targets don't overlap).

- [ ] **Step 4: Run — verify pass + full detail suite + tsc**

Run: `cd mobile && npx jest __tests__/screens/TrustProjectDetail && npx tsc --noEmit`
Expected: PASS (open-version + existing detail/journey/owner/sources/generate suites), tsc clean.

- [ ] **Step 5: Commit**

```bash
git add "mobile/app/trust/[projectId].tsx" mobile/__tests__/screens/TrustProjectDetail.open-version.test.tsx
git commit -m "feat(trust): tap a version to open the draft viewer"
```

---

### Task 8: Help topic (Definition of Done gate)

**Files:**
- Modify: `mobile/src/help-content/features.ts` (add feature key)
- Modify: `mobile/src/help-content/topics.ts` (add topic)
- Test: `mobile/__tests__/help/coverage.test.ts` (existing gate — must pass)

**Interfaces:**
- Produces: `FEATURES` key `"draft-viewer"` + a topic with `featureKey: "draft-viewer"`.

- [ ] **Step 1: Run the coverage gate to confirm current state**

Run: `cd mobile && npx jest __tests__/help/coverage.test.ts`
Expected: PASS now (baseline). It will FAIL after Step 2 adds the feature until Step 3 adds the topic.

- [ ] **Step 2: Add the feature key**

`features.ts` — add to the `FEATURES` array:

```ts
  { key: "draft-viewer", label: "Reading, editing & regenerating a draft" },
```

- [ ] **Step 3: Add the topic**

`topics.ts` — add an entry (follow the `sources` topic shape: `id`, `title`, `featureKey`, `keywords`, `blocks`):

```ts
  {
    id: "draft-viewer",
    title: "Read, edit & regenerate a draft",
    featureKey: "draft-viewer",
    keywords: ["draft", "content", "read", "view", "edit", "revise", "regenerate", "version", "approve", "guidance"],
    blocks: [
      {
        kind: "text",
        text: "Open a project, go to Drafts (or Feedback), and tap a version to read the full drafted content. Reviewers read here before approving; owners can also edit or regenerate it.",
      },
      {
        kind: "text",
        text: "Editing lets the owner adjust each section's heading and body; saving creates a new version. Regenerate re-drafts from the sources — you can add optional guidance (for example, \"focus on 2026 costs\"). Every edit or regeneration is a new version, so an earlier approved version is never changed; the new version needs its own approval.",
      },
    ],
  },
```

- [ ] **Step 4: Run — verify the gate passes**

Run: `cd mobile && npx jest __tests__/help/coverage.test.ts`
Expected: PASS (feature ↔ topic satisfied).

- [ ] **Step 5: Commit**

```bash
git add mobile/src/help-content/features.ts mobile/src/help-content/topics.ts
git commit -m "docs(help): draft viewer/edit/regenerate topic (DoD)"
```

---

## Final verification (after all tasks)

- [ ] Backend: `cd backend && python -m pytest tests/test_trust_router.py tests/test_trust_draft.py -v` — all pass; confirm the "no log line contains the API key" test still passes.
- [ ] Mobile: `cd mobile && npx jest && npx tsc --noEmit` — full suite green, tsc clean.
- [ ] Manual sanity of route param wiring: version screen back nav returns to the project; Save/Regenerate navigate to the new version id.
- [ ] Rollout reminder in the PR body: **prod backend must be refreshed on ship** (new endpoint + `guidance` field) or the mobile read screen 404s on production (recurring "prod backend lags main" lesson).

## Self-review

- **Spec coverage:** read endpoint (T1), guidance (T2), client+hook (T3), read UI (T4), edit→new version (T5), regenerate+guidance (T6), entry points from Drafts+Feedback (T7), Help DoD (T8), approval-invalidation confirm (T5/T6), reviewer-can-read (T1 guard `need_owner=False`). All spec sections mapped.
- **Type consistency:** `getVersion`/`VersionDetailView`/`DraftSection` names identical across T3–T6; `generateVersion(artifactId, {guidance})` identical in T3 hook and T6 caller; `addVersion(artifactId, {sections})` matches the existing hook signature; route `pathname: "/trust/version/[versionId]"` identical in T5/T6/T7.
- **Placeholders:** none — every code step has literal code; UI-detail steps (T5/T6/T7 step 3) describe concrete controls with exact accessibility labels the tests assert.
