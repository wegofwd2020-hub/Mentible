# Splash → Studio funnel (built vs. proposed)

The visual companion to [ADR-037](adr/ADR-037-reposition-to-expert-validation-studio.md)
(the SME expert-validation reposition): the whole visitor journey from the public
splash to the Studio's Capture → Create → Validate → Share loop, with every node
marked **built/live** or **proposed/not-yet-built**.

**Key:** 🟩 green = built / live today · 🟨 amber (dashed) = proposed / not yet built.

> **Status note (updated 2026-08-14).** Since this diagram was first drawn, part of the
> amber funnel has **shipped**: the **`/work-with-me` page** (in-app route, scheduler
> link-out to `calendly.com/wegofwd2020`, mailto fallback — #453/#454) and the **"Work with
> me" CTA** on the landing page (`mambakkam.net/mentible` — mambakkam-net #118) are now live.
> So the "Book a 30-minute conversation" (`G`) and "Work-with-me: qualify" (`J`) nodes below —
> and the sequence's first proposed zone — are effectively **built** now, via a Calendly
> link-out whose booking form carries the qualify questions. The **fuller marketing site**
> (hero, intent grid, About/Books/Content, Mission+Proof) is still proposed. The nodes are
> left amber below to preserve the original as-analyzed snapshot; this note is the delta.

---

## 1. Flow — visitor decision tree

```mermaid
graph TD
    %% GREEN = built/live today.  AMBER dashed = proposed / not yet built.
    %% Note: the SME owner may also BE the expert (self-validate) — the invited-reviewer path is the two-actor case.

    A["SME buyer lands on home<br/>mambakkam.net/mentible"]:::proposed --> B["Hero: turn expertise into trusted knowledge"]:::proposed
    B --> C{"Intent?"}:::proposed
    C -->|Understand method| D["How it works:<br/>Capture · Create · Validate · Share"]:::proposed
    C -->|See outputs| E["Formats: book · lessons · diagrams · text/Markdown<br/>(podcast / video / social = later)"]:::proposed
    C -->|Check credibility| F["Mission + Proof:<br/>approval record, expert sign-off"]:::proposed
    C -->|Ready now| G["CTA: Book a 30-minute conversation"]:::proposed
    D --> G
    E --> G
    F --> G
    G --> J["Work-with-me: qualify as SME<br/>Discovery / Sprint / Pilot (services-led)"]:::proposed
    J --> K{"Fit?"}:::proposed
    K -->|Not yet| MW["Stay in touch / follow-up<br/>(self-serve Pro is deferred)"]:::proposed
    K -->|Yes| L["Sign in / sign up<br/>Supabase: email or Google"]:::built

    L --> N["Studio dashboard /app/mentible"]:::built
    N --> O["New project: Title · Topic · Audience · Goal"]:::built
    O --> IN["Input phase: add Sources<br/>paste / Link / notes — content lives here"]:::built
    IN --> P["AI draft — grounded, uses ONLY the sources"]:::built
    P --> RQ{"Draft ready?"}:::built
    RQ -->|Refine| CH["Request changes / regenerate"]:::built
    CH --> P
    RQ -->|Send for validation| INV["Invite expert reviewer"]:::built

    INV -.->|email invite| RV["Invited expert opens invite link"]:::built
    RV --> RVr["Redeem on login -> scoped access to THIS project"]:::built
    RVr --> RW["Reviews tab: read draft + leave feedback"]:::built
    RW --> VD{"Expert verdict"}:::built
    VD -->|Changes| CH
    VD -->|Approve as expert| AR["Approval record<br/>append-only, recorded_via"]:::built
    AR --> PUB["Publish phase (separate step):<br/>Copy as text / Markdown"]:::built

    PUB --> DERI["Derivatives: post / banner / audio / video"]:::proposed
    PUB --> EXP["PDF / Word export (Pro)"]:::proposed
    DERI --> SH["Shared assets drive referrals + leads"]:::proposed
    SH --> A

    LB["● Built / live today"]:::built
    LP["● Proposed / not built"]:::proposed

    classDef built fill:#DCFCE7,stroke:#16A34A,stroke-width:2px,color:#052e16;
    classDef proposed fill:#FEF3C7,stroke:#D97706,stroke-width:1.5px,stroke-dasharray:6 4,color:#451a03;
```

> The SME owner may also **be** the expert and self-validate; the invited-reviewer branch is the two-actor case.

---

## 2. Sequence — actor messages

```mermaid
sequenceDiagram
    autonumber
    %% Shaded zones: amber = PROPOSED (not built), green = BUILT (live today).
    actor V as Visitor / SME owner
    actor R as Invited expert reviewer
    participant S as Splash page
    participant MK as Work-with-me
    participant A as Auth (Supabase)
    participant D as Studio (/app/mentible)
    participant AI as AI drafting (grounded)
    participant DB as Cloud DB

    rect rgb(254, 243, 199)
    note over V,MK: PROPOSED — marketing site & services funnel (single landing page today)
    V->>S: Open home (subpath: mambakkam.net/mentible)
    S-->>V: Hero, proof stats, approval-record preview
    V->>S: Scroll How it works / Formats / Proof
    V->>MK: Click "Book a 30-minute conversation"
    MK-->>V: Qualify as SME (Discovery / Sprint / Pilot)
    end

    rect rgb(220, 252, 231)
    note over V,DB: BUILT — live today (owner may also BE the expert and self-validate)
    V->>A: Sign in (email or Google)
    A-->>V: Session (JWT)
    V->>D: Enter studio dashboard
    D->>DB: Load projects for user
    DB-->>D: Project list
    V->>D: New project (Title / Topic / Audience / Goal)
    V->>D: Input phase — add Sources (paste / Link / notes)
    V->>D: Generate draft
    D->>AI: Draft request (use ONLY the sources, invent nothing)
    AI-->>D: Draft with sourced claims
    D-->>V: Draft in workspace

    loop Refine until ready
        V->>D: Request changes / regenerate section
        D->>AI: Regenerate
        AI-->>D: Revised draft
    end

    V->>D: Invite expert reviewer (email)
    D->>DB: Create invite / project_membership
    R->>A: Open invite link, sign in
    A-->>R: Session
    R->>D: Redeem -> scoped access to THIS project only
    R->>D: Read draft, leave feedback
    alt Changes requested
        D-->>V: Feedback routed back to refine loop
    else Approved
        R->>D: Approve as expert
        D->>DB: Store approval record (append-only, recorded_via)
    end
    V->>D: Publish phase (separate, user-initiated step)
    D-->>V: Copy master as text / Markdown
    end

    rect rgb(254, 243, 199)
    note over V,DB: PROPOSED — derivatives, export & referral loop
    V->>D: Generate derivatives (post / banner / audio / video)
    D-->>V: PDF / Word export (Pro)
    V->>S: Share links back to site (leads, referrals)
    end
```

---

## Build reality behind the colors

- **Built (green):** Supabase auth · Studio dashboard · New project (Title/Topic/Audience/Goal) ·
  Input/Sources · grounded AI draft · refine loop · invite → redeem → Reviews (scoped
  `project_membership`) · expert approve → append-only approval record (`recorded_via`) ·
  Publish (Copy text/Markdown). **Plus (shipped 2026-08-14, see status note):** the
  `/work-with-me` page + landing "Work with me" CTA (services funnel via a Calendly link-out).
- **Proposed (amber):** the fuller marketing site (hero, intent grid, About/Books/Content,
  Mission+Proof), the Formats grid extras (podcast/video/social — note video = animated SVG
  only), derivatives (short-form studio, PR #338), PDF/Word export, the referral loop, and
  self-serve Pro (deferred).

Source diagrams: `Mentible_Splash_Page_Flow_Corrected.mmd` /
`Mentible_Splash_Page_Sequence_Corrected.mmd`.
