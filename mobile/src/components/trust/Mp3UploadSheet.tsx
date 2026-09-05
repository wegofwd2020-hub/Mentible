import React, { useEffect, useState } from "react";
import { Modal, Pressable, Text, TextInput, View } from "react-native";
import { radius, spacing, typography, type Palette } from "@/constants/theme";
import { useTheme, useThemedStyles } from "@/theme";
import { Alert } from "@/lib/alert";
import { pickAudioFile } from "@/storage/pickAudioFile";
import type { PickedAudio } from "@/api/audioUpload";

// Client-side soft guard. The backend `audio_max_bytes` (500 MB) and the STT
// provider are the real gates — this just spares the user a doomed upload of an
// obviously-too-big file. Kept generous so we never block a valid interview.
const MAX_AUDIO_BYTES = 500 * 1024 * 1024;

// Language options for transcription. Tamil is the default (the capture arc's
// first target); English is offered so the same surface serves mixed corpora.
const LANGUAGES: { code: string; label: string }[] = [
  { code: "ta", label: "Tamil" },
  { code: "en", label: "English" },
];

function humanSize(bytes: number): string {
  if (bytes <= 0) return "";
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function Mp3UploadSheet({
  visible,
  busy,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  busy: boolean;
  onClose: () => void;
  onSubmit: (asset: PickedAudio, opts: { title?: string; language: string }) => void;
}): React.JSX.Element {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [asset, setAsset] = useState<PickedAudio | null>(null);
  const [title, setTitle] = useState("");
  const [language, setLanguage] = useState("ta");

  // Reset the form each time the sheet (re)opens.
  useEffect(() => {
    if (visible) {
      setAsset(null);
      setTitle("");
      setLanguage("ta");
    }
  }, [visible]);

  const onPick = async () => {
    try {
      const picked = await pickAudioFile();
      if (!picked) return; // cancelled
      if (picked.size > MAX_AUDIO_BYTES) {
        Alert.alert("File too large", "Please choose an audio file under 500 MB.");
        return;
      }
      setAsset(picked);
    } catch {
      Alert.alert("Couldn't open that file", "Please try a different audio file.");
    }
  };

  const submit = () => {
    if (!asset || busy) return;
    onSubmit(asset, { title: title.trim() || undefined, language });
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>Upload interview (audio)</Text>
          <Text style={styles.subtitle}>Transcribe an mp3, m4a, or wav into an editable transcript.</Text>

          <Pressable
            onPress={onPick}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel="Choose an audio file"
            style={styles.picker}
          >
            <Text style={styles.pickerText}>
              {asset ? `${asset.name}${asset.size ? ` · ${humanSize(asset.size)}` : ""}` : "Choose an audio file…"}
            </Text>
          </Pressable>

          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder="Title (optional)"
            placeholderTextColor={theme.textMuted}
            accessibilityLabel="Transcript title"
            style={styles.input}
            editable={!busy}
          />

          <Text style={styles.fieldLabel}>Language</Text>
          <View style={styles.langRow}>
            {LANGUAGES.map((l) => {
              const active = l.code === language;
              return (
                <Pressable
                  key={l.code}
                  onPress={() => setLanguage(l.code)}
                  disabled={busy}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={`Language ${l.label}`}
                  style={[styles.langChip, active && styles.langChipActive]}
                >
                  <Text style={[styles.langChipText, active && styles.langChipTextActive]}>{l.label}</Text>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.row}>
            <Pressable onPress={onClose} disabled={busy} accessibilityRole="button" accessibilityLabel="Cancel" style={styles.btn}>
              <Text style={styles.btnText}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={submit}
              disabled={!asset || busy}
              accessibilityRole="button"
              accessibilityLabel="Transcribe audio"
              style={[styles.btn, styles.save, (!asset || busy) && styles.disabled]}
            >
              <Text style={[styles.btnText, styles.saveText]}>{busy ? "Transcribing…" : "Transcribe"}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (c: Palette) => ({
  backdrop: { flex: 1, backgroundColor: "#0008", justifyContent: "center" as const, padding: spacing.xl },
  card: { backgroundColor: c.surface, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.md },
  title: { fontSize: typography.sizeLg, fontWeight: "700" as const, color: c.text },
  subtitle: { fontSize: typography.sizeSm, color: c.textMuted },
  picker: {
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: radius.md,
    padding: spacing.md,
    backgroundColor: c.background,
  },
  pickerText: { color: c.text, fontSize: typography.sizeMd },
  input: {
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: radius.md,
    padding: spacing.sm,
    color: c.text,
    fontSize: typography.sizeMd,
  },
  fieldLabel: { fontSize: typography.sizeSm, color: c.textSecondary, fontWeight: "600" as const },
  langRow: { flexDirection: "row" as const, gap: spacing.sm },
  langChip: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: c.border,
  },
  langChipActive: { backgroundColor: c.primary, borderColor: c.primary },
  langChipText: { color: c.textSecondary, fontSize: typography.sizeSm, fontWeight: "600" as const },
  langChipTextActive: { color: c.primaryText },
  row: { flexDirection: "row" as const, justifyContent: "flex-end" as const, gap: spacing.sm },
  btn: { paddingVertical: spacing.sm, paddingHorizontal: spacing.lg, borderRadius: radius.md },
  btnText: { fontWeight: "700" as const, color: c.textSecondary, fontSize: typography.sizeMd },
  save: { backgroundColor: c.primary },
  saveText: { color: c.primaryText },
  disabled: { opacity: 0.5 },
});
