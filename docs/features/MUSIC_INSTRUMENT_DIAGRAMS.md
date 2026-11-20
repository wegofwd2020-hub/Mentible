# Labelled instrument diagrams (music)

Status: shipped in commit `17df4e0e` (branch `chore/rebuild-generation-prompts`).
Prompt rules live in `backend/src/generate/prompt_builder.py`
(`_MUSIC_SVG_GUIDELINES`, `_MUSIC_NO_SVG_GUIDELINES`, `_MUSIC_KEYWORDS`,
`_subject_block`). In-app help: topic `instrument-diagrams`, feature key
`instrument-diagrams` in `mobile/src/help-content/features.ts`.

## What the author gets

For a music lesson, the model draws the instrument as a labelled inline SVG:
a keyboard with the note names on the keys, or a fretboard with the strings
named. The drawing appears where the lesson names a key or control.

It is an approximation drawn by the model, not a photo. Key counts and label
positions can be wrong. Attach a real photo to the topic if the lesson needs an
exact picture.

## When it applies

Routing is by the **topic** text, not the book's subject. The generate request
carries no book subject, so the topic is the only signal. The match is a
substring match, case-insensitive, on:

`music`, `piano`, `keyboard`, `chord`, `rhythm`, `melody`, `instrument`,
`guitar`, `octave`

Examples:

| Topic | Gets the block? |
|---|---|
| Day 1: Keyboard Basics | Yes |
| Reading rhythm in 4/4 time | Yes (`rhythm`) |
| Photosynthesis in leaves | No |
| Keyboard shortcuts in your editor | Yes (`keyboard` is ambiguous; accepted) |

A book named "Learn Music" does not trigger the block on its own. Each topic
name must contain a keyword.

## What the model is told

With SVG on (the default; no caller turns it off today):

- Draw ONE self-contained inline SVG in a `svg` block, with `viewBox`,
  `role="img"` and an `aria-label`.
- Put a `<text>` label on every key or control named.
- This is an explicit exception to the general rule that reserves `svg` for
  motion and prefers Mermaid for static structure. Mermaid cannot draw a
  keyboard.
- Note names and rhythm values go in markdown tables with centred columns.

With SVG off (`include_svg=False`, unreachable from the app today): the model
describes instrument layouts in words, with no SVG.

## How to use it

1. Add a topic whose name contains one of the keywords, such as
   "Day 1: Keyboard Basics".
2. Generate the topic, alone or with generate-all for the book.
3. Check the drawing against your instrument: key count, label positions and
   the note names.
4. If it's wrong or missing, regenerate the topic. Prompts are not stored, so
   regeneration uses the current rules and the new drawing replaces the old.

## Troubleshooting

- **No drawing appeared:** the topic name has no keyword. Rename the topic to
  include one, then regenerate.
- **Drawing is cut off or labels overlap:** regenerate. If it keeps happening,
  attach a photo instead.
- **A computer-keyboard topic got a piano drawing:** accepted trade-off. The
  keyword list is the only signal; remove `keyboard` from `_MUSIC_KEYWORDS` if
  it matters more than music coverage.

## Known limits

- Routing is topic-only. A book-level subject field would fix this, but the
  generate request and the mobile client would need it too.
- No renderer check runs on the SVG. The tests verify the prompt text, not the
  drawing.
- The reader's sanitiser may remove parts of an SVG it doesn't allow. Check
  the drawing on a device; a stripped element shows up as a missing label or
  shape, not as an error.

## Tests

`backend/tests/test_prompt_builder_music.py` covers keyword routing, the
SVG-off variant and a non-music control.
