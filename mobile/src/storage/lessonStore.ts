import AsyncStorage from "@react-native-async-storage/async-storage";
import type { LessonOutput } from "@/types/lesson";

const INDEX_KEY = "sbq_library_index";
const lessonKey = (jobId: string) => `sbq_lesson_${jobId}`;

export interface LessonMeta {
  jobId: string;
  topic: string;
  level: string;
  savedAt: string;
}

export interface StoredLesson {
  lesson: LessonOutput;
  jobId: string;
  savedAt: string;
}

export async function saveLesson(
  jobId: string,
  lesson: LessonOutput,
): Promise<void> {
  const savedAt = new Date().toISOString();
  const entry: StoredLesson = { lesson, jobId, savedAt };

  await AsyncStorage.setItem(lessonKey(jobId), JSON.stringify(entry));

  const index = await loadLibrary();
  const meta: LessonMeta = { jobId, topic: lesson.topic, level: lesson.level, savedAt };
  const deduped = index.filter((m) => m.jobId !== jobId);
  await AsyncStorage.setItem(INDEX_KEY, JSON.stringify([meta, ...deduped]));
}

export async function loadLibrary(): Promise<LessonMeta[]> {
  const raw = await AsyncStorage.getItem(INDEX_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as LessonMeta[];
  } catch {
    return [];
  }
}

export async function loadLesson(jobId: string): Promise<StoredLesson | null> {
  const raw = await AsyncStorage.getItem(lessonKey(jobId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredLesson;
  } catch {
    return null;
  }
}

export async function deleteLesson(jobId: string): Promise<void> {
  const index = await loadLibrary();
  await Promise.all([
    AsyncStorage.removeItem(lessonKey(jobId)),
    AsyncStorage.setItem(
      INDEX_KEY,
      JSON.stringify(index.filter((m) => m.jobId !== jobId)),
    ),
  ]);
}

export async function clearLibrary(): Promise<void> {
  const index = await loadLibrary();
  await Promise.all([
    ...index.map((m) => AsyncStorage.removeItem(lessonKey(m.jobId))),
    AsyncStorage.removeItem(INDEX_KEY),
  ]);
}

// Legacy aliases — used by existing screens until next refactor.
export const saveLastLesson = saveLesson;
export async function loadLastLesson(): Promise<StoredLesson | null> {
  const index = await loadLibrary();
  if (!index.length) return null;
  return loadLesson(index[0].jobId);
}
