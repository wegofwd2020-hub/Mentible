// Auto-sync controller tests. `syncNow`/`syncStatus`/`isUnlocked` are mocked
// (T1's engine is exercised by its own test suite) — this file is only about
// the guard/trigger/single-flight wiring in `autoSync.ts` + the reactive
// store in `syncStatusStore.ts`.
//
// jest-hoisting trap (see mobile/__tests__ conventions): `jest.mock(...)`
// factories are hoisted above these imports, so every variable a factory
// closes over must be declared with a `mock`-prefixed name.
import React from "react";
import { Text } from "react-native";
import { act, render } from "@testing-library/react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

const mockSyncNow = jest.fn();
const mockSyncStatus = jest.fn();
const mockIsUnlocked = jest.fn();
jest.mock("@/sync/syncEngine", () => ({
  syncNow: (...args: unknown[]) => mockSyncNow(...args),
  syncStatus: (...args: unknown[]) => mockSyncStatus(...args),
  isUnlocked: (...args: unknown[]) => mockIsUnlocked(...args),
}));

let mockBookStoreListener: (() => void) | null = null;
const mockSubscribeBookStore = jest.fn((listener: () => void) => {
  mockBookStoreListener = listener;
  return jest.fn();
});
jest.mock("@/storage/bookStore", () => ({
  subscribeBookStore: (listener: () => void) => mockSubscribeBookStore(listener),
}));

let mockAuthValue: { status: string; accessToken: string | null } = {
  status: "signed_in",
  accessToken: "test-token",
};
jest.mock("@/auth/AuthProvider", () => ({
  useAuth: () => mockAuthValue,
}));

const mockDemoState = { IS_DEMO: false };
jest.mock("@/constants/demo", () => ({
  get IS_DEMO() {
    return mockDemoState.IS_DEMO;
  },
}));

const mockAlert = jest.fn();
jest.mock("@/lib/alert", () => ({
  Alert: { alert: (...args: unknown[]) => mockAlert(...args) },
}));

const mockAddEventListener = jest.fn((_event: string, _handler: (state: string) => void) => ({
  remove: jest.fn(),
}));
jest.mock("react-native", () => {
  // Spreading the whole `react-native` module (`{ ...actual }`) eagerly
  // evaluates every lazily-defined property (ProgressBarAndroid, Clipboard,
  // DevMenu, ...), some of which throw under jest with no native runtime.
  // `AppState` itself is exposed off the module via a getter-only property
  // (no setter), so reassigning `actual.AppState = {...}` silently no-ops
  // (leaving the real AppState in place) — mutate the `addEventListener`
  // method directly on the existing AppState object instead.
  const actual = jest.requireActual("react-native");
  actual.AppState.addEventListener = (event: string, handler: (state: string) => void) =>
    mockAddEventListener(event, handler);
  return actual;
});

import { useAutoSync, AUTOSYNC_ENABLED_KEY, isAutoSyncEnabled, setAutoSyncEnabled } from "@/sync/autoSync";
import { getSyncStatus, setSyncStatus, useSyncStatus } from "@/sync/syncStatusStore";

// Mirrors the constants in autoSync.ts (not exported — these are the test's
// own copies, not a shared source of truth).
const DEBOUNCE_MS = 4000;
const MIN_INTERVAL_MS = 15000;

function Probe() {
  useAutoSync();
  return null;
}

function StatusProbe() {
  const status = useSyncStatus();
  return <Text testID="state">{status.state}</Text>;
}

// Native Promise resolution isn't affected by fake timers, but our guard
// chain hops through several `await`s (AsyncStorage, isUnlocked, syncNow,
// syncStatus) before settling — drain enough microtask ticks to let it.
async function flush(times = 12): Promise<void> {
  for (let i = 0; i < times; i++) {
    // eslint-disable-next-line no-await-in-loop
    await Promise.resolve();
  }
}

function latestAppStateHandler(): (state: string) => void {
  const calls = mockAddEventListener.mock.calls;
  return calls[calls.length - 1]![1];
}

// Fake "now" jumps forward by a large increment every test so a previous
// test's `lastRunAt` (module-level state in autoSync.ts, not reset between
// tests) can never fall inside the next test's MIN_INTERVAL_MS window.
let fakeNow = 1_700_000_000_000;

beforeEach(async () => {
  jest.useFakeTimers();
  fakeNow += 10_000_000;
  jest.setSystemTime(fakeNow);
  jest.clearAllMocks();
  await AsyncStorage.clear();

  mockAuthValue = { status: "signed_in", accessToken: "test-token" };
  mockDemoState.IS_DEMO = false;
  mockBookStoreListener = null;

  mockSyncNow.mockResolvedValue({ pushed: 0, pulled: 0, deleted: 0, failed: [] });
  mockSyncStatus.mockResolvedValue({ state: "up_to_date", toPush: 0, toPull: 0, lastSyncedAt: null });
  mockIsUnlocked.mockResolvedValue(true);
});

afterEach(() => {
  jest.useRealTimers();
});

describe("useAutoSync — sign-in trigger", () => {
  it("signed_in + unlocked on mount calls syncNow once", async () => {
    render(<Probe />);
    await act(async () => {
      await flush();
    });
    expect(mockSyncNow).toHaveBeenCalledTimes(1);
    expect(mockSyncNow).toHaveBeenCalledWith("test-token");
  });
});

