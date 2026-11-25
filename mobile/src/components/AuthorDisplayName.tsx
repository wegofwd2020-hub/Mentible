// Settings > Account: the name shown on books the user publishes to Author
// Commons (account.display_name). Blank by default (never the email — it is
// visible to all members), so the user must set it before publishing.

import React, { useEffect, useState } from "react";
import { Text, TextInput, View } from "react-native";
import { ApiError, getDisplayName, setDisplayName } from "@/api/client";
import { useAuth } from "@/auth/AuthProvider";
import { Button, Label } from "@/components/ui";
import { radius, spacing, typography, type Palette } from "@/constants/theme";
import { useThemedStyles } from "@/theme";

const MAX_LEN = 60;

export function AuthorDisplayName(): React.JSX.Element {
  const { accessToken } = useAuth();
  const styles = useThemedStyles(makeStyles);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!accessToken) return;
    let alive = true;
    getDisplayName(accessToken)
      .then((name) => {
        if (alive && name) setValue(name);
      })
      .catch(() => {
        // Best-effort prefill; the field simply starts blank.
      });
    return () => {
      alive = false;
    };
  }, [accessToken]);

  const onSave = async () => {
    if (!accessToken) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      setValue(await setDisplayName(accessToken, value.trim()));
      setSaved(true);
    } catch (e) {
      setError(
        e instanceof ApiError && e.status === 422
          ? `Enter a name of 1-${MAX_LEN} characters.`
          : "Couldn’t save your name. Try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.wrap}>
      <Label tone="secondary">Publisher / account name</Label>
      <Text style={styles.help}>
        Shown as the publisher on Author Commons. Set it before you publish.
      </Text>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={(t) => {
          setValue(t);
          setSaved(false);
        }}
        maxLength={MAX_LEN}
        placeholder="Your name or pen name"
        placeholderTextColor={styles.help.color}
        accessibilityLabel="Publisher / account name"
      />
      <Button
        variant="primary"
        label="Save"
        accessibilityLabel="Save publisher name"
        onPress={onSave}
        busy={busy}
        disabled={busy || !accessToken || !value.trim()}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {saved ? <Text style={styles.help}>Saved.</Text> : null}
    </View>
  );
}

const makeStyles = (c: Palette) => ({
  wrap: { gap: spacing.sm },
  help: { color: c.textMuted, fontSize: typography.sizeSm, lineHeight: 20 },
  input: {
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: radius.sm,
    padding: spacing.sm,
    color: c.text,
  },
  error: { color: c.error, fontSize: typography.sizeSm },
});
