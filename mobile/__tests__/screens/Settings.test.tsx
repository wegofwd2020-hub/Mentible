import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";

jest.mock("../../src/secure/keyStore", () => ({
  loadApiKey: jest.fn(),
  saveApiKey: jest.fn(),
  deleteApiKey: jest.fn(),
  maskApiKey: (k: string) => `sk-ant-...${k.slice(-4)}`,
  isValidApiKey: (k: string) => k.startsWith("sk-ant-") && k.length >= 20,
}));

const {
  loadApiKey,
  saveApiKey,
  deleteApiKey,
} = require("../../src/secure/keyStore") as {
  loadApiKey: jest.Mock;
  saveApiKey: jest.Mock;
  deleteApiKey: jest.Mock;
};

import SettingsScreen from "../../app/(tabs)/settings";

beforeEach(() => {
  jest.clearAllMocks();
});

describe("SettingsScreen", () => {
  it("shows no-key message when nothing is stored", async () => {
    loadApiKey.mockResolvedValue(null);
    render(<SettingsScreen />);
    await waitFor(() => {
      expect(screen.getByText("No key saved")).toBeTruthy();
    });
  });

  it("shows masked key when one is already saved", async () => {
    loadApiKey.mockResolvedValue("sk-ant-FAKE_KEY_test_1234");
    render(<SettingsScreen />);
    await waitFor(() => {
      expect(screen.getByText("sk-ant-...1234")).toBeTruthy();
    });
  });

  it("save button is disabled when input is empty", () => {
    loadApiKey.mockResolvedValue(null);
    render(<SettingsScreen />);
    const btn = screen.getByLabelText("Save API key");
    expect(btn.props.accessibilityState.disabled).toBe(true);
  });

  it("calls saveApiKey on Save press with valid key", async () => {
    loadApiKey.mockResolvedValue(null);
    saveApiKey.mockResolvedValue(undefined);

    render(<SettingsScreen />);
    const input = screen.getByLabelText("Paste Anthropic API key");
    fireEvent.changeText(input, "sk-ant-FAKE_VALID_KEY_abcdef");
    fireEvent.press(screen.getByLabelText("Save API key"));

    await waitFor(() => {
      expect(saveApiKey).toHaveBeenCalledWith("sk-ant-FAKE_VALID_KEY_abcdef");
    });
  });

  it("does not save a key that does not start with sk-ant-", async () => {
    loadApiKey.mockResolvedValue(null);
    render(<SettingsScreen />);
    const input = screen.getByLabelText("Paste Anthropic API key");
    fireEvent.changeText(input, "not-a-valid-key-at-all-here");
    fireEvent.press(screen.getByLabelText("Save API key"));

    await waitFor(() => {
      expect(saveApiKey).not.toHaveBeenCalled();
    });
  });
});
