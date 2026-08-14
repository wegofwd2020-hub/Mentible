import React from "react";
import { Text, processColor } from "react-native";
import { render, screen } from "@testing-library/react-native";
import { AppBackground } from "@/components/AppBackground";
import { ThemeContext } from "@/theme/ThemeProvider";
import { studioDarkColors, studioLightColors } from "@/constants/theme";

function flatten(style: unknown): Record<string, unknown> {
  return Object.assign({}, ...(Array.isArray(style) ? style.flat(Infinity) : [style]).filter(Boolean));
}

// RNTL's rendered tree shows LinearGradient's `colors` prop after react-native's
// native color processing (hex string -> packed int32), not the raw hex — so
// compare against `processColor(...)`, the same conversion RN itself applies.
function processed(hexes: string[]) {
  return hexes.map((h) => processColor(h));
}

describe("AppBackground", () => {
  it("renders its children", () => {
    render(
      <AppBackground>
        <Text>hello</Text>
      </AppBackground>,
    );
    expect(screen.getByText("hello")).toBeTruthy();
  });

  it("gradient runs from the theme's background to its bgGradientEnd (light)", () => {
    const tree = render(
      <ThemeContext.Provider
        value={{ theme: studioLightColors, themeName: "studio-light", setTheme: () => {} }}
      >
        <AppBackground>
          <Text>x</Text>
        </AppBackground>
      </ThemeContext.Provider>,
    ).toJSON();
    // react-native-web/native both surface the LinearGradient's `colors` prop
    // on the rendered node in test output.
    const node = tree as any;
    const colorsProp = node?.props?.colors ?? flatten(node?.props?.style)?.colors;
    expect(colorsProp).toEqual(processed([studioLightColors.background, studioLightColors.bgGradientEnd as string]));
  });

  it("gradient falls back to a flat fill when a palette has no bgGradientEnd", () => {
    const flatTheme = { ...studioDarkColors, bgGradientEnd: undefined };
    const tree = render(
      <ThemeContext.Provider value={{ theme: flatTheme as any, themeName: "studio-dark", setTheme: () => {} }}>
        <AppBackground>
          <Text>x</Text>
        </AppBackground>
      </ThemeContext.Provider>,
    ).toJSON();
    const node = tree as any;
    const colorsProp = node?.props?.colors;
    expect(colorsProp).toEqual(processed([flatTheme.background, flatTheme.background]));
  });
});
