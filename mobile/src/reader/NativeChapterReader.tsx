// Native stub. Metro resolves `NativeChapterReader.web.tsx` on web and this file
// everywhere else, which is what keeps DOMPurify out of the native bundle.
//
// It should never render: `ChapterRenderer` guards on `Platform.OS === "web"`.
// Throwing makes a wiring mistake loud instead of shipping a blank screen.
import type { ImportedChapter } from "@/types/book";

export function NativeChapterReader(_props: { chapter: ImportedChapter }): never {
  throw new Error(
    "NativeChapterReader is web-only. Native must render ChapterRenderer's WebView path.",
  );
}
