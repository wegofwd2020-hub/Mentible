import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { Linking } from "react-native";
import { BRAND_CONTACT, BRAND_NAME } from "@/constants/brand";
import { QUALITY_GATE_LIBS } from "@/constants/qualityGateLibs";

import AboutScreen from "../../app/(tabs)/about";

// Flattens an RN style (object | array | nested array) into a single object so
// tests can inspect the resolved fontFamily/fontWeight without caring how many
// style arrays a primitive wraps things in.
function flattenStyle(style: unknown): Record<string, unknown> {
  const arr = Array.isArray(style) ? style.flat(Infinity) : [style];
  return Object.assign({}, ...arr.filter(Boolean));
}

describe("AboutScreen", () => {
  it("renders the section eyebrows via the Label primitive (uppercase, never bold)", () => {
    render(<AboutScreen />);
    for (const text of ["About this app", "Privacy"]) {
      const style = flattenStyle(screen.getByText(text).props.style);
      expect(style["textTransform"]).toBe("uppercase");
      expect(style["fontWeight"]).not.toBe("700");
      expect(style["fontWeight"]).not.toBe("600");
    }
    // "Author" is ambiguous — it's both the section eyebrow and the row label
    // for BRAND_AUTHOR's value — so pick the uppercase (Label) one explicitly.
    const authorEyebrow = screen
      .getAllByText("Author")
      .map((el) => flattenStyle(el.props.style))
      .find((s) => s["textTransform"] === "uppercase");
    expect(authorEyebrow).toBeDefined();
    expect(authorEyebrow?.["fontWeight"]).not.toBe("700");
    expect(authorEyebrow?.["fontWeight"]).not.toBe("600");
  });

  it("retires the bold row-value weights to medium (500) — Studio re-skin", () => {
    render(<AboutScreen />);
    const appRow = flattenStyle(screen.getByText(BRAND_NAME).props.style);
    expect(appRow["fontWeight"]).toBe("500");
    const contactRow = flattenStyle(screen.getByText(BRAND_CONTACT).props.style);
    expect(contactRow["fontWeight"]).toBe("500");
  });

  it("keeps the Contact row as a raw pressable mailto link (behavior unchanged)", () => {
    const spy = jest.spyOn(Linking, "openURL").mockResolvedValue(undefined as never);
    render(<AboutScreen />);
    fireEvent.press(screen.getByLabelText(`Email ${BRAND_CONTACT}`));
    expect(spy).toHaveBeenCalledWith(`mailto:${BRAND_CONTACT}`);
    spy.mockRestore();
  });

  it("lists every quality-gate library with its name, version, and role", () => {
    render(<AboutScreen />);
    expect(screen.getByText("Quality-gate libraries")).toBeTruthy();
    for (const lib of QUALITY_GATE_LIBS) {
      // Each lib row exposes name + version + role via its accessibility label.
      expect(screen.getByLabelText(`${lib.name} ${lib.version} — ${lib.role}`)).toBeTruthy();
      expect(screen.getByText(lib.name)).toBeTruthy();
    }
    // The trust engine + the grounding LLM SDK are both credited.
    expect(screen.getByText("wegofwd-llm")).toBeTruthy();
    expect(screen.getByText("anthropic (SDK)")).toBeTruthy();
  });
});
