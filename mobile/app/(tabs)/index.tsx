import { Redirect } from "expo-router";

// The launch/landing route. Per product decision the app opens on the Library,
// so "/" redirects there. This screen renders nothing visible.
export default function Index() {
  return <Redirect href="/library" />;
}
