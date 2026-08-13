import React from "react";
import { Pressable, type StyleProp, type ViewStyle } from "react-native";
import { useRouter } from "expo-router";
import { useManagedStatus } from "@/hooks/useManagedStatus";
import { UsageMeterPill } from "@/components/UsageMeterPill";

// Wires the compact managed-plan quota indicator (`UsageMeterPill`) into the
// app chrome (TopNavBar + SideNav) so a managed-plan user sees their quota
// everywhere. `useManagedStatus` yields `status:null` for signed-out/BYOK
// users (or on a failed fetch — non-critical chrome), in which case this
// renders nothing and the surrounding chrome is unchanged. Even when
// `status` is non-null, `UsageMeterPill` itself renders null for a null
// entitlement (BYOK-with-account), so nothing shows for those users either.
// `style` lets each chrome host (TopNavBar row vs. SideNav column) place it
// without this shared component hard-coding either layout.
export function ChromeUsageMeter({
  style,
}: {
  style?: StyleProp<ViewStyle>;
} = {}): React.JSX.Element | null {
  const router = useRouter();
  const { status } = useManagedStatus();

  if (!status) return null;

  return (
    <Pressable
      onPress={() => router.push("/usage")}
      accessibilityRole="button"
      accessibilityLabel="Usage — open details"
      style={style}
    >
      <UsageMeterPill status={status} />
    </Pressable>
  );
}
