import { render } from "@testing-library/react-native";
import { Text } from "react-native";
import { ThemeProvider, useThemeControls } from "@/theme/ThemeProvider";
import { SWITCHABLE_THEMES } from "@/constants/theme";

// `useThemeName` doesn't exist on ThemeProvider; the real accessor for the
// current theme name is `useThemeControls().themeName` (see ThemeProvider.tsx).
function Probe() {
  const { themeName } = useThemeControls();
  return <Text testID="name">{themeName}</Text>;
}

test("app defaults to navy-trust for a new/unset user", () => {
  const { getByTestId } = render(<ThemeProvider><Probe /></ThemeProvider>);
  expect(getByTestId("name").props.children).toBe("navy-trust");
});

test("navy-trust is offered in the theme switcher", () => {
  expect(SWITCHABLE_THEMES).toContain("navy-trust");
});
