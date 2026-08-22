import { render, fireEvent } from "@testing-library/react-native";
const mockPush = jest.fn();
jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush }) }));
import { LandingHome } from "@/components/landing/LandingHome";

beforeEach(() => mockPush.mockClear());

test("hero shows headline, accent word, and honest subhead", () => {
  const { getByText, queryByText } = render(<LandingHome />);
  expect(getByText(/Turn expertise into/i)).toBeTruthy();
  expect(getByText(/trusted knowledge/i)).toBeTruthy();
  expect(getByText(/cited back to/i)).toBeTruthy();
  // honesty guardrails: no fabricated proof strings
  expect(queryByText(/review time/i)).toBeNull();
  expect(queryByText(/YouTube/i)).toBeNull();
});

test("approval card is labeled an Example and shows provenance", () => {
  const { getByText } = render(<LandingHome />);
  expect(getByText(/Example/i)).toBeTruthy();
  expect(getByText(/never hide who signed off/i)).toBeTruthy();
});

test("Formats lists only built exports", () => {
  const { getByText, queryByText } = render(<LandingHome />);
  ["EPUB", "PDF", "Carousel", "Audio"].forEach((f) => expect(getByText(new RegExp(f, "i"))).toBeTruthy());
  expect(queryByText(/Newsletter/i)).toBeNull();
});

test("primary CTA routes to work-with-me", () => {
  const { getByText } = render(<LandingHome />);
  fireEvent.press(getByText(/Book a 30-minute conversation/i));
  expect(mockPush).toHaveBeenCalledWith("/work-with-me");
});
