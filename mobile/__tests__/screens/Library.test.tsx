import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";

const mockPush = jest.fn();

// Screen reads accessToken via useAuth (used by SharedWithYou/UserChip) — present
// as signed out with no token so those self-gate to their minimal render.
jest.mock("../../src/auth/AuthProvider", () => ({
  useAuth: () => ({ status: "signed_out", session: null, accessToken: null }),
}));

jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn(), back: jest.fn() }),
  // Fire the focus callback once on mount (via an effect), like the real
  // useFocusEffect — NOT on every render, which would loop when the callback
  // sets state.
  useFocusEffect: (cb: () => void) => {
    require("react").useEffect(cb, []);
  },
}));

jest.mock("../../src/hooks/useResponsive", () => ({
  useResponsive: () => ({ width: 390, isTablet: false, isDesktop: false }),
}));

jest.mock("../../src/storage/epubLibrary", () => ({
  listEpubs: jest.fn(),
  deleteEpub: jest.fn(),
  openEpub: jest.fn(),
}));

jest.mock("../../src/storage/exportStatus", () => ({
  getAllExportStatus: jest.fn().mockResolvedValue({}),
}));

jest.mock("../../src/lib/trackedExport", () => ({
  reconcileGeneratingExports: jest.fn().mockResolvedValue(undefined),
  loadPublishedMap: jest.fn().mockResolvedValue({}),
}));

jest.mock("../../src/storage/reviewStore", () => ({
  reviewCounts: jest.fn().mockResolvedValue({}),
}));

jest.mock("../../src/storage/seedReviews", () => ({
  maybeSeedReviews: jest.fn().mockResolvedValue(false),
}));

jest.mock("../../src/storage/shelfStore", () => ({
  listShelves: jest.fn().mockResolvedValue([]),
  getAssignments: jest.fn().mockResolvedValue({}),
  createShelf: jest.fn(),
  renameShelf: jest.fn(),
  deleteShelf: jest.fn(),
  assignBook: jest.fn(),
  pruneBook: jest.fn(),
}));

const { listEpubs } = require("../../src/storage/epubLibrary") as {
  listEpubs: jest.Mock;
};

import LibraryScreen from "../../app/(tabs)/library";

beforeEach(() => {
  jest.clearAllMocks();
  listEpubs.mockResolvedValue([]);
});

describe("LibraryScreen", () => {
  it("mounts and shows the empty state with a single primary action", async () => {
    render(<LibraryScreen />);
    await waitFor(() => {
      expect(screen.getByText("Your Library is empty")).toBeTruthy();
    });

    // The heading uses the Studio Fraunces-heading style, not a bold Inter
    // weight — assert via the primitive's typography, not a color literal.
    const heading = screen.getByText("Your Library is empty");
    const flat = require("react-native").StyleSheet.flatten(heading.props.style);
    expect(flat.fontWeight).not.toBe("700");
    expect(flat.fontFamily).toBe(require("../../src/constants/fonts").FRAUNCES.semibold);

    // "Go to Studio" is the one gold-pill primary action on this screen; Import
    // EPUB is present too but as a secondary (ghost) control.
    const primaryCta = screen.getByRole("button", { name: "Go to Studio" });
    expect(primaryCta).toBeTruthy();
    expect(screen.getByRole("button", { name: "Import an EPUB file into your library" })).toBeTruthy();
  });

  it("navigates to the Studio (books route) on the primary CTA", async () => {
    render(<LibraryScreen />);
    await waitFor(() => screen.getByRole("button", { name: "Go to Studio" }));
    fireEvent.press(screen.getByRole("button", { name: "Go to Studio" }));
    expect(mockPush).toHaveBeenCalledWith("/books");
  });
});
