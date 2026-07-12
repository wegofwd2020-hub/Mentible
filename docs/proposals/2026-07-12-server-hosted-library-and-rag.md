# Server-hosted library + hosted RAG + storage tiers — design brief (pre-ADR)

**Status:** COMPANION to **ADR-032** (2026-07-12). The §5 open decisions are now resolved
and the decision record lives in `docs/adr/ADR-032-server-hosted-library-and-rag.md`; this
brief is retained for the detailed **copyright / DMCA legal analysis (§4)** and the design
rationale. Where they differ, **ADR-032 governs**.
**Decision-maker:** Sivakumar Mambakkam
**Supersedes / amends (if accepted):** ADR-028 D2/D3/D6 (device-local, per-device,
neutral-conduit, preferences-not-profiles), ADR-014 (device-local / zero-knowledge
default), ADR-001 (no server-side key custody); reshapes ADR-029 (RAG moves
server-side) and ADR-030 (currency agent gains a server home).

---

## 1. The proposal & why

Move the personal-library layer from **device-local** to a **server-hosted user
account**:

- **User profile on the server** — the account owns the library, not a single device.
- **Store downloaded files on the server** (scope-limited — see §3).
- **Build the RAG (ADR-029) on the server**, over that hosted library.
- **A default storage allowance per subscription**, with larger tiers on higher plans.

**The benefit driving it:** the user gets the AI functionality (retrieval, grounding,
currency) **without being tied to one device** — switch phone/tablet/web and the
library, index, and references follow the account. It also lifts the device-load
concern behind ADR-029 (large libraries + vector stores no longer sit on a phone).

This is a real, coherent product direction. It is also a **reversal of a core stance**,
not a tuning of ADR-029 — hence its own ADR.

---

## 2. What it reverses (be honest about the cost)

| Today (ADR) | This proposal |
|---|---|
| **ADR-028 D2/D3** — server never hosts/mirrors/proxies a third-party file; device downloads direct from source; per-device | Server **stores** a (scoped) subset of library content per-account |
| **ADR-028 D6** — no behavioral profile; "preferences, not profiles" | A per-account server library + RAG **is** a reading-interest profile |
| **ADR-014** — device-local / zero-knowledge by default | Library + index live **with us**, readable by us to serve RAG |
| **ADR-001** — no server-side key custody | Server-side embedding/RAG needs **managed keys** (BYOK-on-device no longer fits) |
| **ADR-029 D3** — index is per-device, derived, disposable | Index is **server-side, per-account**, part of the subscription |

None of these are fatal — they're **tradeoffs** the multi-device benefit may justify —
but each is a moat or a legal shield being spent, so each must be a conscious choice,
not a silent consequence.

---

## 3. Content scope — DECIDED (option 1, refined)

**What may be server-hosted:**
1. **Public-domain feed downloads** (Project Gutenberg, PD Internet Archive items) —
   hosting + RAG is clean, no rightsholder.
2. **The user's own uploads** — files the user personally puts in their account,
   covered by a rights-representation + indemnification clause (see §4).
3. **Mentible-authored books** — already ours.

**What stays device-local (NOT server-hosted):**
4. **Copyrighted-but-free feed downloads** (Feedbooks originals, copyrighted IA items) —
   remain device-local per ADR-028; the server holds **metadata/link only**.
5. **User-added third-party repo *content*** — the server may store the **feed
   metadata / link**, but must **not fetch and store the files**. This is the
   highest-exposure path (see §4) — the "it's the user's material" defense barely
   applies when *our server* reaches out and copies content the user doesn't own.

So the server-hosted corpus = **PD works + the user's own uploads + authored books.**
Everything else is metadata on the server, bytes on the device.

---

## 4. Copyright & legal analysis (the part to re-read)

> **Not legal advice** — I'm not a lawyer, and the ToS + DMCA setup must be reviewed by
> real counsel before launch. The structure below is the well-established shape of how
> user-content hosting works; it is orientation, not a legal opinion.

### 4.1 A disclaimer is necessary, but not sufficient

The instinct — "put out a disclaimer making the user responsible / accept ownership of
any copyright violation" — is correct and standard. Every user-content platform runs on
it. But a disclaimer alone is not the whole shield, because it governs **two different
relationships**, and only covers one:

