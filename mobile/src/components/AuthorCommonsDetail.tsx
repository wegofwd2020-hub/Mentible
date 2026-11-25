import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { useAuth } from "@/auth/AuthProvider";
import {
  ApiError,
  downloadCommonsArtifact,
  getAuthorCommons,
  type CommonsSummary,
} from "@/api/client";
import { downloadArtifact } from "@/storage/epubLibrary";
import { BookCover } from "@/components/BookCover";
import { spacing, typography, type Palette } from "@/constants/theme";
import { FRAUNCES } from "@/constants/fonts";
import { useTheme, useThemedStyles } from "@/theme";

type Detail = CommonsSummary & { description: string | null };
type Fmt = "epub" | "pdf";

const MIME: Record<Fmt, string> = { epub: "application/epub+zip", pdf: "application/pdf" };

function slug(title: string): string {
  return title.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase().slice(0, 60) || "book";
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function AuthorCommonsDetail({ bookId }: { bookId: string }) {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { accessToken } = useAuth();
  const [book, setBook] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Fmt | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!accessToken) return;
    let live = true;
    setLoading(true);
    getAuthorCommons(accessToken, bookId)
      .then((b) => live && setBook(b))
      .catch((e: unknown) => {
        if (!live) return;
        setError(
          e instanceof ApiError && e.status === 404
            ? "This book is no longer available."
            : "Couldn't load this book. Try again in a moment.",
        );
      })
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [accessToken, bookId]);

  const download = async (fmt: Fmt) => {
    if (!accessToken || !book) return;
    setBusy(fmt);
    setNotice(null);
    try {
      const bytes = await downloadCommonsArtifact(accessToken, bookId, fmt);
      if (bytes.byteLength === 0) {
        setNotice("Download failed. Try again in a moment.");
        return;
      }
      const res = await downloadArtifact(bytes, `${slug(book.title)}.${fmt}`, MIME[fmt]);
      setNotice(res.savedPath ? `Saved to ${res.savedPath}` : "Download started.");
    } catch (e) {
      setNotice(
        e instanceof ApiError && e.status === 404
          ? "This book is no longer available."
          : "Download failed. Try again in a moment.",
      );
    } finally {
      setBusy(null);
    }
  };

  if (loading) return <ActivityIndicator color={theme.primary} style={{ marginTop: spacing.xl }} />;
  if (error || !book) return <Text style={styles.error}>{error ?? "This book is no longer available."}</Text>;

  return (
    <ScrollView contentContainerStyle={styles.wrap}>
      <View style={styles.coverBox}>
        <BookCover title={book.title} size="large" coverSvg={book.cover_svg ?? undefined} />
      </View>
      <Text style={styles.title}>{book.title}</Text>
      <Text style={styles.meta}>{book.author_name}</Text>
      {book.description ? <Text style={styles.desc}>{book.description}</Text> : null}
      <View style={styles.facts}>
        <Text style={styles.meta}>{`Published by ${book.account_name}`}</Text>
        <Text style={styles.meta}>{`Version ${book.version}`}</Text>
        <Text style={styles.meta}>{`Published ${formatDate(book.published_at)}`}</Text>
      </View>
      <View style={styles.buttons}>
        {book.formats.map((fmt) => (
          <Pressable
            key={fmt}
            accessibilityRole="button"
            accessibilityLabel={`Download ${fmt.toUpperCase()}`}
            disabled={busy !== null}
            onPress={() => void download(fmt)}
            style={[styles.btn, busy !== null && { opacity: 0.6 }]}
          >
            <Text style={styles.btnText}>{`Download ${fmt.toUpperCase()}`}</Text>
          </Pressable>
        ))}
      </View>
      {notice ? <Text style={styles.notice}>{notice}</Text> : null}
    </ScrollView>
  );
}

const makeStyles = (c: Palette) => ({
  wrap: { padding: spacing.lg, gap: spacing.sm },
  coverBox: { alignSelf: "flex-start" as const, marginBottom: spacing.sm },
  title: { color: c.text, fontSize: typography.sizeXl, fontFamily: FRAUNCES.semibold },
  meta: { color: c.textSecondary, fontSize: typography.sizeSm },
  desc: { color: c.text, fontSize: typography.sizeMd, marginTop: spacing.sm },
  facts: { gap: 2, marginTop: spacing.sm },
  buttons: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: spacing.sm, marginTop: spacing.md },
  btn: { backgroundColor: c.primary, borderRadius: 8, paddingVertical: spacing.sm, paddingHorizontal: spacing.lg },
  btnText: { color: c.primaryText, fontWeight: "700" as const, fontSize: typography.sizeSm },
  notice: { color: c.textSecondary, fontSize: typography.sizeSm, marginTop: spacing.sm },
  error: { color: c.error, fontSize: typography.sizeMd, textAlign: "center" as const, padding: spacing.xl },
});
