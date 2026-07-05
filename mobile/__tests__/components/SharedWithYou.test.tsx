import React from "react";
import { render, screen, waitFor } from "@testing-library/react-native";
import { SharedWithYou } from "@/components/SharedWithYou";

jest.mock("@/api/client", () => ({
  sharedWithMe: jest.fn(),
  getSharedDraft: jest.fn(),
  listComments: jest.fn().mockResolvedValue([]),
  postComment: jest.fn(),
}));
import * as api from "@/api/client";

it("renders nothing when signed out", () => {
  const { toJSON } = render(<SharedWithYou token={null} />);
  expect(toJSON()).toBeNull();
});

it("lists drafts shared with me", async () => {
  (api.sharedWithMe as jest.Mock).mockResolvedValue([{ book_id: "b1", title: "Shared Book", owner_sub: "o", version: "1.0", updated_at: "" }]);
  render(<SharedWithYou token="tok" />);
  await waitFor(() => expect(screen.getByText("Shared Book")).toBeTruthy());
});

it("renders nothing (no header) when the shared list is empty", async () => {
  (api.sharedWithMe as jest.Mock).mockResolvedValue([]);
  render(<SharedWithYou token="tok" />);
  await waitFor(() => expect(api.sharedWithMe).toHaveBeenCalled());
  expect(screen.queryByText(/Shared with you/i)).toBeNull();
});
