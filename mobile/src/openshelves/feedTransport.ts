// Where a feed request goes. Native fetches the feed directly (ADR-028: device ->
// source). The browser CANNOT: OPDS feeds send no Access-Control-Allow-Origin, so a
// direct cross-origin fetch is blocked by CORS. On web we ask our backend to fetch
// the feed DOCUMENT for us (metadata only — book files still download source ->
// device, via the browser's own download).
//
// This seam swaps only the request URL. fetchFeed keeps one body.
import { Platform } from "react-native";
import { resolveBaseUrl } from "@/api/client";
import { FeedParseError, FeedSourceError } from "./errors";

export const usesFeedProxy = Platform.OS === "web";

// `isWeb` is a parameter, not a constant read inside the body: jest-expo runs the
// NATIVE preset, so Platform.OS === "web" is never true under test and a module-level
// branch could only be tested vacuously.
export function feedRequestUrl(feedUrl: string, isWeb: boolean = usesFeedProxy): string {
  if (!isWeb) return feedUrl;
  return `${resolveBaseUrl()}/api/v1/shelves/feed?url=${encodeURIComponent(feedUrl)}`;
}

// The backend answers failures as {"detail": {"code", "message"}} — map each code
// back onto the same error vocabulary the direct path produces, so the UI copy is
// identical on web and native.
export async function proxyErrorFor(resp: Response): Promise<Error> {
  let code = "";
  let message = "";
  try {
    const body = await resp.json();
    const detail = body?.detail;
    if (typeof detail === "string") {
      // The rate limiter (and other non-router raisers) may emit a plain
      // string `detail` instead of the router's {code, message} shape.
      // Use it directly rather than reading .code/.message off a string.
      message = detail;
    } else {
      code = detail?.code ?? "";
      message = detail?.message ?? "";
    }
  } catch {
    // A non-JSON error body (a gateway's own 502 page, say) — fall through.
  }
  if (!message) message = `Could not reach the feed (HTTP ${resp.status}).`;

  if (code === "auth_required") return new FeedSourceError(message, { authRequired: true });
  if (code === "too_large") return new FeedParseError(message);
  return new FeedSourceError(message);
}
