# Audio Narration Derivative (P1-5 P4, audio-only) — Design Spec

**Status:** Proposed · **Date:** 2026-08-18 · **Area:** `backend/src/derivatives/`, `mobile/` · **Extends:** the P1-5 derivatives (post/card/carousel/animated) · **Prior art:** `docs/proposals/2026-07-27-short-form-publishing-studio.md` §P4

## Why

P4 is the last unshipped Share slice: turn a validated draft into **spoken-word audio** (a narrated summary/voiceover). The full proposal pairs audio with A-V (narrated video). But the stack has **no ffmpeg and no video encoder**, and adding an audio track to video needs ffmpeg regardless — so **A-V/video is deferred** (a separate later slice needing new infra: ffmpeg-in-Docker or an external render service). **This slice is audio-only.**

Two hard facts from the feasibility pass shape the design:
1. The LLM seam (`wegofwd_llm`) is **chat-completions only** — its `Capabilities` has no TTS field. So text-to-speech needs a **separate audio client** (an `httpx.AsyncClient` call to a vendor TTS endpoint), exactly like B3's originality situation. The **compiler is not involved** (it renders images/GIF, not audio).
2. Mobile can **save** any audio file for free (`downloadArtifact` is mime-generic) but has **no in-app player** — playback needs a new `expo-audio` dependency (locked decision: in-app play + download).

## Relationship to the north-star (multi-modal Personal Library)

The product north-star is a **multi-modal Personal Library** of text + graphics + **audio** (later video) books that **only our Web+Android reader renders** — that is the moat. This slice is deliberately **rung 1 of that path, not the destination**: it ships audio as a **Share-phase derivative** (a downloadable/playable narration clip), NOT as audio carried inside a library book the reader plays. Verified current state: `book.json`/the EPUB artifact carry no audio, and the sandboxed-HTML reader has no audio pipeline — so library-carried audio is a **separate, larger follow-on** (audio in `book.json` + the artifact + a new reader audio pipeline, web + native). This slice's **TTS client + narration-script generator are built to be reused by that follow-on** — the engine is the shared foundation; only the *delivery* (share-clip now → reader-rendered library book later) differs. When the library slice is taken up, capture it in an ADR (target + staged path: derivative → book.json audio → reader pipeline → video).

## Decisions (locked with the user)

