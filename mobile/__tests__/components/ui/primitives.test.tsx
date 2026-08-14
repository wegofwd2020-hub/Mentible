import React from "react";
import { StyleSheet } from "react-native";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { ThemeProvider } from "@/theme";
import { themes } from "@/constants/theme";
import { Button, Card, Chip, Label } from "@/components/ui";

const t = themes["studio-light"];

function renderThemed(ui: React.ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>);
}

describe("Label", () => {
  it("renders uppercase text with a positive letter spacing", () => {
    renderThemed(<Label>hello world</Label>);
    const node = screen.getByText("hello world");
    const flat = StyleSheet.flatten(node.props.style);
    expect(flat.textTransform).toBe("uppercase");
    expect(flat.letterSpacing).toBeGreaterThan(0);
    expect(flat.fontWeight).not.toBe("700");
  });

  it("defaults to the muted tone color", () => {
    renderThemed(<Label>muted</Label>);
    const flat = StyleSheet.flatten(screen.getByText("muted").props.style);
    expect(flat.color).toBe(t.textMuted);
  });

  it("uses the secondary tone color when requested", () => {
    renderThemed(<Label tone="secondary">secondary</Label>);
    const flat = StyleSheet.flatten(screen.getByText("secondary").props.style);
    expect(flat.color).toBe(t.textSecondary);
  });
});

describe("Button", () => {
  it("variant=primary uses the theme primary fill and primaryText label color", () => {
    renderThemed(<Button variant="primary" label="Save" onPress={jest.fn()} />);
    const btn = screen.getByLabelText("Save");
    const btnFlat = StyleSheet.flatten(btn.props.style);
    expect(btnFlat.backgroundColor).toBe(t.primary);

    const label = screen.getByText("Save");
    const labelFlat = StyleSheet.flatten(label.props.style);
    expect(labelFlat.color).toBe(t.primaryText);
    expect(labelFlat.fontWeight).not.toBe("700");
  });

  it("variant=ghost is a transparent hairline", () => {
    renderThemed(<Button variant="ghost" label="Cancel" onPress={jest.fn()} />);
    const btn = screen.getByLabelText("Cancel");
    const btnFlat = StyleSheet.flatten(btn.props.style);
    expect([undefined, "transparent"]).toContain(btnFlat.backgroundColor);
    expect(btnFlat.borderWidth).toBe(1);
    expect(btnFlat.borderColor).toBe(t.borderLight);

    const label = screen.getByText("Cancel");
    const labelFlat = StyleSheet.flatten(label.props.style);
    expect(labelFlat.color).toBe(t.text);
  });

  it("busy disables the button, shows an ellipsis, and blocks onPress", () => {
    const onPress = jest.fn();
    renderThemed(<Button variant="primary" label="Save" busy onPress={onPress} accessibilityLabel="Save" />);
    const btn = screen.getByLabelText("Save");
    expect(btn.props.accessibilityState?.disabled).toBeTruthy();
    expect(screen.getByText("…")).toBeTruthy();
    fireEvent.press(btn);
    expect(onPress).not.toHaveBeenCalled();
  });

  it("disabled blocks onPress without busy", () => {
    const onPress = jest.fn();
    renderThemed(<Button variant="ghost" label="Nope" disabled onPress={onPress} />);
    const btn = screen.getByLabelText("Nope");
    expect(btn.props.accessibilityState?.disabled).toBeTruthy();
    fireEvent.press(btn);
    expect(onPress).not.toHaveBeenCalled();
  });

  it("fires onPress when enabled", () => {
    const onPress = jest.fn();
    renderThemed(<Button variant="primary" label="Go" onPress={onPress} />);
    fireEvent.press(screen.getByLabelText("Go"));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

describe("Card", () => {
  it("uses the surface/border role colors and lg radius", () => {
    const { toJSON } = renderThemed(
      <Card>
        <Label>inside</Label>
      </Card>,
    );
    const tree = toJSON() as unknown as { props: { style: unknown } };
    const flat = StyleSheet.flatten(tree.props.style as never) as {
      backgroundColor?: string;
      borderColor?: string;
      borderWidth?: number;
      borderRadius?: number;
    };
    expect(flat.backgroundColor).toBe(t.surface);
    expect(flat.borderColor).toBe(t.border);
    expect(flat.borderWidth).toBe(1);
    expect(flat.borderRadius).toBe(22);
  });
});

describe("Chip", () => {
  it("active differs from inactive", () => {
    renderThemed(
      <>
        <Chip label="Active" active />
        <Chip label="Inactive" />
      </>,
    );
    const activeFlat = StyleSheet.flatten(screen.getByText("Active").props.style);
    const inactiveFlat = StyleSheet.flatten(screen.getByText("Inactive").props.style);
    expect(activeFlat.color).toBe(t.primary);
    expect(inactiveFlat.color).not.toBe(t.primary);
  });
});
