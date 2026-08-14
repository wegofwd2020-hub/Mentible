/** @jest-environment jsdom */
// registerWebFonts() (web-only) injects a single idempotent <style> tag with
// weight-synthesizing @font-face rules for the canonical families the theme's
// web CSS font stacks name (Inter / Fraunces / Source Serif 4 / OpenDyslexic),
// plus a low-priority default so react-native-web Text without an explicit
// fontFamily renders Inter. See docs/superpowers/specs/2026-08-14-web-fonts-design.md.
//
// Font modules + expo-asset are mocked so the emitted URIs are deterministic —
// we assert on the injected CSS text, not real font loading.
jest.mock("expo-asset", () => ({
  Asset: {
    fromModule: (mod: unknown) => ({ uri: `/mock-fonts/${String(mod)}.ttf` }),
  },
}));

jest.mock("@expo-google-fonts/inter", () => ({
  Inter_400Regular: "Inter_400Regular",
  Inter_500Medium: "Inter_500Medium",
  Inter_600SemiBold: "Inter_600SemiBold",
  Inter_700Bold: "Inter_700Bold",
}));

jest.mock("@expo-google-fonts/fraunces", () => ({
  Fraunces_400Regular: "Fraunces_400Regular",
  Fraunces_600SemiBold: "Fraunces_600SemiBold",
  Fraunces_700Bold: "Fraunces_700Bold",
  Fraunces_400Regular_Italic: "Fraunces_400Regular_Italic",
  Fraunces_600SemiBold_Italic: "Fraunces_600SemiBold_Italic",
}));

jest.mock("@expo-google-fonts/source-serif-4", () => ({
  SourceSerif4_400Regular: "SourceSerif4_400Regular",
  SourceSerif4_600SemiBold: "SourceSerif4_600SemiBold",
  SourceSerif4_700Bold: "SourceSerif4_700Bold",
}));

// react-native-web's Text/TextInput are forwardRef components exposing a
// patchable `.render` — that shape isn't guaranteed under the native
// react-native package this jsdom test otherwise resolves, so fake it here
// with the same shape (React.forwardRef) and a render that returns a real
// element (needed for React.cloneElement inside the interceptor).
jest.mock("react-native", () => {
  const actualReactNative = jest.requireActual("react-native");
  const actualReact = jest.requireActual("react");
  const forwardRefComponent = (displayName: string) =>
    actualReact.forwardRef((props: Record<string, unknown>, _ref: unknown) =>
      actualReact.createElement(displayName, props),
    );
  const overrides: Record<string, unknown> = {
    Text: forwardRefComponent("Text"),
    TextInput: forwardRefComponent("TextInput"),
  };
  // A Proxy (not a spread) so every other export — Platform, FlatList, etc.,
  // several of which are lazy getters that eagerly explode under jsdom if
  // forced — stays exactly as real react-native provides it.
  return new Proxy(actualReactNative, {
    get(target, prop, receiver) {
      if (typeof prop === "string" && prop in overrides) return overrides[prop];
      return Reflect.get(target, prop, receiver);
    },
  });
});

import { Text, TextInput } from "react-native";
import { registerWebFonts, installWebTextFontInterceptor } from "../../src/lib/webFonts.web";

const STYLE_ID = "mentible-web-fonts";

// Invokes a forwardRef component's current (possibly patched) `.render` the
// same way React itself would — positional (props, ref).
function renderWith(Component: unknown, props: Record<string, unknown>) {
  return (Component as { render: (props: unknown, ref: unknown) => unknown }).render(
    props,
    null,
  );
}

// Parses the injected stylesheet text into a list of @font-face blocks with
// their family/weight/style, plus the leftover (non-@font-face) text.
function parseFaces(css: string) {
  const faces: { family?: string; weight?: string; style?: string; body: string }[] = [];
  const re = /@font-face\s*\{([^}]*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(css))) {
    const body = match[1];
    faces.push({
      family: /font-family:\s*["']?([^;"']+)["']?\s*;/.exec(body)?.[1]?.trim(),
      weight: /font-weight:\s*([^;]+)\s*;/.exec(body)?.[1]?.trim(),
      style: /font-style:\s*([^;]+)\s*;/.exec(body)?.[1]?.trim(),
      body,
    });
  }
  const rest = css.replace(re, "");
  return { faces, rest };
}

