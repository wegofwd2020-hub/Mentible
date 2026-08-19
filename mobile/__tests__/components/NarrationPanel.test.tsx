import React from "react";
import { render, fireEvent, waitFor } from "@testing-library/react-native";
import { NarrationPanel } from "@/components/NarrationPanel";

const mockGenStore = jest.fn(async (..._args: any[]) => ({ book: book2, audio: { id: "a1" } }));
jest.mock("@/lib/audioGenerate", () => ({
  generateAndStoreTopicAudio: (...a: any[]) => mockGenStore(...a),
  AudioGenerateError: class extends Error {},
}));
jest.mock("@/storage/bookStore", () => ({ saveBook: jest.fn(async () => {}) }));
jest.mock("@/storage/mediaStore", () => ({
  deleteAudio: jest.fn(async (b: any) => b),
  pruneOrphanMedia: jest.fn(async () => {}),
  resolveAudioDataUrls: jest.fn(async () => new Map()),
  MediaCapError: class extends Error {},
  MAX_AUDIO_PER_TOPIC: 5,
}));
jest.mock("@/components/AudioNarrationPlayer", () => ({ AudioNarrationPlayer: () => null }));
let mockPlanValue: any = { is_pro: false };
jest.mock("@/hooks/useBillingPlan", () => ({ useBillingPlan: () => ({ plan: mockPlanValue }) }));
const mockLoadApiKey = jest.fn(async (..._args: any[]): Promise<string | null> => "sk-openai");
jest.mock("@/secure/keyStore", () => ({ loadApiKey: (...a: any[]) => mockLoadApiKey(...a) }));

const lesson = { topic: "T", synopsis: "S", sections: [{ heading: "H", body_markdown: "B" }], key_takeaways: ["K"], learning_objectives: [], further_reading: [], level: "i", language: "en" };
const book: any = { id: "b", content: { u1: { topicId: "u1", title: "T", lesson, audio: [] } } };
const book2: any = { id: "b", content: { u1: { topicId: "u1", title: "T", lesson, audio: [{ id: "a1", file: "media/b/a1.mp3", mime: "audio/mpeg", title: "T" }] } } };

beforeEach(() => {
  mockGenStore.mockClear();
  mockLoadApiKey.mockClear();
  mockLoadApiKey.mockResolvedValue("sk-openai");
  mockPlanValue = { is_pro: false };
});

it("generate narration calls the engine with source_text + openai key, then persists", async () => {
  const onBookChange = jest.fn();
  const { getByLabelText } = render(<NarrationPanel book={book} topicId="u1" onBookChange={onBookChange} />);
  fireEvent.press(getByLabelText(/generate narration/i));
  await waitFor(() => expect(mockGenStore).toHaveBeenCalled());
  const arg = mockGenStore.mock.calls[0][0];
  expect(arg.provider_id).toBe("openai");
  expect(arg.apiKey).toBe("sk-openai");
  expect(typeof arg.source_text).toBe("string");
  expect(arg.source_text).toContain("S"); // from lessonToNarratableText
  await waitFor(() => expect(onBookChange).toHaveBeenCalledWith(book2));
});

it("a not-Pro user with no key is blocked (no engine call)", async () => {
  mockPlanValue = { is_pro: false }; mockLoadApiKey.mockResolvedValueOnce(null);
  const { getByLabelText } = render(<NarrationPanel book={book} topicId="u1" onBookChange={jest.fn()} />);
  fireEvent.press(getByLabelText(/generate narration/i));
  await waitFor(() => expect(mockLoadApiKey).toHaveBeenCalledWith("openai"));
  expect(mockGenStore).not.toHaveBeenCalled();
});

it("at the clip cap the generate button is disabled", () => {
  const full: any = { id: "b", content: { u1: { topicId: "u1", lesson, audio: Array.from({ length: 5 }, (_, i) => ({ id: `a${i}`, file: `media/b/a${i}.mp3`, mime: "audio/mpeg" })) } } };
  const { getByLabelText } = render(<NarrationPanel book={full} topicId="u1" onBookChange={jest.fn()} />);
  expect(getByLabelText(/generate narration/i).props.accessibilityState?.disabled).toBe(true);
});
