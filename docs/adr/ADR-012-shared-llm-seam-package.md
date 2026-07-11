# ADR-012 — Shared LLM provider seam as an installable package

**Status:** Accepted — 2026-06-09 · **built** (`wegofwd-llm[anthropic]@v0.2.0` pinned in `backend/requirements.txt`; `pipeline/VENDORED.md` points at the package). *Currency note 2026-07-11:* D1 said the legacy `pipeline/providers/{base,anthropic}.py` are deleted per consumer on migration — in Mentible they're **retained as a documented rollback path** (see `VENDORED.md`), not yet deleted.
**Decision-maker:** Sivakumar Mambakkam
**Amends:** **ADR-002** (the provider layer graduates from a *vendored copy* to a
*shared package dependency* — this fires ADR-002's own stated review trigger:
"if a third product joins the family and would also want the same shared code,
then a package is clearly the right answer"). **ADR-005** (the `LLMProvider` seam
it authorised now has a concrete cross-product home, owner, and release policy).
**Extends:** **ADR-011** (Pramana becomes a *runtime* LLM consumer — it will
generate its own content, not only ingest Mentible artifacts; the *scope* of that
generation is an open product question below and requires an ADR-011 amendment).
**Relates:** **ADR-001** (key discipline — the package never sources, persists, or
logs a key, of either regime).

---

## Context

