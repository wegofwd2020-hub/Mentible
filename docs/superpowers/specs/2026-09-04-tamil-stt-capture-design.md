# Tamil Speech-to-Text Capture — Design

**Date:** 2026-09-04
**Status:** Approved (design); ready for implementation planning
**Author:** Siva Mambakkam (with Claude)
**Related:** ADR-037 (SME expert-validation reposition), ADR-042 (no self-hosted inference), ADR-005/ADR-012/ADR-014 (provider seam, key handling), ADR-001 (BYOK key discipline)
**Source docs (external, in `~/Downloads/`):** `mentible_feature_rationale_tamil_transcription.md`, `tamil_stt_implementation_guide.md`, `transcript_review_feature_spec.md`, `mp3_upload_integration_design.md`

---

## 1. Summary

Add a **Capture** capability to Mentible: a subject-matter expert (or an operator interviewing one) uploads an audio recording, the system transcribes it, and the resulting transcript enters the existing trust/validation loop as a reviewable, correctable, expert-approvable artifact.

This is the missing **Capture** phase of ADR-037's Capture → Create → Validate → Share loop. The motivating use case (from field research) is recording indigenous Tamil knowledge held by non-typing elders — recipes, Ayurveda, kolam design, craft, oral history — where conversation, not typing, is the natural way the knowledge is shared.

The feature is built **onto the existing stack** (FastAPI + Celery/Redis + the trust workspace + RN/Expo), not as a new subsystem. The genuinely new surface is small: a provider-agnostic speech-to-text seam, an upload endpoint, and a transcript-review screen. Everything downstream — versioning, correction audit trail, expert approval — is the trust workspace that already exists on `main`.

---

## 2. Goals and non-goals

### Goals
- Let a user upload an audio interview (MP3/M4A/WAV) from the Mentible app (Android and RN-web).
- Transcribe it via a **provider-agnostic, managed-or-BYOK** speech-to-text seam, honouring ADR-042 ("the model is the commodity" — no self-hosted GPU inference).
- Land the transcript as a first-class trust artifact so it inherits immutable versioning, correction history, and expert approval with `recorded_via` provenance.
- Provide a review surface to correct transcript text and assign speaker labels, producing a new immutable version.
- Keep the speech-to-text logic behind a clean in-repo seam so it can later be extracted to a shared `wegofwd-audio2text` package once a second product needs it.

### Non-goals (explicitly dropped from the source docs)
- **Self-hosted Whisper on a GPU box.** Contradicts ADR-042; ~$1.6k/month of infrastructure with no product differentiation. Rejected.
- **New `transcript` / `transcript_words` / `transcript_segments` / `transcript_revisions` tables.** The trust schema's `artifact` + immutable `artifact_version` + append-only `approval`/`feedback` already model versioned, audited, approvable content. Reuse it; do not build a parallel store.
- **FERPA / educational-data-privacy logic.** Mentible is adult-only (no COPPA/FERPA per CLAUDE.md).
- **A standalone React + Material-UI + Redux SPA.** Mentible's UI is RN/Expo (native + RN-web). Build there; reuse theming and auth.
- **Per-word confidence highlighting.** Commodity Whisper APIs return segment-level confidence (`avg_logprob`), not reliable per-word scores. Review highlights at the segment level.
- **diff-match-patch import/merge editor, model-retraining/feedback-loop pipeline, real-time streaming transcription.** Out of scope for this design.
- **Automatic speaker diarization.** Speaker separation is handled by manual tagging in review at MVP (see §4).

---

## 3. Key decisions (from brainstorming)

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | **Provider-agnostic managed + BYOK** speech-to-text seam (Groq / OpenAI, Google later). No self-hosted inference. | ADR-042; cheap; works on web; mirrors the LLM seam. |
| D2 | **Manual speaker tagging** in review; no auto-diarization at MVP. | Keeps the seam fully provider-agnostic; most SME captures are a single expert narrating. |
| D3 | **In-repo seam** at `backend/src/capture/`; extract to `wegofwd-audio2text` only when a second consumer appears. | Avoids the wegofwd-help mistake (extraction with no second consumer = dead weight). |
| D4 | **Transcript = `artifact(format='transcript')`** with immutable `artifact_version`s + existing `approval`/`feedback`. | Reuses the trust loop wholesale; "trust is the product" — the expert confirms the transcript. |
| D5 | **RN + Expo** (one codebase → Android + RN-web) for upload and review. | Consistency with every existing trust surface; reuse `useThemedStyles`, `RequireSignIn`, `IS_DEMO` gating. |

---

## 4. Architecture and data flow

