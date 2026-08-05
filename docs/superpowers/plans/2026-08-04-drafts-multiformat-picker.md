# Drafts Multi-format Generate Picker Implementation Plan (slice 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Drafts tab's single hard-coded "Generate a draft" with a 6-format GENERATE picker that creates an artifact of the chosen format and generates a format-appropriate draft, reusing the PR #370 viewer.

**Architecture:** One unified generator — a per-format spec (`FORMAT_SPECS`) drives the prompt; content stays the `{sections}` shape so every format renders in the existing viewer. Backend adds an `essay` format (migration `0011`) + format-aware prompt. Mobile adds a format catalog + a `generateFormat` hook helper + the picker UI.

**Tech Stack:** FastAPI · asyncpg · Alembic · Pydantic v2 · pytest · React Native + Expo · Jest + RNTL.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-04-drafts-multiformat-picker-design.md`.
- Content shape stays `{"sections":[{heading,body,source_ids}]}` for ALL formats (viewer unchanged).
- Generation stays **owner-only** (`need_owner=True`, unchanged); reviewers see the drafts list, not the picker.
- App-level authz only — no RLS / no tenant column.
- The 6 formats + rules are FIXED (verbatim from the spec table): linkedin/x_thread/reel/podcast → derivative; essay/book → cornerstone.
- `artifact.format` CHECK constraint is named `artifact_format_check` (confirmed on the DB).
- Every RN literal in `makeStyles` needs `as const`; Fraunces headings without `fontWeight`; `PageContainer` scene-roots keep `flex: 1`.
- Run REAL `npx tsc --noEmit` (mobile) — Jest doesn't typecheck.
- Backend DB tests need `DATABASE_URL`; run against the local test DB (recipe below).

**Local backend test recipe (DB already migrated to 0010):**
```bash
cd backend
export DATABASE_URL="postgresql://postgres:devlocal@localhost:5439/mentible_test"
export BYOK_MASTER_KEY="0000000000000000000000000000000000000000000000000000000000000000"
export SYSTEM_OWNER_SECRET="1111111111111111111111111111111111111111111111111111111111111111"
export REDIS_URL="redis://localhost:6379/0" APP_ENV=test LOG_LEVEL=INFO
export PYTHONPATH=/home/sivam/Documents/code/projects/AIStuff/STEM_studybuddy/Mentible
source .venv/bin/activate
```

---

### Task 1: Backend — `essay` format (migration 0011 + ARTIFACT_FORMATS)

**Files:**
- Create: `backend/alembic/versions/0011_artifact_format_essay.py`
- Modify: `backend/src/trust/models.py` (add `"essay"` to `ARTIFACT_FORMATS`)
- Test: `backend/tests/test_trust_router.py`

**Interfaces:**
- Produces: `ARTIFACT_FORMATS` includes `"essay"`; the DB CHECK accepts `format='essay'` after `alembic upgrade head`.

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/test_trust_router.py`:

```python
def test_create_essay_artifact_accepted():
    with TestClient(app) as c:
        owner = f"o-{uuid.uuid4()}"
        _as(owner, f"{owner}@x.z")
        pid = c.post("/api/v1/trust/projects", json={"title": "P", "topic": "t"}).json()["id"]
        r = c.post(
            f"/api/v1/trust/projects/{pid}/artifacts",
            json={"role": "cornerstone", "format": "essay"},
        )
        assert r.status_code == 200, r.text
        assert r.json()["format"] == "essay"
```

- [ ] **Step 2: Run — verify it fails**

Run: `cd backend && python -m pytest tests/test_trust_router.py::test_create_essay_artifact_accepted -v`
Expected: FAIL — either a 422 (`ARTIFACT_FORMATS` rejects `essay`) or a DB `CheckViolation` on insert.

- [ ] **Step 3: Add `"essay"` to `ARTIFACT_FORMATS`**

`backend/src/trust/models.py` — append `"essay"` inside the `ARTIFACT_FORMATS` tuple:

```python
ARTIFACT_FORMATS = (
    "book",
    "guide",
    "learning_module",
    "podcast",
    "youtube",
    "reel",
    "linkedin",
    "x_thread",
    "essay",
)
```

- [ ] **Step 4: Write the migration**

