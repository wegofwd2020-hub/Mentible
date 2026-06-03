# Professional eBook Publishing — Measures for Mentible Authors

> **What this is.** A practical playbook for anyone using Mentible to author
> eBooks **as a professional/commercial publisher** — i.e. selling or
> distributing the EPUB3/PDF artifacts Mentible produces, rather than reading
> them privately. It covers the legal, metadata, quality, accessibility,
> distribution, and tax measures a publisher is expected to take, and maps each
> to **what Mentible emits today vs. what you must add yourself**.
>
> ⚠️ **Not legal, tax, or accessibility-compliance advice.** Requirements vary by
> country and change over time. Treat this as a checklist to brief professionals
> (IP attorney, accountant, accessibility auditor), not a substitute for them.
>
> Related: [`ARTIFACT_PIPELINE.md`](ARTIFACT_PIPELINE.md) (how content becomes
> EPUB3/PDF — incl. the **"Artifact types & media"** extension point for future
> audio/video/interactive artifacts),
> [`adr/ADR-004-two-product-split-and-artifacts.md`](adr/ADR-004-two-product-split-and-artifacts.md)
> (the artifact/money model), [`adr/ADR-006-brand-name-and-audience-scope.md`](adr/ADR-006-brand-name-and-audience-scope.md)
> (brand clearance).
>
> **Today this guide assumes text-based EPUB3/PDF.** Richer artifacts (enhanced
> EPUB, audiobooks, interactive HTML, DAISY) each add their own production,
> rights, and accessibility obligations — see that extension point.

---

## 0. TL;DR — the order to do things

1. **Decide the legal wrapper** — who is the publisher (you / an imprint / a
   company), and who owns the content.
2. **Resolve AI-content rights & disclosure** — Mentible content is
   LLM-generated; this materially affects copyright and store policies. Do this
   *before* you sell anything (§3).
3. **Get identifiers** — ISBN per format/edition; register copyright if your
   jurisdiction offers it (§4).
4. **Fill complete metadata** in Mentible's `Book.metadata` (§5).
5. **Make it conformant and accessible** — EPUBCheck clean, EPUB Accessibility
   1.1 / WCAG 2.1 AA, accessibility metadata (legally required for EU sales as of
   28 Jun 2025) (§6–7).
6. **Choose channels** and meet each store's format/metadata rules (§8).
7. **Handle pricing, royalties, and tax** (digital-goods VAT/sales tax) (§9).
8. **Sort DRM, privacy, and brand** (§10–12).
9. **Run the pre-publication checklist** (§13).

---

## 1. Scope & roles

- **Publisher** = the legal entity of record on the book (you personally, a
  registered imprint name, or a company). The publisher name appears in
  metadata (`dc:publisher`) and on retail listings, and is who stores pay and
  who is liable for the content.
