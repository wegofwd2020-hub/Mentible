import { render, fireEvent } from "@testing-library/react-native";
import { StyleSheet } from "react-native";

// StudioHeader reads useSafeAreaInsets. No test in this repo renders such a
// component outside expo-router's own SafeAreaProvider wrapper, so — like
// SideNav/TopNavBar — this one needs the library's own jest mock wired in
// explicitly, or the hook throws ("No safe area value available…") outside a
// <SafeAreaProvider>.
jest.mock("react-native-safe-area-context", () => {
  const mock = require("react-native-safe-area-context/jest/mock");
  return mock.default ?? mock;
});

import { StudioHeader, kickerFor } from "@/components/StudioHeader";
import { PLAYFAIR } from "@/constants/fonts";

const props = (over: any = {}) => ({
  navigation: { goBack: jest.fn() } as any,
  route: { name: "trust/[projectId]", key: "k", params: {} } as any,
  options: { title: "Project" } as any,
  back: { title: "Reviews" } as any,
  ...over,
});

describe("StudioHeader", () => {
  it("renders the wordmark and the curated kicker for a mapped route", () => {
    const { getByText } = render(<StudioHeader {...props()} />);
    expect(getByText("MENTIBLE")).toBeTruthy();
    expect(getByText("PROJECT")).toBeTruthy(); // SECTION_KICKERS["trust/[projectId]"]
  });

  it("renders the wordmark in Playfair, never a raw bold weight", () => {
    const { getByText } = render(<StudioHeader {...props()} />);
    const wordmark = getByText("MENTIBLE");
    const flat = StyleSheet.flatten(wordmark.props.style);
    expect(flat.fontFamily).toBe(PLAYFAIR.medium);
    expect(flat.fontWeight).not.toBe("700");
  });

  it("falls back to the uppercased title for an unmapped route", () => {
    expect(kickerFor("some/unknown", "Widgets")).toBe("WIDGETS");
    expect(kickerFor("trust/new")).toBe("NEW PROJECT"); // mapped wins over title
  });

  it("shows a back control that calls goBack, and hides it when there is no back", () => {
    const goBack = jest.fn();
    const { getByLabelText, rerender, queryByLabelText } = render(
      <StudioHeader {...props({ navigation: { goBack } })} />
    );
    fireEvent.press(getByLabelText("Go back"));
    expect(goBack).toHaveBeenCalled();
    rerender(<StudioHeader {...props({ back: undefined })} />);
    expect(queryByLabelText("Go back")).toBeNull();
  });
});
