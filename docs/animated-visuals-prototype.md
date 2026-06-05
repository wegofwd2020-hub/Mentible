# Animated visuals — free path (prototype)

> **Status:** prototype on `feat/animated-svg-visuals`. The free alternative to
> paid text-to-video: the LLM writes an **animated SVG as text**, the reader
> drops it inline so it animates in-page. Zero extra cost, no new dependency, no
> separate provider/async-video API.

## Why SVG, not video
Real video gen (Veo/Sora/Kling) is **paid** and rides a separate async API — it
doesn't fit a BYOK learning app. For *educational motion* (an orbit, a wave, a
cycle, one pass of an algorithm) an **animated SVG** is the right tool: it's text
the existing free text models already produce, it renders in the existing reader
WebView, and it stays in the EPUB/PDF-friendly content model.

## How it works (the path)
1. **Generation** — the prompt (`prompt_builder._ANIMATED_SVG_GUIDE`) tells the
   model it MAY emit a self-contained SVG in a ```svg block, animated with SMIL
   or CSS `@keyframes`, **no JavaScript**, one per lesson, small + legible. It
   includes two **worked examples** (a motion diagram + a character) so weaker
   free models have a concrete pattern to follow — few-shot raises the floor.
   The character example is gated to narrative/analogy lessons only (never a
   technical/reference lesson; never realistic) per the adult-learner positioning.
2. **Render** — the reader's `marked` renderer (`contentHtml.ts`) special-cases
   ```svg the same way it does ```mermaid: it drops the SVG inline inside
   `<figure class="anim-svg">` (instead of a `<pre>` code block), so SMIL/CSS
   animation plays in the WebView. `<script>` is stripped defensively.
3. **Style** — `.anim-svg` is a centered card matching the diagram styling.

## Verified
- Unit: `contentHtml.test.ts` asserts the ```svg renderer + figure styling are wired.
- Visual: rendered a real lesson (`buildTopicHtml`) with an animated sine-wave SVG
  in headless Chrome — the green dot traces the wave inline (not a code block).
- Backend: prompt directive present in built prompts; existing prompt/e2e tests green.

## Limits / follow-ups
- Animation quality depends on the model emitting good SVG — measure across
  providers (ties into the conformance work). A weak model may need the directive
  tightened or examples added.
- `<script>` is stripped, but SVG is still author-generated content rendered in a
  WebView — same trust model as the existing Mermaid/markdown passthrough.
- Could add an SVG-specific render error fallback (if the SVG is malformed) and a
  small library of vetted animation patterns the model can adapt.
- Lottie/CSS-only variants are possible later; SVG is the lowest-friction start.
