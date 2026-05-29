# Competitive Landscape — Content Publishing & Distribution

> **Status:** Research note (2026-05-29). Companion to ADR-004 (two-product split
> / artifacts) and the branding analysis. Captures who else lets users *publish*
> learning content, the two closest analogs to Mentible, and the strategic
> takeaways. Market changes fast — re-verify before acting.

---

## Why this note exists

A product discussion floated positioning Mentible as a "content publishing" tool
(Udemy/Coursera-style). This surveys the publishing/distribution landscape to
answer: **is publishing a moat, or a commodity rail to ride?** Short answer —
**a commodity rail.** The defensible part of Mentible is the **AI authoring
engine**, not the publishing surface.

> **Note:** `cogitotech.com`, raised as a possible example, is **not** a
> publishing platform — it is an AI **training-data / data-labeling** company
> (annotation, RLHF, content moderation; clients incl. OpenAI/AWS). Excluded.

---

## The landscape, by type

| Type | Examples | What they do |
|---|---|---|
| **Marketplaces** (built-in audience, take a cut) | Books: Amazon **KDP**, Apple Books, **Kobo Writing Life**, B&N Press. Courses: **Udemy, Coursera, Skillshare** | List your content in their store; they own discovery + the buyer relationship |
| **Creator commerce** (your own storefront) | **Gumroad, Payhip, Podia, Sellfy**; **Teachable, Thinkific, Kajabi, LearnWorlds** | You bring the audience; they handle checkout, hosting, course delivery |
| **Distribution aggregators** | **Draft2Digital, PublishDrive, IngramSpark, Smashwords** | Push one upload to many retailers/libraries |
| **Book + course hybrids** | **Leanpub** | Markdown → ebook *and* course; see below |
| **Interactive ebook + branded reader** | **Kotobee**, Pressbooks, Kitaboo | Author interactive EPUBs + ship a branded reader app; see below |

---

## The two closest analogs

### Kotobee — the closest architectural twin ⚠️

Kotobee lets users **create interactive EPUBs** (video, audio, **self-assessment
quizzes**, widgets), bundle them into a **white-labeled, branded reader app**
(Android / iOS / desktop / web), distribute via a **cloud library**, export to
**EPUB / SCORM / LTI** for LMSs, and read **offline**.

Compared against **ADR-004**, that is **most of Mentible's two-app model already
shipping**: interactive EPUB3 + branded offline reader + quizzes. The decisive
gap: **Kotobee is a *manual* authoring tool** — the human writes the content.

### Leanpub — the closest on *format*

Write in Markdown, publish a **book and a course** from the same source; a Leanpub
**course is "an ebook + quizzes."** Sells at ~80% royalty. Conceptually very near
Mentible's lesson+quiz artifact — but again, **the author writes it themselves.**

---

## Strategic takeaways

1. **Publishing/distribution is commoditized — ride the rails, don't build a
   store.** KDP, Apple Books, Leanpub, and the aggregators already solve
   distribution. Mentible should **export into** these rails (and/or its own free
   reader, ADR-004), not become a two-sided marketplace. (Reinforces the earlier
   decision *against* a Udemy/Coursera-style platform: it would reverse D6, the
   "no shared content store" rule, and the money model.)

2. **The moat is AI authoring, not the publishing surface.** Kotobee/Leanpub make
   users **write the content**; their pipeline is manual-authoring + publish.
   Mentible's differentiator is the **scoped-query engine that *generates* the
   rigorous, structured, interactive artifact** from a prompt. Positioning should
   therefore be **"describe what you want to learn → Mentible authors the
   interactive book for you,"** with publishing as a downstream export — **not**
   "interactive ebook publishing" (Kotobee already owns that phrase).

3. **Kotobee is a build-vs-buy signal for the reader app.** Since ADR-004's reader
   is a real separate build, Kotobee (white-label offline reader, quizzes,
   SCORM/LTI, cloud library) is worth studying as a **template, component, or
   partner** before reinventing it. Open question for the reader repo.

---

## References

- ADR-004 — two-product split + artifact delivery (the model these analogs mirror).
- `docs/branding-and-naming-analysis.md` — positioning (authoring-side, single audience).
- Sources: [Kotobee](https://www.kotobee.com/) ·
  [Kotobee Author](https://www.kotobee.com/en/products/author) ·
  [Leanpub](https://leanpub.com/) ·
  [Platforms to sell ebooks (2026)](https://sellfy.com/blog/how-to-sell-ebooks-online/) ·
  [Cogito Tech — data labeling, *not* publishing](https://www.cogitotech.com/)