- **D1 — Audio only; video deferred.** Narrated audio now; A-V (mux audio onto animation via ffmpeg) is a separate later slice, out of scope.
- **D2 — Source = a validated section/draft.** Reuse the existing `_resolve_key_and_source` seam (`source_text` OR a validated `topic_version_id`, access-gated), same as card/carousel/animated.
- **D3 — Delivery = in-app play + download.** An inline play/pause preview (new `expo-audio` player) plus the existing `downloadArtifact` save. On web, an `<audio>` element.
- **D4 — TTS via a separate, dormant-config audio client** (the seam can't do it). The audio key/provider come from the SAME `_resolve_key_and_source` managed/BYOK fork; only **TTS-capable providers** (initially OpenAI; Gemini later) are accepted — a resolved provider with no TTS endpoint returns a clean "audio not supported for this provider" 422. A feature/config gate (`Field(default=..., "empty = audio disabled")`) lets the whole derivative be turned off; managed audio spend is metered (chars/minutes) like tokens (ADR-005 economics).

## Architecture

### Pipeline (mirrors `/animated`, minus the compiler)
`resolve → generate narration script (LLM) → TTS client → audio bytes → base64 in response`. Per the proposal's "audio → script → TTS → MP3" flow.

### Backend — a new `/api/v1/derivatives/audio` endpoint
- `make_audio` in `backend/src/derivatives/router.py`, mirroring `make_animated` (`router.py:482`):
  1. `_resolve_key_and_source(...)` — shared: managed/BYOK key fork + trust-section source + `source_label` provenance + access gate (identical to card/carousel/animated).
  2. **Narration script** — a new `generate_narration(source_text, tone) -> {script, title}` in `backend/src/derivatives/generate.py`, via the LLM seam (`build_provider`/`LLMRequest json`/`generate_validated`), that turns the validated section into **speakable** prose: strips markdown/headings/citation markers, expands the draft into natural spoken narration (bounded length, e.g. a ~60–90s summary), returns a plain-text `script`. (Same shape as `generate_card`; runs via `asyncio.to_thread`.)
  3. **TTS** — a NEW `backend/src/derivatives/tts.py` `synthesize_speech(script, *, provider_id, api_key, voice, fmt="mp3") -> (bytes, char_count)`: a dormant-config `httpx.AsyncClient` POST to the resolved provider's TTS endpoint (OpenAI `/v1/audio/speech` first). Provider must be TTS-capable (a small `TTS_CAPABLE = {"openai"}` map) — else raise a clean error → 422. Returns audio bytes + char count for metering.
  4. Meter managed spend (chars→cost) on success only; return `AudioResponse { script, title, audio_base64, mime: "audio/mpeg", provenance }`.
- **Schemas** (`backend/src/derivatives/schemas.py`): `AudioRequest { source_text? | topic_version_id?(uuid), tone?, voice?, api_key?, provider_id, model? }` (mirror `AnimatedRequest` + a `voice`), `AudioResponse` as above.
- **Config** (`backend/config.py`): a dormant gate following the established pattern — e.g. `tts_base_url_openai: str = Field(default="https://api.openai.com/v1", ...)` and/or an enable flag; **empty/unset ⇒ the endpoint returns a clean "audio disabled" 422** and the mobile button hides. The BYOK/managed **key** itself flows through `_resolve_key_and_source` (no new key config unless a wholly separate TTS vendor is chosen later).
- **ADR-001:** the audio path handles the LLM/BYOK key — it must NEVER be logged, persisted, or in a traceback; the TTS `httpx` call must not log the key or the audio URL with the key. Reuse the same key discipline as the derivatives generate path; add the caplog assertion test.
- **Security:** the TTS `httpx.AsyncClient` posts only the script text + the key in the `Authorization` header to the fixed vendor URL — never a user-controlled URL (no SSRF); the base URL is config, not request-supplied.

### Compiler — NO change
Audio is not a compiler render. `render.py` is untouched. (Confirmed: the compiler is image/GIF-only and would need ffmpeg for audio/video, which is out of scope.)

### Mobile — a "Generate narration" mode on the Publish tab
- `mobile/app/(tabs)/posts.tsx`: a new `audio` mode next to card/carousel/animated. Uses the same source picker (`renderSourcePicker`) and the same generate→result flow.
- **Player:** add `expo-audio` (the current SDK audio module) + an inline play/pause preview of the returned `audio_base64` (a `data:audio/mpeg;base64,...` URI). On web, a native `<audio controls>`; native uses `expo-audio`'s player. Fail-open if playback unavailable (still offer download).
- **Download:** `downloadArtifact(fromBase64(audio_base64), "narration.mp3", "audio/mpeg")` — existing mime-generic path, no new download code.
- `mobile/src/api/derivativesClient.ts`: `makeAudio` + `MakeAudioResponse` (mirror `makeAnimated`, IS_DEMO block).
- `mobile/src/hooks/useMakeAudio.ts`: mirror `useMakeAnimated` (knownNotPro gate).
- **Help DoD:** a `publish-audio` FEATURES key + Help topic + HELP_TREE leaf (next to `publish-animated`) in the same change.

## Non-goals

- No A-V / video (needs ffmpeg or an external render service — deferred, separate slice).
- No whole-book audiobook (the shortlist deferred "audiobook" as a standalone product line; this is a short narrated clip of one validated section).
- No reader-carried narration (the sandboxed-iframe reader has no audio pipeline).
- No speech-to-text / media-reference *input* (a sibling proposal item, not this slice).
- No new TTS vendor beyond the first (OpenAI); the `TTS_CAPABLE` map + client is the seam for adding Gemini/others later.

## Testing

- **Backend:** `generate_narration` returns speakable script (markdown/citation markers stripped) — mock provider; `synthesize_speech` posts to the right URL with the key in the header (mock `httpx`), returns bytes + char count, raises the clean error for a non-TTS provider (→ 422); the endpoint: owner/access-gated via `_resolve_key_and_source` (403/401/404, bad uuid 422), managed/BYOK fork, dormant-config disabled → 422, managed spend metered once on success; **the key never appears in logs / response / the TTS request log** (caplog assertion, ADR-001). No compiler/other-derivative regression.
- **Mobile:** `useMakeAudio` gating (knownNotPro blocks keyless; fail-open; BYOK always sent; request shape incl. voice/tone); the Publish audio mode renders, plays (mock `expo-audio`), and downloads a `.mp3`; button re-enables on error; help coverage + tree gates green.
- **Real-run:** an in-container probe is N/A (no compiler subprocess); instead a live endpoint probe with a real (BYOK) OpenAI key post-deploy confirms end-to-end audio bytes — do this once before relying on it. (Managed stays dormant until a key is configured.)

## Launch posture (important)

At launch the feature works for **BYOK users with a TTS-capable provider key** (paste an OpenAI key → narrate). **Managed audio is dormant** until an ops decision configures a managed TTS key + per-plan audio cost caps (audio minutes are a real vendor cost, ADR-005) — the managed path returns the same clean "audio not available on your plan" 422 the derivatives managed fork already returns when ineligible, until then. So: BYOK-first, managed-when-provisioned. The `expo-audio` player + download work regardless of key path.

## Rollout

Backend (new endpoint + tts client + config) + mobile (expo-audio + audio mode + Help) → web + backend ROOT refresh (no migration) + APK. The derivative is **dormant/BYOK-first by default** (managed audio off until a managed TTS key + caps are set) — same posture as managed billing / B3's external-service gate.
