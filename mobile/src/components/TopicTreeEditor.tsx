import React, { useCallback } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { radius, spacing, typography, type Palette } from "@/constants/theme";
import { useTheme, useThemedStyles } from "@/theme";
import { randomUUID } from "@/lib/uuid";
import {
  subtopicLabel,
  subtopicDetail,
  type StructuredTOC,
  type SubjectNode,
  type TopicNode,
} from "@/types/book";

interface Props {
  toc: StructuredTOC;
  onChange: (next: StructuredTOC) => void;
}

// The TOC is plain JSON data, so a structural clone is the simplest safe way to
// produce the next immutable value before handing it back via onChange.
function clone(toc: StructuredTOC): StructuredTOC {
  return JSON.parse(JSON.stringify(toc)) as StructuredTOC;
}

function emptyUnit(): TopicNode {
  return { id: randomUUID(), title: "New topic", subtopics: [], prerequisites: [] };
}

function emptySubject(): SubjectNode {
  return { subject_label: "New subject", units: [emptyUnit()] };
}

function move<T>(arr: T[], from: number, to: number): void {
  if (to < 0 || to >= arr.length) return;
  const [item] = arr.splice(from, 1);
  arr.splice(to, 0, item);
}

// A small round icon-button used for add / remove / reorder actions.
function MiniButton({
  label,
  glyph,
  onPress,
  tone = "default",
  styles,
}: {
  label: string;
  glyph: string;
  onPress: () => void;
  tone?: "default" | "danger";
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={[styles.mini, tone === "danger" && styles.miniDanger]}
    >
      <Text style={[styles.miniGlyph, tone === "danger" && styles.miniGlyphDanger]}>
        {glyph}
      </Text>
    </Pressable>
  );
}

export function TopicTreeEditor({ toc, onChange }: Props) {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const mutate = useCallback(
    (fn: (draft: StructuredTOC) => void) => {
      const draft = clone(toc);
      fn(draft);
      onChange(draft);
    },
    [toc, onChange],
  );

  return (
    <View style={styles.root}>
      {toc.subjects.map((subject, si) => (
        <View key={si} style={styles.subjectCard}>
          {/* Subject header */}
          <View style={styles.subjectHeader}>
            <TextInput
              style={styles.subjectInput}
              value={subject.subject_label}
              onChangeText={(t) =>
                mutate((d) => {
                  d.subjects[si].subject_label = t;
                })
              }
              placeholder="Subject"
              placeholderTextColor={theme.textMuted}
              accessibilityLabel={`Subject ${si + 1} label`}
            />
            <MiniButton
              styles={styles}
              label={`Remove subject ${si + 1}`}
              glyph="✕"
              tone="danger"
              onPress={() =>
                mutate((d) => {
                  d.subjects.splice(si, 1);
                })
              }
            />
          </View>

          {/* Units */}
          {subject.units.map((unit, ui) => (
            <View key={ui} style={styles.unitCard}>
              <View style={styles.unitHeader}>
                <TextInput
                  style={styles.unitInput}
                  value={unit.title}
                  onChangeText={(t) =>
                    mutate((d) => {
                      d.subjects[si].units[ui].title = t;
                    })
                  }
                  placeholder="Topic title"
                  placeholderTextColor={theme.textMuted}
                  accessibilityLabel={`Topic ${si + 1}.${ui + 1} title`}
                />
                <MiniButton
                  styles={styles}
                  label={`Move topic ${si + 1}.${ui + 1} up`}
                  glyph="↑"
                  onPress={() => mutate((d) => move(d.subjects[si].units, ui, ui - 1))}
                />
                <MiniButton
                  styles={styles}
                  label={`Move topic ${si + 1}.${ui + 1} down`}
                  glyph="↓"
                  onPress={() => mutate((d) => move(d.subjects[si].units, ui, ui + 1))}
                />
                <MiniButton
                  styles={styles}
                  label={`Remove topic ${si + 1}.${ui + 1}`}
                  glyph="✕"
                  tone="danger"
                  onPress={() =>
                    mutate((d) => {
                      d.subjects[si].units.splice(ui, 1);
                    })
                  }
                />
              </View>

              {/* Subtopics — a short label (shown in the outline + folded into
                  the generation topic) plus optional detail (the longer scope
                  text, fed to generation as guidance). */}
              {unit.subtopics.map((sub, sti) => (
                <View key={sti} style={styles.subtopicCol}>
                  <View style={styles.subtopicRow}>
                    <Text style={styles.bullet}>•</Text>
                    <TextInput
                      style={styles.subtopicInput}
                      value={subtopicLabel(sub)}
                      onChangeText={(t) =>
                        mutate((d) => {
                          const cur = d.subjects[si].units[ui].subtopics[sti];
                          d.subjects[si].units[ui].subtopics[sti] = {
                            label: t,
                            detail: subtopicDetail(cur),
                          };
                        })
                      }
                      placeholder="Subtopic"
                      placeholderTextColor={theme.textMuted}
                      accessibilityLabel={`Subtopic ${si + 1}.${ui + 1}.${sti + 1} label`}
                    />
                    <MiniButton
                      styles={styles}
                      label={`Remove subtopic ${si + 1}.${ui + 1}.${sti + 1}`}
                      glyph="✕"
                      tone="danger"
                      onPress={() =>
                        mutate((d) => {
                          d.subjects[si].units[ui].subtopics.splice(sti, 1);
                        })
                      }
                    />
                  </View>
                  <TextInput
                    style={styles.detailInput}
                    value={subtopicDetail(sub) ?? ""}
                    onChangeText={(t) =>
                      mutate((d) => {
                        const cur = d.subjects[si].units[ui].subtopics[sti];
                        d.subjects[si].units[ui].subtopics[sti] = {
                          label: subtopicLabel(cur),
                          detail: t.trim() ? t : undefined,
                        };
                      })
                    }
                    placeholder="Detail (optional — scope guidance for generation)"
                    placeholderTextColor={theme.textMuted}
                    multiline
                    accessibilityLabel={`Subtopic ${si + 1}.${ui + 1}.${sti + 1} detail`}
                  />
                </View>
              ))}

              {/* Prerequisites — read-only chips at this phase (editing deferred) */}
              {unit.prerequisites.length > 0 && (
                <View style={styles.prereqRow}>
                  <Text style={styles.prereqLabel}>Requires:</Text>
                  {unit.prerequisites.map((p, pi) => (
                    <Text key={pi} style={styles.prereqChip}>
                      {p}
                    </Text>
                  ))}
                </View>
              )}

              <Pressable
                style={styles.addInline}
                accessibilityRole="button"
                accessibilityLabel={`Add subtopic to topic ${si + 1}.${ui + 1}`}
                onPress={() =>
                  mutate((d) => {
                    d.subjects[si].units[ui].subtopics.push({ label: "New subtopic" });
                  })
                }
              >
                <Text style={styles.addInlineText}>+ Subtopic</Text>
              </Pressable>
            </View>
          ))}

          <Pressable
            style={styles.addUnit}
            accessibilityRole="button"
            accessibilityLabel={`Add topic to subject ${si + 1}`}
            onPress={() =>
              mutate((d) => {
                d.subjects[si].units.push(emptyUnit());
              })
            }
          >
            <Text style={styles.addUnitText}>+ Add topic</Text>
          </Pressable>
        </View>
      ))}

      <Pressable
        style={styles.addSubject}
        accessibilityRole="button"
        accessibilityLabel="Add subject"
        onPress={() =>
          mutate((d) => {
            d.subjects.push(emptySubject());
          })
        }
      >
        <Text style={styles.addSubjectText}>+ Add subject</Text>
      </Pressable>
    </View>
  );
}

