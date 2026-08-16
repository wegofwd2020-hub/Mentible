// Test mock for `@/components/LessonRenderer`'s `TopicRenderer`.
//
// In the app, the trust draft viewers render section content through the ONE
// reader (web = real DOM div; native = an auto-height WebView) — an opaque
// render boundary that React Native Testing Library can't query as `<Text>`.
// The reader has its own tests; a *screen* test only needs to prove the viewer
// hands the reader the right topic. So this mock renders each section's heading
// + body as plain `<Text>` nodes, keeping `getByText(<prose>)` assertions
// meaningful without depending on reader internals or a real WebView.
const React = require("react");
const { Text } = require("react-native");

function TopicRenderer({ topic }) {
  const sections = (topic && topic.lesson && topic.lesson.sections) || [];
  return sections.flatMap((s, i) => [
    React.createElement(Text, { key: "h" + i }, s.heading),
    React.createElement(Text, { key: "b" + i }, s.body_markdown),
  ]);
}

module.exports = { TopicRenderer };
