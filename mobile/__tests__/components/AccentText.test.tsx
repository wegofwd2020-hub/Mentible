import React from "react";
import { Text } from "react-native";
import { render } from "@testing-library/react-native";
import { AccentText } from "@/components/AccentText";
import { FRAUNCES_ITALIC } from "@/constants/fonts";

function flatFamily(node: { props: { style?: unknown } }): string | undefined {
  const s = Array.isArray(node.props.style)
    ? Object.assign({}, ...node.props.style.filter(Boolean))
    : (node.props.style as { fontFamily?: string } | undefined);
  return s?.fontFamily;
}

it("renders its word in the italic Fraunces family (no synthesised fontStyle)", () => {
  const { getByText } = render(<AccentText>projects</AccentText>);
  const node = getByText("projects");
  const s = Array.isArray(node.props.style)
    ? Object.assign({}, ...node.props.style.filter(Boolean))
    : node.props.style;
  expect(flatFamily(node)).toBe(FRAUNCES_ITALIC.semibold);
  // Slant comes from the italic family, never a fontStyle (which would double up on web).
  expect(s?.fontStyle).toBeUndefined();
});

it("works inline inside a heading, inheriting the parent's size/colour", () => {
  const { getByText } = render(
    <Text style={{ fontSize: 18, color: "#fff" }}>
      No <AccentText>projects</AccentText> yet.
    </Text>,
  );
  // The accent word is present and only overrides the family.
  expect(flatFamily(getByText("projects"))).toBe(FRAUNCES_ITALIC.semibold);
});
