import React from "react";
import { Text } from "react-native";
import { render, screen, waitFor, act } from "@testing-library/react-native";
import { ThemeProvider, useTheme, useThemeControls } from "@/theme";
import { themes } from "@/constants/theme";

jest.mock("@/theme/themeStore", () => ({
  loadThemeName: jest.fn(async () => null),
  saveThemeName: jest.fn(async () => {}),
}));
import { loadThemeName, saveThemeName } from "@/theme/themeStore";

function Probe() {
  const c = useTheme();
  const { themeName, setTheme } = useThemeControls();
  return (
    <>
      <Text testID="name">{themeName}</Text>
      <Text testID="bg">{c.background}</Text>
      <Text testID="switch" onPress={() => setTheme("forest-moss")}>go</Text>
    </>
  );
}

beforeEach(() => jest.clearAllMocks());

it("defaults to study when nothing is persisted", async () => {
  render(<ThemeProvider><Probe /></ThemeProvider>);
  await waitFor(() => expect(screen.getByTestId("name").props.children).toBe("study"));
  expect(screen.getByTestId("bg").props.children).toBe(themes.study.background);
});

it("loads a persisted theme on mount", async () => {
  (loadThemeName as jest.Mock).mockResolvedValueOnce("gilded-noir");
  render(<ThemeProvider><Probe /></ThemeProvider>);
  await waitFor(() => expect(screen.getByTestId("name").props.children).toBe("gilded-noir"));
  expect(screen.getByTestId("bg").props.children).toBe(themes["gilded-noir"].background);
});

it("setTheme updates the palette and persists", async () => {
  render(<ThemeProvider><Probe /></ThemeProvider>);
  await waitFor(() => expect(screen.getByTestId("name").props.children).toBe("study"));
  act(() => { screen.getByTestId("switch").props.onPress(); });
  await waitFor(() => expect(screen.getByTestId("bg").props.children).toBe(themes["forest-moss"].background));
  expect(saveThemeName).toHaveBeenCalledWith("forest-moss");
});

it("useTheme falls back to Study with no provider (compat shim)", () => {
  render(<Probe />);
  expect(screen.getByTestId("bg").props.children).toBe(themes.study.background);
});
