# ADR-002: Repo Structure & Vendoring Strategy

| | |
|---|---|
| **Status** | Accepted — 2026-04-25 · **Amended by ADR-012 / ADR-019 (currency pass 2026-07-11):** the LLM-**provider** vendoring this ADR covered is superseded by the shared `wegofwd-llm` package — `pipeline/providers/*` are a deprecated rollback path only (`pipeline/VENDORED.md`). `prompts.py` / `content_format_validator.py` / `toc_structurer.py` remain vendored as described. |
| **Decision-maker** | Sivakumar Mambakkam |
| **Related** | SCOPE.md §8 · CLAUDE.md "Repository layout" |

---

## Context

StudyBuddy Q reuses a meaningful slice of intellectual property from the
existing `StudyBuddy_OnDemand` codebase:

| Module | What it does | Why it's reusable |
|---|---|---|
| `pipeline/prompts.py` | Universal + per-subject formatting blocks (Epic 11 IP) | This is the scoping IP — the actual product moat |
| `pipeline/providers/` | `LLMProvider` ABC + `AnthropicProvider` | Already abstracts model + transport |
| `pipeline/content_format_validator.py` | Drift detection on generated content | Same quality bar applies |
| `pipeline/config.py` (subset) | Model pinning, max_tokens defaults | Same defaults are right |

We need a strategy for sharing these without coupling release cycles or
introducing circular dependencies between two products that should evolve
independently.

Three approaches were on the table:

| Approach | How |
|---|---|
| **A. Git submodule** | `pipeline/` is a submodule pointing at a tagged version of OnDemand |
| **B. Python package** | Extract shared code into `studybuddy-prompts` package on a private PyPI / Git URL |
| **C. Vendoring (copy)** | Copy the files into this repo; track source SHA in `VENDORED.md` |

---

## Decision

**We adopt Approach C — vendoring.** The shared modules are copied verbatim
into `pipeline/` in this repo. A `pipeline/VENDORED.md` file records the source
file path and the OnDemand commit SHA each was copied from. Updates are a
deliberate, manual sync triggered by a script and gated by a code review.

```
StudyBuddy_SelfLearner/
  pipeline/
    prompts.py                    ← vendored
    providers/
      __init__.py
      base.py                     ← vendored
      anthropic.py                ← vendored (modified — see notes)
    content_format_validator.py   ← vendored
    config.py                     ← Q-specific (NOT vendored)
    VENDORED.md                   ← source SHA tracker
```

---

## Why vendoring (not submodules, not a package)

### Submodules (rejected)

| Problem | Why it's a deal-breaker |
|---|---|
| Submodules make a single pinned version *the* version | We *want* to diverge — Q may evolve prompts independently of OnDemand |
| `git clone --recursive` foot-guns | Junior contributors will trip on this perpetually |
| Submodule pointers don't show up in PR diffs cleanly | Code review of "the thing we depend on" becomes opaque |
| Two repos must be cloned to develop one | Local dev friction multiplies |

### Shared package on PyPI / private index (rejected at this stage)

| Problem | Why it's a deal-breaker |
|---|---|
| Adds release-management overhead — every prompt tweak needs a version bump and a publish | Both products release at different cadences; we'd block on each other |
| Forces *runtime* coupling (same dependency tree) | The two backends already differ on auth, RLS, Stripe, etc. — pinning shared deps is noise |
| Premature abstraction | We have one consumer (Q) of the shared code. YAGNI |
| Dependency audit / supply-chain story | More moving parts before the shared code has proven stable |

### Vendoring (chosen)

| Pro | Why it wins |
|---|---|
| **Diffable** | A code review of the synced changes shows up as a normal PR diff |
| **Decoupled release** | We can hold an old prompt version while OnDemand iterates, or pull the latest selectively |
| **No build-system gymnastics** | One repo, one Poetry/uv lock, one CI pipeline |
| **Honest** | The IP is small (~few hundred lines of prompts + ~200 lines of provider abstraction). Pretending it's "a library" is over-engineering |

---

## When (and how) to sync

Vendoring is **not "copy once and forget."** Updates are deliberate, scripted,
and reviewed.

### Trigger conditions for a sync

| Trigger | Action |
|---|---|
| OnDemand merges an Epic-11-style prompt improvement | Open a vendor-sync PR within 1 week |
| OnDemand fixes a `pipeline/providers/` bug that affects us | Sync immediately |
| Q diverges from OnDemand intentionally (custom prompt for self-learner) | Document divergence in `VENDORED.md`; do NOT auto-sync that file thereafter |
| OnDemand refactors the public surface | Manual port — vendoring script may need updating first |

