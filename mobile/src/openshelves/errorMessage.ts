// mobile/src/openshelves/errorMessage.ts
// Shared error→message mapping for the Open Shelves hooks.
import { FeedSourceError } from "./errors";

export function toMessage(err: unknown): string {
  if (err instanceof FeedSourceError && err.authRequired) {
    return "Authenticated repos aren't supported yet.";
  }
  return (err as Error)?.message ?? "Something went wrong.";
}
