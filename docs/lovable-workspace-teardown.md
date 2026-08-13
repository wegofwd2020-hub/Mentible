# Lovable workspace teardown — the 4-tab project workspace

> **Source:** `mentible_loverable_ux/src/routes/_authenticated/app/p/$id.tsx` (640 lines) — the Lovable
> prototype's project workspace. Companion to [`lovable-studio-flow-teardown.md`](./lovable-studio-flow-teardown.md)
> (the flow-level deck) and the [Studio-vs-Projects](./studio-vs-projects.md) notes.
> **Status:** Reference / adaptation review — captured 2026-08-13. **Our analog:** `mobile/app/trust/[projectId].tsx`.

Element-by-element map of the Lovable workspace against what **we** ship, to decide what (if anything) to
adapt. **Headline: we already have MORE of the workspace than the prototype** — richer on create,
versioning, and publish. Only two Lovable-distinctive things are genuinely missing from ours.

## Shell

Breadcrumb `Projects ›` + project title (Fraunces, 3xl–4xl) + a **flat 4-tab bar, always visible, with
live counts**: `Input (n) · Drafts (n) · Feedback · Publish (n)`. One page; tabs never hide a phase.

## The four tabs (Lovable)

- **Input — "Add source material".** Optional label input (`placeholder: "Label (optional) — e.g.
  Interview 2026-07-20"`) + a paste `Textarea` (`"Paste transcript or notes here…"`) + Add. A "sources on
  file" rail lists what's added. **Kinds: transcript / note only (no Link).**
- **Drafts.** Left: a **"Generate" format palette** — 6 one-click formats each with a length hint
  (`linkedin · x_thread · reel · podcast · essay · chapter`); clicking one generates (per-format pending
  spinner). Below it, a **drafts list** (`format · title · v{current_version}`, click → open). Empty:
  "Pick a format to generate, or open an existing draft." Right: the **Artifact panel**.
- **Artifact panel** (opens a selected draft): header `format · v{n}` + an **Approved** badge
  (`CheckCircle2`, accent) when approved; the title (Fraunces 2xl); an **Approve / Unapprove** toggle +
  **Copy**; a **"Request a revision"** section — a free-text `Textarea` (`'e.g. "Tighten the hook, cut the
  middle example, keep the close."'`) → **drafts a new version carrying that note**; **Version history**
  (the older versions listed).
- **Feedback — "Revision notes".** A **project-wide, read-only LOG** aggregating every "request a
  revision" across ALL drafts: `format · v{n} · date · note`. Empty: "No revision notes yet."
- **Publish — "Ready to publish".** **Approved assets only.** Each `PublishCard`: `format · v · title` +
  **Copy** + **Download Markdown**. Copy says "Formats beyond Markdown unlock on the Pro plan." Empty:
  "…click Approve to move it here."

## Element-by-element vs ours (`trust/[projectId].tsx`)

| Element | Lovable | Ours | Verdict |
|---|---|---|---|
| **Layout** | Flat **4 tabs, always visible, live counts** | **Phase-gated wizard** (`selected` PhaseKey Sources→Structure→Drafts→Review→Publish + a guided next-step banner) | **≠ biggest fork** — theirs reads faster and never hides a phase; ours hand-holds the first-draft path. The one real structural adaptation candidate. |
| **Input** | label + paste box; **transcript/note only** | per-kind Input (transcript / **note / link**, #409) + sources rail | **✅ we're ahead** (Link source; web-verified) |
| **Drafts palette** | 6 one-click formats + hints, per-format spinner | whole-book / per-topic toggle + draft-format cards + **Waiting→Generating** progress bars (#421) | **✅ ahead** — plus a TOC/Structure arc + per-topic mode they don't have |
| **Artifact panel** | view · Approve/Unapprove · Copy · **Request-a-revision** (free-text → new version) · version history | version viewer: Revise+guidance (S1) · provenance+history (S2) · **feedback thread + revise-from-note (S3)** · manual edit (S4) · Approve with `recorded_via` · progress bars | **✅ ahead** (append-only approval records, per-topic parity) |
| **Feedback tab** | **project-wide revision-notes LOG** (all "request a revision" rolled up into one timeline) | feedback is **per-version** (the S3 thread); **not rolled up** into a project-wide view | **✨ they have, we don't** — clean, small idea |
| **Publish tab** | approved-only · Copy · Download-**MD**; PDF/DOCX behind Pro | PublishPanel · Add-to-Library · **real EPUB/PDF (compiler)** · text/MD · Slice-B Pro-wall | **✅ ahead** (real compiled artifacts, not MD) |
| **Data (Supabase)** | `projects · project_inputs · artifacts · artifact_versions` (`body_md`, `feedback_note`) | trust workspace: `project · project_input · artifact/topic_version · approval/feedback · project_membership` | different spine; ours richer (topics, membership, provenance) |

## The two things worth adapting (everything else, we're ahead)

1. **The flat unified 4-tab layout with live counts** — vs our phase-gated wizard. Reads faster, never
   hides a phase; the trade-off is losing the guided hand-holding (which we deliberately added, #411, for
   the wayfinding gap [[feedback_real_gap_is_wayfinding]]). A real design decision, not a clear win either
   way — a hybrid (tabs with counts + keep the next-step nudge) may beat both.
2. **A project-wide Feedback log** — all revision notes across every draft in one read-only timeline
   (`format · v · date · note`). Ours records feedback per version but never rolls it up. Small, additive,
   and genuinely useful for an owner scanning "what's been asked for across the whole project." The data
   already exists (`feedback` / `topic_feedback` rows) — this is a read-only aggregation + a tab.

## Not adapting (intentional)

The Lovable Publish's copy/download-MD + PDF/DOCX-Pro-wall is a thinner version of what we already ship
(Library + compiled EPUB/PDF + the Slice-B Pro-wall). The transcript/note-only Input is a subset of ours.
The single-artifact-per-format model is thinner than our topics + whole-book. No action.
