import React from "react";
import { Dimensions, Text } from "react-native";
import { render, screen } from "@testing-library/react-native";
import { PageContainer } from "../../src/components/PageContainer";

function mockWidth(width: number) {
  jest
    .spyOn(Dimensions, "get")
    .mockReturnValue({ width, height: 800, scale: 1, fontScale: 1 });
}

function flatten(style: unknown): Record<string, unknown> {
  return Object.assign({}, ...(Array.isArray(style) ? style.flat(Infinity) : [style]).filter(Boolean));
}

afterEach(() => jest.restoreAllMocks());

describe("PageContainer", () => {
  it("renders its children", () => {
    mockWidth(390);
    render(
      <PageContainer>
        <Text>hello</Text>
      </PageContainer>,
    );
    expect(screen.getByText("hello")).toBeTruthy();
  });

  it("does not constrain width on a phone", () => {
    mockWidth(390);
    const tree = render(
      <PageContainer>
        <Text>x</Text>
      </PageContainer>,
    ).toJSON();
    const style = flatten((tree as any).props.style);
    expect(style.maxWidth).toBeUndefined();
    expect(style.alignSelf).toBeUndefined();
  });

  it("caps and centers width on a wide screen", () => {
    mockWidth(1440);
    const tree = render(
      <PageContainer maxWidth={900}>
        <Text>x</Text>
      </PageContainer>,
    ).toJSON();
    const style = flatten((tree as any).props.style);
    expect(style.maxWidth).toBe(900);
    expect(style.alignSelf).toBe("center");
  });
});
