// Task 4 (zk-library-sync / autosync increment 1b): the Settings sync panel's
// status badge (driven by `useSyncStatus()`) and the auto-sync toggle (backed
// by `@/sync/autoSync`'s `isAutoSyncEnabled`/`setAutoSyncEnabled`). The
// engine's `syncNow`/`isUnlocked` plumbing itself is covered by
// `LibrarySync.test.tsx` — this file only exercises the new badge + toggle.
//
// Mock vars referenced inside jest.mock() factories must be "mock"-prefixed
// (babel-plugin-jest-hoist hoist-safety — same convention as
// LibrarySync.test.tsx / BackupRestore.test.tsx).
import { render, fireEvent, waitFor } from "@testing-library/react-native";
import { LibrarySync } from "@/components/LibrarySync";
import type { SyncStatus } from "@/sync/syncEngine";

const mockIsUnlocked = jest.fn(async () => true);
const mockEnableSync = jest.fn(async (_t: string) => "RECOVERY-KEY-ABCD-1234");
const mockUnlockOnDevice = jest.fn(async (_t: string, _k: string) => {});
const mockSyncNow = jest.fn(async (_t: string) => ({ pushed: 0, pulled: 0, deleted: 0, failed: [] as string[] }));
const mockSyncStatusFn = jest.fn(async (_t: string | null) => ({
  state: "up_to_date" as const,
  toPush: 0,
  toPull: 0,
  lastSyncedAt: null as string | null,
}));
const mockGetLastSyncedAt = jest.fn(async () => null as string | null);

jest.mock("@/sync/syncEngine", () => {
  const actual = jest.requireActual("@/sync/syncEngine");
  return {
    isUnlocked: () => mockIsUnlocked(),
    enableSync: (t: string) => mockEnableSync(t),
    unlockOnDevice: (t: string, k: string) => mockUnlockOnDevice(t, k),
    runSyncExclusive: (t: string) => mockSyncNow(t),
    syncStatus: (t: string | null) => mockSyncStatusFn(t),
    getLastSyncedAt: () => mockGetLastSyncedAt(),
    SyncLockedError: actual.SyncLockedError,
    SyncKeysetExistsError: actual.SyncKeysetExistsError,
  };
});

const mockUseSyncStatus = jest.fn<SyncStatus, []>(() => ({
  state: "up_to_date",
  toPush: 0,
  toPull: 0,
  lastSyncedAt: null,
}));
const mockSetSyncStatus = jest.fn();
jest.mock("@/sync/syncStatusStore", () => ({
  useSyncStatus: () => mockUseSyncStatus(),
  setSyncStatus: (patch: unknown) => mockSetSyncStatus(patch),
}));

const mockIsAutoSyncEnabled = jest.fn(async () => true);
const mockSetAutoSyncEnabled = jest.fn(async (_on: boolean) => {});
jest.mock("@/sync/autoSync", () => ({
  isAutoSyncEnabled: () => mockIsAutoSyncEnabled(),
  setAutoSyncEnabled: (on: boolean) => mockSetAutoSyncEnabled(on),
}));

jest.mock("@/auth/AuthProvider", () => ({
  useAuth: () => ({ accessToken: "test-token" }),
}));

const mockAlertSpy = jest.fn();
jest.mock("@/lib/alert", () => ({ Alert: { alert: (...a: unknown[]) => mockAlertSpy(...a) } }));

const mockCopyText = jest.fn(async (_s: string) => {});
jest.mock("@/lib/clipboard", () => ({ copyText: (s: string) => mockCopyText(s) }));

beforeEach(() => {
  mockIsUnlocked.mockClear();
  mockIsUnlocked.mockImplementation(async () => true);
  mockEnableSync.mockClear();
  mockUnlockOnDevice.mockClear();
  mockSyncNow.mockClear();
  mockSyncNow.mockImplementation(async () => ({ pushed: 0, pulled: 0, deleted: 0, failed: [] }));
  mockSyncStatusFn.mockClear();
  mockSyncStatusFn.mockImplementation(async () => ({ state: "up_to_date", toPush: 0, toPull: 0, lastSyncedAt: null }));
  mockGetLastSyncedAt.mockClear();
  mockGetLastSyncedAt.mockImplementation(async () => null);
  mockUseSyncStatus.mockClear();
  mockUseSyncStatus.mockReturnValue({ state: "up_to_date", toPush: 0, toPull: 0, lastSyncedAt: null });
  mockSetSyncStatus.mockClear();
  mockIsAutoSyncEnabled.mockClear();
  mockIsAutoSyncEnabled.mockImplementation(async () => true);
  mockSetAutoSyncEnabled.mockClear();
  mockAlertSpy.mockClear();
  mockCopyText.mockClear();
});