describe("useAutoSync — foreground trigger", () => {
  it("AppState active triggers a sync; a second active within MIN_INTERVAL_MS does not", async () => {
    render(<Probe />);
    await act(async () => {
      await flush();
    });
    expect(mockSyncNow).toHaveBeenCalledTimes(1); // the mount (sign-in) trigger

    // Clear the mount trigger's own throttle window before probing foreground.
    await act(async () => {
      jest.advanceTimersByTime(MIN_INTERVAL_MS + 1);
      await flush();
    });

    const handler = latestAppStateHandler();
    await act(async () => {
      handler("active");
      await flush();
    });
    expect(mockSyncNow).toHaveBeenCalledTimes(2);

    await act(async () => {
      handler("active");
      await flush();
    });
    expect(mockSyncNow).toHaveBeenCalledTimes(2); // still 2 — inside MIN_INTERVAL_MS
  });
});

describe("useAutoSync — edit trigger", () => {
  it("debounces rapid bookStore edits into exactly one syncNow call", async () => {
    render(<Probe />);
    await act(async () => {
      await flush();
    });
    expect(mockSyncNow).toHaveBeenCalledTimes(1); // the mount trigger
    expect(mockBookStoreListener).toBeTruthy();

    act(() => {
      mockBookStoreListener?.();
      jest.advanceTimersByTime(DEBOUNCE_MS / 2);
      mockBookStoreListener?.(); // resets the debounce window
      mockBookStoreListener?.();
    });

    // Still inside the (reset) debounce window — no call yet.
    await act(async () => {
      jest.advanceTimersByTime(DEBOUNCE_MS - 1);
      await flush();
    });
    expect(mockSyncNow).toHaveBeenCalledTimes(1);

    await act(async () => {
      jest.advanceTimersByTime(2);
      await flush();
    });
    expect(mockSyncNow).toHaveBeenCalledTimes(2); // one call for three rapid edits
  });
});

describe("useAutoSync — single-flight", () => {
  it("coalesces a trigger that arrives mid-run into exactly one rerun", async () => {
    let resolveFirst!: (v: { pushed: number; pulled: number; deleted: number; failed: string[] }) => void;
    mockSyncNow.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
    );

    render(<Probe />);
    await act(async () => {
      await flush();
    });
    expect(mockSyncNow).toHaveBeenCalledTimes(1); // in flight, unresolved

    const handler = latestAppStateHandler();
    await act(async () => {
      handler("active"); // arrives while the first run is still pending
      await flush();
    });
    expect(mockSyncNow).toHaveBeenCalledTimes(1); // coalesced — no second call started

    await act(async () => {
      resolveFirst({ pushed: 0, pulled: 0, deleted: 0, failed: [] });
      await flush();
    });
    expect(mockSyncNow).toHaveBeenCalledTimes(2); // exactly one rerun after resolving
  });
});

describe("useAutoSync — guards", () => {
  it("blocks when locked (isUnlocked false)", async () => {
    mockIsUnlocked.mockResolvedValue(false);
    render(<Probe />);
    await act(async () => {
      await flush();
    });
    expect(mockSyncNow).not.toHaveBeenCalled();
  });

  it("blocks when signed out", async () => {
    mockAuthValue = { status: "signed_out", accessToken: null };
    render(<Probe />);
    await act(async () => {
      await flush();
    });
    expect(mockSyncNow).not.toHaveBeenCalled();
  });

  it("blocks in IS_DEMO", async () => {
    mockDemoState.IS_DEMO = true;
    render(<Probe />);
    await act(async () => {
      await flush();
    });
    expect(mockSyncNow).not.toHaveBeenCalled();
  });

  it("blocks when the autosync toggle is off", async () => {
    await AsyncStorage.setItem(AUTOSYNC_ENABLED_KEY, "false");
    render(<Probe />);
    await act(async () => {
      await flush();
    });
    expect(mockSyncNow).not.toHaveBeenCalled();
  });
});

describe("useAutoSync — error handling", () => {
  it("syncNow rejecting sets status to error, never throws, never alerts", async () => {
    mockSyncNow.mockRejectedValueOnce(new Error("network down"));
    render(<Probe />);
    await act(async () => {
      await flush();
    });
    expect(getSyncStatus().state).toBe("error");
    expect(mockAlert).not.toHaveBeenCalled();
  });
});

describe("useAutoSync — cleanup", () => {
  it("removes the AppState listener and unsubscribes from bookStore on unmount", async () => {
    const bookStoreUnsub = jest.fn();
    mockSubscribeBookStore.mockImplementationOnce((listener: () => void) => {
      mockBookStoreListener = listener;
      return bookStoreUnsub;
    });
    const appStateRemove = jest.fn();
    mockAddEventListener.mockImplementationOnce(() => ({ remove: appStateRemove }));

    const { unmount } = render(<Probe />);
    await act(async () => {
      await flush();
    });

    unmount();

    expect(appStateRemove).toHaveBeenCalledTimes(1);
    expect(bookStoreUnsub).toHaveBeenCalledTimes(1);
  });
});

describe("isAutoSyncEnabled / setAutoSyncEnabled", () => {
  it("defaults to enabled when the key is unset", async () => {
    expect(await isAutoSyncEnabled()).toBe(true);
  });

  it("reflects an explicit false", async () => {
    await setAutoSyncEnabled(false);
    expect(await isAutoSyncEnabled()).toBe(false);
  });

  it("reflects an explicit true", async () => {
    await setAutoSyncEnabled(false);
    await setAutoSyncEnabled(true);
    expect(await isAutoSyncEnabled()).toBe(true);
  });
});

describe("useSyncStatus", () => {
  it("reflects setSyncStatus updates", () => {
    act(() => {
      setSyncStatus({ state: "pending", toPush: 3, toPull: 0 });
    });
    const { getByTestId } = render(<StatusProbe />);
    expect(getByTestId("state").props.children).toBe("pending");

    act(() => {
      setSyncStatus({ state: "up_to_date" });
    });
    expect(getByTestId("state").props.children).toBe("up_to_date");
  });
});