```
mobile (RN/Expo)  ── upload audio ──►  POST /api/v1/trust/projects/{id}/transcribe
                                            │
                                            ├─ validate (mime/size/duration)
                                            ├─ store audio  → project_input(kind='upload', storage_path, content_hash)
                                            ├─ create        artifact(format='transcript')
                                            ├─ create        generation_job(kind='transcription', status='queued')
                                            └─ dispatch      Celery transcribe_task
                                                              └─► 202 { job_id, artifact_id }

transcribe_task (Celery worker):
    resolve key  (managed Groq key from env/vault  |  BYOK key decrypted from Redis envelope)
    segments = capture.transcribe(audio_path, language)      ← the seam
    write artifact_version v1  (content = segments jsonb)
    generation_job → status='done'

mobile polls generation_job  → on 'done' opens review surface
    user edits segment text + assigns speakers
    save = new immutable artifact_version (v2, v3, …)
    → existing approval loop (expert approves; recorded_via)
```

Everything to the right of `capture.transcribe(...)` is existing trust infrastructure. New code is the seam, the upload endpoint + task, the `generation_job` transcription discriminator, one migration, and two mobile screens.

---

## 5. Backend

### 5.1 The capture seam — `backend/src/capture/`

Mirrors the `wegofwd-llm` contract/registry pattern.

```python
# contract.py
@dataclass(frozen=True)
class TranscriptSegment:
    text: str
    start: float                    # seconds
    end: float
    confidence: float | None        # segment-level; None if the provider omits it

@dataclass(frozen=True)
class TranscriptionRequest:
    audio_path: str
    language: str                   # BCP-47-ish, e.g. 'ta', 'en'
    model: str

class STTProvider(Protocol):
    async def transcribe(
        self, req: TranscriptionRequest, *, api_key: str
    ) -> list[TranscriptSegment]: ...

# registry.py
def build_stt_provider(provider_id: str, *, api_key: str) -> STTProvider:
    """provider_id ∈ {'groq', 'openai'} at MVP; 'google' (diarizing) later."""
```

Discipline (ADR-001 / ADR-005 D3):
- The seam **never sources a key** — the caller always passes the key string.
- The seam **never logs** a key, an audio path, or audio bytes.
- Outbound HTTP uses `httpx.AsyncClient` (never block the event loop).

MVP providers:
- **groq** — `whisper-large-v3` over Groq's OpenAI-compatible endpoint. Managed default (aligns with ADR-042's Groq-keyless-default ethos).
- **openai** — `whisper-1` / `gpt-4o-transcribe`, BYOK path.
- **google** (deferred to slice 4) — Speech-to-Text v2 with built-in diarization; enters as one more registry entry returning an optional speaker field.

### 5.2 Endpoint

`POST /api/v1/trust/projects/{project_id}/transcribe` (multipart)
- Fields: `file` (audio), `language` (default `ta`), optional `title`.
- Access: `require_project_access` (owner or invited reviewer) — same guard as the rest of the trust router.
- Validation: mime ∈ {mp3, m4a, wav}; size ≤ 500 MB; duration ≤ 4 h (reject with clear 4xx messages).
- Rate limit: reuse/introduce a per-account limiter (e.g. 10 uploads/hour) via Redis.
- Side effects: store audio → `project_input(kind='upload')`; create `artifact(format='transcript')`; create `generation_job(kind='transcription')`; dispatch Celery task.
- Response: `202 { job_id, artifact_id, poll_url }`.

Status polling reuses the existing trust `generation_job` polling endpoint/hook.

### 5.3 Job, keys, and audio custody

