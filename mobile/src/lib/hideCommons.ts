import { Alert } from "@/lib/alert";
import { ApiError, hideAuthorCommons } from "@/api/client";

// Confirm, then recall one of the author's own published books from Author
// Commons ("recall" is the user-facing word; the API route is still /hide).
// Cancel makes no request. The backend enforces ownership (403), which is
// surfaced as a short message via onError.
export function confirmHideFromCommons(opts: {
  token: string;
  bookId: string;
  title: string;
  onDone: () => void;
  onError: (message: string) => void;
}): void {
  const { token, bookId, title, onDone, onError } = opts;
  Alert.alert(
    "Recall from Author Commons?",
    `“${title}” will no longer be listed or downloadable by others. Your book and its files are kept, and you can publish it again any time.`,
    [
      { text: "Cancel", style: "cancel" },
      {
        text: "Recall",
        style: "destructive",
        onPress: () => {
          hideAuthorCommons(token, bookId)
            .then(onDone)
            .catch((e: unknown) =>
              onError(
                e instanceof ApiError && e.status === 403
                  ? "Only the book's publisher can recall it."
                  : "Couldn't recall this book. Try again in a moment.",
              ),
            );
        },
      },
    ],
  );
}
