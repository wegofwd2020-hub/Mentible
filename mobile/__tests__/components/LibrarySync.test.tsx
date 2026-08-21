import { render, fireEvent, waitFor } from "@testing-library/react-native";
import { LibrarySync } from "@/components/LibrarySync";
import { SyncKeysetExistsError } from "@/sync/syncEngine";

// Variables referenced inside jest.mock() factories must be prefixed with
// "mock" (case-insensitive) — babel-plugin-jest-hoist's hoist-safety check
// (see BackupRestore.test.tsx for the same convention in this repo). The
// error classes are re-exported from the REAL module (via requireActual,
// evaluated lazily inside the factory) rather than redeclared as `class ...`
// here — a top-level class binding referenced directly in the mock factory
// hits the TDZ, since babel-plugin-jest-hoist hoists jest.mock() above the
// class declaration.
const mockIsUnlocked = jest.fn(async () => false);
const mockEnableSync = jest.fn(async (_t: string) => "RECOVERY-KEY-ABCD-1234");
const mockUnlockOnDevice = jest.fn(async (_t: string, _k: string) => {});
// LibrarySync now calls `runSyncExclusive` (the cross-caller mutex), not
// `syncNow` directly — the mutex's own no-overlap behavior is proven in
// syncEngine's runSyncExclusive test; this component test only needs the
// mock to forward through and hand back a SyncResult for the Alert.
const mockSyncNow = jest.fn(async (_t: string) => ({ pushed: 2, pulled: 1, deleted: 0, failed: [] as string[] }));
const mockGetLastSyncedAt = jest.fn(async () => null as string | null);
// This test predates the sync-status badge (Task 4) — a fresh, read-only
// "up_to_date" reading is enough to keep it a no-op for these assertions.
const mockSyncStatus = jest.fn(async (_t: string | null) => ({
  state: "up_to_date" as const,
  toPush: 0,
  toPull: 0,
  lastSyncedAt: null as string | null,
}));

jest.mock("@/sync/syncEngine", () => {
  const actual = jest.requireActual("@/sync/syncEngine");
  return {
    isUnlocked: () => mockIsUnlocked(),
    enableSync: (t: string) => mockEnableSync(t),
    unlockOnDevice: (t: string, k: string) => mockUnlockOnDevice(t, k),
    runSyncExclusive: (t: string) => mockSyncNow(t),
    syncStatus: (t: string | null) => mockSyncStatus(t),
    getLastSyncedAt: () => mockGetLastSyncedAt(),
    SyncLockedError: actual.SyncLockedError,
    SyncKeysetExistsError: actual.SyncKeysetExistsError,
  };
});

jest.mock("@/auth/AuthProvider", () => ({
  useAuth: () => ({ accessToken: "test-token" }),
}));

const mockAlertSpy = jest.fn();
jest.mock("@/lib/alert", () => ({ Alert: { alert: (...a: any[]) => mockAlertSpy(...a) } }));

const mockCopyText = jest.fn(async (_s: string) => {});
jest.mock("@/lib/clipboard", () => ({ copyText: (s: string) => mockCopyText(s) }));

beforeEach(() => {
  mockIsUnlocked.mockClear();
  mockIsUnlocked.mockImplementation(async () => false);
  mockEnableSync.mockClear();
  mockEnableSync.mockImplementation(async () => "RECOVERY-KEY-ABCD-1234");
  mockUnlockOnDevice.mockClear();
  mockUnlockOnDevice.mockImplementation(async () => {});
  mockSyncNow.mockClear();
  mockSyncNow.mockImplementation(async () => ({ pushed: 2, pulled: 1, deleted: 0, failed: [] }));
  mockGetLastSyncedAt.mockClear();
  mockGetLastSyncedAt.mockImplementation(async () => null);
  mockSyncStatus.mockClear();
  mockSyncStatus.mockImplementation(async () => ({ state: "up_to_date", toPush: 0, toPull: 0, lastSyncedAt: null }));
  mockAlertSpy.mockClear();
  mockCopyText.mockClear();
});