- **Author** = the named creator (`dc:creator`). In Mentible projects the author
  is a person (e.g. the book's named author); the *tool* is not the author.
- **Imprint** = an optional brand the publisher trades under. If you publish
  under a name other than your own, check it for trademark conflicts the same way
  the project vets "Mentible" (ADR-006).

---

## 2. Business & legal setup

| Measure | Why | Notes |
|---|---|---|
| Choose an **entity** (sole trader / LLC / Ltd) | Liability, tax, and the name that appears as publisher | Talk to an accountant; this drives §9. |
| Register a **business / imprint name** if used | Many stores require a payee + tax ID | KDP/Apple/Google need a bank account + tax interview. |
| **Content liability review** | You are responsible for what you sell — defamation, dangerous instructions, factual errors, infringement | Especially important for AI-generated content (§3). |
| **Terms of sale / refunds** | Consumer law (e.g. EU/UK distance-selling, US FTC) | Stores handle most of this when you sell *through* them. |

---

## 3. AI-generated content: rights, disclosure, and quality (do this first)

Mentible content is produced by an LLM from your scoped prompts. This is the
single biggest difference from traditional publishing and it has concrete
consequences:

- **Copyrightability.** In several jurisdictions (notably the **US Copyright
  Office**, guidance updated 2023–2025), purely AI-generated text **cannot be
  copyrighted**; only material with sufficient **human authorship** (your
  selection, arrangement, substantial editing, original additions) is
  protectable. Practically: **edit and curate** the output so there is real human
  authorship, and keep records of your contribution. Do not assume you hold
  enforceable copyright in raw, unedited generations.
- **Store disclosure rules.** **Amazon KDP requires you to disclose AI-generated
  content** during publishing; other stores are moving the same way. Answer
  truthfully. "AI-assisted" (you heavily edited) vs "AI-generated" (verbatim)
  are treated differently — know which you're shipping.
- **Originality / plagiarism.** LLMs can reproduce or closely paraphrase existing
  text. Run a plagiarism check on commercial titles; you are liable for
  infringement even if a model produced the text.
- **Factual accuracy.** You are publishing under your name. **Fact-check**
  technical claims, figures, code, and especially anything safety-relevant. A
  professional title needs a human editorial pass; do not ship raw model output.
- **Third-party IP in prompts/figures.** Don't instruct the model to reproduce
  copyrighted passages, trademarks, or living-person likenesses without rights.
- **Provider terms.** Under BYOK you call the model on your own account — check
  *your* LLM provider's commercial-use and output-ownership terms (they generally
  assign output to you, but confirm for your provider/plan).

> **Mentible support today:** none of this is automated. The tool generates and
> compiles; **disclosure, editing, fact-checking, and plagiarism screening are
> your manual responsibility.** A future feature could stamp an AI-disclosure
> line into the colophon — see §14.

---

## 4. Identifiers & registration

