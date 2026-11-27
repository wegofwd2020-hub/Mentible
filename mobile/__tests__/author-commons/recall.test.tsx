import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";

jest.mock("@/auth/AuthProvider", () => ({ useAuth: () => ({ accessToken: "tok-r", status: "signed_in" }) }));
jest.mock("@/auth/RequireSignIn", () => ({ RequireSignIn: ({ children }: { children: React.ReactNode }) => children }));
jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock("@/components/PageContainer", () => ({
  PageContainer: ({ children }: { children: React.ReactNode }) => children,
}));
const mockAlert = jest.fn();
jest.mock("@/lib/alert", () => ({ Alert: { alert: (...a: unknown[]) => mockAlert(...a) } }));
jest.mock("@/api/client", () => ({
  listAuthorCommons: jest.fn(),
  listMyAuthorCommons: jest.fn(),
  hideAuthorCommons: jest.fn(),
}));

import { hideAuthorCommons, listAuthorCommons, listMyAuthorCommons } from "@/api/client";
import AuthorCommonsScreen from "@/../app/(tabs)/author-commons";

const mockList = listAuthorCommons as jest.Mock;
const mockMine = listMyAuthorCommons as jest.Mock;
const mockHide = hideAuthorCommons as jest.Mock;

const item = (id: string, title: string) => ({
  book_id: id,
  title,
  author_name: "Me",
  account_name: "Acct",
  version: 1,
  published_at: "2026-11-01T00:00:00Z",
  formats: ["epub"],
  language: "en",
  cover_svg: null,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockList.mockResolvedValue({ items: [], total: 0, page: 1, page_size: 20 });
});

it("shows your live listings with a Recall button", async () => {
  mockMine.mockResolvedValue([item("mine-1", "My Book")]);
  render(<AuthorCommonsScreen />);
  expect(await screen.findByText("Your listings")).toBeTruthy();
  expect(screen.getByText("My Book")).toBeTruthy();
  expect(screen.getByLabelText("Recall My Book from Author Commons")).toBeTruthy();
});

it("hides the Your listings section when you have no live listings", async () => {
  mockMine.mockResolvedValue([]);
  render(<AuthorCommonsScreen />);
  await waitFor(() => expect(mockMine).toHaveBeenCalled());
  expect(screen.queryByText("Your listings")).toBeNull();
});

it("Recall confirms, calls the hide route, then refreshes both lists", async () => {
  mockMine.mockResolvedValueOnce([item("mine-1", "My Book")]).mockResolvedValue([]);
  mockHide.mockResolvedValue(undefined);
  render(<AuthorCommonsScreen />);
  fireEvent.press(await screen.findByLabelText("Recall My Book from Author Commons"));

  expect(mockHide).not.toHaveBeenCalled();
  const buttons = mockAlert.mock.calls[0][2] as { text: string; onPress?: () => void }[];
  expect(buttons.map((b) => b.text)).toEqual(["Cancel", "Recall"]);
  await act(async () => buttons[1].onPress?.());

  await waitFor(() => expect(mockHide).toHaveBeenCalledWith("tok-r", "mine-1"));
  await waitFor(() => expect(screen.queryByText("Your listings")).toBeNull());
  expect(mockList.mock.calls.length).toBeGreaterThan(1);
});
