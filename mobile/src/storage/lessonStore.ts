import AsyncStorage from "@react-native-async-storage/async-storage";
import type { LessonOutput } from "@/types/lesson";

const LAST_LESSON_KEY = "sbq_last_lesson";

export interface StoredLesson {
  lesson: LessonOutput;
  jobId: string;
  savedAt: string;
}

export async function saveLastLesson(
  jobId: string,
  lesson: LessonOutput,
): Promise<void> {
  const entry: StoredLesson = {
    lesson,
    jobId,
    savedAt: new Date().toISOString(),
  };
  await AsyncStorage.setItem(LAST_LESSON_KEY, JSON.stringify(entry));
}

export async function loadLastLesson(): Promise<StoredLesson | null> {
  const raw = await AsyncStorage.getItem(LAST_LESSON_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredLesson;
  } catch {
    return null;
  }
}

export async function clearLastLesson(): Promise<void> {
  await AsyncStorage.removeItem(LAST_LESSON_KEY);
}
