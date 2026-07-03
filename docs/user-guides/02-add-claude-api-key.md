# Create a Claude API key and add it to Mentible

To generate your own books and lessons, Mentible needs a **Claude (Anthropic) API
key**. This is your own key — you get it directly from Anthropic, Anthropic bills
you for what you use, and the key stays on your device. Mentible uses it to call
Claude on your behalf and never stores or logs it. This is called **BYOK**
("bring your own key").

> **Before you start:** sign in to Mentible first —
> see [Sign in with Google](01-sign-in-with-google.md). You must be signed in to
> save an API key.

There are two parts: **(A)** get a key from Anthropic, then **(B)** paste it into
Mentible.

---

## Part A — Create your Claude API key

1. **Open the Anthropic Console.** Go to
   **https://console.anthropic.com/settings/keys** and sign up or log in.

2. **Add billing.** Under **Billing**, add a payment method and a little credit.
   Claude has **no free tier**, so a key won't work until there's credit on the
   account. A few dollars is plenty to start.

3. **Create the key.** Go to **Settings → API Keys** and click **Create Key**.
   Give it a name like *"Mentible"* so you recognise it later.

4. **Copy the key.** It starts with **`sk-ant-`** followed by a long string.
   Copy it now — Anthropic only shows the full key once. If you lose it, just
   create a new one.

> **Keep it private.** Treat the key like a password. Anyone with it can spend on
> your Anthropic account. You can delete a key from the Anthropic Console at any
> time to revoke it.

---

## Part B — Add the key to Mentible

1. **Open Settings.** In Mentible, tap **Settings** in the navigation.

2. **Go to the API keys section.** Scroll to **"API keys (BYOK)."** (If it asks
   you to sign in first, do that — see the sign-in guide.)

3. **Select Anthropic.** In the provider row, tap the **Anthropic** chip. It's
   the default and the recommended provider for finished books.

4. **Paste your key.** In the **API key** field, paste the `sk-ant-…` key you
   copied from the Anthropic Console.

5. **Save.** Tap **Save**. Mentible validates the key (Anthropic keys start with
   `sk-ant-` and are at least 20 characters) and stores it securely on your
   device. You'll then see a **Saved key** row showing a masked version like
   `sk-ant-…abcd` — confirmation it's stored.

You're ready to generate. Head to **Books → New Book** to create your first one.

---

## Good to know

- **Where the key lives.** Only in your device's secure storage. It travels with
  each generation request, is used once to call Anthropic, then discarded — never
  logged and never saved on Mentible's servers.
- **Who pays.** Anthropic bills your account per token used. Mentible charges you
  nothing for the tokens on the BYOK path.
- **Other providers.** The same screen supports OpenAI, Groq, OpenRouter, and
  Google Gemini. Groq and Gemini have free tiers if you want to experiment, but
  their output is draft-grade — **Anthropic (Claude) is recommended for real
  books.**
- **Remove or replace a key.** In the same section, tap **Remove** on the saved-key
  row, then paste a new one. To clear every provider key from the device, use
  **Settings → Account → Remove saved API keys.**
- **New browser or device.** Keys don't sync — they stay in the browser you added
  them in. On a new device, sign in and paste the key again (or create a fresh one
  in the Anthropic Console).

---

**See also:** [Sign in with Google](01-sign-in-with-google.md)
