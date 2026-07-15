# ADR-033 — Free vs paid, at a glance (for a non-technical audience)

> Plain-language companion to `docs/adr/ADR-033-per-user-private-hosted-library.md`,
> written for presenting to non-technical folks. This file is the read-and-digest copy.
> **Editable slide deck with the graphics:** `docs/adr-033-decks/tiers-free-vs-paid.pptx`
> (6 slides — free tier (phone mockup + icon callouts), paid tier (multi-device), a
> "one day, three devices" journey, the three concept cards, and the comparison table;
> the "can *you* read it?" answer is in the Paid slide's speaker notes). Interactive
> web version: `docs/adr-033-web/tiers-free-vs-paid.html` (artifact `52f0fb35`).

**One line:** The same app, two ways to keep your library. Free stays on your device.
Paid gives you a private library that follows you everywhere.

---

## 🟢 Free — on your device

Everything you write and download lives on the phone or tablet in your hand. Nothing
is sent anywhere.

*(In the app: a "My Library" screen with your draft, your lesson, a public-domain
download, and a "search your shelf" bar — all local.)*

- **It's all on your device** — your books, drafts and lessons live here, not on
  anyone's server.
- **Works offline** — on a plane, on the subway; no signal needed.
- **Only you can see it** — nothing leaves the device, so there's nothing for us to see.
- **Free — no account needed** — open the app and start.

---

## 🟡 Paid — a private library that follows you

Your library lives in a private space of your own. Open it on your phone, your tablet,
or the web — always the same, always up to date.

*(In the app: phone, laptop, and tablet all showing the **same** shelf, in sync.)*

- **Same library everywhere** — start on your phone, finish on your laptop; it's
  already there.
- **Search everything you've written** — ask a question, get answers from across your
  whole library.
- **Private to you** — yours alone, never shared, never used to profile you.
- **Room to grow** — comes with a starting storage & usage allowance; upgrade for more.

---

## Three pictures to explain it

Drop these on a slide. Each is a plain-language way to describe the choice. (The
artifact renders them as simple illustrations.)

| Picture | Tier | What it says |
|---|---|---|
| 📓 **A notebook in your bag** | Free | Always with you, works anywhere, only you open it — but it lives in one place. |
| 🏛️ **A private study that follows you** | Paid | One private room holds your whole library; every device is a door into the same room. |
| 🔒 **A locked room only you enter** | Either way | Both tiers are private. Free keeps the key on your device; paid keeps your room locked on our side, opened only for you. |

---

## Side by side — no jargon

| | 🟢 Free · on device | 🟡 Paid · private hosted |
|---|---|---|
| **Where your library lives** | On your device | In your private online space |
| **Use it on all your devices** | One device at a time | Phone, tablet & web — in sync |
| **Search across your whole library** | On that device's shelf | Everything, from anywhere |
| **Works offline** | Always | Needs a connection |
| **Who can see it** | Only you (never leaves device) | Only you (private, encrypted) |
| **Cost** | Free | Subscription, with allowance |

---

### Note for presenters

The concept cards are the most slide-ready — each stands alone. If your audience might
ask *"can **you** (the company) read it?"*, the honest answer to have ready:

> On the **free** tier, no — it never leaves your device. On the **paid** tier, our
> server has to read your writing to build the search index, so it's private *to you
> and no other user* — but it isn't a "we literally cannot see it" guarantee. If that
> matters to someone, the free device tier is the zero-knowledge option.

*Illustrates `ADR-033 — per-user private hosted library`. The free device tier is
unchanged; the paid tier is opt-in.*
