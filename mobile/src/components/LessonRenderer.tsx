import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Platform, View } from "react-native";
import type { GeneratedTopic, ImportedChapter, QuizSet } from "@/types/book";
import { buildChapterHtml, buildChapterQuizHtml, buildTopicHtml } from "@/components/contentHtml";
import { type Palette } from "@/constants/theme";
import { useTheme, useThemedStyles } from "@/theme";
import { NativeTopicReader } from "@/reader/NativeTopicReader";
import { NativeChapterReader } from "@/reader/NativeChapterReader";
import { NativeQuizReader } from "@/reader/NativeQuizReader";
import { useTopicAudio } from "@/reader/useTopicAudio";
// expo-audio is native-only (no web entry semantics we rely on here — the web
// topic reader plays audio via a plain <audio> element in NativeTopicReader.web,
// never through this file). Static import is safe: this module (LessonRenderer)
// is only ever exercised for its native WebView path on native, and Platform.OS
// gates which branch of TopicRenderer/ChapterRenderer/QuizRenderer actually runs.
import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";

// Re-export the pure builder so existing importers keep working
// (`@/components/LessonRenderer` was their home before the contentHtml split).
export { buildTopicHtml };

// react-native-webview is native-only. Import lazily so the web bundle never
// tries to resolve it (it has no web entry point and would throw at load time).
const WebView = Platform.OS !== "web" ? require("react-native-webview").default : null;

// ── Native WebView host ───────────────────────────────────────────────────────
// The native topic reader: renders built topic HTML in a react-native-webview.
// Web renders through NativeTopicReader instead (see TopicRenderer), so this host
// only ever mounts on native.

interface HtmlViewProps {
  html: string;
  label: string;
  /** Auto-height: the WebView sizes to its content and disables its own scroll
   * so it can flow inside a parent ScrollView (whole-book draft preview). A flex
   * WebView collapses to 0 with no definite height inside a ScrollView. */
  inline?: boolean;
  /** Extra `injectedJavaScript` to run alongside the auto-height script (e.g.
   * the audio bridge — ADR-040 rung 3). Composed so callers don't have to
   * choose between the two. */
  extraInjectedJS?: string;
  /** Called with every raw `onMessage` payload BEFORE the built-in height
   * parse. Return `true` if the message was consumed (e.g. an audio-bridge
   * message) so the height parse is skipped for it. */
  onCustomMessage?: (data: string) => boolean;
  /** Forwarded to `<WebView ref>` so a caller (the audio bridge) can push
   * state back in via `injectJavaScript`. */
  webviewRef?: React.RefObject<any>;
}

// Injected once inline: post the document height on load, and again as async
// content (mermaid/KaTeX) finishes drawing, so the WebView grows to fit.
const AUTO_HEIGHT_JS = `(function () {
  function post() {
    var h = Math.ceil(document.documentElement.scrollHeight || document.body.scrollHeight || 0);
    if (window.ReactNativeWebView && h > 0) window.ReactNativeWebView.postMessage(String(h));
  }
  post();
  window.addEventListener('resize', post);
  try { new MutationObserver(post).observe(document.body, { subtree: true, childList: true, attributes: true }); } catch (e) {}
  [150, 500, 1200, 2500].forEach(function (t) { setTimeout(post, t); });
})(); true;`;

