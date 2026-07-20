// The web chapter reader: an IMPORTED book's chapter rendered into the app's own
// DOM. Mirrors NativeTopicReader.web.tsx.
//
// Security: there is no iframe boundary here, so `renderChapterToSafeHtml` IS the
// boundary. Never inject anything into this subtree that has not been through it.
// Unlike a topic, a chapter is third-party HTML from a stranger's EPUB, and its
// sanitize pass is stricter: images resolve from the chapter's own map or are
// dropped, and every URI-bearing attribute is reduced to `data:`-only.

import React, { useMemo, useRef } from "react";
import { View, StyleSheet } from "react-native";
import type { ImportedChapter } from "@/types/book";
import { renderChapterToSafeHtml } from "@/reader/renderContent";
import { READER_CSS, READER_ROOT_CLASS } from "@/reader/readerStyles";
import { colors } from "@/constants/theme";

export function NativeChapterReader({ chapter }: { chapter: ImportedChapter }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const html = useMemo(() => renderChapterToSafeHtml(chapter), [chapter]);

  // NOTE: no `enhanceReaderNode` here. That pass runs KaTeX + Mermaid over the
  // node, which are for OUR generated topics. A third-party EPUB has no `$…$`
  // contract with us, and running KaTeX over arbitrary prose would corrupt
  // ordinary text that happens to contain dollar signs.
  return (
    <View style={styles.container}>
      <style data-mentible-reader="">{READER_CSS}</style>
      <div
        ref={ref}
        className={READER_ROOT_CLASS}
        // SAFE: `html` is the output of renderChapterToSafeHtml.
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
});
