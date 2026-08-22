import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";

jest.mock("../../src/secure/keyStore", () => ({
  loadApiKey: jest.fn(async () => null), saveApiKey: jest.fn(), deleteApiKey: jest.fn(),
  maskApiKey: (k: string) => k, isValidApiKey: () => true,
}));
jest.mock("../../src/auth/AuthProvider", () => ({ useAuth: () => ({ status: "unavailable", session: null }) }));
jest.mock("@/theme/themeStore", () => ({ loadThemeName: jest.fn(async () => null), saveThemeName: jest.fn(async () => {}) }));
import { saveThemeName } from "@/theme/themeStore";

import { ThemeProvider } from "@/theme";
import { themes } from "@/constants/theme";
import SettingsScreen from "../../app/(tabs)/settings";

function flatColor(style: unknown): string | undefined {
  const arr = Array.isArray(style) ? style : [style];
  for (const s of arr.reverse()) {
    if (s && typeof s === "object" && "color" in s) return (s as { color?: string }).color;
  }
  return undefined;
}

beforeEach(() => jest.clearAllMocks());

it("shows a tile for Navy Trust + the switchable Studio themes and applies one on tap", async () => {
  render(<ThemeProvider><SettingsScreen /></ThemeProvider>);
  // switcher = Navy Trust (default) + the Studio themes (P0 studio re-skin)
  for (const label of ["Navy Trust", "Studio", "Studio Light"]) {
    expect(await screen.findByLabelText(new RegExp(`^Theme: ${label}( \\(selected\\))?$`))).toBeTruthy();
  }
  // old exotic palettes stay defined but are no longer offered in the switcher
  for (const label of ["Manuscript", "Reading", "Gilded Noir", "Forest & Moss"]) {
    expect(screen.queryByLabelText(new RegExp(`^Theme: ${label}`))).toBeNull();
  }
  fireEvent.press(screen.getByLabelText(/^Theme: Studio Light( \(selected\))?$/));
  await waitFor(() => expect(saveThemeName).toHaveBeenCalledWith("studio-light"));
});

it("colours each tile's caption from that tile's OWN palette, not the active theme", async () => {
  // Active theme = navy-trust (default). The dark tile (Studio) must
  // render its caption in its own textSecondary, else the label collapses to
  // near-invisible on the dark tile background.
  render(<ThemeProvider><SettingsScreen /></ThemeProvider>);
  const studioLight = await screen.findByText("Studio Light");
  expect(flatColor(studioLight.props.style)).toBe(themes["studio-light"].textSecondary);
  const studio = screen.getByText("Studio");
  expect(flatColor(studio.props.style)).toBe(themes["studio-dark"].textSecondary);
  // sanity: they differ from each other
  expect(themes["studio-light"].textSecondary).not.toBe(themes["studio-dark"].textSecondary);
});
