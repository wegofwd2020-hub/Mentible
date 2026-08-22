import { render } from "@testing-library/react-native";
jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn() }) }));
import Index from "@/../app/(tabs)/index";

test("/ renders the Landing Home, not a redirect", () => {
  const { getByText } = render(<Index />);
  expect(getByText(/Turn expertise into/i)).toBeTruthy();
});
