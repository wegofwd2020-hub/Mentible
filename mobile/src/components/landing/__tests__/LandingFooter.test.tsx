import { render, fireEvent } from "@testing-library/react-native";
const mockPush = jest.fn();
jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush }) }));
import { LandingFooter, OPERATOR_NAME, CONTACT_PLACEHOLDER } from "@/components/landing/LandingFooter";

beforeEach(() => mockPush.mockClear());

test("shows the operator name and a placeholder contact, never an invented address", () => {
  const { getByText, queryByText } = render(<LandingFooter />);
  expect(getByText(new RegExp(OPERATOR_NAME))).toBeTruthy();
  expect(getByText(CONTACT_PLACEHOLDER)).toBeTruthy();
  expect(queryByText(/@/)).toBeNull();
});

test("legal links are labelled as drafts and route to the draft pages", () => {
  const { getByText } = render(<LandingFooter />);
  fireEvent.press(getByText("Privacy policy (draft)"));
  expect(mockPush).toHaveBeenLastCalledWith("/legal/privacy");
  fireEvent.press(getByText("Terms of use (draft)"));
  expect(mockPush).toHaveBeenLastCalledWith("/legal/terms");
});
