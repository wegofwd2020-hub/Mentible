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

## Recommended Path: Web UI Manual Import

**For users without server access (e.g., Sridhar):**

### 1. Export Old Studio Books (Web App)

Log in at **mentible.app** as sxp718@gmail.com:
1. **Library** → browse old books
2. For each book:
   - Open it
   - **Menu** → **Export** → **Markdown**
   - Save file locally as `{BookName}.md`

### 2. Import into Projects (Web UI)

1. Log in at **mentible.app** (sxp718@gmail.com)
2. **Projects** → **+ Create new project**
3. Fill in:
   - **Project name** (book title)
   - **Description** (optional)
4. **Add topics** for each exported `.md` file:
   - **Project** → **Edit** → **Add topic**
   - Paste markdown content into the topic editor
   - **Label:** use chapter/section name from the old book
   - **Save**

### 3. Enable Expert Validation (New in Projects)

Once topics are imported:

1. **Projects** → **Share** → **Invite reviewer**
   - Invite expert reviewers for validation
2. **Reviews** tab shows feedback from reviewers
3. **Approvals** to mark content as validated

## Bulk Import (For Operators Only)

**Note:** Bulk import via script requires server access and OAuth token generation. Not available to regular users without server credentials.

If many books need importing and you have server access:
1. Structure books as `imports/old_studio_books/{book_name}/manifest.json + topics/*.md`
2. Generate OAuth token for sxp718@gmail.com on the server
3. Run: `python scripts/import-studio-books.py imports/old_studio_books/ --token <TOKEN>`

Script location: `scripts/import-studio-books.py`

## Current Limitations

- Old Studio metadata (dates, stats) not automatically migrated
- Old lesson generation context lost (keep markdown exports as reference)
- Web UI import is manual but requires no server access

## Support

For questions or if bulk import is needed, contact engineering.

---

**Related docs:**
- ADR-037: Reposition to expert-validation studio
- ADR-009: Books-only, remove Query
- docs/STATUS.md: Current feature matrix