// Runs BEFORE the registerWebFonts describe below (Jest executes `it`s in
// declaration order) so the very first assertion here sees Text/TextInput's
// pristine, un-patched .render — registerWebFonts() itself calls
// installWebTextFontInterceptor(), which would otherwise have already
// patched them by the time a later block ran this check.
describe("installWebTextFontInterceptor (web)", () => {
  it("patches Text.render and TextInput.render with an idempotent sentinel", () => {
    const beforeText = (Text as { render?: unknown }).render;
    const beforeTextInput = (TextInput as { render?: unknown }).render;
    installWebTextFontInterceptor();
    expect((Text as { render?: unknown }).render).not.toBe(beforeText);
    expect((TextInput as { render?: unknown }).render).not.toBe(beforeTextInput);

    // A second install must not double-wrap (mirrors applyGlobalFont's sentinel).
    const afterFirst = (Text as { render?: unknown }).render;
    installWebTextFontInterceptor();
    expect((Text as { render?: unknown }).render).toBe(afterFirst);
  });

  it("assigns Inter to an un-styled Text element", () => {
    installWebTextFontInterceptor();
    const el = renderWith(Text, { children: "Your account syncs…" }) as {
      props: { style?: unknown[] };
    };
    const flat = Object.assign({}, ...(el.props.style as Record<string, unknown>[]));
    expect(flat.fontFamily).toBe("Inter_400Regular");
    expect(flat.fontWeight).toBe("normal");
  });

  it("leaves an explicit icon family untouched (no fontFamily override added)", () => {
    installWebTextFontInterceptor();
    const el = renderWith(Text, {
      style: { fontFamily: "Ionicons", fontSize: 20 },
    }) as { props: { style: unknown } };
    // resolveFamilyForStyle returns null for icon fonts, so the interceptor
    // must return the element from the wrapped render unmodified — not a
    // cloneElement with an appended style entry.
    expect(el.props.style).toEqual({ fontFamily: "Ionicons", fontSize: 20 });
  });
});

describe("registerWebFonts (web)", () => {
  afterEach(() => {
    document.getElementById(STYLE_ID)?.remove();
  });

  it("injects a <style id='mentible-web-fonts'> into document.head", () => {
    registerWebFonts();
    const style = document.getElementById(STYLE_ID);
    expect(style).not.toBeNull();
    expect(style?.tagName).toBe("STYLE");
    expect(style?.parentElement).toBe(document.head);
  });

  it("declares Inter 400/500/600/700 @font-face rules with a bundled src", () => {
    registerWebFonts();
    const css = document.getElementById(STYLE_ID)?.textContent ?? "";
    const { faces } = parseFaces(css);
    for (const weight of ["400", "500", "600", "700"]) {
      const face = faces.find((f) => f.family === "Inter" && f.weight === weight);
      expect(face).toBeDefined();
      expect(face?.body).toMatch(/font-display:\s*swap/);
      expect(face?.body).toMatch(/src:\s*url\(["']?\/mock-fonts\/Inter_/);
    }
  });

  it("declares Fraunces 400/600/700 upright + 400/600 italic @font-face rules", () => {
    registerWebFonts();
    const css = document.getElementById(STYLE_ID)?.textContent ?? "";
    const { faces } = parseFaces(css);
    for (const weight of ["400", "600", "700"]) {
      expect(
        faces.find((f) => f.family === "Fraunces" && f.weight === weight && f.style !== "italic"),
      ).toBeDefined();
    }
    for (const weight of ["400", "600"]) {
      expect(
        faces.find((f) => f.family === "Fraunces" && f.weight === weight && f.style === "italic"),
      ).toBeDefined();
    }
  });

  it("declares Source Serif 4 400/600/700 @font-face rules", () => {
    registerWebFonts();
    const css = document.getElementById(STYLE_ID)?.textContent ?? "";
    const { faces } = parseFaces(css);
    for (const weight of ["400", "600", "700"]) {
      expect(faces.find((f) => f.family === "Source Serif 4" && f.weight === weight)).toBeDefined();
    }
  });

  it("declares OpenDyslexic @font-face rules", () => {
    registerWebFonts();
    const css = document.getElementById(STYLE_ID)?.textContent ?? "";
    const { faces } = parseFaces(css);
    expect(faces.some((f) => f.family === "OpenDyslexic")).toBe(true);
  });

  it("sets a default rule that resolves un-styled text to Inter, without !important", () => {
    registerWebFonts();
    const css = document.getElementById(STYLE_ID)?.textContent ?? "";
    const { rest } = parseFaces(css);
    expect(rest).toMatch(/font-family:\s*["']?Inter["']?/);
    expect(css).not.toMatch(/!important/);
  });

  it("is idempotent — a second call does not append a second style tag", () => {
    registerWebFonts();
    registerWebFonts();
    expect(document.head.querySelectorAll(`#${STYLE_ID}`).length).toBe(1);
  });
});
