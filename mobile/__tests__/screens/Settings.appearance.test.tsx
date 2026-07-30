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

it("shows a tile for every theme and applies one on tap", async () => {
  render(<ThemeProvider><SettingsScreen /></ThemeProvider>);
  // all five tiles present
  for (const label of ["Study", "Manuscript", "Reading", "Gilded Noir", "Forest & Moss"]) {
    expect(await screen.findByLabelText(new RegExp(`Theme: ${label}`))).toBeTruthy();
  }
  fireEvent.press(screen.getByLabelText(/Theme: Forest & Moss/));
  await waitFor(() => expect(saveThemeName).toHaveBeenCalledWith("forest-moss"));
});

it("colours each tile's caption from that tile's OWN palette, not the active theme", async () => {
  // Active theme = study (default). A light tile (Manuscript) must render its
  // caption in its own textSecondary, else the label collapses to near-invisible
  // on the light tile background.
  render(<ThemeProvider><SettingsScreen /></ThemeProvider>);
  const manuscript = await screen.findByText("Manuscript");
  expect(flatColor(manuscript.props.style)).toBe(themes.manuscript.textSecondary);
  const noir = screen.getByText("Gilded Noir");
  expect(flatColor(noir.props.style)).toBe(themes["gilded-noir"].textSecondary);
  // sanity: they differ from the active (study) theme's textSecondary
  expect(themes.manuscript.textSecondary).not.toBe(themes.study.textSecondary);
});
