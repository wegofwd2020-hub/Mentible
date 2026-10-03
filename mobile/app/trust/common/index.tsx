import { useCallback, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, Text, TextInput, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useCommonProjects } from "@/hooks/useCommonProjects";
import { useResponsive } from "@/hooks/useResponsive";
import { useThemedStyles } from "@/hooks/useThemedStyles";
import { RequireSignIn } from "@/auth/RequireSignIn";
import { PageContainer } from "@/components/layout/PageContainer";
import { Card, Label } from "@/components/ui";
import { Palette } from "@/constants/theme";
import { FRAUNCES } from "@/constants/fonts";
import type { CommonProjectSummary } from "@/api/trustClient";

const makeStyles = (c: Palette) => ({
  header: { paddingBottom: 16 },
  kicker: { color: c.secondary, marginBottom: 4 },
  title: { fontSize: 32, fontFamily: FRAUNCES, fontWeight: "600", color: c.foreground, marginBottom: 12 },
  searchInput: { borderWidth: 1, borderColor: c.border, borderRadius: 8, padding: 12, marginBottom: 24, color: c.foreground, fontSize: 16 },
  list: { flex: 1 },
  contentContainer: { paddingHorizontal: 16, paddingVertical: 12 },
  card: { marginBottom: 12, cursor: "pointer" },
  cardContent: { flex: 1 },
  cardTitle: { fontSize: 18, fontFamily: FRAUNCES, fontWeight: "600", color: c.foreground, marginBottom: 4 },
  cardDescription: { fontSize: 14, color: c.secondary, marginBottom: 8, lineHeight: 20 },
  cardAuthor: { fontSize: 12, color: c.tertiary },
  emptyCard: {
    borderWidth: 2,
    borderStyle: "dashed",
    borderColor: c.border,
    borderRadius: 8,
    padding: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyTitle: { fontSize: 16, fontWeight: "600", color: c.foreground, textAlign: "center", marginBottom: 8 },
  emptyText: { fontSize: 14, color: c.secondary, textAlign: "center" },
  error: { color: c.error, padding: 16, textAlign: "center" },
});

function CommonProjectCard({ item, onPress }: { item: CommonProjectSummary; onPress: () => void }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <Pressable onPress={onPress} accessibilityLabel={`Open project: ${item.title}`}>
      <Card style={styles.card}>
        <View style={styles.cardContent}>
          <Text style={styles.cardTitle}>{item.title}</Text>
          {item.description && <Text style={styles.cardDescription} numberOfLines={2}>{item.description}</Text>}
          <Text style={styles.cardAuthor}>By {item.author_name}</Text>
        </View>
      </Card>
    </Pressable>
  );
}

function CommonProjectsInner() {
  const router = useRouter();
  const { isTablet } = useResponsive();
  const [searchQuery, setSearchQuery] = useState("");
  const { projects, loading, error, refresh } = useCommonProjects(searchQuery ? { q: searchQuery } : undefined);
  const styles = useThemedStyles(makeStyles);

  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));

  if (error) {
    return <Text style={styles.error}>{error}</Text>;
  }

  if (loading && projects.length === 0) {
    return <ActivityIndicator size="large" style={{ flex: 1, justifyContent: "center" }} />;
  }

  return (
    <View style={styles.list}>
      <View style={styles.header}>
        <Label style={styles.kicker}>DISCOVER</Label>
        <Text style={styles.title}>Common Projects</Text>
        <TextInput
          style={styles.searchInput}
          placeholder="Search by title..."
          placeholderTextColor="#999"
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
      </View>

      {projects.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>No shared projects yet</Text>
          <Text style={styles.emptyText}>Authors will publish their projects here for you to import and build upon.</Text>
        </View>
      ) : (
        <FlatList
          data={projects}
          keyExtractor={(item) => item.id}
          numColumns={isTablet ? 2 : 1}
          key={isTablet ? "grid2" : "grid1"}
          columnWrapperStyle={isTablet ? { gap: 16 } : undefined}
          contentContainerStyle={styles.contentContainer}
          renderItem={({ item }) => (
            <CommonProjectCard
              item={item}
              onPress={() => router.push(`/trust/common/${item.id}`)}
            />
          )}
          onEndReachedThreshold={0.5}
          onEndReached={() => { /* load more if paginated */ }}
        />
      )}
    </View>
  );
}

export default function CommonProjectsScreen() {
  return (
    <RequireSignIn action="browse common projects">
      <PageContainer style={{ flex: 1 }}>
        <CommonProjectsInner />
      </PageContainer>
    </RequireSignIn>
  );
}