### The sync script

`scripts/sync-from-ondemand.sh` — to be implemented in the first MVP PR.
Behaviour:

```bash
#!/bin/bash
# Usage: ./scripts/sync-from-ondemand.sh <ondemand-repo-path> [--dry-run]

ONDEMAND="$1"
FILES=(
  "pipeline/prompts.py"
  "pipeline/content_format_validator.py"
  "pipeline/providers/__init__.py"
  "pipeline/providers/base.py"
  "pipeline/providers/anthropic.py"
)

for f in "${FILES[@]}"; do
  cp "$ONDEMAND/$f" "./pipeline/$(basename "$f" | ...)"
done

# Record SHAs
ONDEMAND_SHA=$(git -C "$ONDEMAND" rev-parse HEAD)
# Append/update VENDORED.md with date + SHA per file
```

Outputs an updated `VENDORED.md` and stages the changes for review.

### `VENDORED.md` format

```markdown
# Vendored Files

Last sync: 2026-04-25 from StudyBuddy_OnDemand@a1b2c3d4

| File | Source path | Source SHA | Synced at | Modified locally? |
|---|---|---|---|---|
| pipeline/prompts.py | pipeline/prompts.py | a1b2c3d4 | 2026-04-25 | No |
| pipeline/providers/anthropic.py | pipeline/providers/anthropic.py | a1b2c3d4 | 2026-04-25 | **Yes — Q passes BYOK key per-call instead of from env** |
| pipeline/content_format_validator.py | pipeline/content_format_validator.py | a1b2c3d4 | 2026-04-25 | No |
```

### Files we explicitly modify after vendoring

| File | Modification | Why |
|---|---|---|
| `pipeline/providers/anthropic.py` | Constructor takes `api_key` argument per-call instead of reading env | BYOK requires per-request keys (ADR-001) |
| `pipeline/config.py` | Q-specific defaults; not vendored at all | Different deployment context |

When OnDemand modifies `anthropic.py`, the sync script flags it as a
"modified-locally" conflict. Resolution is a manual three-way merge.

---

## Commit message convention

Vendor syncs use a dedicated prefix:

```
chore(vendor): sync pipeline from OnDemand@a1b2c3d4

- prompts.py: pull Epic 11 maths-formatting refinements
- providers/anthropic.py: keep local modification (BYOK per-call key)
- content_format_validator.py: pull new format-drift rule for currency

Source: StudyBuddy_OnDemand@a1b2c3d4
```

---

## Anti-patterns to avoid

### ❌ Don't import from the OnDemand repo at runtime

Even if both repos sit side-by-side on disk, the backend must not do:

```python
# WRONG
import sys
sys.path.insert(0, "../StudyBuddy_OnDemand")
from pipeline.prompts import build_lesson_prompt
```

This couples deployment, makes Docker images leak across products, and breaks
the moment one repo refactors. Always use the local vendored copy.

### ❌ Don't symlink the vendored files

A symlink to the OnDemand checkout means updates are silent and untracked. The
whole point of vendoring is that updates are visible in git diffs.

### ❌ Don't auto-sync on CI

Tempting but wrong: an automated nightly sync would silently drift Q's prompts
under us. Vendor syncs are deliberate human acts.

### ❌ Don't vendor things we don't need

`pipeline/build_grade.py`, `pipeline/seed_default.py`, etc. are not vendored.
They're tools in the OnDemand pipeline that don't apply to Q. Resist the urge
to copy "just in case."

---

## Consequences

### Positive

- Two products evolve independently
- Vendor updates show up as reviewable diffs, not opaque submodule pointer changes
- No release-cycle coupling
- New contributors can clone one repo and develop

### Negative

- Drift risk if syncs are forgotten — mitigated by the sync trigger list above
- Manual merge work on locally-modified files (`anthropic.py`)
- Easy for the sync script to fall behind reality if file paths change in OnDemand

### Operational

- A monthly review reminder ("any prompt changes in OnDemand worth pulling?") is healthy
- If both products end up with substantial shared logic *plus* shared UX *plus*
  a stable contract, revisit Approach B (extract to a package). Until then, vendoring is enough

---

## Review

This ADR will be re-reviewed:
- If 6+ files end up vendored (sign of growing shared surface — package may be warranted)
- If Q and OnDemand prompts diverge significantly enough that "syncing" no longer makes sense
- If a third product joins the family and would also want the same shared code (then a package is clearly the right answer)
