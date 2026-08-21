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
  // `autoSync.ts` calls `runSyncExclusive`, not `syncNow`, directly — but
  // this file's tests are about the guard/trigger/single-flight wiring, not
  // the cross-caller mutex (that's `runSyncExclusive.test.ts`'s job), so the
  // mock forwards straight through with no serialization of its own.
  runSyncExclusive: (...args: unknown[]) => mockSyncNow(...args),
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

// Same edit-trigger wiring as bookStore's subscribe, for the EPUB library and
// shelfStore stores T5 folded into `syncNow` — the debounced edit trigger
// must fire on any of the three, not just book edits.
let mockEpubLibraryListener: (() => void) | null = null;
const mockSubscribeEpubLibrary = jest.fn((listener: () => void) => {
  mockEpubLibraryListener = listener;
  return jest.fn();
});
jest.mock("@/storage/epubLibrary", () => ({
  subscribeEpubLibrary: (listener: () => void) => mockSubscribeEpubLibrary(listener),
}));

let mockShelfStoreListener: (() => void) | null = null;
const mockSubscribeShelfStore = jest.fn((listener: () => void) => {
  mockShelfStoreListener = listener;
  return jest.fn();
});
jest.mock("@/storage/shelfStore", () => ({
  subscribeShelfStore: (listener: () => void) => mockSubscribeShelfStore(listener),
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

import {
  useAutoSync,
  AUTOSYNC_ENABLED_KEY,
  isAutoSyncEnabled,
  setAutoSyncEnabled,
  __resetAutoSyncForTests,
} from "@/sync/autoSync";
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
  // autoSync.ts's lock/queue/throttle/authRef state is module-level (a
  // singleton) — reset it explicitly so one test's run can't leave the lock
  // held, `lastRunAt` set, or a stale token behind for the next test.
  __resetAutoSyncForTests();

  mockAuthValue = { status: "signed_in", accessToken: "test-token" };
  mockDemoState.IS_DEMO = false;
  mockBookStoreListener = null;
  mockEpubLibraryListener = null;
  mockShelfStoreListener = null;

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

  it("also fires the debounced trigger for epubLibrary and shelfStore edits (T5)", async () => {
    render(<Probe />);
    await act(async () => {
      await flush();
    });
    expect(mockSyncNow).toHaveBeenCalledTimes(1); // the mount trigger
    expect(mockEpubLibraryListener).toBeTruthy();
    expect(mockShelfStoreListener).toBeTruthy();

    act(() => {
      mockEpubLibraryListener?.();
    });
    await act(async () => {
      jest.advanceTimersByTime(DEBOUNCE_MS + 1);
      await flush();
    });
    expect(mockSyncNow).toHaveBeenCalledTimes(2); // an epub edit alone triggers a sync

    act(() => {
      mockShelfStoreListener?.();
    });
    await act(async () => {
      jest.advanceTimersByTime(DEBOUNCE_MS + 1);
      await flush();
    });
    expect(mockSyncNow).toHaveBeenCalledTimes(3); // a shelf edit alone triggers a sync
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

describe("useAutoSync — concurrent-trigger race", () => {
  it("two triggers arriving in the same synchronous tick still call syncNow exactly once while the run is in flight", async () => {
    // Repro of the reported TOCTOU: the sign-in effect and a cold-start
    // AppState "active" event can fire back-to-back, both potentially
    // observing `running === false` if the lock were only set after an
    // `await`. Here we fire the second trigger synchronously, right after
    // `render()` returns (i.e. before the first trigger's guard-check
    // awaits have had any chance to resolve) — the synchronous
    // check-and-set lock in `pump()` must still only start one `syncNow`.
    let resolveFirst!: (v: { pushed: number; pulled: number; deleted: number; failed: string[] }) => void;
    mockSyncNow.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
    );

    render(<Probe />); // synchronously fires the sign-in trigger via its effect
    const handler = latestAppStateHandler(); // AppState listener registered during the same render
    handler("active"); // arrives in the same tick, before any guard-await has settled

    await act(async () => {
      await flush();
    });
    expect(mockSyncNow).toHaveBeenCalledTimes(1); // exactly one syncNow while in flight — no race duplicate

    await act(async () => {
      resolveFirst({ pushed: 0, pulled: 0, deleted: 0, failed: [] });
      await flush();
    });
    expect(mockSyncNow).toHaveBeenCalledTimes(2); // exactly one coalesced rerun (the "active" trigger)

    // Settled — no further reruns from a request that no longer exists.
    await act(async () => {
      await flush();
    });
    expect(mockSyncNow).toHaveBeenCalledTimes(2);
  });
});

describe("useAutoSync — coalesced rerun re-guards freshly", () => {
  it("a rerun triggered mid-run uses the CURRENT token, not the one captured when the run started", async () => {
    let resolveFirst!: (v: { pushed: number; pulled: number; deleted: number; failed: string[] }) => void;
    mockSyncNow.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
    );

    const { rerender } = render(<Probe />);
    await act(async () => {
      await flush();
    });
    expect(mockSyncNow).toHaveBeenNthCalledWith(1, "test-token");

    // Token rotates (e.g. a refresh) while the first run is still pending —
    // re-render so the controller's auth snapshot picks it up (its own
    // sign-in effect also requests a sync on the token change).
    mockAuthValue = { status: "signed_in", accessToken: "rotated-token" };
    rerender(<Probe />);
    await act(async () => {
      await flush();
    });

    // A foreground trigger arrives mid-run too — belt & suspenders on top of
    // the rerender's own sign-in-triggered request.
    const handler = latestAppStateHandler();
    await act(async () => {
      handler("active");
      await flush();
    });
    expect(mockSyncNow).toHaveBeenCalledTimes(1); // still just the in-flight first call

    await act(async () => {
      resolveFirst({ pushed: 0, pulled: 0, deleted: 0, failed: [] });
      await flush();
    });
    expect(mockSyncNow).toHaveBeenCalledTimes(2);
    expect(mockSyncNow).toHaveBeenNthCalledWith(2, "rotated-token"); // fresh token, never the stale one
  });

  it("a rerun does NOT call syncNow if a guard flips false before the drain loop re-checks it", async () => {
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
    expect(mockSyncNow).toHaveBeenCalledTimes(1);

    const handler = latestAppStateHandler();
    await act(async () => {
      handler("active"); // coalesces a rerun request
      await flush();
    });
    expect(mockSyncNow).toHaveBeenCalledTimes(1);

    // The guard flips false before the drain loop gets to re-check it.
    mockIsUnlocked.mockResolvedValue(false);

    await act(async () => {
      resolveFirst({ pushed: 0, pulled: 0, deleted: 0, failed: [] });
      await flush();
    });
    expect(mockSyncNow).toHaveBeenCalledTimes(1); // rerun's guard check failed — no second call
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

  it("a token nulled during the isUnlocked() await (after the !!token guard passed) skips the run — no syncNow, no throw", async () => {
    // Repro of the LOW finding: `pump()` checks `!!authRef.current.accessToken`
    // as part of the synchronous guard expression BEFORE `await isUnlocked()`
    // is reached, then re-reads `authRef.current.accessToken` AFTER all guards
    // resolve. A sign-out landing in that `isUnlocked()` await window nulls the
    // token out from under it. Reproduced here by holding `isUnlocked()`
    // pending, mutating `authRef` (via a rerender picking up a new `useAuth()`
    // value) while it's still pending, then resolving it true.
    let resolveUnlocked!: (v: boolean) => void;
    mockIsUnlocked.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          resolveUnlocked = resolve;
        }),
    );

    const { rerender } = render(<Probe />);
    await act(async () => {
      await flush();
    });
    expect(mockSyncNow).not.toHaveBeenCalled(); // still stuck awaiting isUnlocked()

    // The token drops out from under the in-flight guard check — status stays
    // "signed_in" (an actual sign-out would also flip status, but a null
    // token alone is the precise window the guard-order fix targets).
    mockAuthValue = { status: "signed_in", accessToken: null };
    rerender(<Probe />);
    await act(async () => {
      await flush();
    });

    await act(async () => {
      resolveUnlocked(true); // all other guards passed; isUnlocked() now resolves true too
      await flush();
    });

    expect(mockSyncNow).not.toHaveBeenCalled(); // null-token guard skipped the run
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
  it("removes the AppState listener and unsubscribes from bookStore, epubLibrary, and shelfStore on unmount", async () => {
    const bookStoreUnsub = jest.fn();
    mockSubscribeBookStore.mockImplementationOnce((listener: () => void) => {
      mockBookStoreListener = listener;
      return bookStoreUnsub;
    });
    const epubLibraryUnsub = jest.fn();
    mockSubscribeEpubLibrary.mockImplementationOnce((listener: () => void) => {
      mockEpubLibraryListener = listener;
      return epubLibraryUnsub;
    });
    const shelfStoreUnsub = jest.fn();
    mockSubscribeShelfStore.mockImplementationOnce((listener: () => void) => {
      mockShelfStoreListener = listener;
      return shelfStoreUnsub;
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
    expect(epubLibraryUnsub).toHaveBeenCalledTimes(1);
    expect(shelfStoreUnsub).toHaveBeenCalledTimes(1);
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