// ADR-040 rung 3 — the native audio bridge. Wires taps on the reader's
// id-keyed control markup (`.rd-audio-toggle` / `.rd-audio-seek`, both
// `data-audio-id`-tagged; see `renderReaderAudioHtml`'s native branch in
// `@/lib/figuresHtml`) to `postMessage`, and defines `window.__rdAudioState`
// so RN can push playback state back in via `injectJavaScript`. Only the clip
// id ever crosses the bridge — never a data: URI or file path.
const AUDIO_BRIDGE_JS = `(function () {
  function post(m){ if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(m)); }
  document.addEventListener('click', function (e) {
    var b = e.target && e.target.closest && e.target.closest('.rd-audio-toggle');
    if (b) { post({ t: 'audio', action: 'toggle', id: b.getAttribute('data-audio-id') }); }
  });
  document.addEventListener('input', function (e) {
    var s = e.target;
    if (s && s.classList && s.classList.contains('rd-audio-seek')) {
      post({ t: 'audio', action: 'seek', id: s.getAttribute('data-audio-id'), positionMs: Math.round(Number(s.value)) });
    }
  });
  function fmt(ms){ var t=Math.max(0,Math.floor(ms/1000)); var m=Math.floor(t/60); var s=('0'+(t%60)).slice(-2); return m+':'+s; }
  window.__rdAudioState = function (st) {
    var wrap = document.querySelector('.topic-audio[data-audio-id="'+st.id+'"]'); if (!wrap) return;
    var btn = wrap.querySelector('.rd-audio-toggle'); if (btn) { btn.innerHTML = st.playing ? '&#10073;&#10073;' : '&#9658;'; btn.setAttribute('aria-label', st.playing ? 'Pause' : 'Play'); }
    var seek = wrap.querySelector('.rd-audio-seek'); if (seek) { seek.max = String(st.durationMs || 0); seek.value = String(st.positionMs || 0); }
    var time = wrap.querySelector('.rd-audio-time'); if (time) { time.innerHTML = fmt(st.positionMs||0) + '&nbsp;/&nbsp;' + fmt(st.durationMs||0); }
  };
})(); true;`;

function HtmlView({ html, label, inline, extraInjectedJS, onCustomMessage, webviewRef }: HtmlViewProps) {
  const styles = useThemedStyles(makeStyles);
  const [height, setHeight] = useState(1);
  const injectedJavaScript = useMemo(
    () => [inline ? AUTO_HEIGHT_JS : "", extraInjectedJS ?? ""].join("\n"),
    [inline, extraInjectedJS],
  );
  return (
    <View style={inline ? styles.inlineContainer : styles.container}>
      <WebView
        ref={webviewRef}
        source={{ html }}
        style={inline ? [styles.inlineWebview, { height }] : styles.webview}
        javaScriptEnabled
        originWhitelist={["*"]}
        scrollEnabled={!inline}
        showsVerticalScrollIndicator={false}
        allowsInlineMediaPlayback={false}
        mixedContentMode="always"
        accessibilityLabel={label}
        injectedJavaScript={injectedJavaScript || undefined}
        onMessage={(e: { nativeEvent: { data: string } }) => {
          const data = e.nativeEvent.data;
          if (onCustomMessage?.(data)) return;
          if (!inline) return;
          const h = Number(data);
          if (Number.isFinite(h) && h > 0) setHeight(h);
        }}
      />
    </View>
  );
}

// ── Public renderers ──────────────────────────────────────────────────────────

/**
 * Renders a full book topic — lesson plus any tutorial / quiz sets / experiment.
 *
 * Web renders the native reader (real DOM: selection, find-in-page, semantic
 * headings, bundled fonts). Native renders the same content through a WebView.
 * The switch lives here (not at the two call sites) so the Studio topic screen and
 * the shared-draft reader can never drift apart.
 *
 * `NativeTopicReader` resolves to a throwing stub off-web, so the `Platform.OS`
 * guard is what keeps DOMPurify/marked/mermaid out of the native bundle (D3).
 *
 * `figures` (from `useTopicFigures`) is an optional id → data:URL map for any
 * author-attached images (media feature) — passed through to whichever
 * renderer is active so both surfaces can inline the same figures.
 */
export function TopicRenderer({
  topic,
  figures,
  inline,
}: {
  topic: GeneratedTopic;
  figures?: Map<string, string>;
  /** Opt-in: renders auto-height so the reader can flow inside a parent
   * ScrollView instead of self-scrolling. On web via NativeTopicReader /
   * readerStyles' `.inline` modifier; on native via the WebView auto-height host. */
  inline?: boolean;
}) {
  if (Platform.OS === "web") return <NativeTopicReader topic={topic} figures={figures} inline={inline} />;
  return <WebViewTopicRenderer topic={topic} figures={figures} inline={inline} />;
}

/**
 * Owns the native audio player + WebView↔expo-audio bridge (ADR-040 rung 3).
 * The WebView renders the id-keyed control markup (button/range/time, never a
 * data: URI); this component resolves an id to a `file://` uri (via
 * `useTopicAudio`) and drives ONE `expo-audio` player — playing a second clip
 * stops the first. Only the clip id crosses the bridge in either direction.
 */
