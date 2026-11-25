import { Alert } from "@/lib/alert";
import { ApiError, hideAuthorCommons } from "@/api/client";

// Confirm, then take one of the author's own published books out of Author
// Commons. Cancel makes no request. The backend enforces ownership (403), which
// is surfaced as a short message via onError.
export function confirmHideFromCommons(opts: {
  token: string;
  bookId: string;
  title: string;
  onDone: () => void;
  onError: (message: string) => void;
}): void {
  const { token, bookId, title, onDone, onError } = opts;
  Alert.alert(
    "Hide from Author Commons?",
    `“${title}” will no longer be listed or downloadable by others. Your book and its files are kept.`,
    [
      { text: "Cancel", style: "cancel" },
      {
        text: "Hide",
        style: "destructive",
        onPress: () => {
          hideAuthorCommons(token, bookId)
            .then(onDone)
            .catch((e: unknown) =>
              onError(
                e instanceof ApiError && e.status === 403
                  ? "Only the book's publisher can hide it."
                  : "Couldn't hide this book. Try again in a moment.",
              ),
            );
        },
      },
    ],
  );
}
