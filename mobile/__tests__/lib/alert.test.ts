/**
 * Cross-platform Alert shim — the web mapping (the bug fix). react-native-web has
 * no Alert.alert, so on web the shim routes to window.confirm/alert and fires the
 * buttons' onPress. We mock react-native as web here and assert the routing.
 */
const mockRNAlert = jest.fn();
jest.mock("react-native", () => ({
  Platform: { OS: "web" },
  Alert: { alert: mockRNAlert },
}));

import { Alert } from "@/lib/alert";

describe("Alert shim on web", () => {
  const realConfirm = global.confirm;
  const realAlert = global.alert;

  afterEach(() => {
    global.confirm = realConfirm;
    global.alert = realAlert;
    jest.clearAllMocks();
  });

  it("runs the action button's onPress when the confirm is accepted", () => {
    global.confirm = jest.fn(() => true) as unknown as typeof global.confirm;
    const action = jest.fn();
    const cancel = jest.fn();
    Alert.alert("Delete user?", "This can't be undone.", [
      { text: "Cancel", style: "cancel", onPress: cancel },
      { text: "Delete", style: "destructive", onPress: action },
    ]);
    expect(action).toHaveBeenCalledTimes(1);
    expect(cancel).not.toHaveBeenCalled();
    expect(mockRNAlert).not.toHaveBeenCalled(); // never falls through to native
  });

  it("runs the cancel button's onPress when the confirm is dismissed", () => {
    global.confirm = jest.fn(() => false) as unknown as typeof global.confirm;
    const action = jest.fn();
    const cancel = jest.fn();
    Alert.alert("Delete user?", undefined, [
      { text: "Cancel", style: "cancel", onPress: cancel },
      { text: "Delete", style: "destructive", onPress: action },
    ]);
    expect(action).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("shows an info alert and runs the single button's onPress", () => {
    global.alert = jest.fn() as unknown as typeof global.alert;
    const ok = jest.fn();
    Alert.alert("Cleared", "All device-local provider keys were removed.", [
      { text: "OK", onPress: ok },
    ]);
    expect(global.alert).toHaveBeenCalledTimes(1);
    expect(ok).toHaveBeenCalledTimes(1);
  });
});