describe("status badge", () => {
  it("up_to_date: renders 'Up to date'", async () => {
    mockUseSyncStatus.mockReturnValue({ state: "up_to_date", toPush: 0, toPull: 0, lastSyncedAt: null });
    const { getByText } = render(<LibrarySync />);
    await waitFor(() => expect(getByText(/up to date/i)).toBeTruthy());
  });

  it("pending: toPush 2 + toPull 1 renders a '3 change(s) to sync' count", async () => {
    mockUseSyncStatus.mockReturnValue({ state: "pending", toPush: 2, toPull: 1, lastSyncedAt: null });
    const { getByText } = render(<LibrarySync />);
    await waitFor(() => expect(getByText(/3 changes to sync/i)).toBeTruthy());
  });

  it("syncing: renders 'Syncing…'", async () => {
    mockUseSyncStatus.mockReturnValue({ state: "syncing", toPush: 0, toPull: 0, lastSyncedAt: null });
    const { getByText } = render(<LibrarySync />);
    await waitFor(() => expect(getByText(/syncing/i)).toBeTruthy());
  });

  it("error: renders \"Couldn't sync\"", async () => {
    mockUseSyncStatus.mockReturnValue({ state: "error", toPush: 0, toPull: 0, lastSyncedAt: null });
    const { getByText } = render(<LibrarySync />);
    await waitFor(() => expect(getByText(/couldn.t sync/i)).toBeTruthy());
  });

  it("signed_out: renders no status line", async () => {
    mockUseSyncStatus.mockReturnValue({ state: "signed_out", toPush: 0, toPull: 0, lastSyncedAt: null });
    const { queryByText, getByText } = render(<LibrarySync />);
    // Wait for the unlocked phase to settle (Sync now button present) before
    // asserting the negative — otherwise this passes trivially pre-render.
    await waitFor(() => expect(getByText(/sync now/i)).toBeTruthy());
    expect(queryByText(/up to date/i)).toBeNull();
    expect(queryByText(/change.*to sync/i)).toBeNull();
    expect(queryByText(/syncing/i)).toBeNull();
    expect(queryByText(/couldn.t sync/i)).toBeNull();
  });

  it("locked: the unlock prompt still shows (not the badge)", async () => {
    mockIsUnlocked.mockImplementation(async () => false);
    mockUseSyncStatus.mockReturnValue({ state: "locked", toPush: 0, toPull: 0, lastSyncedAt: null });
    const { getByText } = render(<LibrarySync />);
    await waitFor(() => expect(getByText(/enable cloud sync/i)).toBeTruthy());
  });
});

describe("auto-sync toggle", () => {
  it("reflects isAutoSyncEnabled() on mount", async () => {
    mockIsAutoSyncEnabled.mockImplementation(async () => false);
    const { getByLabelText } = render(<LibrarySync />);
    await waitFor(() => expect(getByLabelText("Auto-sync").props.value).toBe(false));
  });

  it("calls setAutoSyncEnabled on toggle", async () => {
    mockIsAutoSyncEnabled.mockImplementation(async () => true);
    const { getByLabelText } = render(<LibrarySync />);
    const toggle = await waitFor(() => getByLabelText("Auto-sync"));
    await waitFor(() => expect(toggle.props.value).toBe(true));

    fireEvent(toggle, "valueChange", false);
    await waitFor(() => expect(mockSetAutoSyncEnabled).toHaveBeenCalledWith(false));
  });
});

describe("manual Sync now", () => {
  it("still calls the engine's syncNow", async () => {
    const { getByText } = render(<LibrarySync />);
    await waitFor(() => expect(getByText(/sync now/i)).toBeTruthy());

    fireEvent.press(getByText(/sync now/i));
    await waitFor(() => expect(mockSyncNow).toHaveBeenCalledWith("test-token"));
    await waitFor(() => expect(mockAlertSpy).toHaveBeenCalled());
  });
});
