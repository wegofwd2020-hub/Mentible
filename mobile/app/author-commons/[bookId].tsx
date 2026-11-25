import { Pressable, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { PageContainer } from "@/components/PageContainer";
import { RequireSignIn } from "@/auth/RequireSignIn";
import { AuthorCommonsDetail } from "@/components/AuthorCommonsDetail";
import { spacing, typography } from "@/constants/theme";
import { useTheme } from "@/theme";

export default function AuthorCommonsBookScreen() {
  const { bookId } = useLocalSearchParams<{ bookId: string }>();
  const router = useRouter();
  const theme = useTheme();
  return (
    <RequireSignIn action="view this book">
      <PageContainer style={{ flex: 1 }}>
        <View style={{ padding: spacing.md }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back to Author Commons"
            onPress={() => (router.canGoBack() ? router.back() : router.replace("/author-commons"))}
          >
            <Text style={{ color: theme.primary, fontSize: typography.sizeMd }}>‹ Author Commons</Text>
          </Pressable>
        </View>
        {bookId ? <AuthorCommonsDetail bookId={bookId} /> : null}
      </PageContainer>
    </RequireSignIn>
  );
}
