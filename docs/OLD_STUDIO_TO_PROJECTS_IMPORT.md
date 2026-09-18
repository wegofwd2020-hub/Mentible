# Importing Old Studio Books to Projects

**For:** Sridhar (sxp718@gmail.com)  
**Source:** Books authored in old Studio (pre-ADR-037)  
**Destination:** New Projects workspace (trust/expert-validation model)  
**Status:** Manual import process (no automated migration tool yet)

## Overview

Old Studio books (single-lesson model, removed per ADR-009) need to be migrated into the new Projects structure (multi-topic books with expert-validation workflow, ADR-037).

### Old Studio → New Projects Mapping

| Old | New |
|-----|-----|
| Query/Lesson | Book → Topics (per lesson becomes a topic) |
| Generated content | Topic → Versions (first version is the lesson export) |
| No validation | Topic → Approvals (expert review step, new in ADR-037) |

## Import Steps

### 1. Export Old Studio Books

**Via the web app (mentible.app/app/mentible, auth as sxp718@gmail.com):**
- Navigate to **Library** → old books list
- For each book:
  - Open the book
  - **Menu** → **Export** → **Markdown**
  - Save file as `{BookName}.md`

**Or via API (if direct DB access available):**
- Endpoint: `GET /api/v1/library/{book_id}/export?format=markdown`
- Auth: Bearer token for sxp718@gmail.com
- Save response to local file

### 2. Structure for Import

Create a project directory structure:

```
imports/
  old_studio_books/
    book_1_name/
      manifest.json          # metadata (title, author, created_at)
      topics/
        01_chapter_or_lesson.md
        02_chapter_or_lesson.md
        ...
    book_2_name/
      ...
```

**manifest.json template:**
```json
{
  "title": "Book Title",
  "description": "Original description from old Studio",
  "author": "Sridhar Parthasarathy",
  "created_at": "2025-XX-XX",
  "topics": [
    {
      "label": "01 First Topic",
      "file": "topics/01_chapter_or_lesson.md"
    }
  ]
}
```

### 3. Import into Projects (Web UI)

**Create a new Project:**
1. Log in at **mentible.app** (sxp718@gmail.com)
2. **Projects** → **+ Create new project**
3. Fill in project name, description
4. **Add topics** (manual, or bulk import below)

**Add Topics (Manual):**
1. For each `.md` file:
   - **Project** → **Edit** → **Add topic**
   - Paste markdown content into the topic editor
   - Label: use chapter/section name
   - Save

**Bulk Import (CLI/API, requires backend access):**
- Script location: `scripts/import-studio-books.py` (to be created)
- Usage: `python scripts/import-studio-books.py imports/old_studio_books/ --account sxp718@gmail.com`

### 4. Enable Expert Validation (New in Projects)

Once topics are imported:

1. **Projects** → **Share** → **Invite reviewer**
   - Invite expert reviewers for validation
2. **Reviews** tab shows feedback from reviewers
3. **Approvals** to mark content as validated

## Current Limitations

- ⚠️ No automated migration for old Studio metadata (dates, stats)
- ⚠️ No bulk-import CLI yet (manual web UI only, or custom script needed)
- ⚠️ Old lesson generation context lost (keep source exports as reference)

## Next Steps if Bulk Import Needed

1. **Create import script** (`scripts/import-studio-books.py`):
   - Read manifest.json per project
   - POST to `/api/v1/trust/projects` (create project)
   - POST to `/api/v1/trust/projects/{id}/topics` (add topics)
   - Requires admin/system account or OAuth token

2. **Database direct import** (if API unavailable):
   - Backup prod DB first
   - Upsert into `trust_project`, `trust_topic`, `trust_artifact_version`
   - Run alembic migrations to ensure schema is current

## Support

For questions or if bulk import is needed, contact engineering.

---

**Related docs:**
- ADR-037: Reposition to expert-validation studio
- ADR-009: Books-only, remove Query
- docs/STATUS.md: Current feature matrix
