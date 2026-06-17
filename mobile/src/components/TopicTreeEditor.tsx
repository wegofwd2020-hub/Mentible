import React, { useCallback } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { colors, radius, spacing, typography } from "@/constants/theme";
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
}: {
  label: string;
  glyph: string;
  onPress: () => void;
  tone?: "default" | "danger";
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
              placeholderTextColor={colors.textMuted}
              accessibilityLabel={`Subject ${si + 1} label`}
            />
            <MiniButton
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
                  placeholderTextColor={colors.textMuted}
                  accessibilityLabel={`Topic ${si + 1}.${ui + 1} title`}
                />
                <MiniButton
                  label={`Move topic ${si + 1}.${ui + 1} up`}
                  glyph="↑"
                  onPress={() => mutate((d) => move(d.subjects[si].units, ui, ui - 1))}
                />
                <MiniButton
                  label={`Move topic ${si + 1}.${ui + 1} down`}
                  glyph="↓"
                  onPress={() => mutate((d) => move(d.subjects[si].units, ui, ui + 1))}
                />
                <MiniButton
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
                      placeholderTextColor={colors.textMuted}
                      accessibilityLabel={`Subtopic ${si + 1}.${ui + 1}.${sti + 1} label`}
                    />
                    <MiniButton
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
                    placeholderTextColor={colors.textMuted}
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

const styles = StyleSheet.create({
  root: { gap: spacing.md },
  subjectCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  subjectHeader: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  subjectInput: {
    flex: 1,
    color: colors.text,
    fontSize: typography.sizeLg,
    fontWeight: "700",
    borderBottomColor: colors.borderLight,
    borderBottomWidth: 1,
    paddingVertical: spacing.xs,
  },
  unitCard: {
    backgroundColor: colors.surfaceHigh,
    borderRadius: radius.sm,
    padding: spacing.sm,
    gap: spacing.xs,
  },
  unitHeader: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  unitInput: {
    flex: 1,
    color: colors.text,
    fontSize: typography.sizeMd,
    fontWeight: "600",
    paddingVertical: spacing.xs,
  },
  subtopicCol: {
    marginBottom: spacing.xs,
  },
  subtopicRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingLeft: spacing.sm,
  },
  bullet: { color: colors.textMuted, fontSize: typography.sizeMd },
  subtopicInput: {
    flex: 1,
    color: colors.text,
    fontSize: typography.sizeSm,
    fontWeight: "600",
    paddingVertical: 2,
  },
  detailInput: {
    color: colors.textMuted,
    fontSize: typography.sizeXs,
    lineHeight: 18,
    paddingVertical: 2,
    // Align under the label text (bullet + gap), set off as secondary scope.
    paddingLeft: spacing.sm + spacing.md,
  },
  prereqRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: spacing.xs,
    paddingLeft: spacing.sm,
    marginTop: spacing.xs,
  },
  prereqLabel: { color: colors.textMuted, fontSize: typography.sizeXs },
  prereqChip: {
    color: colors.textSecondary,
    fontSize: typography.sizeXs,
    backgroundColor: colors.background,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  mini: {
    width: 30,
    height: 30,
    borderRadius: radius.full,
    backgroundColor: colors.background,
    alignItems: "center",
    justifyContent: "center",
  },
  miniDanger: { backgroundColor: colors.error + "22" },
  miniGlyph: { color: colors.textSecondary, fontSize: typography.sizeMd, fontWeight: "700" },
  miniGlyphDanger: { color: colors.error },
  addInline: { alignSelf: "flex-start", paddingVertical: spacing.xs, paddingLeft: spacing.sm },
  addInlineText: { color: colors.primary, fontSize: typography.sizeXs, fontWeight: "600" },
  addUnit: {
    alignSelf: "flex-start",
    paddingVertical: spacing.xs,
  },
  addUnitText: { color: colors.primary, fontSize: typography.sizeSm, fontWeight: "600" },
  addSubject: {
    borderColor: colors.borderLight,
    borderWidth: 1,
    borderStyle: "dashed",
    borderRadius: radius.md,
    padding: spacing.md,
    alignItems: "center",
  },
  addSubjectText: { color: colors.primary, fontSize: typography.sizeMd, fontWeight: "600" },
});
