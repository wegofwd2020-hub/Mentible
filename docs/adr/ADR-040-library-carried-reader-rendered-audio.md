# ADR-040 — Library-carried, reader-rendered audio (the multi-modal-library north-star)

**Status:** Proposed (2026-08-18). Records the **decision and its staged path only — no code.**
Implementation is deferred to per-slice specs (see §Staged path).
**Decision-maker:** Sivakumar Mambakkam
**Trigger:** the P1-5 P4 audio-narration derivative shipped (`docs/superpowers/specs/2026-08-18-audio-narration-derivative-p4-design.md`, merged `b7f63af`) as a **Share-phase clip** — generate narration, play/download an MP3. The product north-star (memory `project_product_vision_multimodal_library`) is a **multi-modal Personal Library** of text + graphics + **audio** books that **only our Web+Android reader renders** — the moat. This ADR records the target state (audio living *inside* a library book the reader plays) and the staged path to it, so the shipped derivative is explicitly **rung 1 of a recorded roadmap**, not the destination.
**Relates to:** ADR-004 (two-product split / artifact), ADR-037 (SME reposition — Capture→Create→Validate→**Share**), the P4 spec, and `docs/proposals/2026-07-27-short-form-publishing-studio.md` §P4.

---

## Context

Today (verified 2026-08-18):
- **Audio exists only as a Share derivative.** `POST /api/v1/derivatives/audio` (`backend/src/derivatives/router.py` `make_audio`) turns a validated section into a base64 MP3 the mobile Publish tab plays (`expo-audio`) and downloads. Nothing about it touches a library book.
- **The library book carries no audio.** `book.json` (`compiler/src/types.ts` `Book`/`GeneratedTopic`; mobile `mobile/src/types/book.ts`) carries text, quizzes, and **image refs** — no audio field anywhere.
- **The reader has no audio.** The shared renderer `mobile/src/reader/topicHtml.ts` emits lesson/quiz/figure HTML; no `<audio>`, no player.

But the media-attach machinery for the moat **already exists** — images proved the pattern, and P4 built the audio engine. This ADR decides to converge them rather than let audio calcify as a download-only side feature.

## Decision

**Audio is a first-class, library-carried, reader-rendered medium** — the same status text and graphics have — reached by **staged extension of existing machinery, not a rebuild**. Specifically:

1. **Audio rides in a book exactly the way images do: refs in `book.json`, bytes in the device media dir, resolved at render time.** A per-topic/section `audio?: TopicAudio[]` field mirrors `TopicImage` (`mobile/src/types/book.ts:165`): `{ id, file: "media/<bookId>/<id>.mp3", mime, caption?, alt?, transcript? }` — **refs, never base64 bytes, in `book.json`**. Bytes live in the per-book `media/<bookId>/` dir managed by `mobile/src/storage/mediaStore.ts` (the same store images use). This is the established "refs travel, bytes stay local" invariant (`mobile/src/lib/figuresHtml.ts:12`) — audio inherits it, and inherits its consequence: **audio, like figures, does not travel over the wire form of a shared draft** (bytes are device-local).

2. **The reader plays audio in-book, per surface, reusing the P4 player.** The sanitizer already permits a `data:`-URI `<audio controls>` unchanged (DOMPurify `html` profile; `audio`/`source`/`track` are DATA_URI_TAGS and not in `FORBID_TAGS`; `mobile/src/reader/sanitize.ts:216`) — so **no sanitizer weakening is required**. Web reader (native DOM, no iframe — `NativeTopicReader.web.tsx`) emits a plain `<audio>` with a `data:` URI. **Native (Android/iOS) is the constraint**: OEM AVPlayer/ExoPlayer `data:`-URI support is unreliable (the lesson baked into `mobile/src/components/AudioNarrationPlayer.tsx:14`), so native in-book audio is a **React player mounted outside the WebView** (reusing `AudioNarrationPlayer.tsx`: `expo-audio` + a `file://` cache), resolving `audio.file` → `file://` the way `mediaStore.resolveFigureDataUrls` resolves images. The WebView HTML marks *where* audio sits; the RN player renders *over* it.

3. **The compiler bakes audio into the EPUB3 artifact** via the existing image pipeline. EPUB3 supports audio; `compiler/src/epub.ts` already extracts data:-URI media into packaged resources + OPF manifest items (`packImages`, `MEDIA_EXT`, `buildOpf`). Audio adds `audio/mpeg` to `MEDIA_EXT`, a `packAudio` sibling, an `<item media-type="audio/mpeg"/>` in the manifest, and an `<audio>` in the chapter XHTML — the identical mechanism, one media type wider. So an exported book carries its narration.

4. **Authoring reuses the shipped P4 engine, not a new one.** Producing a topic's audio at authoring time calls the same `synthesize_speech` (`backend/src/derivatives/tts.py`) + `generate_narration` (`backend/src/derivatives/generate.py`) + managed/BYOK key fork (`_resolve_key_and_source`) the `/audio` derivative uses. The *only* difference from the derivative: **persist the bytes into the book's media dir + write a `TopicAudio` ref**, instead of returning a one-off base64 download. BYOK-first / managed-dormant posture carries over unchanged.

## Why (rejected alternatives)