it("not-enabled: Enable cloud sync calls enableSync and shows the recovery key once", async () => {
  const { getByText, queryByText } = render(<LibrarySync />);
  await waitFor(() => expect(getByText(/enable cloud sync/i)).toBeTruthy());

  fireEvent.press(getByText(/enable cloud sync/i));
  await waitFor(() => expect(mockEnableSync).toHaveBeenCalledWith("test-token"));

  // The recovery key is on screen, with a copy affordance.
  await waitFor(() => expect(getByText("RECOVERY-KEY-ABCD-1234")).toBeTruthy());
  expect(getByText(/copy/i)).toBeTruthy();

  // Confirming dismisses it and runs the first sync.
  fireEvent.press(getByText(/i've saved it/i));
  await waitFor(() => expect(mockSyncNow).toHaveBeenCalledWith("test-token"));

  expect(queryByText("RECOVERY-KEY-ABCD-1234")).toBeNull();
});

it("enabled + unlocked: Sync now calls syncNow and Alerts the counts", async () => {
  mockIsUnlocked.mockImplementation(async () => true);
  const { getByText } = render(<LibrarySync />);
  await waitFor(() => expect(getByText(/sync now/i)).toBeTruthy());

  fireEvent.press(getByText(/sync now/i));
  await waitFor(() => expect(mockSyncNow).toHaveBeenCalledWith("test-token"));
  await waitFor(() =>
    expect(mockAlertSpy).toHaveBeenCalledWith("Sync complete", expect.stringMatching(/pushed 2.*pulled 1.*removed 0/i)),
  );
});

it("enabled + unlocked: a failed book is noted in the Alert", async () => {
  mockIsUnlocked.mockImplementation(async () => true);
  mockSyncNow.mockImplementation(async () => ({ pushed: 1, pulled: 0, deleted: 0, failed: ["book-1"] }));
  const { getByText } = render(<LibrarySync />);
  await waitFor(() => expect(getByText(/sync now/i)).toBeTruthy());

  fireEvent.press(getByText(/sync now/i));
  await waitFor(() =>
    expect(mockAlertSpy).toHaveBeenCalledWith("Sync complete", expect.stringMatching(/1 book\(s\) couldn.t sync/i)),
  );
});

it("enable throws SyncKeysetExistsError → switches to the unlock input", async () => {
  mockEnableSync.mockImplementation(async () => {
    throw new SyncKeysetExistsError();
  });
  const { getByText, getByLabelText, queryByText } = render(<LibrarySync />);
  await waitFor(() => expect(getByText(/enable cloud sync/i)).toBeTruthy());

  fireEvent.press(getByText(/enable cloud sync/i));
  await waitFor(() => expect(mockEnableSync).toHaveBeenCalled());

  await waitFor(() => expect(getByLabelText(/recovery key/i)).toBeTruthy());
  // No recovery key was ever generated/shown for this path.
  expect(queryByText(/^RECOVERY-KEY/)).toBeNull();
});

it("unlock: entering a key calls unlockOnDevice, then syncs", async () => {
  const { getByText, getByLabelText } = render(<LibrarySync />);
  await waitFor(() => expect(getByText(/enable cloud sync/i)).toBeTruthy());

  fireEvent.press(getByText(/unlock this device/i));
  const input = getByLabelText(/recovery key/i);
  fireEvent.changeText(input, "MY-RECOVERY-KEY");
  fireEvent.press(getByText(/^unlock$/i));

  await waitFor(() => expect(mockUnlockOnDevice).toHaveBeenCalledWith("test-token", "MY-RECOVERY-KEY"));
  await waitFor(() => expect(mockSyncNow).toHaveBeenCalledWith("test-token"));
});

it("unlock: a wrong key Alerts an error and stays locked", async () => {
  mockUnlockOnDevice.mockImplementation(async () => {
    throw new Error("bad key");
  });
  const { getByText, getByLabelText } = render(<LibrarySync />);
  await waitFor(() => expect(getByText(/enable cloud sync/i)).toBeTruthy());

  fireEvent.press(getByText(/unlock this device/i));
  const input = getByLabelText(/recovery key/i);
  fireEvent.changeText(input, "WRONG-KEY");
  fireEvent.press(getByText(/^unlock$/i));

  await waitFor(() => expect(mockUnlockOnDevice).toHaveBeenCalled());
  await waitFor(() => expect(mockAlertSpy).toHaveBeenCalledWith(expect.stringMatching(/didn.t work/i)));
  expect(mockSyncNow).not.toHaveBeenCalled();
  // Still showing the unlock affordance, not "Sync now".
  expect(getByText(/enable cloud sync/i)).toBeTruthy();
});

it("the recovery key is never rendered in the unlocked or locked states", async () => {
  mockIsUnlocked.mockImplementation(async () => true);
  const { getByText, queryByText } = render(<LibrarySync />);
  await waitFor(() => expect(getByText(/sync now/i)).toBeTruthy());
  expect(queryByText(/^RECOVERY-KEY/)).toBeNull();
});