**(a) You ↔ the user (the disclaimer works here).**
A ToS clause where the user **represents they own or have the rights** to what they add,
and **indemnifies** you for claims arising from it, genuinely shifts liability
*contractually*. Caveats: it is only as good as the user's ability to actually pay a
judgment, and it does **not** stop you from being *named* in a suit.

**(b) You ↔ the copyright holder (the disclaimer does NOT bind them).**
The rightsholder can come after **you as the host** regardless of your ToS with the
user — your agreement with the user is not a defense against a third party. What protects
a host *there* is **DMCA safe harbor (§512)**, and that is not a paragraph — it is
**mechanics you must implement**:

- Register a **DMCA agent** (with the Copyright Office).
- Run **notice-and-takedown** — remove/disable access on a valid notice, promptly.
- Maintain a **repeat-infringer policy** and actually enforce it.
- Have **no actual knowledge** of specific infringement and don't be "willfully blind";
  don't induce/encourage infringing use.
- Don't derive a **direct financial benefit** from infringement you have the right and
  ability to control.

**Disclaimer + DMCA-compliance together are the shield. The disclaimer by itself is not.**

### 4.2 Two server channels, very different risk

"User adds a repo or uploads material" is not one thing:

- **User uploads their own file** → the disclaimer/indemnification fits well. Plausibly
  their content; they represent rights; standard UGC posture. **Server-hostable (§3.2).**
- **User names a repo and your server fetches + stores it** → weakest position. *Your
  server* is copying third-party content the user doesn't own; the "user's material"
  framing barely applies, and it can look like active participation. **Keep device-local;
  server holds metadata/link only (§3.5).**

### 4.3 Practical bottom line

Option-1 scope (§3) + a rights-representation/indemnification ToS + DMCA safe-harbor
mechanics + not server-fetching user-named repos = a **defensible** posture. It is
practical and normal. What makes it safe is the *combination*, and it must clear a
**legal review before any hosting ships**.

---

## 5. Consequential decisions still open (finish the brainstorm)

1. **Server-side RAG compute & key custody.** BYOK-on-device no longer fits a
   server-built index. Embedding/query runs on **managed keys** (ADR-016/013 managed
   vault + metering — built, currently off). So this feature is **gated on the
   managed-billing launch**. Confirm that dependency; decide Phase-1 lexical (cheap,
   server FTS) vs Phase-2 semantic (managed-key embeddings, metered).
2. **Storage economics & plans.** Real per-account infra cost = stored bytes (PD works +
   uploads) + vector store. Define the default allowance, the paid tiers, and how usage
   is metered/enforced (ties to ADR-016/013 + the dormant RevenueCat entitlements).
3. **Multi-device sync model.** How the account's library/index reaches each device
   (stream from server vs sync-down), offline behavior, and conflict handling.
4. **Privacy / GDPR posture shift.** The account now holds the user's library + a
   reading-interest profile. Update the data-minimization stance (amends ADR-014 D8),
   deletion/export obligations, and the "we don't see your library" messaging.
5. **What happens to ADR-028's device-local promise.** Is it *replaced* by this, or does
   device-local remain an option (e.g. a free/anonymous tier stays device-local, the
   subscription unlocks the hosted account)? A **hybrid** — device-local baseline +
   opt-in hosted account on subscription — keeps the ADR-028 posture available and makes
   the reversal opt-in rather than wholesale. **(Recommended framing; confirm.)**
6. **ADR-029 / ADR-030 rewrite.** Both currently specify device-local; they need
   amendment to a server-side (or hybrid) home once §5.1 is settled.

---

## 6. Next steps

1. Resolve §5 open decisions (one at a time — continue the brainstorm).
2. Promote this brief to **ADR-032 — Server-hosted library + hosted RAG + storage
   tiers**, amending ADR-028 D2/D3/D6, ADR-014, ADR-001, and reshaping ADR-029/030.
3. Flag the **legal review** (ToS rights-rep/indemnification + DMCA agent + takedown +
   repeat-infringer policy) as a launch-gating prerequisite, before any hosting ships.
