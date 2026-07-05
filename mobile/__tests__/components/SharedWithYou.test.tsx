import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { SharedWithYou } from "@/components/SharedWithYou";

jest.mock("@/api/client", () => ({ sharedWithMe: jest.fn() }));
const mockPush = jest.fn();
const mockFocus: { run: (() => void) | null } = { run: null };
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush }),
  useFocusEffect: (cb: () => void) => {
    const R = require("react");
    mockFocus.run = cb;
    R.useEffect(() => {
      cb();
    }, [cb]);
  },
}));
import * as api from "@/api/client";

beforeEach(() => {
  jest.clearAllMocks();
  (api.sharedWithMe as jest.Mock).mockResolvedValue([
    { book_id: "b1", title: "Shared Book", owner_sub: "o", version: "1.0", updated_at: "" },
  ]);
});

it("renders nothing when signed out", () => {
  expect(render(<SharedWithYou token={null} />).toJSON()).toBeNull();
});

it("renders nothing when the shared list is empty", async () => {
  (api.sharedWithMe as jest.Mock).mockResolvedValue([]);
  render(<SharedWithYou token="tok" />);
  await waitFor(() => expect(api.sharedWithMe).toHaveBeenCalled());
  expect(screen.queryByText(/Shared with you/i)).toBeNull();
});

it("navigates to the full-screen reader when a draft is tapped", async () => {
  render(<SharedWithYou token="tok" />);
  fireEvent.press(await screen.findByLabelText("Open shared draft: Shared Book"));
  expect(mockPush).toHaveBeenCalledWith("/book/shared/b1");
});
