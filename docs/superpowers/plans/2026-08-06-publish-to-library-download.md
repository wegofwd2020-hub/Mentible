# Publish → Add to Library + Download EPUB/PDF — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On the Publish tab, turn a validated long-form asset (book/essay/guide) into a Library book and let the user download it as EPUB or PDF, reusing the existing book/compiler/Library machinery.

**Architecture:** A ~40-line `artifactToBook` converter (`DraftSection[] → Book`) is the only new logic. The Publish panel branches on `artifact.format`: long-form → Add to Library (`saveBook`) + Download EPUB/PDF (`trackedExport` → `downloadArtifact`); social → the existing Copy actions. Content is fetched on demand via the existing `loadVersionContent`.

**Tech Stack:** React Native + Expo · TypeScript · Jest + RNTL.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-06-publish-to-library-download-design.md`.
- NO backend change, NO migration. `/api/v1/export/*` compile endpoints already exist + are key-free.
- Reuse verbatim (do not modify): `saveBook` (`@/storage/bookStore`), `trackedExport` (`@/lib/trackedExport`, calls `buildCompilePayload` internally), `downloadArtifact` (`@/storage/epubLibrary`), `randomUUID` (`@/lib/uuid`), and the screen's existing `loadVersionContent(versionId)` (= `getVersion`) + `inputs` (= `project.inputs`).
- `title` passed to the converter must yield a non-empty book title (the compiler 422s on empty) — default to `"Untitled"`.
- Long-form set = exactly `{ "book", "essay", "guide" }`. Social formats keep the existing Copy / Copy-as-Markdown UNCHANGED.
- NOT doing Open-Library `publishBook` (ADR-027 gated) — local Library + download only.
- `useThemedStyles` (selected theme, no forced `SmeThemeScope`); every RN literal `as const`.
- Run REAL `npx tsc --noEmit` (Jest doesn't typecheck). jest.mock factory consts need a `mock` prefix; the screen-under-test import path matches existing `TrustProjectDetail` tests (`@/../app/trust/[projectId]`).
- Type shapes (already on `main`): `Book` (`@/types/book`) = `{ id, title, toc:{subjects:[{subject_label, units:[{id,title,subtopics:[],prerequisites:[]}]}]}, content:{[topicId]:{topicId,title,lesson,generatedAt}}, createdAt, updatedAt }`; `LessonOutput` (`@/types/lesson`) = `{ topic, level, language, synopsis, learning_objectives:[], sections:[{heading,body_markdown}], key_takeaways:[], further_reading:[] }`; `DraftSection {heading, body, source_ids}` + `ProjectInputView {id, kind, title, content, source_ref, created_at}` (`@/api/trustClient`).

---

### Task 1: `artifactToBook` converter

**Files:**
- Create: `mobile/src/lib/artifactToBook.ts`
- Test: `mobile/__tests__/lib/artifactToBook.test.ts`

**Interfaces:**
- Produces: `artifactToBook(sections: DraftSection[], title: string, inputs: ProjectInputView[]): Book` — one topic; `{heading,body}` → `{heading, body_markdown}`; appends a "Sources" section from the union of cited `source_ids` (mapped to `S{n}` by inputs order) when any are cited; empty title → `"Untitled"`.

- [ ] **Step 1: Write the failing test**

Create `mobile/__tests__/lib/artifactToBook.test.ts`:

```ts
import { artifactToBook } from "@/lib/artifactToBook";

const inputs = [
  { id: "i1", kind: "transcript", title: "Interview 07-20", content: "…", source_ref: null, created_at: null },
  { id: "i2", kind: "link", title: null, content: "medicare.gov enrollment", source_ref: "https://medicare.gov", created_at: null },
];

it("maps sections to lesson body_markdown and appends a Sources section for cited inputs", () => {
  const book = artifactToBook(
    [{ heading: "Windows", body: "Sign up during IEP.", source_ids: ["i1"] },
     { heading: "Cost", body: "Premiums vary.", source_ids: ["i2"] }],
    "Medicare guide",
    inputs as any,
  );
  expect(book.title).toBe("Medicare guide");
  const topicId = Object.keys(book.content!)[0];
  const secs = book.content![topicId].lesson.sections;
  expect(secs[0]).toEqual({ heading: "Windows", body_markdown: "Sign up during IEP." });
  const sources = secs[secs.length - 1];
  expect(sources.heading).toBe("Sources");
  expect(sources.body_markdown).toContain("[S1] Interview 07-20");
  expect(sources.body_markdown).toContain("[S2]");            // i2: no title → source_ref/content
  // toc wires the same topic id
  expect(book.toc.subjects[0].units[0].id).toBe(topicId);
});

it("omits the Sources section when nothing is cited, and defaults an empty title", () => {
  const book = artifactToBook([{ heading: "H", body: "B", source_ids: [] }], "   ", []);
  expect(book.title).toBe("Untitled");
  const topicId = Object.keys(book.content!)[0];
  const secs = book.content![topicId].lesson.sections;
  expect(secs).toHaveLength(1);
  expect(secs.some((s) => s.heading === "Sources")).toBe(false);
});
```

- [ ] **Step 2: Run — verify it fails**

Run: `cd mobile && npx jest __tests__/lib/artifactToBook.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `artifactToBook.ts`**

```ts
import { randomUUID } from "@/lib/uuid";
import type { DraftSection, ProjectInputView } from "@/api/trustClient";
import type { Book } from "@/types/book";
import type { LessonSection } from "@/types/lesson";

export function artifactToBook(
  sections: DraftSection[],
  title: string,
  inputs: ProjectInputView[],
): Book {
  const now = new Date().toISOString();
  const topicId = randomUUID();
  const safeTitle = title.trim() || "Untitled";

  const lessonSections: LessonSection[] = sections.map((s) => ({
    heading: s.heading,
    body_markdown: s.body,
  }));

  const labelFor = new Map(inputs.map((inp, i) => [inp.id, `S${i + 1}`] as const));
  const byId = new Map(inputs.map((inp) => [inp.id, inp] as const));
  const cited = [...new Set(sections.flatMap((s) => s.source_ids ?? []))];
  if (cited.length) {
    const lines = cited.map((id) => {
      const inp = byId.get(id);
      const name = inp ? inp.title || inp.source_ref || inp.content.slice(0, 80) : "(source)";
      return `- [${labelFor.get(id) ?? "cited"}] ${name}`;
    });
    lessonSections.push({ heading: "Sources", body_markdown: lines.join("\n") });
  }

  const lesson = {
    topic: safeTitle,
    level: "",
    language: "en",
    synopsis: "",
    learning_objectives: [],
    sections: lessonSections,
    key_takeaways: [],
    further_reading: [],
  };

  return {
    id: randomUUID(),
    title: safeTitle,
    toc: {
      subjects: [
        { subject_label: safeTitle, units: [{ id: topicId, title: safeTitle, subtopics: [], prerequisites: [] }] },
      ],
    },
    content: { [topicId]: { topicId, title: safeTitle, lesson, generatedAt: now } },
    createdAt: now,
    updatedAt: now,
  };
}
```

- [ ] **Step 4: Run — verify pass + tsc**

Run: `cd mobile && npx jest __tests__/lib/artifactToBook.test.ts && npx tsc --noEmit`
Expected: PASS, tsc clean. (If tsc complains a required `LessonOutput`/`Book` field is missing, add it with an empty/default value — do not remove required fields.)

- [ ] **Step 5: Commit**

```bash
git add mobile/src/lib/artifactToBook.ts mobile/__tests__/lib/artifactToBook.test.ts
git commit -m "feat(trust): artifactToBook — validated draft → Library Book"
```

---

### Task 2: Publish panel — Add to Library + Download EPUB/PDF (long-form)

**Files:**
- Modify: `mobile/app/trust/[projectId].tsx`
- Test: `mobile/__tests__/screens/TrustProjectDetail.publishbook.test.tsx` (new)

**Interfaces:**
- Consumes: `artifactToBook` (Task 1), `saveBook`, `trackedExport`, `downloadArtifact`, the screen's existing `loadVersionContent` + `inputs`.
- Produces: long-form (`book`/`essay`/`guide`) Publish assets show Add to Library + Download EPUB + Download PDF; social keep Copy.

- [ ] **Step 1: Write the failing test**

Create `mobile/__tests__/screens/TrustProjectDetail.publishbook.test.tsx`, modelled on the existing `TrustProjectDetail` tests. Mock `@/storage/bookStore` (`saveBook`), `@/lib/trackedExport` (`trackedExport` → `{ artifact: new ArrayBuffer(8) }`), `@/storage/epubLibrary` (`downloadArtifact`), and `useTrustProject` (with `project` holding a validated version + `inputs`, and a `loadVersionContent` mock resolving `{ content: { sections: [{heading:"H",body:"B",source_ids:[]}] } }`). Seed the Publish tab with (a) a `book`-format artifact with a validated version and (b) a `linkedin`-format artifact with a validated version. Assert:

```ts
// long-form asset → book actions, not Copy
expect(getByLabelText("Add Chapter outline to Library")).toBeTruthy();
expect(getByLabelText("Download Chapter outline as EPUB")).toBeTruthy();
expect(getByLabelText("Download Chapter outline as PDF")).toBeTruthy();
// social asset → Copy actions
expect(getByLabelText("Copy LinkedIn post as text")).toBeTruthy();

fireEvent.press(getByLabelText("Add Chapter outline to Library"));
await waitFor(() => expect(mockSaveBook).toHaveBeenCalled());
// the saved book has one topic with the mapped section
const savedBook = mockSaveBook.mock.calls[0][0];
const topicId = Object.keys(savedBook.content)[0];
expect(savedBook.content[topicId].lesson.sections[0].body_markdown).toBe("B");

fireEvent.press(getByLabelText("Download Chapter outline as EPUB"));
await waitFor(() => expect(mockTrackedExport).toHaveBeenCalledWith(expect.anything(), "epub", { diagrams: true }));
await waitFor(() => expect(mockDownloadArtifact).toHaveBeenCalledWith(expect.any(ArrayBuffer), expect.stringMatching(/\.epub$/), "application/epub+zip"));
```

(Use the artifact `title` your fixture sets, e.g. "Chapter outline". Keep the exact accessibility labels the implementation uses.)

- [ ] **Step 2: Run — verify it fails**

Run: `cd mobile && npx jest __tests__/screens/TrustProjectDetail.publishbook.test.tsx`
Expected: FAIL (no book actions).

- [ ] **Step 3: Wire the Publish panel**

In `mobile/app/trust/[projectId].tsx`:
- Add imports: `artifactToBook` from `@/lib/artifactToBook`, `saveBook` from `@/storage/bookStore`, `trackedExport` from `@/lib/trackedExport`, `downloadArtifact` from `@/storage/epubLibrary`.
- Add near the top: `const LONG_FORM = new Set(["book", "essay", "guide"]);` and a `slug` helper `const slug = (t: string) => t.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "asset";`.
- Extend `PublishPanel` props with `inputs: ProjectInputView[]`, `onAddToLibrary: (versionId, title, format) => void`, `onDownloadAsset: (versionId, title, fmt: "epub" | "pdf") => void` (keep `onCopyAsset`, `pubBusy`).
- In `PublishPanel`, per `{ artifact, version }`: if `LONG_FORM.has(artifact.format)` render three `Pressable`s — Add to Library (`accessibilityLabel={`Add ${title} to Library`}`, `onPress={() => onAddToLibrary(version.id, title, artifact.format)}`), Download EPUB (`accessibilityLabel={`Download ${title} as EPUB`}`, busy `${version.id}:epub`), Download PDF (`accessibilityLabel={`Download ${title} as PDF`}`, busy `${version.id}:pdf`), each `disabled={pubBusy !== null}`. Else render the existing Copy / Copy-as-Markdown block unchanged. Keep the `PDF & Word — Pro` line only under the social branch (long-form now has real PDF).
- In `TrustProjectDetailInner`, add handlers (mirror `onCopyAsset`'s on-demand fetch + busy/error pattern):

```tsx
  const onAddToLibrary = (versionId: string, title: string, _format: string) => {
    setPubBusy(`${versionId}:lib`);
    void (async () => {
      try {
        const v = await loadVersionContent(versionId);
        const book = artifactToBook(v.content?.sections ?? [], title, inputs);
        await saveBook(book);
        Alert.alert("Added", "Added to your Library.");
      } catch (e) {
        Alert.alert("Couldn't add", e instanceof ApiError ? e.userMessage() : "Please try again.");
      } finally {
        setPubBusy(null);
      }
    })();
  };

  const onDownloadAsset = (versionId: string, title: string, fmt: "epub" | "pdf") => {
    setPubBusy(`${versionId}:${fmt}`);
    void (async () => {
      try {
        const v = await loadVersionContent(versionId);
        const book = artifactToBook(v.content?.sections ?? [], title, inputs);
        const res = await trackedExport(book, fmt, { diagrams: true });
        await downloadArtifact(res.artifact, `${slug(title)}.${fmt}`, fmt === "epub" ? "application/epub+zip" : "application/pdf");
      } catch (e) {
        Alert.alert("Couldn't download", e instanceof ApiError ? e.userMessage() : "Please try again.");
      } finally {
        setPubBusy(null);
      }
    })();
  };
```

- Pass `inputs`, `onAddToLibrary`, `onDownloadAsset` into `<PublishPanel …/>`. (`ProjectInputView` is already imported; `inputs` is already destructured from the hook.)

- [ ] **Step 4: Run — verify pass + full TrustProjectDetail suite + tsc**

Run: `cd mobile && npx jest __tests__/screens/TrustProjectDetail && npx tsc --noEmit`
Expected: PASS (publishbook + existing detail/journey/compare/picker/… suites), tsc clean. If an existing Publish test asserted Copy on a long-form fixture, update it to the book actions (note in report).

- [ ] **Step 5: Commit**

```bash
git add "mobile/app/trust/[projectId].tsx" mobile/__tests__/screens/TrustProjectDetail.publishbook.test.tsx
git commit -m "feat(trust): Publish — add long-form asset to Library + download EPUB/PDF"
```

---

## Final verification (after all tasks)

- [ ] `cd mobile && npx jest && npx tsc --noEmit` — full suite green, tsc clean.
- [ ] Manual reasoning: a `book`/`essay`/`guide` validated asset in Publish → Add to Library saves a Book (opens in reader); Download EPUB/PDF compiles + downloads (web `<a>` / native share). A `linkedin` asset still shows Copy.
- [ ] PR body: mobile/web only — **no backend change / no migration**; the export endpoints are already live on prod. Ship = web redeploy.

## Self-review

- **Spec coverage:** converter + Sources section (T1); long-form Add-to-Library + Download EPUB/PDF, social keeps Copy (T2). Non-goals (Open-Library publish, backend, Word) excluded. All spec sections mapped.
- **Type consistency:** `artifactToBook(sections, title, inputs)` identical in T1 and the T2 callers; `trackedExport(book, fmt, {diagrams:true})` + `downloadArtifact(bytes, filename, mime)` match the reused signatures; `LONG_FORM` set matches the spec exactly.
- **Placeholders:** none — converter is literal code; T2 handlers are literal; the panel-edit step names the exact labels + busy keys the test asserts.
