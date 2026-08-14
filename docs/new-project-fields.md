# New Project fields — what to put where

When you tap **+ New project** (Projects tab), you fill in up to four fields:
**Title, Topic, Audience, Goal**. This is a guide to what each one is for, its
limits, and — importantly — what it is *not* for.

## The one thing to understand first

**These four fields are *steering* context, not the content.** They tell the AI
the *angle and voice* of the work. The actual material — the facts, the source
text — comes from the **Sources (Inputs)** you add *inside* the project after you
create it. When the model generates an outline or a draft, it is instructed to
**use only your sources and invent nothing**; Title / Topic / Audience / Goal
just frame *how* it writes what the sources contain.

So: **don't paste your whole subject into Topic.** Give a short angle here, then
feed the real material as Sources.

How the fields reach the model (roughly):

> "You are outlining a long-form work **on `{Topic}`** for `{Audience}` so the
> reader can `{Goal}`. Using ONLY the sources below, …"

If a field is blank, that clause is simply left out.

## The fields

| Field | Required? | Max length | Multi-line? |
|---|---|---|---|
| **Title** | ✅ Yes | 120 characters | No |
| **Topic** | Optional | 500 characters | Yes |
| **Audience** | Optional | no fixed cap | No |
| **Goal** | Optional | no fixed cap | No |

### Title  *(required)*
The name of the project. It's what you'll see in the Projects list and on the
project screen — it does **not** steer generation. Make it a clear, human name
for the work.

- ✅ *"Dishwasher drain-pump replacement — DIY guide"*
- ✅ *"Post-mortems that change engineering culture"*
- 🚫 Not a place for the full description — that's Topic.

### Topic  *(optional, 500 chars)*
The **specific insight or angle** you want the work to take — one or two
sentences, not the whole subject. This is the field people most often overfill.
Keep it to the *lens*, and let the Sources carry the detail.

- ✅ *"The end-to-end drain/circulation-pump replacement on a residential
  dishwasher — safe diagnosis, the exact tools and parts, and the common
  mistakes DIYers make."*
- 🚫 Pasting the whole service manual (that's a Source).

### Audience  *(optional)*
**Who the work is for.** Sets reading level, assumed knowledge, and tone. It
becomes "*for `{Audience}`*" in the prompt.

- ✅ *"First-time DIY homeowners with basic hand tools"*
- ✅ *"Senior engineering leaders"*

### Goal  *(optional)*
**What the reader should be able to do afterward**, or why the piece exists. It
becomes "*so the reader can `{Goal}`*" in the prompt.

- ✅ *"safely replace the pump themselves without a service call"*
- ✅ *"Teach · Thought leadership · Lead-gen"* (a mode, if you're using it for
  content)

## After you create the project

1. The project opens on the **Input** phase — this is where you add **Sources**
   (paste text, add a Link, attach notes). *This is the material the draft is
   built from.*
2. Move to **Drafts** to generate an outline and a draft, grounded in those
   sources.
3. **Feedback** — invite an expert to review and validate.
4. **Publish** — copy or export the validated version.

You can edit Title / Topic / Audience / Goal later — none of this is locked in
at creation.

## Quick answers

- **Are any fields required?** Only **Title**.
- **Does Topic write the content?** No — Sources do. Topic sets the angle.
- **What if I leave Topic/Audience/Goal blank?** Fine — the model just gets less
  steering and works purely from your sources.
- **Where does the actual knowledge go?** In **Sources**, inside the project.
