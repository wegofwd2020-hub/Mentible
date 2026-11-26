import { render, fireEvent } from "@testing-library/react-native";
const mockPush = jest.fn();
jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush }) }));
import { LandingFooter, OPERATOR_NAME, CONTACT_EMAIL } from "@/components/landing/LandingFooter";

beforeEach(() => mockPush.mockClear());

test("shows the operator name and the confirmed support contact address", () => {
  const { getByText, queryByText } = render(<LandingFooter />);
  expect(getByText(new RegExp(OPERATOR_NAME))).toBeTruthy();
  expect(getByText(CONTACT_EMAIL)).toBeTruthy();
  expect(CONTACT_EMAIL).toBe("support@kaundinyalabs.com");
  expect(queryByText(/pending owner confirmation/)).toBeNull();
});

test("legal links are labelled as drafts and route to the draft pages", () => {
  const { getByText } = render(<LandingFooter />);
  fireEvent.press(getByText("Privacy policy (draft)"));
  expect(mockPush).toHaveBeenLastCalledWith("/legal/privacy");
  fireEvent.press(getByText("Terms of use (draft)"));
  expect(mockPush).toHaveBeenLastCalledWith("/legal/terms");
});