function WebViewTopicRenderer({
  topic,
  figures,
  inline,
}: {
  topic: GeneratedTopic;
  figures?: Map<string, string>;
  inline?: boolean;
}) {
  const theme = useTheme();
  const { fileUris } = useTopicAudio(topic);
  const webviewRef = useRef<any>(null);
  const player = useAudioPlayer(); // expo-audio: source set via replace() below
  const status = useAudioPlayerStatus(player);
  const activeId = useRef<string | null>(null);

  const html = useMemo(() => buildTopicHtml(topic, figures, theme, "native"), [topic, figures, theme]);

  // Push playback state back into the WebView control for the active clip.
  useEffect(() => {
    if (!activeId.current) return;
    const msg = JSON.stringify({
      id: activeId.current,
      playing: !!status.playing,
      positionMs: Math.round((status.currentTime ?? 0) * 1000),
      durationMs: Math.round((status.duration ?? 0) * 1000),
    });
    webviewRef.current?.injectJavaScript(`window.__rdAudioState && window.__rdAudioState(${msg}); true;`);
  }, [status.playing, status.currentTime, status.duration]);

  const onCustomMessage = useCallback(
    (data: string): boolean => {
      let m: any;
      try {
        m = JSON.parse(data);
      } catch {
        return false;
      }
      if (!m || m.t !== "audio") return false;
      const uri = fileUris.get(m.id);
      // Single active clip: switching to a different id (whether via toggle or
      // seek) swaps the player's source, which stops whatever was playing.
      if (activeId.current !== m.id) {
        activeId.current = m.id;
        if (uri) player.replace({ uri });
      }
      if (m.action === "toggle") {
        // Toggle: if this clip is the active one and already playing, pause; else play.
        if (status.playing && activeId.current === m.id) player.pause();
        else player.play();
      } else if (m.action === "seek") {
        player.seekTo((m.positionMs ?? 0) / 1000);
      }
      return true;
    },
    [fileUris, player, status.playing],
  );

  return (
    <HtmlView
      html={html}
      label="Topic content"
      inline={inline}
      extraInjectedJS={AUDIO_BRIDGE_JS}
      onCustomMessage={onCustomMessage}
      webviewRef={webviewRef}
    />
  );
}

/**
 * Renders one chapter of an IMPORTED book. Same platform split as
 * `TopicRenderer`: web gets the real DOM (selection, find-in-page, bundled
 * fonts), native gets the same content through the WebView.
 */
export function ChapterRenderer({ chapter }: { chapter: ImportedChapter }) {
  if (Platform.OS === "web") return <NativeChapterReader chapter={chapter} />;
  return <WebViewChapterRenderer chapter={chapter} />;
}

function WebViewChapterRenderer({ chapter }: { chapter: ImportedChapter }) {
  const theme = useTheme();
  const html = useMemo(() => buildChapterHtml(chapter, theme), [chapter, theme]);
  return <HtmlView html={html} label="Chapter content" />;
}

/**
 * Renders a standalone chapter quiz (Open Shelves F2 — "Make a quiz from this
 * chapter"). Same platform split as `TopicRenderer`/`ChapterRenderer`, and
 * deliberately goes through the TOPIC render path (KaTeX/GFM enhancement +
 * sanitize), not the chapter one: the quiz is OUR schema-validated content,
 * not third-party prose read from the chapter's own HTML.
 */
export function QuizRenderer({ quiz }: { quiz: QuizSet }) {
  if (Platform.OS === "web") return <NativeQuizReader quiz={quiz} />;
  return <WebViewQuizRenderer quiz={quiz} />;
}

function WebViewQuizRenderer({ quiz }: { quiz: QuizSet }) {
  const theme = useTheme();
  const html = useMemo(() => buildChapterQuizHtml(quiz, theme), [quiz, theme]);
  return <HtmlView html={html} label="Chapter quiz" />;
}

const makeStyles = (c: Palette) => ({
  container: {
    flex: 1,
    backgroundColor: c.background,
  },
  webview: {
    flex: 1,
    backgroundColor: c.background,
  },
  // Inline (auto-height) host: no flex — the WebView's height is measured from
  // content and applied inline, so it flows inside a parent ScrollView.
  inlineContainer: {
    backgroundColor: c.background,
  },
  inlineWebview: {
    backgroundColor: c.background,
  },
});