| Item | What | Detail |
|---|---|---|
| **ISBN** | The retail identifier for a book edition | You generally need a **separate ISBN per format** (EPUB ≠ PDF ≠ print) and per substantially revised edition. Buy from your national agency (Bowker in the US, Nielsen in the UK, or your country's ISBN agency). Some stores (KDP) issue a **free ASIN/ISBN** but it locks distribution to them — buying your own keeps you portable. |
| **Imprint of record** | Publisher name tied to the ISBN | Set when you register the ISBN; must match `dc:publisher`. |
| **Copyright registration** | Optional but strengthens enforcement (e.g. US Copyright Office) | Only the human-authored portions are registrable (§3). |
| **Legal deposit** | Some countries legally require depositing a copy with the national library | E.g. British Library (UK), Library of Congress (US, for registered works), BnF (France). Check your jurisdiction. |
| **DOI** | Only if you publish into academic/citation ecosystems | Usually unnecessary for general trade eBooks. |

> **Mentible support today:** `Book.metadata.identifier` feeds `dc:identifier`
> in the OPF (defaults to the internal book id if unset). **Put your real ISBN
> there** before compiling a sellable EPUB. There is no per-format ISBN handling
> — compile EPUB and PDF with their respective ISBNs set.

---

## 5. Metadata — completeness sells (and is required)

Stores rank and surface books by metadata; incomplete metadata = poor
discoverability and sometimes rejection. Mentible's `Book.metadata` maps to EPUB
Dublin Core in the OPF:

| `Book.metadata` field | OPF output | Pro-publishing note |
|---|---|---|
| `identifier` | `dc:identifier` | **Your ISBN** (§4). |
| `author` / `authorFileAs` | `dc:creator` (+ `marc:relators` role `aut`, file-as) | File-as is the sort name ("Doe, Jane"). |
| `publisher` | `dc:publisher` | Your imprint of record. |
| `language` | `dc:language` + `xml:lang` | BCP-47 (e.g. `en`, `en-US`, `fr`). |
| `description` | `dc:description` | This becomes/seeds your **retail blurb** — write it well. |
| `subjects` | repeatable `dc:subject` | Use real **BISAC / Thema** subject codes for stores (see below). |
| `rights` | `dc:rights` | Verbatim copyright/licence line; also shown in the colophon. |
| `date` | `dc:date` | Publication date (ISO). |
| `series` / `seriesIndex` | belongs-to-collection | Series name + position. |
| (auto) | `dcterms:modified` | Maintained by the compiler. |

**Additional metadata you manage *outside* Mentible** (in the store dashboards
and/or an ONIX feed):

- **BISAC** (North America) / **Thema** (international) subject categories —
  stores need their codes, not free text. Map your `subjects` to them.
- **Keywords**, **price**, **territory rights**, **age/audience**, **publication
  date**, **comp titles**.
- **ONIX 3.0** — the publishing-industry metadata feed format. Aggregators and
  larger retailers ingest ONIX. If you distribute at scale you'll produce an ONIX
  record per title (via your aggregator/IngramSpark, not Mentible).

> **Mentible gap:** no BISAC/Thema validation and **no ONIX export** — these are
> handled by your distributor or added manually.

---

## 6. Technical conformance & validation

A professional EPUB must **pass validation** or stores will reject it.

- **EPUBCheck** — the official IDPF/W3C validator. Your EPUB must pass with **no
  errors**. Run it on every artifact before upload:
  ```bash
  java -jar epubcheck.jar your-book.epub
  ```
- **PDF** — validate the PDF opens cleanly across readers; for some channels
  (print-on-demand via IngramSpark/KDP Print) you need **PDF/X** with embedded
  fonts and correct bleed/trim — Mentible's screen PDF is **not** a print-ready
  PDF/X. Treat the Mentible PDF as a *digital* deliverable, not a print master.
- **Fonts** — embed and confirm licences permit embedding/redistribution
  (Mentible embeds Source Serif 4; verify the licence covers commercial
  distribution, which OFL does).
- **Reflow & device testing** — open the EPUB on multiple readers (Apple Books,
  Kobo, Google Play Books, Thorium, Calibre) to catch reflow/KaTeX/diagram
  rendering issues. Page count is reader-dependent — don't promise a fixed page
  count.

> **Mentible support today:** the compiler produces EPUB3 with both `nav.xhtml`
> (EPUB3) and `toc.ncx` (EPUB2 fallback), self-closed void elements (valid
> XHTML), and a colophon. **EPUBCheck is NOT run in the pipeline** — run it
> yourself on the downloaded artifact. See §14.

---

## 7. Accessibility — now legally mandatory for EU sales

This is the measure most easily overlooked and the one with the hardest legal
deadline.

- **European Accessibility Act (EAA)** — **in force since 28 June 2025.** eBooks
  sold to EU consumers must meet accessibility requirements. Non-accessible
  titles can be **barred from EU sale**. This applies to you if you sell into the
  EU at all.
- **Standards:** **EPUB Accessibility 1.1** conformance, aligned to **WCAG 2.1
  Level AA**.
- **Validate with **Ace by DAISY**** (the accessibility checker; complements
  EPUBCheck):
  ```bash
  ace your-book.epub
  ```
- **Accessibility metadata is mandatory** — the OPF must declare
  `schema:accessMode`, `schema:accessModeSufficient`, `schema:accessibilityFeature`,
  `schema:accessibilityHazard`, and a human-readable `schema:accessibilitySummary`.
  Stores (Apple, Google) display these and the EU requires them.
- **Content requirements:** meaningful **alt text on every image/diagram**,
  correct **heading hierarchy**, **language** declared, readable contrast,
  navigable TOC, no information conveyed by colour alone, math as **MathML** (not
  images).

> **Mentible status:**
> - ✅ Math is MathML (KaTeX `output:"mathml"`), language is declared, there's a
>   proper nav/TOC and heading structure — good foundations.
> - ✅ **Accessibility metadata is now emitted** in the OPF (`schema:accessMode`,
>   `accessModeSufficient`, `accessibilityFeature`, `accessibilityHazard`,
>   `accessibilitySummary`), auto-derived from content (math → `MathML`;
>   diagrams/images → a `visual` access mode) and overridable via
>   `Book.metadata.accessibility`. See `compiler/src/epub.ts` (`accessibilityMeta`).
> - ⚠️ **Diagram/image alt text** depends on what the generator produced; Mermaid
>   diagrams need descriptive alternatives, not just a rendered SVG. The compiler
>   does **not** auto-claim `alternativeText` — assert it (and formal
>   `conformsTo`/`certifiedBy`) only after you've ensured every figure is
>   described.
> - ❌ **Ace by DAISY is not run** in the pipeline.
>
> **Emitting metadata is necessary but not sufficient for EAA conformance.** You
> still need real alt text on every figure, an Ace pass, and (for a formal claim)
> an audit. The tool no longer blocks you on metadata, but **don't assert WCAG
> conformance until the content actually meets it.**

---

## 8. Distribution channels

Pick direct-to-store, an aggregator, or both.

| Channel | Format | Notes |
|---|---|---|
| **Amazon KDP** | Uploads EPUB; converts to Kindle format | Free ISBN/ASIN option (locks distribution); **AI disclosure required**; 35%/70% royalty tiers with delivery-cost rules. |
| **Apple Books** | EPUB | Requires a Mac/iTunes Producer or aggregator; strong accessibility-metadata surfacing. |
| **Google Play Books** | EPUB / PDF | Direct upload; supports your own ISBN. |
| **Kobo Writing Life** | EPUB | Direct, indie-friendly. |
| **Aggregators** — Draft2Digital, PublishDrive, Smashwords, **IngramSpark** | EPUB (+ print PDF) | One upload → many stores + libraries; generate ONIX for you; IngramSpark also does print-on-demand (needs print-ready PDF/X, not Mentible's screen PDF). |
| **Direct sales** (your own site, the free reader app) | EPUB/PDF | You handle delivery, tax, and DRM yourself. Note the **Mentible reader app** (ADR-004) "lights up" your EPUBs — a direct-sale + interactive-read path you control. |

Each store has its own **metadata, cover-size, and content rules** — read them;
rejections are usually metadata/validation/cover issues.

---

## 9. Pricing, royalties & tax

- **Pricing & royalties** — each store sets royalty tiers (e.g. KDP 35%/70%).
  Decide list price per territory and currency.
- **Sales tax / VAT on digital goods** — eBooks are taxable digital goods in most
  markets. **EU VAT** applies based on the buyer's location (EU OSS/MOSS scheme);
  many countries apply a **reduced VAT rate to eBooks**. US **sales-tax nexus**
  rules may apply for direct sales. When you sell *through* a store, the store
  usually remits the consumption tax; for **direct sales you are responsible**.
- **Withholding tax** — stores run a **tax interview** (e.g. US W-8BEN for
  non-US payees) to set withholding; complete it to avoid 30% withholding.
- **Royalty/payment thresholds** — stores pay out monthly above a minimum;
  reconcile statements.

> Get an accountant who knows digital-goods VAT/sales tax for your markets.

---

## 10. DRM & content protection

- **DRM is optional and a trade-off.** Store DRM (Adobe ADEPT, Apple FairPlay,
  Kindle) limits copying but harms legitimate readers and portability.
- **Social DRM / watermarking** (embedding the buyer's reference in the file) is
  a lighter-touch alternative many indie publishers prefer.
- **Mentible/EAA note:** heavy DRM can conflict with accessibility (screen
  readers). The Mentible **reader app** model (free reader that opens your EPUBs)
  assumes **DRM-light** distribution — decide consciously; don't bolt on DRM that
  breaks the interactive-read experience or accessibility.

---

## 11. Privacy & data protection

- If you collect **reader data** (email lists, the reader app's local progress,
  analytics), **GDPR/UK-GDPR/CCPA** apply: lawful basis, privacy policy,
  deletion on request.
- The Mentible reader app keeps **progress local** by design (ADR-004), which
  minimises this — but anything you add (newsletter, accounts) brings obligations.
- **BYOK keys are the reader/author's property** and never published in an
  artifact — keep it that way (project rule; ADR-001).

---

## 12. Brand & trademark

- If you publish under an **imprint name**, clear it (USPTO/EUIPO + domains +
  store search) exactly as the project does for "Mentible" (ADR-006). A book
  brand is a trademark.
- Don't put **"Mentible"** on a *published book's* branding as if cleared — the
  name is **provisional pending trademark clearance** (ADR-006). Your imprint and
  the tool's brand are separate things.
- Cover and interior must not infringe third-party marks or images (§3).

---

## 13. Pre-publication checklist (per title, per format)

**Rights & content**
- [ ] Human editorial pass done; content fact-checked.
- [ ] AI-content **disclosure** decided and ready to declare at upload (§3).
- [ ] Plagiarism/originality check passed.
- [ ] No infringing text, images, marks, or likenesses.
- [ ] You hold/registered copyright in the human-authored portions.

**Identifiers & metadata**
- [ ] **ISBN** assigned (per format) and set in `Book.metadata.identifier`.
- [ ] `author` / `authorFileAs`, `publisher`, `language`, `date`, `rights`,
      `description`, `subjects`, `series` filled.
- [ ] BISAC/Thema categories + keywords prepared for the store.
- [ ] Colophon/cover show correct author + rights.

**Technical**
- [ ] **EPUBCheck passes with no errors.**
- [ ] Opens correctly on ≥3 readers (Apple Books, Kobo, Thorium/Calibre).
- [ ] Fonts embedded and licensed for distribution.
- [ ] PDF validated; if print, a separate **PDF/X** master (not the screen PDF).

**Accessibility (blocking for EU sale)**
- [ ] **Ace by DAISY** passes.
- [ ] **Accessibility metadata** present in the OPF (`schema:access*`).
- [ ] Alt text on every image/diagram; correct heading order; MathML for math.

**Commercial**
- [ ] Store **tax interview** completed (W-8BEN etc.).
- [ ] Pricing/territories/royalty tier set.
- [ ] VAT/sales-tax handling confirmed (esp. for direct sales).
- [ ] DRM decision made.
- [ ] Privacy policy in place if collecting reader data.

---

## 14. Gaps in Mentible for professional publishing (project backlog)

What the tool would need to better support a professional publisher (today these
are manual / external):

1. ✅ **Accessibility metadata emission — DONE.** The OPF now emits
   `schema:accessMode`, `accessModeSufficient`, `accessibilityFeature`,
   `accessibilityHazard`, and `accessibilitySummary`, auto-derived from content
   and overridable via `Book.metadata.accessibility`
   (`compiler/src/epub.ts → accessibilityMeta`). Remaining a11y work is items 2–3.
2. **In-pipeline validation** — run **EPUBCheck** and **Ace by DAISY** on compile
   and surface results, so an author can't ship an invalid/inaccessible artifact
   unknowingly.
3. **Alt-text discipline** — require/generate descriptive alt text for every
   diagram and image (Mermaid SVGs especially).
4. **AI-disclosure stamp** — optional colophon/metadata line declaring
   AI-generated/assisted status, to satisfy store disclosure rules consistently.
5. **Per-format ISBN** — distinct identifiers for EPUB vs PDF in one project.
6. **ONIX 3.0 export** — a metadata feed for aggregators/retailers.
7. **BISAC/Thema picker** — structured subject codes instead of free-text
   `subjects`.
8. **Print-ready PDF/X** profile — embedded-font, bleed/trim PDF for POD, distinct
   from the screen PDF.

> See [`ARTIFACT_PIPELINE.md`](ARTIFACT_PIPELINE.md) for where these would slot
> into the compile flow, and the OPF builder in `compiler/src/epub.ts` for the
> current metadata emission.

---

## References to chase (authoritative sources, verify currency)

- **EPUBCheck** and **EPUB Accessibility 1.1** — W3C Publishing.
- **Ace by DAISY** — DAISY Consortium accessibility checker.
- **European Accessibility Act** — EU Directive 2019/882 (eBooks in scope; in
  force 28 Jun 2025).
- **US Copyright Office** — guidance on AI-generated works (human-authorship
  requirement).
- **Amazon KDP** — AI content disclosure & content guidelines.
- **ISBN** — your national ISBN agency (Bowker/Nielsen/etc.).
- **BISAC** (BISG) / **Thema** (EDItEUR) subject schemes; **ONIX 3.0** (EDItEUR).
- **EU VAT OSS** for digital goods; your country's tax authority.
