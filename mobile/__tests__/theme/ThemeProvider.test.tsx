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
      <Text testID="switch-dark" onPress={() => setTheme("studio-dark")}>dark</Text>
    </>
  );
}

beforeEach(() => jest.clearAllMocks());

it("defaults to navy-trust when nothing is persisted", async () => {
  render(<ThemeProvider><Probe /></ThemeProvider>);
  await waitFor(() => expect(screen.getByTestId("name").props.children).toBe("navy-trust"));
  expect(screen.getByTestId("bg").props.children).toBe(themes["navy-trust"].background);
});

it("a persisted studio-dark still wins over the navy-trust default", async () => {
  (loadThemeName as jest.Mock).mockResolvedValueOnce("studio-dark");
  render(<ThemeProvider><Probe /></ThemeProvider>);
  await waitFor(() => expect(screen.getByTestId("name").props.children).toBe("studio-dark"));
  expect(screen.getByTestId("bg").props.children).toBe(themes["studio-dark"].background);
});

it("loads a persisted theme on mount", async () => {
  (loadThemeName as jest.Mock).mockResolvedValueOnce("gilded-noir");
  render(<ThemeProvider><Probe /></ThemeProvider>);
  await waitFor(() => expect(screen.getByTestId("name").props.children).toBe("gilded-noir"));
  expect(screen.getByTestId("bg").props.children).toBe(themes["gilded-noir"].background);
});

it("setTheme updates the palette and persists", async () => {
  render(<ThemeProvider><Probe /></ThemeProvider>);
  await waitFor(() => expect(screen.getByTestId("name").props.children).toBe("navy-trust"));
  act(() => { screen.getByTestId("switch").props.onPress(); });
  await waitFor(() => expect(screen.getByTestId("bg").props.children).toBe(themes["forest-moss"].background));
  expect(saveThemeName).toHaveBeenCalledWith("forest-moss");
});

it("setTheme(\"studio-dark\") still switches away from the navy-trust default", async () => {
  render(<ThemeProvider><Probe /></ThemeProvider>);
  await waitFor(() => expect(screen.getByTestId("name").props.children).toBe("navy-trust"));
  act(() => { screen.getByTestId("switch-dark").props.onPress(); });
  await waitFor(() => expect(screen.getByTestId("name").props.children).toBe("studio-dark"));
  expect(screen.getByTestId("bg").props.children).toBe(themes["studio-dark"].background);
  expect(saveThemeName).toHaveBeenCalledWith("studio-dark");
});

it("useTheme falls back to Navy Trust with no provider (compat shim)", () => {
  render(<Probe />);
  expect(screen.getByTestId("bg").props.children).toBe(themes["navy-trust"].background);
});