const makeStyles = (c: Palette) => ({
  root: { gap: spacing.md },
  subjectCard: {
    backgroundColor: c.surface,
    borderColor: c.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  subjectHeader: { flexDirection: "row" as const, alignItems: "center" as const, gap: spacing.sm },
  subjectInput: {
    flex: 1,
    color: c.text,
    fontSize: typography.sizeLg,
    fontWeight: "700" as const,
    borderBottomColor: c.borderLight,
    borderBottomWidth: 1,
    paddingVertical: spacing.xs,
  },
  unitCard: {
    backgroundColor: c.surfaceHigh,
    borderRadius: radius.sm,
    padding: spacing.sm,
    gap: spacing.xs,
  },
  unitHeader: { flexDirection: "row" as const, alignItems: "center" as const, gap: spacing.xs },
  unitInput: {
    flex: 1,
    color: c.text,
    fontSize: typography.sizeMd,
    fontWeight: "600" as const,
    paddingVertical: spacing.xs,
  },
  subtopicCol: {
    marginBottom: spacing.xs,
  },
  subtopicRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: spacing.xs,
    paddingLeft: spacing.sm,
  },
  bullet: { color: c.textMuted, fontSize: typography.sizeMd },
  subtopicInput: {
    flex: 1,
    color: c.text,
    fontSize: typography.sizeSm,
    fontWeight: "600" as const,
    paddingVertical: 2,
  },
  detailInput: {
    color: c.textMuted,
    fontSize: typography.sizeXs,
    lineHeight: 18,
    paddingVertical: 2,
    // Align under the label text (bullet + gap), set off as secondary scope.
    paddingLeft: spacing.sm + spacing.md,
  },
  prereqRow: {
    flexDirection: "row" as const,
    flexWrap: "wrap" as const,
    alignItems: "center" as const,
    gap: spacing.xs,
    paddingLeft: spacing.sm,
    marginTop: spacing.xs,
  },
  prereqLabel: { color: c.textMuted, fontSize: typography.sizeXs },
  prereqChip: {
    color: c.textSecondary,
    fontSize: typography.sizeXs,
    backgroundColor: c.background,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  mini: {
    width: 30,
    height: 30,
    borderRadius: radius.full,
    backgroundColor: c.background,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  miniDanger: { backgroundColor: c.error + "22" },
  miniGlyph: { color: c.textSecondary, fontSize: typography.sizeMd, fontWeight: "700" as const },
  miniGlyphDanger: { color: c.error },
  addInline: { alignSelf: "flex-start" as const, paddingVertical: spacing.xs, paddingLeft: spacing.sm },
  addInlineText: { color: c.primary, fontSize: typography.sizeXs, fontWeight: "600" as const },
  addUnit: {
    alignSelf: "flex-start" as const,
    paddingVertical: spacing.xs,
  },
  addUnitText: { color: c.primary, fontSize: typography.sizeSm, fontWeight: "600" as const },
  addSubject: {
    borderColor: c.borderLight,
    borderWidth: 1,
    borderStyle: "dashed" as const,
    borderRadius: radius.md,
    padding: spacing.md,
    alignItems: "center" as const,
  },
  addSubjectText: { color: c.primary, fontSize: typography.sizeMd, fontWeight: "600" as const },
});
