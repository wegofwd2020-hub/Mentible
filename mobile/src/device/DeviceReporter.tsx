import { useEffect, useRef } from "react";
import { useAuth } from "@/auth/AuthProvider";
import { registerDevice } from "@/api/accountClient";
import { deviceLabel, devicePlatform, getOrCreateDeviceId } from "@/device/deviceIdentity";

// Reports this install's device identity to the backend whenever the user is
// signed in (on launch, and on each new session token — a lightweight heartbeat
// that bumps the device's last_seen). Renders nothing. Must live under
// AuthProvider so useAuth resolves. Failures are swallowed and retried on the
// next token change — device reporting must never block the app.
export function DeviceReporter() {
  const { status, accessToken } = useAuth();
  // The last token we successfully reported for — guards against re-posting on
  // every render while still re-reporting on a genuine token change / refresh.
  const reportedFor = useRef<string | null>(null);

  useEffect(() => {
    if (status !== "signed_in" || !accessToken) return;
    if (reportedFor.current === accessToken) return;
    reportedFor.current = accessToken;

    let active = true;
    void (async () => {
      try {
        const deviceId = await getOrCreateDeviceId();
        await registerDevice(accessToken, {
          device_id: deviceId,
          label: deviceLabel(),
          platform: devicePlatform(),
        });
      } catch {
        if (active) reportedFor.current = null; // allow a retry on the next change
      }
    })();
    return () => {
      active = false;
    };
  }, [status, accessToken]);

  return null;
}
