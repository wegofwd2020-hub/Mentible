import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { FeedbackSheet } from "@/components/FeedbackSheet";
import { sendFeedback } from "@/api/feedbackClient";

jest.mock("expo-router", () => ({ usePathname: () => "/trust/p1" }));
jest.mock("@/auth/AuthProvider", () => ({
  useAuth: () => ({
    accessToken: "tok",
    session: { user: { email: "jane@x.com", user_metadata: { full_name: "Jane Q" } } },
    status: "signed_in",
  }),
}));
jest.mock("@/api/feedbackClient", () => ({ sendFeedback: jest.fn() }));
jest.mock("@/lib/alert", () => ({ Alert: { alert: jest.fn() } }));
jest.mock("@/api/client", () => ({ ApiError: class extends Error {} }));

beforeEach(() => jest.clearAllMocks());

it("submits feedback with the current route as page and prefilled name", async () => {
  (sendFeedback as jest.Mock).mockResolvedValue({ id: "f1" });
  render(<FeedbackSheet visible onClose={jest.fn()} />);
  fireEvent.changeText(screen.getByLabelText("Feedback text"), "the upload broke");
  fireEvent.press(screen.getByLabelText("Send feedback"));
  await waitFor(() => expect(sendFeedback).toHaveBeenCalledTimes(1));
  const [body, token] = (sendFeedback as jest.Mock).mock.calls[0];
  expect(token).toBe("tok");
  expect(body).toMatchObject({ name: "Jane Q", page: "/trust/p1", text: "the upload broke", type: "bug" });
  // No confirmation pop-up on success — an inline "Sent" note appears instead.
  const { Alert } = require("@/lib/alert");
  await screen.findByText(/Sent/);
  expect(Alert.alert).not.toHaveBeenCalled();
});

it("does not submit an empty message", () => {
  render(<FeedbackSheet visible onClose={jest.fn()} />);
  fireEvent.press(screen.getByLabelText("Send feedback"));
  expect(sendFeedback).not.toHaveBeenCalled();
});
