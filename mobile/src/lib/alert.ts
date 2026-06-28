import { Alert as RNAlert, Platform } from "react-native";
import type { AlertButton, AlertOptions } from "react-native";

// Cross-platform Alert. react-native-web (0.19) does NOT implement Alert.alert —
// it's a silent no-op, so confirmation dialogs (Delete account, admin Delete user,
// Remove saved keys, …) and info alerts do nothing on web. On native we delegate to
// the real RN Alert; on web we map to window.confirm/alert so each button's onPress
// still fires. Browser dialogs are plain but functional — a styled in-app confirm
// modal is a possible future polish (Option B in the bug triage).

// Reach the browser dialogs without a hard dependency on DOM lib types in the RN
// tsconfig (web-only path; guarded by Platform.OS === "web").
const dom = globalThis as unknown as {
  confirm?: (message?: string) => boolean;
  alert?: (message?: string) => void;
};

function webAlert(title: string, message?: string, buttons?: AlertButton[]): void {
  const text = [title, message].filter(Boolean).join("\n\n");
  const btns = buttons ?? [];

  // 0–1 button ⇒ informational: show it, then run the (single) button's onPress.
  if (btns.length <= 1) {
    dom.alert?.(text);
    btns[0]?.onPress?.();
    return;
  }

  // 2+ buttons ⇒ confirm: OK runs the first non-cancel (action) button; Cancel runs
  // the cancel button. window.confirm is binary, so a rare 3-button alert collapses
  // to action-vs-cancel.
  const confirmed = dom.confirm?.(text) ?? false;
  const action = btns.find((b) => b.style !== "cancel") ?? btns[0];
  const cancel = btns.find((b) => b.style === "cancel");
  (confirmed ? action : cancel)?.onPress?.();
}

// Drop-in replacement for react-native's Alert (the `.alert` static is all the app
// uses). Import from "@/lib/alert" instead of "react-native".
export const Alert = {
  alert(
    title: string,
    message?: string,
    buttons?: AlertButton[],
    options?: AlertOptions,
  ): void {
    if (Platform.OS === "web") {
      webAlert(title, message, buttons);
    } else {
      RNAlert.alert(title, message, buttons, options);
    }
  },
};
