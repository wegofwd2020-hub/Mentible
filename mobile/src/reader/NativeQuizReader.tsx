// Native (Android/iOS) stub. Metro resolves `NativeQuizReader.web.tsx` on web
// and this file everywhere else, which is what keeps DOMPurify / marked out of
// the native bundle entirely (mirrors NativeTopicReader.tsx, spec D3).
//
// It should never render: `QuizRenderer` guards on `Platform.OS === "web"`, so
// off-web it always picks the react-native-webview path (`buildChapterQuizHtml`).
// Throwing makes a wiring mistake loud instead of shipping a blank screen.
import type { QuizSet } from "@/types/book";

export function NativeQuizReader(_props: { quiz: QuizSet }): never {
  throw new Error(
    "NativeQuizReader is web-only (mirrors NativeTopicReader — spec D3). Native must render QuizRenderer's WebView path.",
  );
}
