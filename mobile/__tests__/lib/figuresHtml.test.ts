import { countBookFigures, renderAudioHtml, renderAudioTranscriptHtml, renderFiguresHtml, renderReaderAudioHtml } from "@/lib/figuresHtml";
import type { Book, TopicAudio, TopicImage } from "@/types/book";

const img = (id: string, caption?: string): TopicImage => ({
  id, file: `media/b/${id}.png`, mime: "image/png", caption, addedAt: "x",
});

function bookWith(images: Record<string, TopicImage[]>): Book {
  const content = Object.fromEntries(
    Object.entries(images).map(([topicId, imgs]) => [
      topicId,
      { topicId, title: "U", lesson: {} as never, generatedAt: "x", images: imgs },
    ]),
  );
  return { id: "b", title: "T", toc: { subjects: [] }, createdAt: "x", updatedAt: "x", content } as unknown as Book;
}

describe("countBookFigures", () => {
  it("counts every topic's figures across the book", () => {
    expect(countBookFigures(bookWith({ t1: [img("a"), img("b")], t2: [img("c")] }))).toBe(3);
  });
  it("is 0 for a book with no figures, no content, or topics without an images key", () => {
    expect(countBookFigures(bookWith({ t1: [] }))).toBe(0);
    expect(countBookFigures({ id: "b", title: "T" } as unknown as Book)).toBe(0);
    // A topic generated before media slice 1 has no `images` key at all — the
    // shape every pre-#318 book on disk still has.
    const legacy = {
      id: "b", title: "T",
      content: { t1: { topicId: "t1", title: "U", lesson: {}, generatedAt: "x" } },
    } as unknown as Book;
    expect(countBookFigures(legacy)).toBe(0);
  });
});

describe("renderFiguresHtml", () => {
  it("returns empty string when no images resolve", () => {
    expect(renderFiguresHtml([], new Map())).toBe("");
    expect(renderFiguresHtml([img("a")], new Map())).toBe(""); // no dataUrl → skipped
  });
  it("emits a figure per resolved image with escaped caption and data: src", () => {
    const urls = new Map([["a", "data:image/png;base64,AAAA"]]);
    const html = renderFiguresHtml([img("a", "A <b>cap</b>")], urls);
    expect(html).toContain('<section class="figures">');
    expect(html).toContain('src="data:image/png;base64,AAAA"');
    expect(html).toContain("A &lt;b&gt;cap&lt;/b&gt;");
    expect(html).not.toContain("<b>cap</b>");
  });
});

const aud = (id: string, title?: string): TopicAudio => ({
  id, file: `media/b/${id}.mp3`, mime: "audio/mpeg", title,
});

describe("renderAudioHtml", () => {
  it("returns empty string when no clips resolve", () => {
    expect(renderAudioHtml([], new Map())).toBe("");
    expect(renderAudioHtml([aud("a")], new Map())).toBe(""); // no dataUrl → skipped
  });
  it("emits a figure per resolved clip with an <audio controls> and escaped title", () => {
    const urls = new Map([["a", "data:audio/mpeg;base64,AAAA"]]);
    const html = renderAudioHtml([aud("a", "Intro <b>Narration</b>")], urls);
    expect(html).toContain('<figure class="topic-audio">');
    expect(html).toContain('<audio controls="controls" src="data:audio/mpeg;base64,AAAA"></audio>');
    expect(html).toContain("Intro &lt;b&gt;Narration&lt;/b&gt;");
    expect(html).not.toContain("<b>Narration</b>");
  });
  it("falls back to 'Narration' when the clip has no title", () => {
    const urls = new Map([["a", "data:audio/mpeg;base64,AAAA"]]);
    const html = renderAudioHtml([aud("a")], urls);
    expect(html).toContain("<figcaption>Narration</figcaption>");
  });
});

const audT = (id: string, transcript?: string, title?: string): TopicAudio => ({
  id, file: `media/b/${id}.mp3`, mime: "audio/mpeg", title, transcript,
});

describe("renderAudioTranscriptHtml", () => {
  it("returns empty string for no clips, a clip with no transcript, or a whitespace-only transcript", () => {
    expect(renderAudioTranscriptHtml([])).toBe("");
    expect(renderAudioTranscriptHtml([audT("a")])).toBe("");
    expect(renderAudioTranscriptHtml([audT("a", "   ")])).toBe("");
  });
  it("emits a figure per clip with a transcript, as escaped prose with no <audio>", () => {
    const html = renderAudioTranscriptHtml([audT("a", "Hello <b>there</b>.", "Intro")]);
    expect(html).toContain('<figure class="topic-audio-transcript">');
    expect(html).toContain("<p>Hello &lt;b&gt;there&lt;/b&gt;.</p>");
    expect(html).toContain("<figcaption>Intro</figcaption>");
    expect(html).not.toContain("<audio");
  });
  it("falls back to 'Narration' when the clip has no title", () => {
    const html = renderAudioTranscriptHtml([audT("a", "Hello.")]);
    expect(html).toContain("<figcaption>Narration</figcaption>");
  });
});

const AUD: TopicAudio = { id: "a1", file: "media/b/a1.mp3", mime: "audio/mpeg", title: "Intro", transcript: "Hello world." };

describe("renderReaderAudioHtml", () => {
  it("web target emits a native <audio controls> with the data: src + transcript details", () => {
    const html = renderReaderAudioHtml([AUD], { target: "web", dataUrls: new Map([["a1", "data:audio/mpeg;base64,AAA="]]) });
    expect(html).toContain('<audio class="rd-audio" controls="controls" preload="none" src="data:audio/mpeg;base64,AAA="></audio>');
    expect(html).toContain('data-audio-id="a1"');
    expect(html).toContain("<summary>Transcript</summary>");
    expect(html).toContain("Hello world.");
    expect(html).not.toContain("rd-audio-toggle"); // no native control on web
  });

  it("native target emits an id-keyed control block, NO <audio> and NO data: URI", () => {
    const html = renderReaderAudioHtml([AUD], { target: "native" });
    expect(html).toContain('class="rd-audio-toggle" data-audio-id="a1"');
    expect(html).toContain('class="rd-audio-seek" data-audio-id="a1"');
    expect(html).toContain('class="rd-audio-time" data-audio-id="a1"');
    expect(html).not.toContain("<audio"); // native must not embed <audio>
    expect(html).not.toContain("data:"); // no base64 in native markup
    expect(html).toContain("Hello world."); // transcript still present
  });

  it("web: a clip with no resolved url is skipped; native: rendered regardless (id-only)", () => {
    expect(renderReaderAudioHtml([AUD], { target: "web", dataUrls: new Map() })).toBe("");
    expect(renderReaderAudioHtml([AUD], { target: "native" })).toContain("data-audio-id");
  });

  it("empty / no audio → empty string", () => {
    expect(renderReaderAudioHtml([], { target: "web", dataUrls: new Map() })).toBe("");
    expect(renderReaderAudioHtml(undefined as unknown as TopicAudio[], { target: "native" })).toBe("");
  });

  it("escapes a hostile transcript / title (no raw HTML injection)", () => {
    const evil: TopicAudio = { id: "x", file: "media/b/x.mp3", mime: "audio/mpeg", title: "<img src=x onerror=1>", transcript: "</p><script>alert(1)</script>" };
    const html = renderReaderAudioHtml([evil], { target: "native" });
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img src=x");
  });
});
