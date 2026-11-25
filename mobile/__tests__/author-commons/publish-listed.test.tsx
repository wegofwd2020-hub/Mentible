import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";

jest.mock("@/auth/AuthProvider", () => ({ useAuth: () => ({ accessToken: "tok" }) }));
jest.mock("@/storage/bookStore", () => ({ loadBook: jest.fn() }));
jest.mock("@/constants/demo", () => ({ demoBlocked: () => false }));
jest.mock("@/api/client", () => ({
  ApiError: class ApiError extends Error {},
  publishBook: jest.fn(),
}));

import { loadBook } from "@/storage/bookStore";
import { publishBook } from "@/api/client";
import { PublishButton } from "@/components/PublishButton";

beforeEach(() => {
  (loadBook as jest.Mock).mockResolvedValue({ id: "b1", title: "T" });
});

it("shows success when the book was listed", async () => {
  (publishBook as jest.Mock).mockResolvedValue({ status: "done", listed: true });
  render(<PublishButton bookId="b1" enabled />);
  fireEvent.press(screen.getByLabelText("Publish book to Author Commons"));
  await waitFor(() => expect(screen.getByText(/✓ Published to Author Commons/)).toBeTruthy());
});

it("warns when the catalog write failed (listed false)", async () => {
  (publishBook as jest.Mock).mockResolvedValue({ status: "done", listed: false });
  render(<PublishButton bookId="b1" enabled />);
  fireEvent.press(screen.getByLabelText("Publish book to Author Commons"));
  await waitFor(() =>
    expect(
      screen.getByText("Published, but not yet listed on Author Commons. Please publish again."),
    ).toBeTruthy(),
  );
});
