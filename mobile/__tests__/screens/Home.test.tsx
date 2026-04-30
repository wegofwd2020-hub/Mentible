import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";

// Module mocks must be declared before the component import.
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
  // In tests there is no navigation lifecycle, so invoke the callback immediately.
  useFocusEffect: (cb: () => void) => { cb(); },
}));

jest.mock("../../src/api/client", () => ({
  submitGenerate: jest.fn(),
}));

jest.mock("../../src/secure/keyStore", () => ({
  loadApiKey: jest.fn(),
}));

jest.mock("../../src/storage/lessonStore", () => ({
  loadLastLesson: jest.fn(),
  saveLastLesson: jest.fn(),
}));

jest.mock("../../src/components/LevelPicker", () => {
  const { View, Text } = require("react-native");
  return {
    LevelPicker: ({ value }: { value: string }) => (
      <View testID="level-picker">
        <Text>{value}</Text>
      </View>
    ),
  };
});

const { submitGenerate } = require("../../src/api/client") as { submitGenerate: jest.Mock };
const { loadApiKey } = require("../../src/secure/keyStore") as { loadApiKey: jest.Mock };
const { loadLastLesson } = require("../../src/storage/lessonStore") as { loadLastLesson: jest.Mock };

import HomeScreen from "../../app/(tabs)/index";

beforeEach(() => {
  jest.clearAllMocks();
  loadLastLesson.mockResolvedValue(null);
});

describe("HomeScreen", () => {
  it("renders topic input and generate button", async () => {
    loadApiKey.mockResolvedValue("sk-ant-FAKE_KEY_test_12345");
    render(<HomeScreen />);
    expect(screen.getByLabelText("Topic input")).toBeTruthy();
    expect(screen.getByLabelText("Generate lesson")).toBeTruthy();
  });

  it("shows key-not-set banner when no API key is stored", async () => {
    loadApiKey.mockResolvedValue(null);
    render(<HomeScreen />);
    await waitFor(() => {
      expect(screen.getByText(/No API key set/)).toBeTruthy();
    });
  });

  it("generate button is disabled when topic is empty", async () => {
    loadApiKey.mockResolvedValue("sk-ant-FAKE_KEY_test_12345");
    render(<HomeScreen />);
    const btn = screen.getByLabelText("Generate lesson");
    expect(btn.props.accessibilityState.disabled).toBe(true);
  });

  it("generate button is enabled when topic is filled and key exists", async () => {
    loadApiKey.mockResolvedValue("sk-ant-FAKE_KEY_test_12345");
    render(<HomeScreen />);
    const input = screen.getByLabelText("Topic input");
    fireEvent.changeText(input, "Photosynthesis");
    await waitFor(() => {
      const btn = screen.getByLabelText("Generate lesson");
      expect(btn.props.accessibilityState.disabled).toBe(false);
    });
  });

  it("calls submitGenerate with correct params on tap", async () => {
    loadApiKey.mockResolvedValue("sk-ant-FAKE_KEY_test_12345");
    submitGenerate.mockResolvedValue({ job_id: "job-1", status: "queued" });

    render(<HomeScreen />);
    fireEvent.changeText(screen.getByLabelText("Topic input"), "Quadratic formula");
    fireEvent.press(screen.getByLabelText("Generate lesson"));

    await waitFor(() => {
      expect(submitGenerate).toHaveBeenCalledWith(
        expect.objectContaining({
          topic: "Quadratic formula",
          format: "lesson",
          api_key: "sk-ant-FAKE_KEY_test_12345",
        }),
      );
    });
  });

  it("shows last lesson card when a lesson was previously cached", async () => {
    loadApiKey.mockResolvedValue("sk-ant-FAKE_KEY_test_12345");
    loadLastLesson.mockResolvedValue({
      jobId: "job-prev",
      savedAt: "2026-04-25T10:00:00.000Z",
      lesson: {
        topic: "TCP three-way handshake",
        level: "student",
        language: "en",
        synopsis: "...",
        learning_objectives: [],
        sections: [],
        key_takeaways: [],
        further_reading: [],
      },
    });

    render(<HomeScreen />);
    await waitFor(() => {
      expect(screen.getByText("TCP three-way handshake")).toBeTruthy();
    });
  });
});
