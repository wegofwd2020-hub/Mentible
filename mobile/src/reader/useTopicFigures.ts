import { useEffect, useState } from "react";
import type { GeneratedTopic } from "@/types/book";
import { resolveFigureDataUrls } from "@/storage/mediaStore";

/** Resolve a topic's attached images to a data:URL map for rendering. */
export function useTopicFigures(topic: GeneratedTopic | null | undefined): Map<string, string> {
  const [urls, setUrls] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    let live = true;
    if (!topic?.images?.length) { setUrls(new Map()); return; }
    resolveFigureDataUrls(topic).then((m) => { if (live) setUrls(m); });
    return () => { live = false; };
  }, [topic]);
  return urls;
}
