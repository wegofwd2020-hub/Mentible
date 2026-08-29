import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";

const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush }),
  useFocusEffect: (cb: () => void) => cb(),
}));

const mockLoadDefaultParams = jest.fn();
jest.mock("@/storage/settingsStore", () => ({
  loadDefaultParams: () => mockLoadDefaultParams(),
}));

const mockSummary = jest.fn();
jest.mock("@/storage/usageStore", () => ({
  listUsage: jest.fn().mockResolvedValue([]),
  summarizeUsage: () => mockSummary(),
}));

import { EngineBadge } from "@/components/EngineBadge";

beforeEach(() => {
  jest.clearAllMocks();
  mockLoadDefaultParams.mockResolvedValue({ provider: "anthropic" });
  mockSummary.mockReturnValue({ totalInputTokens: 1200, totalOutputTokens: 300 });
});

it("shows the active engine short label", async () => {
  render(<EngineBadge />);
  await waitFor(() => expect(screen.getByText(/⚙ Claude/)).toBeTruthy());
});

it("appends the device token count when there is usage", async () => {
  render(<EngineBadge />);
  await waitFor(() => expect(screen.getByText(/1\.5k tok/)).toBeTruthy());
});

it("omits the token count when there is none", async () => {
  mockSummary.mockReturnValue({ totalInputTokens: 0, totalOutputTokens: 0 });
  render(<EngineBadge />);
  await waitFor(() => expect(screen.getByText("⚙ Claude")).toBeTruthy());
});

it("tapping opens the Usage screen", async () => {
  render(<EngineBadge />);
  await waitFor(() => expect(screen.getByText(/⚙ Claude/)).toBeTruthy());
  fireEvent.press(screen.getByLabelText(/open usage/));
  expect(mockPush).toHaveBeenCalledWith("/usage");
});
