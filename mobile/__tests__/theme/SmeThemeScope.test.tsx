import React from "react";
import { Text } from "react-native";
import { render } from "@testing-library/react-native";
import { SmeThemeScope } from "@/theme/SmeThemeScope";
import { useTheme, useThemeControls } from "@/theme";
import { themes } from "@/constants/theme";

function ShowBg() {
  const theme = useTheme();
  return <Text>{theme.background}</Text>;
}

function ShowName() {
  const { themeName } = useThemeControls();
  return <Text>{themeName}</Text>;
}

it("forces the navy-trust palette inside the scope", () => {
  const { getByText } = render(
    <SmeThemeScope>
      <ShowBg />
    </SmeThemeScope>,
  );
  // navy-trust background, not the Study default that useTheme() returns bare.
  expect(getByText(themes["navy-trust"].background)).toBeTruthy();
  expect(themes["navy-trust"].background).not.toBe(themes.study.background);
});

it("reports themeName navy-trust inside the scope", () => {
  const { getByText } = render(
    <SmeThemeScope>
      <ShowName />
    </SmeThemeScope>,
  );
  expect(getByText("navy-trust")).toBeTruthy();
});
