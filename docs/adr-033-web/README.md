# ADR-033 web explainers (interactive HTML sources)

Self-contained, standalone HTML source for the interactive web versions of the ADR-033
explainer set. **Open any file directly in a browser** — all CSS/SVG is inlined, no external
assets, light/dark aware. These are the sources behind the private claude.ai artifacts; the
editable **PowerPoint** counterparts live in `docs/adr-033-decks/`.

| File | What it is | Live artifact | PPTX / MD counterpart |
|---|---|---|---|
| `user-facing-view.html` | Two-tier user view (free device-local vs paid private hosted) + Mermaid diagrams | [a33e9e59](https://claude.ai/code/artifact/a33e9e59-cc1d-4b70-b1f7-69986f6efad2) | `docs/adr-033-user-facing-view.md` |
| `tiers-free-vs-paid.html` | Free-vs-paid, at a glance (non-technical: mock screens, concepts, comparison) | [52f0fb35](https://claude.ai/code/artifact/52f0fb35-24da-4eb7-8c8e-00454d83b559) | `docs/adr-033-decks/tiers-free-vs-paid.pptx` |
| `persona-value-loop.html` | How four personas get value via the learn → author → carry loop | [b00964cf](https://claude.ai/code/artifact/b00964cf-5330-4fab-aa5c-6d16c27dbd73) | `docs/adr-033-decks/persona-value-loop.pptx` |
| `persona-physician.html` | Physician deck — **clinical-chart** world (tabbed-binder library) | [57dbed2a](https://claude.ai/code/artifact/57dbed2a-ae9d-4fe0-8d0b-c8f37bdde95f) | `docs/adr-033-decks/mentible-for-physicians.pptx` |
| `persona-student.html` | Med-student deck — **notebook** world (flashcard-fan library) | [1499095d](https://claude.ai/code/artifact/1499095d-7d96-4ba7-92a8-2a52bffae8c7) | `docs/adr-033-decks/mentible-for-medical-students.pptx` |
| `persona-screenwriter.html` | Screenwriter deck — **screenplay** world (corkboard library) | [a7ad5f88](https://claude.ai/code/artifact/a7ad5f88-f2ee-4ec6-b3e9-278515581617) | `docs/adr-033-decks/mentible-for-screenwriters.pptx` |
| `persona-architect.html` | Security-architect deck — **blueprint/terminal** world (system-map library) | [bd2a7043](https://claude.ai/code/artifact/bd2a7043-8093-46a4-8716-07d5b7de1006) | `docs/adr-033-decks/mentible-for-security-architects.pptx` |

**Notes**
- The four `persona-*` files are the redesigned **distinct-world** versions (see `docs/adr-033-decks/README.md`). Earlier templated/first-person drafts were superseded and are not archived here.
- To update a live artifact from its source: edit the HTML here, then re-publish the file to the same artifact URL.
- All map to `docs/adr/ADR-033-per-user-private-hosted-library.md`. Free = device-local & zero-knowledge; paid = private hosted. Personas are illustrative.