- **Async:** reuse Celery + Redis (trust Phase A). Transcription is a **single-shot** job, so it reuses the same machinery as `generate_version` — an ephemeral Redis `job:{id}:status` blob polled via the shared `GET /api/v1/jobs/{job_id}` — **not** the durable `generation_job` row (that table is for the whole-book fan-out only). No new job table and no `generation_job` change (it already has a `kind` column).
- **BYOK speech-to-text key:** reuse `backend/src/core/byok_envelope.py` — encrypt in Redis with a per-job ephemeral key, TTL = job timeout, decrypt in the worker, shred after use. Never persisted, never logged.
- **Managed key:** Groq/OpenAI key from env/vault (`backend/src/billing` managed-key source), never returned to the client.
- **Audio at rest (the one genuinely new asset):** production is a Hetzner CX22 (CPU-only, no S3), so store the uploaded audio on local disk under a jobs directory, keyed by `content_hash` (dedupe). Retention: purge after **30 days** (ADR-014 posture; tighter than the source docs' 90). Audio is kept during review so a segment can be replayed while correcting (replay UI deferred to slice 4). Audio bytes and paths never appear in logs.

### 5.4 Data model — migration `0027`

Single change to the trust core (latest committed migration is `0026`):
- Add `'transcript'` to the `artifact.format` CHECK constraint (`artifact_format_check`) and to the `ARTIFACT_FORMATS` tuple. Nothing else — `generation_job` is untouched (transcription doesn't use it).

Content shapes:
- `artifact_version.content` (jsonb):
  ```json
  {
    "language": "ta",
    "segments": [
      {"text": "...", "start": 0.0, "end": 4.2, "confidence": 0.81, "speaker": null}
    ],
    "source_audio_ref": "<project_input.id>",
    "stt_meta": {"provider": "groq", "model": "whisper-large-v3"}
  }
  ```
- `artifact_version.generation_meta` (jsonb): `{ "job_id": "...", "duration_s": 2602, "word_count": 1247 }`.

Corrections and speaker tags produce a **new immutable version** through the existing `artifact_repo` append path (`UNIQUE(artifact_id, version_no)`). `feedback`, `approval`, `recorded_via`, and `action` tables are unchanged — the expert approves the transcript itself.

---

## 6. Mobile (RN + Expo → Android + RN-web)

### 6.1 Upload
- In `mobile/app/trust/[projectId].tsx`, add a Capture card: **"Upload interview (audio)"** → opens `Mp3UploadSheet`.
- `expo-document-picker` (accept mp3/m4a/wav); optional title; language selector (default Tamil); client-side size/duration guard.
- **Platform-aware upload:** a single `uploadAudio()` that branches on `Platform.OS` — web posts a `File`, native posts a `uri`. Do **not** use `expo-file-system` for the web path (native-only; breaks on web — known repo trap).
- POST multipart → reuse the trust job-polling hook → on `done`, navigate to review.

### 6.2 Review — `mobile/app/trust/transcript/[artifactId].tsx`
- Render the segment list; tap a segment to edit its text; tap to assign a speaker (name chips / free text).
- **Segment-level** confidence shading (not per-word — API limit); low-confidence segments surfaced first.
- Save = create a new immutable `artifact_version`; then hand off to the **existing approval UI** (expert approves → `approval` with `recorded_via`).
- `useThemedStyles` (follows the selected theme), wrapped in `RequireSignIn`, hidden under `IS_DEMO`.
- Root `ScrollView` uses `flex: 1` (RN-web and New-Arch text-collapse traps).

### 6.3 Help (Definition of Done gate)
- Add the feature key to `mobile/src/help-content/features.ts` and a matching topic in `mobile/src/help-content/topics.ts`, in the same PR as the UI — the coverage gate (`mobile/__tests__/help/coverage.test.ts`) fails otherwise.

---

## 7. Slicing (implementation order)

Each slice is its own PR on its own branch (`git checkout -b` before editing).

| Slice | Scope | Verification |
|-------|-------|--------------|
| **1 — seam + backend** | `backend/src/capture/` (groq + BYOK openai), `/transcribe` endpoint, Celery transcribe task, migration `0027`, `artifact(format='transcript')` v1 | pytest with mocked `httpx`; migration test; key-redaction test |
| **2 — capture UI** | Upload card + `Mp3UploadSheet` + job polling → lands a transcript artifact | `mobile:verify` on device/emulator |
| **3 — review UI** | Segment review surface (edit text, tag speaker) → new version → existing approval; Help topic | jest + device |
| **4 — deferred backlog** | Per-segment audio replay; Google diarizing provider; export (SRT/DOCX); correction-derived training data | — |

This design covers slices 1–3. Slice 4 is an explicit backlog, not part of this plan.

---

## 8. Testing

- **Mandatory key-redaction test (extended):** assert the speech-to-text key (both BYOK and managed) never appears in any log line, exactly as enforced for the Anthropic key. Assert audio paths and bytes are never logged.
- **Capture seam:** unit tests with a mocked `httpx` client; assert request shaping per provider and correct parsing of segments/confidence. No live speech-to-text, Redis, or Anthropic in CI.
- **Endpoint:** validation (mime/size/duration), access control (`require_project_access`), rate limiting, job creation.
- **Migration `0013`:** applies cleanly; the new enum value and `generation_job.kind` are usable.
- **Mobile:** jest/RNTL for the upload sheet and review components (mindful of RNTL DOM/`.web.tsx`/`asyncUtilTimeout` traps); manual device verification for the real upload → transcribe → review loop.

---

## 9. Compliance and security

- **Speech-to-text BYOK key = the user's property:** transient per-request passthrough, Redis TTL envelope, never persisted or displayed (prefix + last-4 only if surfaced at all). A BYOK key is never promoted to managed.
- **Managed key = ours:** held in env/vault, never returned to clients.
- **Audio:** local-disk at rest with 30-day retention purge; encrypt-at-rest is optional at this stage; never logged. Audio is user content and is purged on account/library deletion per ADR-014.
- **Transport:** TLS only; the audio travels in the multipart body, never in a URL/query string; the `Authorization` header carries only the IdP session JWT.
- **Access:** app-level `require_project_access` (owner + invited reviewer); no RLS, no tenant column — consistent with backend rule #4 as nuanced by ADR-037.

---

## 10. Open questions / risks

- **Tamil accuracy of commodity providers.** Groq/OpenAI Whisper Tamil quality is the main quality risk; mitigated by the human review loop (the whole point of modelling the transcript as a correctable, approvable artifact). Validate empirically in a slice-1 spike with a real Tamil sample.
- **Segment-level confidence only.** If per-word review proves necessary, revisit with a provider that returns word timestamps/scores; not planned.
- **Large-file uploads on RN-web.** 500 MB in a browser is heavy; consider a lower web cap or chunked upload if testing shows problems.
- **Extraction trigger.** Revisit `wegofwd-audio2text` extraction only when pramana or kathai-chithiram actually needs speech-to-text.
