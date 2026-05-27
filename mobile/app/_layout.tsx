import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";

export default function RootLayout() {
  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: "#0f172a" },
          headerTintColor: "#f1f5f9",
          headerTitleStyle: { fontWeight: "700" },
          contentStyle: { backgroundColor: "#0f172a" },
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen
          name="lesson/[jobId]"
          options={{
            title: "Lesson",
            headerBackTitle: "Back",
          }}
        />
        <Stack.Screen
          name="book/new"
          options={{
            title: "New book",
            headerBackTitle: "Books",
          }}
        />
        <Stack.Screen
          name="book/saved/[id]"
          options={{
            title: "Edit book",
            headerBackTitle: "Books",
          }}
        />
        <Stack.Screen
          name="book/generate/[id]"
          options={{
            title: "Generate topics",
            headerBackTitle: "Back",
          }}
        />
        <Stack.Screen
          name="book/topic/[bookId]/[topicId]"
          options={{
            title: "Topic",
            headerBackTitle: "Back",
          }}
        />
        <Stack.Screen
          name="book/read/[id]"
          options={{
            title: "Read",
            headerBackTitle: "Library",
          }}
        />
      </Stack>
    </>
  );
}
