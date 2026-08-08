import React from "react";
import { Text } from "react-native";
import { render, screen, waitFor } from "@testing-library/react-native";
import { ThemeProvider, useThemeControls } from "@/theme";
import { SWITCHABLE_THEMES, themes } from "@/constants/theme";

jest.mock("@/theme/themeStore", () => ({
  loadThemeName: jest.fn(async () => null),
  saveThemeName: jest.fn(async () => {}),
}));

function Probe() {
  const { themeName } = useThemeControls();
  return <Text testID="name">{themeName}</Text>;
}

it("defaults to studio-dark before any stored value loads", async () => {
  render(<ThemeProvider><Probe /></ThemeProvider>);
  await waitFor(() => expect(screen.getByTestId("name").props.children).toBe("studio-dark"));
});

it("switcher lists only the two Studio themes, both real", () => {
  expect(SWITCHABLE_THEMES).toEqual(["studio-dark", "studio-light"]);
  for (const n of SWITCHABLE_THEMES) expect(themes[n]).toBeDefined();
});
