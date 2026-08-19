import { useEffect, useState } from "react";
import type { GeneratedTopic } from "@/types/book";
import { resolveAudioDataUrls, resolveAudioFileUris } from "@/storage/mediaStore";

const EMPTY = { webUrls: new Map<string, string>(), fileUris: new Map<string, string>() };

/** Resolve a topic's audio to the maps the reader needs: web data: URIs (embedded
 *  in the <audio> src) and native file:// URIs (played by expo-audio, id-bridged). */
export function useTopicAudio(topic: GeneratedTopic | null | undefined) {
  const [urls, setUrls] = useState(EMPTY);
  useEffect(() => {
    let live = true;
    if (!topic?.audio?.length) { setUrls(EMPTY); return; }
    Promise.all([resolveAudioDataUrls(topic), resolveAudioFileUris(topic)]).then(([webUrls, fileUris]) => {
      if (live) setUrls({ webUrls, fileUris });
    }).catch(() => {
      // Resolution failed outright (shouldn't happen — both resolvers already
      // swallow per-clip errors — but defense in depth): degrade to "no
      // player" rather than an unhandled promise rejection.
      if (live) setUrls(EMPTY);
    });
    return () => { live = false; };
  }, [topic]);
  return urls;
}
