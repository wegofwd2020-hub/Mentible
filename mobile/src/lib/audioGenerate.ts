import * as FileSystem from "expo-file-system";
import type { Book, TopicAudio } from "@/types/book";
import { attachAudio } from "@/storage/mediaStore";
import { makeAudio, type MakeAudioRequest } from "@/api/derivativesClient";

export class AudioGenerateError extends Error {}

export interface GenerateAndStoreAudioArgs {
  book: Book;
  topicId: string;
  // Exactly one of source_text / topic_version_id — the caller (the future
  // rung-4 "narrate this topic" action) enforces that, this fn just forwards it.
  source_text?: string;
  topic_version_id?: string;
  tone?: string;
  voice?: string;
  provider_id?: string; // default "openai" (makeAudio's own default) if omitted
  // Omit entirely (never pass "") for a keyless managed-plan request — the
  // backend resolves the vendor key from the caller's entitlement instead.
  apiKey?: string;
}

export interface GenerateAndStoreAudioResult {
  // The updated book, ready for the caller to persist (this fn never
  // mutates/persists args.book itself — attachAudio returns a copy).
  book: Book;
  audio: TopicAudio;
}

/**
 * Calls the shipped P4 /derivatives/audio endpoint and persists the returned
 * clip into the topic's media dir + a TopicAudio ref (ADR-040 rung 2, D2). No
 * UI here — the button that calls this is rung 4. Fail-open: any failure
 * (network, write) throws AudioGenerateError and args.book is left untouched
 * (attachAudio is copy-on-write, so a failure never corrupts the caller's book).
 */
export async function generateAndStoreTopicAudio(
  args: GenerateAndStoreAudioArgs,
): Promise<GenerateAndStoreAudioResult> {
  const { book, topicId, source_text, topic_version_id, tone, voice, provider_id, apiKey } = args;

  let res;
  try {
    res = await makeAudio({
      ...(topic_version_id ? { topic_version_id } : { source_text }),
      ...(tone ? { tone } : {}),
      ...(voice ? { voice } : {}),
      // Never send api_key: "" — omit the field entirely for a keyless
      // (managed-plan) request, mirrors useMakeAudio.
      ...(apiKey ? { api_key: apiKey } : {}),
      ...(provider_id ? { provider_id } : {}),
    } as MakeAudioRequest);
  } catch (err) {
    throw new AudioGenerateError(
      err instanceof Error ? err.message : "Could not generate narration.",
    );
  }

  // The P4 TTS engine (backend/src/derivatives/tts.py) produces MP3 only today.
  const tmpUri = `${FileSystem.cacheDirectory}audio-gen-${topicId}-${Date.now()}.mp3`;
  try {
    await FileSystem.writeAsStringAsync(tmpUri, res.audio_base64, {
      encoding: FileSystem.EncodingType.Base64,
    });
    const nextBook = await attachAudio(
      book,
      topicId,
      { uri: tmpUri, mime: res.mime },
      { title: res.title, transcript: res.script },
    );
    const audio = nextBook.content![topicId]!.audio!.at(-1)!;
    return { book: nextBook, audio };
  } catch (err) {
    throw new AudioGenerateError(
      err instanceof Error ? err.message : "Could not save narration to this book.",
    );
  } finally {
    await FileSystem.deleteAsync(tmpUri, { idempotent: true }).catch(() => {});
  }
}
