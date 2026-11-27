import React from "react";
import * as fs from "fs";
import * as path from "path";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";

const mockPush = jest.fn();
jest.mock("@/auth/AuthProvider", () => ({ useAuth: () => ({ accessToken: "tok", status: "signed_in" }) }));
jest.mock("@/auth/RequireSignIn", () => ({ RequireSignIn: ({ children }: { children: React.ReactNode }) => children }));
jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock("@/components/PageContainer", () => ({
  PageContainer: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock("@/api/client", () => ({ listAuthorCommons: jest.fn(), listMyAuthorCommons: jest.fn().mockResolvedValue([]) }));

import { listAuthorCommons } from "@/api/client";
import { NAV_ORDER } from "@/components/navItems";
import AuthorCommonsScreen from "@/../app/(tabs)/author-commons";

const mockList = listAuthorCommons as jest.Mock;

const item = (id: string, title: string) => ({
  book_id: id,
  title,
  author_name: `Author ${id}`,
  account_name: "Acct",
  version: 1,
  published_at: "2026-11-01T00:00:00Z",
  formats: ["epub", "pdf"],
  language: "en",
  cover_svg: null,
});

beforeEach(() => {
  jest.clearAllMocks();
  jest.useRealTimers();
});

it("renders a row per live item", async () => {
  mockList.mockResolvedValue({ items: [item("a", "Alpha"), item("b", "Beta")], total: 2, page: 1, page_size: 20 });
  render(<AuthorCommonsScreen />);
  expect(await screen.findByLabelText("Open book: Alpha")).toBeTruthy();
  expect(screen.getByLabelText("Open book: Beta")).toBeTruthy();
  expect(screen.getByText("Author a")).toBeTruthy();
  fireEvent.press(screen.getByLabelText("Open book: Alpha"));
  expect(mockPush).toHaveBeenCalledWith("/author-commons/a");
});

it("shows an empty state when total is 0", async () => {
  mockList.mockResolvedValue({ items: [], total: 0, page: 1, page_size: 20 });
  render(<AuthorCommonsScreen />);
  expect(await screen.findByText(/No books in Author Commons/i)).toBeTruthy();
});

it("typing in search re-queries with the query string", async () => {
  mockList.mockResolvedValue({ items: [], total: 0, page: 1, page_size: 20 });
  render(<AuthorCommonsScreen />);
  await waitFor(() => expect(mockList).toHaveBeenCalledTimes(1));
  jest.useFakeTimers();
  fireEvent.changeText(screen.getByLabelText("Search Author Commons"), "algebra");
  act(() => {
    jest.advanceTimersByTime(299);
  });
  expect(mockList).toHaveBeenCalledTimes(1);
  act(() => {
    jest.advanceTimersByTime(2);
  });
  jest.useRealTimers();
  await waitFor(() =>
    expect(mockList).toHaveBeenLastCalledWith("tok", expect.objectContaining({ query: "algebra" })),
  );
});

it("tab order places Author Commons directly after Library", () => {
  const layout = fs.readFileSync(path.resolve(__dirname, "../../app/(tabs)/_layout.tsx"), "utf8");
  const names = [...layout.matchAll(/<Tabs\.Screen name="([^"]+)"/g)].map((m) => m[1]);
  expect(names.indexOf("author-commons")).toBe(names.indexOf("library") + 1);
  expect(NAV_ORDER.indexOf("author-commons")).toBe(NAV_ORDER.indexOf("library") + 1);
});
