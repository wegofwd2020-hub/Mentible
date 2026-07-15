// Native (Android/iOS) stub. Metro resolves `NativeTopicReader.web.tsx` on web and
// this file everywhere else, which is what keeps DOMPurify / marked / mermaid out
// of the native bundle entirely (spec D3).
//
// It should never render: `TopicRenderer` guards on `Platform.OS === "web"`, so
// off-web it always picks the react-native-webview path. Throwing makes a wiring
// mistake loud instead of shipping a blank screen.
import type { GeneratedTopic } from "@/types/book";

export function NativeTopicReader(
  _props: { topic: GeneratedTopic; figures?: Map<string, string> },
): never {
  throw new Error(
    "NativeTopicReader is web-only (spec D3). Native must render TopicRenderer's WebView path.",
  );
}
