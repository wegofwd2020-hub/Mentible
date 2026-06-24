import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";

const mockPush = jest.fn();

// Screen is wrapped in RequireSignIn — present as signed in so the gate passes
// through to the screen under test.
jest.mock("../../src/auth/AuthProvider", () => ({
  useAuth: () => ({ status: "signed_in", session: null, accessToken: null }),
}));

jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn(), back: jest.fn() }),
  useFocusEffect: (cb: () => void) => {
    cb();
  },
}));

jest.mock("../../src/storage/bookStore", () => ({
  loadBookIndex: jest.fn(),
  deleteBook: jest.fn(),
  loadBook: jest.fn(),
}));

// Exercise the phone layout (cover grid → tap opens the book). The desktop
// split view is width-gated and covered separately.
jest.mock("../../src/hooks/useResponsive", () => ({
  useResponsive: () => ({ width: 390, isTablet: false, isDesktop: false }),
}));

const { loadBookIndex, deleteBook } = require("../../src/storage/bookStore") as {
  loadBookIndex: jest.Mock;
  deleteBook: jest.Mock;
};

import BooksScreen from "../../app/(tabs)/books";

beforeEach(() => {
  jest.clearAllMocks();
});

describe("BooksScreen", () => {
  it("shows the empty state and a New book button when there are no books", async () => {
    loadBookIndex.mockResolvedValue([]);
    render(<BooksScreen />);
    await waitFor(() => {
      expect(screen.getByText("No books yet")).toBeTruthy();
    });
    expect(screen.getByLabelText("New book")).toBeTruthy();
  });

  it("navigates to the new-book screen on tap", async () => {
    loadBookIndex.mockResolvedValue([]);
    render(<BooksScreen />);
    await waitFor(() => screen.getByLabelText("New book"));
    fireEvent.press(screen.getByLabelText("New book"));
    expect(mockPush).toHaveBeenCalledWith("/book/new");
  });

  it("lists saved books with their counts", async () => {
    loadBookIndex.mockResolvedValue([
      {
        id: "b1",
        title: "Physics Primer",
        subjectCount: 1,
        unitCount: 4,
        updatedAt: "2026-05-26T10:00:00.000Z",
      },
    ]);
    render(<BooksScreen />);
    await waitFor(() => {
      expect(screen.getAllByText("Physics Primer").length).toBeGreaterThan(0);
    });
    expect(screen.getByText(/4 topics/)).toBeTruthy();
  });

  it("opens a saved book on tap", async () => {
    loadBookIndex.mockResolvedValue([
      {
        id: "b1",
        title: "Physics Primer",
        subjectCount: 1,
        unitCount: 4,
        updatedAt: "2026-05-26T10:00:00.000Z",
      },
    ]);
    render(<BooksScreen />);
    await waitFor(() => screen.getAllByText("Physics Primer"));
    fireEvent.press(screen.getByLabelText("Open book: Physics Primer"));
    expect(mockPush).toHaveBeenCalledWith("/book/saved/b1");
  });
});