The multi-provider LLM seam authorised by ADR-005 is now **built and merged**
(Mentible PRs #76–#78, 2026-06-09). It lives in `pipeline/providers/` and is
already portable — `contract.py` imports nothing from `backend/`. It comprises a
typed request/response (`LLMRequest`/`LLMResponse`), a `Capabilities` descriptor,
a registry with logical-role pinning + provenance + per-provider key prefixes and
output-token clamps, a validate→repair conformance loop, native Anthropic tool-use,
and a shared OpenAI-compatible client.

Three products in the family now want this same seam **at runtime**:

| Consumer | Today | Key regime | What it generates |
|---|---|---|---|
| **Mentible** (this repo) | owns the new seam in `pipeline/providers/` | **BYOK** (key per request) + future managed | books / lessons |
| **OnDemand** | older, weaker seam: `get_provider(provider_id, config)` → legacy tuple `LLMProvider` (anthropic/openai/google), keyed from config/env, driven by `build_unit.py` | **managed** (config/env) | curriculum units |
| **Pramana** | artifact-exchange only (ADR-011); no LLM calls today | **managed** (vault) | **compliance content (new)** |

Two facts force the decision:

1. **There are now three runtime consumers of one seam.** ADR-002 chose
   *vendoring* over a package explicitly because "we have one consumer (Q) of the
   shared code. YAGNI," and because *content* (prompts) should be free to drift per
   product. The provider seam is the opposite kind of artifact: **shared
   engineering infra we want identical everywhere**, with real version semantics
   (`LLM_CONTRACT_VERSION`, per-provider `integration_version`). Vendoring it three
   ways means perpetual drift and 3× every bugfix.

2. **ADR-002 pre-authorised this exact move.** Its "Review" section names the
   trigger verbatim — a third product joining the family. ADR-012 is therefore an
   *extension* of ADR-002's logic, not a reversal of it. Vendoring **stays** for
   the things ADR-002 was actually about (prompts/content); only the provider layer
   graduates.

The directions memo (`docs/multi-provider-directions.md` §4) anticipated this:
"lift it to a new package that imports nothing from `backend/` — cleaner boundary."

---

## Decision

### D1 — Extract the provider seam into a standalone installable package

A new package (working name **`llm-seam`** — see open questions) owns the
provider layer. The following modules move out of `pipeline/providers/` into it:

```
llm_seam/
  contract.py          # LLMRequest, LLMResponse, Capabilities, Provider ABC, LLM_CONTRACT_VERSION
  errors.py            # typed error hierarchy (LLMError + subclasses)
  registry.py          # ProviderSpec, PROVIDER_REGISTRY, ROLE_DEFAULTS,
                       #   build_provider, validate_selection, provenance, available_providers
  conformance.py       # generate_validated — the validate→repair loop (schema-agnostic, see D2)
  providers/
    anthropic_native.py   # tool-use JSON
    openai_compatible.py  # OpenAI/Groq/OpenRouter/Gemini/… one client
  tests/                  # the existing tests/llm suite travels with the code —
                          #   it IS the conformance gate (ADR-005 / directions §10)
```

`base.py` / `anthropic.py` (the **legacy tuple** seam) do **not** move; they are
deprecated and deleted from each consumer as it migrates onto the new `Provider`
interface (mechanical wrap, per directions §3).

### D2 — The package is product-neutral and schema-agnostic

This is the rule that keeps it reusable across three different content domains.

- `conformance.generate_validated(...)` validates against a **caller-supplied JSON
  schema / validator** and runs the repair loop. It knows nothing about lessons vs
  curriculum units vs compliance documents.
- **Prompts and output schemas stay in each product** (Mentible: `lesson_schema`;
  OnDemand: its unit schema; Pramana: its compliance schema). They remain vendored
  per ADR-002 where shared, or product-local where not.
- The package contains **no prompt text and no product schema.** If a change would
  put one in, it belongs in a consumer, not the package.

### D3 — The package never sources keys; the caller always passes the key string

This collapses the BYOK-vs-managed split into a non-issue *inside* the package and
reconciles ADR-001 (transient BYOK) with ADR-005 (at-rest managed vault):

| Consumer | Call |
|---|---|
| Mentible (BYOK) | `build_provider(pid, api_key=<from request body>)` |
| OnDemand (managed) | `build_provider(pid, api_key=settings[spec.managed_env_key])` |
| Pramana (managed) | `build_provider(pid, api_key=<from vault>)` |

- The registry already carries `managed_env_key` per provider, so the managed path
  is anticipated; **resolving** that env var / vault secret is the *caller's* job,
  not the package's. The package never touches `os.environ` or any secret store —
  which keeps it pure, testable, and free of a hidden leak surface.
- The package's standing guarantee (already mandated in `contract.py`): **no key
  of either regime ever reaches an exception message, a log line, a `raw` field, or
  a `repr`.** Each consumer keeps its own ADR-001-style log-redaction filter and
  its mandatory "no key in any log line" test — the package ships its own copy of
  that test covering every key prefix it knows.

### D4 — Distribution: own repo, semver tags, pinned git dependency

- The package lives in **its own git repository**, versioned with **semver tags**,
  consumed as a **pinned git dependency** (`pip install llm-seam @ git+…@vX.Y.Z`),
  with an **editable path-install** for local multi-repo development.
- **Pinning is what preserves ADR-002's decoupling.** Each product upgrades
  deliberately when it is ready; nobody is forced to move in lockstep. The single
  source of truth eliminates drift — which is the property vendoring three copies
  could not give us.
- **Versioning governance** (three independent axes, already designed into the
  seam): package **semver** governs the whole; **`LLM_CONTRACT_VERSION`** governs
  the request/response shape; per-provider **`integration_version`** governs how we
  call a given vendor. Additive change → minor; breaking the contract → major +
  `LLM_CONTRACT_VERSION` bump. A private package index is deferred until a git+tag
  dependency proves insufficient.

### D5 — Vendoring stays for prompts/content; only the provider layer graduates

ADR-002 is **not** repealed. Prompts (`prompts.py`), `content_format_validator.py`,
TOC prompt templates, and any shared *content* remain vendored from OnDemand exactly
as today — they *should* drift per product. `pipeline/VENDORED.md` is updated to
**remove the provider rows** (they are now a dependency, not a vendored copy) and to
point at this ADR.

### D6 — Provenance is the shared cross-product vocabulary

`provenance() → {provider, model, model_verified, integration_version,
contract_version}` is **both** the stamp that rides on a Mentible→Pramana artifact
(ADR-011) **and** the stamp Pramana writes on its own generations. One definition,
in the package, used by all three. This means even the pure artifact-exchange path
benefits from the extraction — the consumer/producer agree on the stamp by sharing
the code that defines it.

### D7 — Pramana becomes a generation consumer (product scope is an open question)

The decision to let Pramana generate its own content (rather than only ingest
Mentible artifacts) makes it a runtime consumer of this package. **What** Pramana
generates — a *distinct class* of compliance content Mentible never produced
(complementary, the intended reading) vs. *duplicating* Mentible's generation
(to be avoided) — is a product-architecture question this ADR does **not** settle.
It must be resolved in an **amendment to ADR-011** before Pramana's generation path
is built. ADR-012 only makes the *mechanism* shared; it does not authorise scope.

### D8 — `llm-seam` is a shared **library**, not a network service

This decision shares **code**, not a running server. `llm-seam` is a Python
package each consumer `pip install`s and runs **in its own process** — like
`requests` or `httpx`, not like a microservice the apps call over HTTP/RPC.

```
            ┌──────────────── llm-seam (a package — just code) ──────────────────┐
            │  contract · registry · conformance · providers                     │
            └────────────────────────────────────────────────────────────────────┘
                 ▲  pip install (in-process)   ▲                     ▲
        ┌────────┴────────┐         ┌──────────┴───────┐     ┌───────┴─────────┐
        │ Mentible backend│         │ OnDemand pipeline│     │ Pramana backend │
        │  BYOK key       │         │  managed key     │     │  managed key    │
        └────────┬────────┘         └────────┬─────────┘     └────────┬────────┘
                 └──── each makes its OWN direct call to Anthropic/Groq/… ───────┘
```

Each app calls `build_provider(...).generate(req)` inside itself; the outbound
call to the vendor is made by **that app's own process, with that app's own key**.
There is no `llm-seam` server to deploy, scale, monitor, or keep up.

Why this is the right model, not a shared service:

| | Shared **library** (this ADR) | Shared **service** (rejected) |
|---|---|---|
| Deploy | nothing new — code in each app | a new server to run/scale/secure 24/7 |
| Keys | each app holds its own (D3: caller passes the key) | a central store of *everyone's* keys — a honeypot that **breaks ADR-001** |
| Failure | no new failure point | down → all three apps cannot generate |
| Latency | none added | an extra network hop per call |
| Upgrades | each app **pins** a version, moves when ready (preserves ADR-002 decoupling) | one global rollout, no opt-out |

A central, key-holding service would put the transient BYOK key (ADR-001) and the
managed vault keys (ADR-005) in one externally-reachable place — exactly what both
ADRs forbid. The library model keeps every key inside the process that owns it.

> **Not in scope of this "library" framing:** the **Mentible ↔ Pramana** link is
> still a genuine *service* call — an **artifact** exchange over HTTP (ADR-011,
> `mentible_client`). That is products handing finished packages to each other; it
> is unrelated to how they share the LLM *code* (this ADR). Don't conflate the two.

---

## Migration plan

Mentible goes first as the reference consumer (smallest change — it already has
this shape), then the larger lifts.

1. **Extract** the D1 modules + their tests into the `llm-seam` repo; tag `v0.1.0`.
   No behaviour change; the test suite must stay green on the way out.
2. **Mentible:** replace `pipeline/providers/` with the package dependency; backend
   call-seam and redaction stay put. Update `VENDORED.md` (drop provider rows).
3. **OnDemand** *(largest lift)*: add the dependency; migrate `build_unit.py` and
   the legacy `get_provider`/tuple seam onto `build_provider` /
   `LLMRequest`/`LLMResponse`; port the `google` provider (maps to the
   OpenAI-compatible `gemini` registry entry, or a native Google provider if
   needed); managed keys passed from config.
4. **Pramana** *(net-new, gated on the D7 / ADR-011 amendment)*: add the
   dependency; build its `content_request → draft` generation on `build_provider`
   with managed keys; stamp `provenance()` on each draft.
5. **Docs:** this ADR is the canonical record; reference it from OnDemand's and
   Pramana's docs as they adopt. Update `VENDORED.md`, `multi-provider-directions`,
   and the ADR-011 amendment.

---

## Alternatives considered

| Approach | Verdict |
|---|---|
| **Keep vendoring** (Mentible owns the seam, sync-script copies it into OnDemand + Pramana) | **Rejected.** Vendoring suits *content that should drift*; this is *infra that must not*. Three copies drift; every fix synced 3×; contract/integration versions skew. ADR-002's own review trigger ("third product joins") explicitly points away from this. |
| **Monorepo / git submodule** | **Rejected.** Biggest structural change; out of step with the established multi-repo layout; submodule foot-guns already catalogued in ADR-002. |
| **Status quo** (each product carries its own provider layer) | **Rejected.** OnDemand's seam is already weaker (no conformance, no metering, no provenance); divergence would only widen, and Pramana would start from nothing. |

---

## Open questions

- **Package name.** `llm-seam` is a working title. The package now serves a
  compliance product (Pramana), so a product-neutral, org-scoped name is preferred
  over a "studybuddy"-flavoured one. Decide before tagging `v0.1.0`.
- **Repo location / release ownership.** Where the package repo sits and who cuts
  releases (a single owner keeps the contract coherent).
- **Pramana generation scope (D7).** Distinct compliance content vs. duplicating
  Mentible — requires an **ADR-011 amendment** before Pramana's path is built.
- **Long-term distribution.** Git+tag is the start; revisit a private index if/when
  the number of consumers or the release cadence makes it worthwhile.
- **CI for the package.** The JSON-conformance suite is the authoring-grade gate
  (directions §10) — it must run in the package's own CI, and each consumer keeps
  its own key-redaction test.
- **North Star alignment.** The recorded model is "Mentible = the generation
  engine; Pramana = definitions + delivery." D7 shifts that; the North Star note
  and ADR-011 should be updated in step.

---

## Consequences

**Positive:** one source of truth for the seam — no 3-way drift, one place to fix a
bug or add a provider; the contract/capabilities/provenance vocabulary is shared by
type, not by copy; OnDemand's weaker seam is replaced by the stronger one
(conformance, metering, provenance); Pramana gets a proven generation layer for
free; pinning keeps release cycles decoupled in practice. ADR-002's intent
(decoupling, diffability) is preserved for content, where it actually mattered.

**Negative:** a new repo and a (lightweight) release process; consumers must pin and
deliberately upgrade; a breaking contract change now requires a coordinated
major-version bump across up to three products (mitigated by additive-by-default
discipline and `LLM_CONTRACT_VERSION`). OnDemand's migration off the legacy tuple
seam is real work. Pramana gaining a generation path is a genuine product
expansion that must be scoped (D7) before it is built.

---

## References

- ADR-001 — BYOK security / key discipline; the package's "never source or log a
  key" guarantee upholds it for both regimes.
- ADR-002 — Repo structure & vendoring; **amended** for the provider layer per its
  own "third product joins" review trigger; vendoring stays for content.
- ADR-005 — Multi-provider LLM support; the seam it authorised gets a home here.
- ADR-011 — Pramana compliance integration; **extended** (Pramana now generates);
  the generation *scope* needs an ADR-011 amendment (D7).
- `docs/multi-provider-directions.md` §4, §6, §10 — anticipated the package, the
  role-pinning registry, and the conformance gate.
- `pipeline/providers/` (Mentible PRs #76–#78) — the seam being extracted.
- `pipeline/VENDORED.md` — to be updated to drop the provider rows.
