import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { FRAUNCES } from "@/constants/fonts";

jest.mock("../../src/secure/keyStore", () => ({
  loadApiKey: jest.fn(),
  saveApiKey: jest.fn(),
  deleteApiKey: jest.fn(),
  maskApiKey: (k: string) => `sk-ant-...${k.slice(-4)}`,
  isValidApiKey: (k: string) => k.startsWith("sk-ant-") && k.length >= 20,
}));

// Settings now reads useAuth; stub it (auth is covered by AuthProvider.test).
jest.mock("../../src/auth/AuthProvider", () => ({
  useAuth: () => ({ status: "unavailable", session: null }),
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

// Flattens an RN style (object | array | nested array) into a single object so
// tests can inspect the resolved fontFamily/fontWeight without caring how many
// style arrays a primitive wraps things in.
function flattenStyle(style: unknown): Record<string, unknown> {
  const arr = Array.isArray(style) ? style.flat(Infinity) : [style];
  return Object.assign({}, ...arr.filter(Boolean));
}

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
    const input = screen.getByLabelText("Paste Anthropic (Claude) API key");
    fireEvent.changeText(input, "sk-ant-FAKE_VALID_KEY_abcdef");
    fireEvent.press(screen.getByLabelText("Save API key"));

    await waitFor(() => {
      expect(saveApiKey).toHaveBeenCalledWith("sk-ant-FAKE_VALID_KEY_abcdef", "anthropic");
    });
  });

  it("does not save a key that does not start with sk-ant-", async () => {
    loadApiKey.mockResolvedValue(null);
    render(<SettingsScreen />);
    const input = screen.getByLabelText("Paste Anthropic (Claude) API key");
    fireEvent.changeText(input, "not-a-valid-key-at-all-here");
    fireEvent.press(screen.getByLabelText("Save API key"));

    await waitFor(() => {
      expect(saveApiKey).not.toHaveBeenCalled();
    });
  });

  it("renders row titles in Fraunces with no bold (700) weight — Studio re-skin", () => {
    loadApiKey.mockResolvedValue(null);
    render(<SettingsScreen />);
    // Row/section titles that survive the primitive sweep (auth is "unavailable"
    // here, so the Account row is hidden — these two always render).
    for (const text of ["Dyslexia-friendly font", "🎨 UI concept gallery"]) {
      const style = flattenStyle(screen.getByText(text).props.style);
      expect(style["fontFamily"]).toBe(FRAUNCES.semibold);
      expect(style["fontWeight"]).not.toBe("700");
      expect(style["fontWeight"]).not.toBe("600");
    }
  });

  it("renders section eyebrows via the Label primitive (uppercase, never bold)", () => {
    loadApiKey.mockResolvedValue(null);
    render(<SettingsScreen />);
    for (const text of ["Appearance", "Accessibility", "Prototypes"]) {
      const style = flattenStyle(screen.getByText(text).props.style);
      expect(style["textTransform"]).toBe("uppercase");
      expect(style["fontWeight"]).not.toBe("700");
      expect(style["fontWeight"]).not.toBe("600");
    }
  });
});