- **Leave audio as a download-only Share derivative.** Rejected: it never reaches the moat (reader-rendered multi-modal books); audio stays a commodity export, not a differentiator.
- **Rebuild a media pipeline for audio.** Rejected: images already solved refs-in-json + bytes-in-media-dir + resolve-at-render + EPUB packaging; audio is that pattern one media type wider. A parallel pipeline is waste and drift.
- **Inline audio bytes (base64) into `book.json`.** Rejected: audio is heavy; base64 in the JSON bloats every load/sync and breaks the established refs-only invariant. Bytes belong in the media dir.
- **Play audio inside the native WebView via a data: `<audio>`.** Rejected as the native path: OEM data:-URI support is unreliable (P4's own hard-won lesson). Native uses the RN `expo-audio` player over the WebView.

## Format compatibility (EPUB tier) — audio is EPUB 3-only, and that changes nothing

A natural worry: does adding audio drop EPUB 2 compatibility? **No — because the compiler has always emitted EPUB 3, never EPUB 2.** Verified against `compiler/src/epub.ts` (rung-2 state):

- The package is `<package … version="3.0">` (`epub.ts:557`) with EPUB 3 markers — a `properties="nav"` `nav.xhtml` (`epub:type="toc"`, `:307`/`:478`), a required `dcterms:modified` (`:554`), and `<html xmlns:epub="…/ops">` content documents (`xhtml.ts`). This predates audio.
- A `toc.ncx` (the EPUB 2 nav, `application/x-dtbncx+xml`, `:310`/`:479`) is *also* emitted — but only as the standard EPUB 3 **backward-compat gesture** that lets an older EPUB 2 reader *open and navigate* the file. It never made the books EPUB 2 *documents*.

So the tiers are unchanged by audio:

| | before audio | after audio |
|---|---|---|
| Package | EPUB 3 (v3.0) | EPUB 3 (v3.0) — unchanged |
| Openable in an EPUB 2 reader (via the `toc.ncx` fallback) | yes | **still yes** — the ncx is untouched |
| `<audio>` element | n/a | EPUB 3-only; an EPUB 2 reader ignores the unrecognized tag, text still reads |

What audio actually does: it adds an **EPUB 3-only content-media element** (`audio/mpeg` is an EPUB 3 core media type; there is no EPUB 2 way to embed playable in-content audio — media overlays are EPUB 3). An EPUB 2-only reader opening the book reads all the text and simply **does not play the audio** — graceful degradation, no loss of openability. (Contrast: **images**, shipped earlier, are valid in EPUB 2 and never affected the tier; audio is the first EPUB 3-only content-media addition, but since the package was already v3.0 it moves nothing.) If stricter old-reader friendliness is ever wanted, gate audio behind the KDP/profile system — but nothing is broken today.

## Non-goals / out of scope for this ADR

- **Video / A-V** (narrated video). Still deferred — needs ffmpeg or a render service the stack lacks (see the P4 spec). A separate later decision.
- **A whole-book audiobook** as a standalone product line — the shortlist deferred that (`docs/competitive-analysis/PRIORITIZED_SHORTLIST.md`); this ADR is about per-topic narration *inside* an authored book, not a narrated-book product.
- **Cross-device audio sync** as a solved feature — see the open question below; this ADR records it as the hardest downstream problem, not a decision.
- This ADR lands **no code**. Each rung below gets its own spec + plan when taken up.

## Staged path (each rung = its own spec + plan; rungs are independently shippable)

- **Rung 1 — DONE.** The P4 Share derivative (`/derivatives/audio` + Publish "Generate narration" + `AudioNarrationPlayer`). Built the reusable TTS engine + the two-surface player.
- **Rung 2 — book.json audio schema + compiler bake.** Add `TopicAudio` (refs) to `book.ts` + `compiler/src/types.ts` (which today lacks even `images` — resolve that asymmetry); extend `mediaStore` with `attachAudio`/`resolveAudioUris`; extend `epub.ts` (`MEDIA_EXT`/`packAudio`/`buildOpf`) so an exported book carries narration. *Authoring persists P4-engine output into the media dir + a ref.* No reader change yet — proves audio travels in the artifact.
- **Rung 3 — reader in-book playback.** Emit the `<audio>` marker in `topicHtml.ts`/`figuresHtml.ts` (web plays it directly); mount the native `expo-audio` player over the WebView, resolving `audio.file`→`file://`. This is where the moat becomes visible (our reader plays library audio).
- **Rung 4 — authoring UX + generate-all.** A "narrate this topic / whole book" authoring action (owner-only, billable, managed/BYOK) that fans out P4's engine over topics and stores refs — the audio analog of Generate-full-book.
- **Later — video (A-V)**, gated on new infra (ffmpeg/render service).

## Open questions (to resolve per-rung, not here)

1. **Sync + bloat (the hardest).** Audio bytes are large and device-local (refs-only wire form). Cross-device library sync of audio, and whether a synced/hosted book carries audio at all, ties to the deferred zero-knowledge sync (`docs/SYNC_BUILD_PLAN.md`) and hosted-library ADRs (ADR-033) — likely gated on the managed-billing launch (ADR-039). Rung 2/3 ship device-local audio; sync is a separate decision.
- 2. **Transcript / a11y.** Should `TopicAudio` carry a `transcript` (the narration script is already produced by `generate_narration`) for accessibility + search? Cheap to store at authoring time; decide at rung 2.
- 3. **Voice / cost caps.** Managed audio remains dormant (ADR-039 economics); per-plan audio caps + a managed OpenAI TTS key are an ops decision, unchanged from P4.
- 4. **Native player-over-WebView UX.** Exact placement/anchoring of the RN player relative to the in-WebView `<audio>` marker is a rung-3 design detail.
