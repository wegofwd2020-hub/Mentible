# Comparison: ADR-017, ADR-019, ADR-021

**Purpose:** a single offline reference on how three ADRs relate. The word
"library" appears in all three, but each means something different. This note
explains the differences and the shared design pattern.

**Source ADRs** (in `docs/adr/`):

- ADR-017 — Default shareable library (seeded books in the source tree)
- ADR-019 — Common platform functionality as installable libraries
- ADR-021 — Everyone Library (user-published books) and content moderation

**Written:** 2026-10-11. Status values are as recorded in each ADR at that date.
If an ADR changes, this note goes stale. Check the ADR first.

---

## 1. At a glance

| | ADR-017 Default library | ADR-019 Common platform libraries | ADR-021 Everyone Library |
|---|---|---|---|
| **"Library" means** | Owner-curated books shipped inside the app | Shared *code* packages (`wegofwd-*`) | User-published books on a public shelf |
| **Status** | Accepted, built | Accepted, partially executed | Proposed, design only, not built |
| **Who curates** | The system owner | Not applicable (code) | Any user, then moderated |
| **Trust anchor** | Repo source, sha256 per book in a manifest; owner HMAC-signs (ADR-018) | Security primitives must not drift between products | Explicitly *not* owner-signed; a human super-admin makes the final call |
| **Where content lives** | On the device (bundled, then seeded locally) | In each app's own process | Server-hosted for published books (reverses local-first) |
| **Build gate** | Shipped; generating the flagship book's content is pending | Extract a package only once a second real consumer exists | Four hard gates must all hold: demand, legal, moderation, money model |

---

## 2. What each ADR decides

### ADR-017 — Default shareable library

- A top-level `library/` directory is the single source of truth. It has a
  manifest, a README, and `.book.json` files.
- Books ship inside the app bundle and seed each device on first launch.
  Seeding does not require sign-in.
- Seeded books are read-only. The first edit forks a user-owned copy
  (copy-on-write), and the original stays restorable.
- Bundled books do not count against the fair-use cap (D18).
- Only `published` books seed. `draft` books stay in-tree until they're ready.
- Consumers: the mobile app, the compiler, and the separate reader app.

### ADR-019 — Common platform functionality as installable libraries

- Cross-product common code becomes a library, not a service. Each app
  `pip install`s it and runs it in its own process.
- The caller owns all state and secrets. A library never reads environment
  variables or touches a key store or database.
- Extraction follows a rule: package code that is identical everywhere, and
  copy code that should drift per product. When in doubt, copy first.
- Extraction order:
  - `wegofwd-llm` (from ADR-012) — already extracted.
  - `wegofwd-secure` — key redaction and the BYOK envelope. Extracted now.
  - `wegofwd-identity` — JWKS verification only. Extracted when a second
    consumer is actually wired to it.
  - `wegofwd-billing` — managed-billing mechanism only. Built in-repo first,
    extracted on a second consumer.
- Each product keeps its own policy: plans, allowances, data models, and
  product UX.

### ADR-021 — Everyone Library and moderation

- Three library tiers, kept distinct:
  1. Private library (only the author).
  2. Default library (ADR-017, owner-curated and signed).
  3. Everyone Library (any user publishes; moderated, not pre-curated).
  The Everyone Library never merges with the default library.
- Book lifecycle: draft → published → unpublished, plus flagged and removed.
  Each transition names its actor.
- Super-admin moderation extends the ADR-020 audit trail. Actions are archive,
  unpublish, flag, restore, and remove.
- Complaint review is AI-assisted triage. Claude gives a recommendation and
  rationale; the human super-admin decides. Post-hoc moderation of user content
  is the platform's responsibility, not the model vendor's.
- Zero-knowledge is preserved. Admins see metadata for private books, and full
  content only for published ones.
- Reader access to published books is registration-gated (D9, amended
  2026-07-03).
- Build is gated by D8. Build starts only when all four conditions hold:
  1. Real demand for public discovery.
  2. Legal review completed (hard gate).
  3. Moderation ready (triage policy drafted, human operator available).
  4. Money model decided.

---

## 3. Commonalities

1. **Gate on real need, not speculation.**
   - ADR-019: "copy first, extract on the real second consumer."
   - ADR-021: a naive count-based trigger was rejected. Four conditions gate the build.
   - ADR-017: the seeder ships only when a book reaches `published`.

2. **Keep tiers and layers distinct.**
   - ADR-021 separates private, default, and Everyone libraries.
   - ADR-019 separates shared mechanism from per-app policy.
   - ADR-017 separates bundled read-only books from user-owned copies.

3. **Library, not service.**
   - ADR-019 (inherited from ADR-012) rules out central services.
   - ADR-021 is the one exception. Hosting public content server-side breaks
     this posture, which is a large part of why it is gated.

4. **Provenance and integrity.**
   - ADR-017: sha256 per book in a manifest, so accidental edits are caught.
   - ADR-019: the key-redaction and envelope primitives must not drift.
   - ADR-021: moderation actions are audited.

5. **Shared operator layer.**
   - ADR-021 extends the ADR-020 super-admin and its audit trail.
   - ADR-019 calls the ADR-020 super-admin gate a copyable pattern, not shared
     authorization code (ADR-020 D8).

6. **Local-first posture.**
   - ADR-017 keeps content on-device.
   - ADR-021 is the first proposal to put user content on a server, and the
     only one that reverses this for published content.

---

## 4. Differences that matter

- **Different kinds of "library."** ADR-017 and ADR-021 both hold books, but
  ADR-017 holds owner content and ADR-021 holds user content. ADR-019 holds
  code. ADR-019 is the source of much of the naming confusion.
- **Different trust models.** ADR-017 relies on owner signing. ADR-021 says
  the Everyone Library must not use the owner signing capability (D2).
- **Different maturity.** ADR-017 is built. ADR-019 is partly built. ADR-021 is
  design only.

---

## 5. Open items

- **ADR-017:** generate the flagship book's content and flip it to `published`.
  Also pending: the build step that copies `library/` into the mobile assets
  (follow-up (b)). Today that copy is maintained by hand.
- **ADR-019:** confirm the package family names and the `wegofwd-secure` /
  `wegofwd-llm` boundary before tagging `v0.1.0`.
- **ADR-021:** the open decisions are hosting, discovery, content liability,
  author due process, abuse limits, the AI-triage policy, and the build trigger.
  Legal review is a hard blocker.

---

## 6. Related docs

- `docs/adr/ADR-012` — shared LLM seam package (the template ADR-019 generalises)
- `docs/adr/ADR-014` — user accounts and credential set
- `docs/adr/ADR-018` — system-owner principal (signing capability)
- `docs/adr/ADR-020` — super-admin operator role and audit trail
- `docs/STATUS.md` — canonical "what is built" record
