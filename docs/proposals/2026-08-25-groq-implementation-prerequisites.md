# Groq + Llama — Prerequisites Before Implementation

> **Status:** Pre-implementation checklist. **Date:** 2026-08-25.
> **Purpose:** The **things you (human) need to do or decide** before I write the code to make
> **Groq the managed default** (Llama 3.3 70B + a second Llama option), with **BYOK** for
> Claude/others.
> **Implementation plan (the code side):**
> [`2026-08-25-groq-default-testing-phase.md`](./2026-08-25-groq-default-testing-phase.md).

---

## 0. The short version

You need to do **4 things** to unblock me:

1. **Create a Groq account + API key** (free, no card).
2. **Decide 4 questions** (trust provider · quota tier · default scope · second-model scope).
3. **Give me the tester email list.**
4. **Apply two prod settings** (the Groq key + the tester allowlist) — you run prod ops; I prep the change.

Everything else is code I already have mapped. **No `wegofwd-llm` package release is needed** —
Groq is already registered and verified in the shared package; the default-flip is in-repo constants.

---

## 1. Accounts & keys — you create these

- [ ] **A1. Groq account + API key** *(blocking)*
  - Go to **console.groq.com** → sign up (Google/GitHub/email) → **API Keys** → **Create API Key**.
  - Copy the key (starts with **`gsk_`**). Free tier — **no credit card**.
  - Hand it to me via a secure channel (or, better, **you** paste it into the prod env in step A2 —
    I never need to see it).
  - *Why:* this is the single managed key all testers' Groq generations run through (and the key I
    use for the step-6 verification generation).

- [ ] **A2. (Only if quota tier = B, paid) upgrade Groq to the Dev tier** *(conditional)*
  - In the Groq console, add a card + enable the paid **Dev tier** (removes the free per-minute /
    per-day rate ceiling).
  - *Why:* the free tier is one shared quota bucket — fine for a few coordinated testers, throttles
    (HTTP 429) under concurrency. See the plan §6. Skip this if you pick tier A or C.

---

## 2. Decisions I need from you

- [ ] **D1. Trust-artifact generation: Anthropic or Groq?** *(blocking — recommend Anthropic)*
  - The cited/validated trust spine (ADR-037) is flagged draft-grade on open models. Recommendation:
    **keep trust on Anthropic-managed**, flip only book/lesson/TOC to Groq. (One-line difference.)

- [ ] **D2. Quota tier: A / B / C?** *(blocking)*
  - **A** — free, one managed key (shared quota; expect 429s under concurrency).
  - **B** — paid Groq Dev tier, one managed key (removes the ceiling; needs A2). **Recommended if
    testing is real.**
  - **C** — no managed key; each tester BYOKs their own free Groq key (quota scales; signup friction).

- [ ] **D3. Default scope: testing cohort only, or app-wide?** *(blocking)*
  - Managed access is gated by the tester allowlist. Making Groq the *default provider* means a
    keyless user hitting the default needs managed eligibility (be on the allowlist) **or** their own
    BYOK key. For a closed test, "testers only" is clean. Confirm which.

- [ ] **D4. Second Llama model now, or single-model first?** *(non-blocking)*
  - Ship both **Llama 3.3 70B** (default) + **Llama 3.1 8B instant** (a model sub-picker — the only
    real UI work), or launch single-model Groq now and add the 8B picker as a fast-follow. Single
    model shaves the UI task to near-zero.

---

## 3. Info / access I need

- [ ] **I1. Tester email list** *(blocking)* — the addresses to add to `MANAGED_PLAN_EMAILS` (grants
      keyless managed access). Your own testing email(s) included.
- [ ] **I2. Groq data-retention / ToS confirmation** *(blocking for D2 = A/B managed)* — a quick read
      that Groq's terms are acceptable for routing testers' content on the **managed** path. (Groq is
      US-based — no China-residency issue.) For **C (BYOK)** the tester opts in themselves, lower bar.
- [ ] **I3. Confirm the in-repo default approach** *(FYI, no action)* — I'll set defaults with in-repo
      constants (backend `generate/schemas.py` + mobile `DEFAULT_PROVIDER_ID`), **not** by editing the
      `wegofwd-llm` `ROLE_DEFAULTS`, so **no package release**. Tell me only if you specifically want
      role-based defaults (then a `wegofwd-llm` tag + pin bump is needed).

---

## 4. Prod settings — you apply (I prep)

You run prod/ROOT ops; I stage the change + verify. Once A1/D2/I1 are settled:

- [ ] **P1. Set `MANAGED_GROQ_API_KEY=gsk_…`** in the backend prod env (`config.py` maps this field
      from the env var). No migration.
- [ ] **P2. Add tester emails to `MANAGED_PLAN_EMAILS`** (comma-separated) in the prod env.
- [ ] **P3. Restart/redeploy the backend** to pick up the env (standard config redeploy — no DB change).

*(These are the only prod-side changes; both are env vars, no schema/migration.)*

---

## 5. Minimal unblock path

If you want the fastest green light, the smallest set is:

1. **A1** — create the Groq key.
2. **D1 = Anthropic** (keep trust safe), **D2 = A** (free) or **B** (paid), **D3 = testers-only**,
   **D4 = single-model first**.
3. **I1** — send the tester emails; **I2** — confirm Groq ToS OK.
4. **P1–P3** — set the two env vars + redeploy (I'll prep and verify).

That unblocks the whole implementation; the second Llama model (D4) can follow later.

---

## 6. What I do once the above is set

Per the plan doc §3: flip defaults to Groq/Llama (in-repo constants), (optionally) add the second
Llama model picker, add 429 handling, Help topic + tests, verify a real Groq generation
(whole-book + lesson + a diagram/KaTeX topic), then ship (backend config redeploy + web deploy both
surfaces + APK). No migration, no package release, ~0.5–1.5 dev-days + the verify pass.

---

*Prepared 2026-08-25. Companion: the implementation plan
[`2026-08-25-groq-default-testing-phase.md`](./2026-08-25-groq-default-testing-phase.md) and the
[BYOK cost model](../research/cost-model-byok-unit-economics.md).*
