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
import SettingsScreen from "../../app/(tabs)/settings";

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