Create `backend/alembic/versions/0011_artifact_format_essay.py`. Find the current head revision id (the `0010` file's `revision = "..."`) and set `down_revision` to it. Use the same style as `0009`.

```python
"""artifact.format += essay (drafts multi-format picker, slice 1)"""

from alembic import op

revision = "0011"
down_revision = "0010"   # confirm against the 0010 file's `revision`
branch_labels = None
depends_on = None

_FORMATS = "'book','guide','learning_module','podcast','youtube','reel','linkedin','x_thread'"


def upgrade() -> None:
    op.execute("ALTER TABLE artifact DROP CONSTRAINT artifact_format_check")
    op.execute(
        f"ALTER TABLE artifact ADD CONSTRAINT artifact_format_check "
        f"CHECK (format IN ({_FORMATS},'essay'))"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE artifact DROP CONSTRAINT artifact_format_check")
    op.execute(
        f"ALTER TABLE artifact ADD CONSTRAINT artifact_format_check "
        f"CHECK (format IN ({_FORMATS}))"
    )
```

- [ ] **Step 5: Apply the migration to the test DB**

Run: `cd backend && alembic upgrade head` (env per the recipe).
Expected: `Running upgrade 0010 -> 0011`. Confirm: `docker exec mentible_local_pg psql -U postgres -d mentible_test -tAc "SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='artifact_format_check'"` shows `'essay'`.

- [ ] **Step 6: Run the test — verify it passes**

Run: `cd backend && python -m pytest tests/test_trust_router.py::test_create_essay_artifact_accepted -v`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/alembic/versions/0011_artifact_format_essay.py backend/src/trust/models.py backend/tests/test_trust_router.py
git commit -m "feat(trust): add 'essay' artifact format (migration 0011)"
```

---

### Task 2: Backend — `FORMAT_SPECS` + format-aware prompt

**Files:**
- Create: `backend/src/trust/format_specs.py`
- Modify: `backend/src/trust/draft_prompt.py`
- Test: `backend/tests/test_trust_draft.py`

**Interfaces:**
- Consumes: `build_draft_prompt(sources, artifact_format, topic, audience, goal, guidance=None)` (existing signature — unchanged).
- Produces: `FORMAT_SPECS: dict[str, FormatSpec]` + `DEFAULT_SPEC`; the prompt injects the per-format rule and section range.

- [ ] **Step 1: Write the failing tests**

Add to `backend/tests/test_trust_draft.py` (the file already has `_SOURCES`):

```python
def test_prompt_linkedin_uses_linkedin_rules():
    p = build_draft_prompt(_SOURCES, "linkedin", None, None, None)
    assert "LinkedIn post" in p or "180-260" in p  # per-format length rule present
    assert "3 to 6 sections" not in p              # not the book default


def test_prompt_essay_uses_essay_rules():
    p = build_draft_prompt(_SOURCES, "essay", None, None, None)
    assert "800-1200" in p
    assert "3 to 6 sections" not in p


def test_prompt_book_unchanged_default():
    p = build_draft_prompt(_SOURCES, "book", None, None, None)
    assert "3 to 6 sections" in p


def test_prompt_unknown_format_falls_back_to_book():
    p = build_draft_prompt(_SOURCES, "totally_unknown", None, None, None)
    assert "3 to 6 sections" in p  # DEFAULT_SPEC == book
```

- [ ] **Step 2: Run — verify they fail**

Run: `cd backend && python -m pytest tests/test_trust_draft.py -k "linkedin or essay or book_unchanged or unknown" -v`
Expected: FAIL (prompt hard-codes "3 to 6 sections" for every format).

- [ ] **Step 3: Create `format_specs.py`**

```python
"""Per-format generation specs for the trust draft generator (drafts multi-format picker).

One unified generator; the spec varies the prompt's length/section rules per artifact
format. Content shape stays {sections} for every format (see the design spec).
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class FormatSpec:
    section_rule: str  # the "write N sections" framing injected into the prompt
    rules: str         # length + style rules for this format


FORMAT_SPECS: dict[str, FormatSpec] = {
    "linkedin": FormatSpec(
        "Write ONE LinkedIn post as a single section (leave the heading empty).",
        "180-260 words. Professional but human. 3-5 relevant hashtags. End with a clear call to action.",
    ),
    "x_thread": FormatSpec(
        "Write ONE X thread as a single section; put 5 to 8 tweets in the body, each on its own line.",
        "Each tweet <= 280 characters. Punchy, no fluff. 1-2 hashtags total.",
    ),
    "reel": FormatSpec(
        "Write ONE ~60-second reel script as a single section.",
        "A hook, 2-3 beats, and a close. Spoken, energetic.",
    ),
    "podcast": FormatSpec(
        "Write ONE 60-90 second podcast cold-open monologue as a single section.",
        "Conversational, draws the listener in.",
    ),
    "essay": FormatSpec(
        "Write a long-form essay across 3 to 5 sections, each with a heading.",
        "800-1200 words total. Clear prose.",
    ),
    "book": FormatSpec(
        "write a short draft of 3 to 6 sections",
        "",
    ),
}

DEFAULT_SPEC = FORMAT_SPECS["book"]
```

- [ ] **Step 4: Make `build_draft_prompt` format-aware**

`backend/src/trust/draft_prompt.py` — import the specs and use them instead of the fixed text. Preserve the `book` wording exactly (so `test_prompt_book_unchanged_default` and any existing prompt test pass):

```python
from .format_specs import DEFAULT_SPEC, FORMAT_SPECS


def build_draft_prompt(sources, artifact_format, topic, audience, goal, guidance=None) -> str:
    labelled = "\n\n".join(
        f'[S{i + 1}] ({s.kind}{": " + s.title if s.title else ""})\n"""\n{s.content}\n"""'
        for i, s in enumerate(sources)
    )
    ctx = []
    if topic:
        ctx.append(f"on {topic}")
    if audience:
        ctx.append(f"for {audience}")
    if goal:
        ctx.append(f"so the reader can {goal}")
    ctx_line = (" " + " ".join(ctx)) if ctx else ""
    guidance_line = f"\n\nAdditional guidance from the author: {guidance}" if guidance else ""
    spec = FORMAT_SPECS.get(artifact_format, DEFAULT_SPEC)
    rules_line = f" {spec.rules}" if spec.rules else ""
    return (
        f"You are drafting a {artifact_format}{ctx_line}. Using ONLY the sources below, {spec.section_rule}."
        f"{rules_line} Attribute each section to the source label(s) it draws from. "
        f"Invent nothing beyond the sources — if the sources do not cover something, omit it.{guidance_line}\n\n"
        f"SOURCES:\n{labelled}\n\n"
        f"Respond with ONLY valid JSON, no prose, exactly matching this schema:\n"
        f'{{"sections": [{{"heading": "string", "body": "string", "sources": ["S1"]}}]}}\n'
        f"Return sections per the instruction above."
    )
```

Note: `book`'s `section_rule` is `"write a short draft of 3 to 6 sections"`, so the composed prompt contains "3 to 6 sections" (keeps the book default assertion true). Verify the existing `test_prompt_includes_sources_format_and_json` still passes (it checks `"guide"`, source content, `"S1"`, `"json"` — all preserved).

- [ ] **Step 5: Run the tests — verify pass (incl. no regressions)**

Run: `cd backend && python -m pytest tests/test_trust_draft.py -v`
Expected: PASS — the 4 new tests + all existing (guidance, sources/format/json, generate_draft).

- [ ] **Step 6: Commit**

```bash
git add backend/src/trust/format_specs.py backend/src/trust/draft_prompt.py backend/tests/test_trust_draft.py
git commit -m "feat(trust): per-format draft prompt specs (format-aware generation)"
```

---

### Task 3: Mobile — format catalog + `generateFormat` hook helper

**Files:**
- Create: `mobile/src/constants/draftFormats.ts`
- Modify: `mobile/src/hooks/useTrustProject.ts`
- Test: `mobile/__tests__/hooks/useTrustProject.generateFormat.test.tsx` (new) — or extend an existing hook test if one exists; otherwise create.

**Interfaces:**
- Produces: `DraftFormat { format: string; label: string; hint: string; role: "cornerstone" | "derivative" }`, `DRAFT_FORMATS: DraftFormat[]` (the 6). `useTrustProject().generateFormat(fmt: DraftFormat): Promise<VersionCreatedView>` — `createArtifact(projectId,{role,format,title:label})` then `generateVersion(artifact.id)`.

- [ ] **Step 1: Write the failing test**

Create `mobile/__tests__/hooks/useTrustProject.generateFormat.test.tsx`. Mock `@/api/trustClient`'s `createArtifact` + `generateVersion` + `getProject`, mock `@/auth/AuthProvider` (`accessToken:"tok", status:"signed_in"`) and `@/secure/keyStore` `loadApiKey` → `"sk-ant-x"`. Render the hook with `renderHook` (from `@testing-library/react-native`), call `generateFormat({format:"linkedin",label:"LinkedIn post",hint:"…",role:"derivative"})`, assert:

```ts
expect(createArtifact).toHaveBeenCalledWith("p1", { role: "derivative", format: "linkedin", title: "LinkedIn post" }, "tok");
expect(generateVersion).toHaveBeenCalledWith("art1", expect.objectContaining({ provider_id: "anthropic" }), "tok");
```

(where `createArtifact` mock resolves `{ id: "art1", ... }`). Follow the mocking style of the existing trust hook/client tests under `mobile/__tests__/`.

- [ ] **Step 2: Run — verify it fails**

Run: `cd mobile && npx jest __tests__/hooks/useTrustProject.generateFormat.test.tsx`
Expected: FAIL (`generateFormat` is not a function).

- [ ] **Step 3: Create the format catalog**

`mobile/src/constants/draftFormats.ts`:

```ts
export interface DraftFormat {
  format: string;
  label: string;
  hint: string;
  role: "cornerstone" | "derivative";
}

export const DRAFT_FORMATS: DraftFormat[] = [
  { format: "linkedin", label: "LinkedIn post", hint: "180–260 words", role: "derivative" },
  { format: "x_thread", label: "X thread", hint: "5–8 tweets", role: "derivative" },
  { format: "reel", label: "Reel script", hint: "60 seconds", role: "derivative" },
  { format: "podcast", label: "Podcast cold-open", hint: "60–90 sec", role: "derivative" },
  { format: "essay", label: "Long-form essay", hint: "800–1200 words", role: "cornerstone" },
  { format: "book", label: "Chapter outline", hint: "book", role: "cornerstone" },
];
```

- [ ] **Step 4: Add `generateFormat` to the hook**

`mobile/src/hooks/useTrustProject.ts` — add (reusing the existing `createArtifact`/`generateVersion` imports and `loadApiKey` pattern already used by `generateVersion`):

```ts
  const generateFormat = useCallback(async (fmt: { format: string; label: string; role: string }) => {
    const key = await loadApiKey("anthropic");
    if (!key) throw new Error("No API key saved. Add an Anthropic key in Settings to generate a draft.");
    if (!accessToken) throw new Error("Not signed in");
    const a = await createArtifact(projectId, { role: fmt.role, format: fmt.format, title: fmt.label }, accessToken);
    const v = await generateVersionApi(a.id, { api_key: key, provider_id: "anthropic" }, accessToken);
    await refresh();
    return v;
  }, [accessToken, projectId, refresh]);
```

Add `generateFormat` to the hook's returned object. (`createArtifact` is already imported as `createArtifact`; `generateVersion` is imported as `generateVersionApi`; `loadApiKey` already imported.)

- [ ] **Step 5: Run the test + tsc — verify pass**

Run: `cd mobile && npx jest __tests__/hooks/useTrustProject.generateFormat.test.tsx && npx tsc --noEmit`
Expected: PASS, tsc clean.

- [ ] **Step 6: Commit**

```bash
git add mobile/src/constants/draftFormats.ts mobile/src/hooks/useTrustProject.ts mobile/__tests__/hooks/useTrustProject.generateFormat.test.tsx
git commit -m "feat(trust): draft format catalog + generateFormat hook helper"
```

---

### Task 4: Mobile — DraftsPanel GENERATE picker

**Files:**
- Modify: `mobile/app/trust/[projectId].tsx`
- Test: `mobile/__tests__/screens/TrustProjectDetail.picker.test.tsx` (new)

**Interfaces:**
- Consumes: `DRAFT_FORMATS` (Task 3), `useTrustProject().generateFormat` (Task 3).
- Produces: DraftsPanel renders a GENERATE list of the 6 format cards (owner); tapping a card calls `generateFormat` with per-card busy state.

- [ ] **Step 1: Write the failing test**

Create `mobile/__tests__/screens/TrustProjectDetail.picker.test.tsx`, modelled on the existing `TrustProjectDetail.test.tsx` mock/setup. Seed a project with `my_role:"owner"`, one input (so generate is enabled), no artifacts. Mock `useTrustProject` to expose a `generateFormat` jest.fn. Render, switch to the Drafts tab if needed, then:

```ts
expect(getByText("LinkedIn post")).toBeTruthy();
expect(getByText("Long-form essay")).toBeTruthy();
fireEvent.press(getByLabelText("Generate LinkedIn post"));
expect(generateFormat).toHaveBeenCalledWith(expect.objectContaining({ format: "linkedin" }));
```

Add a second case: with zero inputs, the cards are disabled (assert the "Add a source first" hint renders, mirroring the current DraftsPanel behaviour).

- [ ] **Step 2: Run — verify it fails**

Run: `cd mobile && npx jest __tests__/screens/TrustProjectDetail.picker.test.tsx`
Expected: FAIL (no format cards / label).

- [ ] **Step 3: Replace the DraftsPanel generate controls with the picker**

In `mobile/app/trust/[projectId].tsx`:
- Import `DRAFT_FORMATS, type DraftFormat` from `@/constants/draftFormats`.
- Change `DraftsPanel`'s props: drop `onGenerateDraft`/`onAddArtifact`/`addArtifactBusy`; add `onGenerateFormat: (fmt: DraftFormat) => void` and `genBusyFormat: string | null` (the `format` currently generating, for per-card busy). Keep `isOwner`, `artifacts`, `inputs`, `onOpenVersion`.
- Render a **GENERATE** section (owner only): map `DRAFT_FORMATS` to a `Pressable` card each — label (Fraunces optional; match the existing `versionLabel`/`artifactTitle` styling), hint sub-text, a trailing `+`. `accessibilityRole="button"`, `accessibilityLabel={`Generate ${f.label}`}`, `disabled={genBusyFormat !== null || inputs.length === 0}`, `onPress={() => onGenerateFormat(f)}`. When `inputs.length === 0` render the existing "Add a source first" hint. The busy card shows `…` when `genBusyFormat === f.format`.
- Keep the **DRAFTS** list below exactly as-is (the `artifacts.map` → versionRow → `onOpenVersion` block). When `artifacts.length === 0`, the picker itself is the empty-state (no separate "Add an artifact" button; a reviewer with no artifacts still sees "Waiting for the owner to create a draft.").
- In `TrustProjectDetailInner`: pull `generateFormat` from `useTrustProject`; replace `genBusy`/`onGenerateDraft`/`onAddArtifact`/`addArtifactBusy` state with a single `const [genBusyFormat, setGenBusyFormat] = useState<string | null>(null)` and:

```tsx
  const onGenerateFormat = async (fmt: DraftFormat) => {
    setGenBusyFormat(fmt.format);
    try {
      await generateFormat(fmt);
    } catch (e) {
      Alert.alert("Couldn't generate", e instanceof ApiError ? e.userMessage() : e instanceof Error ? e.message : "Try again.");
    } finally {
      setGenBusyFormat(null);
    }
  };
```

- Update the `<DraftsPanel .../>` render props accordingly, and delete the now-unused `onAddArtifact`/`onGenerateDraft`/`addArtifactBusy`/`genBusy` handlers + `addArtifact` destructure if unused elsewhere (keep `addArtifact` only if still referenced). Add any new styles (`genCard`, `genHint`, `genPlus`) with `as const` on literals.

- [ ] **Step 4: Run the picker test + full DraftsPanel suites + tsc**

Run: `cd mobile && npx jest __tests__/screens/TrustProjectDetail && npx tsc --noEmit`
Expected: PASS — the new picker test + existing detail/journey/owner/sources/generate/open-version suites, tsc clean. If an existing test asserted the old "Generate a draft"/"Add an artifact" labels, update it to the picker (note it in the report).

- [ ] **Step 5: Commit**

```bash
git add "mobile/app/trust/[projectId].tsx" mobile/__tests__/screens/TrustProjectDetail.picker.test.tsx
git commit -m "feat(trust): Drafts GENERATE picker — 6 format cards"
```

---

## Final verification (after all tasks)

- [ ] Backend: `cd backend && python -m pytest tests/test_trust_draft.py tests/test_trust_router.py -v` — all pass; the no-key-in-logs gate still passes.
- [ ] Mobile: `cd mobile && npx jest && npx tsc --noEmit` — full suite green, tsc clean.
- [ ] Confirm a generated non-book draft opens in the PR #370 viewer (route unchanged) — the DRAFTS list rows already push `/trust/version/[versionId]`.
- [ ] PR body: **prod backend must run `alembic upgrade head`** on ship (migration 0011) or `format="essay"` fails the CHECK on prod.

## Self-review

- **Spec coverage:** essay format + migration (T1), FORMAT_SPECS + format-aware prompt (T2), catalog + generateFormat (T3), picker UI (T4). Non-goals (copy/feedback/publish) excluded. All spec sections mapped.
- **Type consistency:** `DraftFormat`/`DRAFT_FORMATS` names identical in T3 and T4; `generateFormat(fmt)` shape identical in the hook (T3) and the panel caller (T4); `FORMAT_SPECS`/`DEFAULT_SPEC` identical in T2 code and prompt.
- **Placeholders:** none — migration, specs, catalog, hook, and picker handler are literal; the T4 UI-detail step names the exact props, labels, and busy-state contract the test asserts.
