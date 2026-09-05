# Feature Specification: Transcript Review & Refinement
## Detailed Technical Design for User-Facing Editor

**Document Type**: Feature Specification (Technical Design)  
**Project**: Mentible  
**Feature**: Transcript Review & Refinement Interface  
**Priority**: P0 (Critical Path)  
**Status**: Ready for Engineering  
**Date**: September 2026  

---

## Table of Contents

1. [Overview & Rationale](#overview--rationale)
2. [User Stories](#user-stories)
3. [Functional Requirements](#functional-requirements)
4. [Technical Specifications](#technical-specifications)
5. [UI/UX Design](#uiux-design)
6. [API Specifications](#api-specifications)
7. [Database Schema](#database-schema)
8. [Testing Strategy](#testing-strategy)
9. [Performance & Scalability](#performance--scalability)
10. [Security & Data Privacy](#security--data-privacy)

---

## Overview & Rationale

### Why This Feature Is Essential

**Problem**: Whisper's Tamil transcription accuracy is ~75-80%, meaning 1 in 5 words is likely incorrect. Without a review mechanism, transcriptions are **unusable**.

**Solution**: A review interface that:
- Identifies low-confidence segments (AI-assisted review)
- Allows in-line corrections
- Supports export/import for external editing (user can copy to Google Docs, Word, etc., edit, and paste back)
- Maintains audit trail of all corrections
- Feeds corrections back into model training pipeline

**Expected Impact**:
- Post-correction accuracy: 85-90% (acceptable for published content)
- Time to publishable transcript: 15-20 minutes (vs. 2-3 hours without tool)
- User satisfaction: Enables practical, usable transcription service

---

## User Stories

### User Story 1: Reviewing a Transcription

```
AS A knowledge holder (e.g., Savitri, the Kolam master)
I WANT TO quickly identify and fix errors in my interview transcript
SO THAT my knowledge is accurately captured and ready to publish

ACCEPTANCE CRITERIA:
  ✓ I can see my full interview transcript within 30 seconds of upload completing
  ✓ Words with low AI confidence (< 70%) are visually highlighted in red
  ✓ I can click on any word to edit it inline
  ✓ I can hear the audio segment corresponding to each sentence (audio sync)
  ✓ Changes are saved automatically as drafts
  ✓ I can see how many corrections I've made (e.g., "12 edits")
  ✓ I can mark the transcript as "ready for review" when done
```

### User Story 2: Exporting & Editing Externally

```
AS A knowledge holder or reviewer
I WANT TO copy my transcript and edit it in Google Docs/Word/my preferred tool
SO THAT I can collaborate with others or do a deeper review without being restricted to the platform

ACCEPTANCE CRITERIA:
  ✓ I can click "Copy All to Clipboard" and paste into Google Docs/Word
  ✓ The exported text includes speaker labels and timestamps
  ✓ Formatting is preserved (speaker names, line breaks)
  ✓ I can edit offline in my preferred tool
  ✓ After editing, I can paste the corrected version back into Mentible
```

### User Story 3: Importing Corrected Transcript

```
AS A knowledge holder
I WANT TO paste my corrected transcript back into Mentible
SO THAT all my external edits are incorporated into the published version

ACCEPTANCE CRITERIA:
  ✓ I can click "Paste Corrected Text" and paste from Google Docs/Word
  ✓ The system detects what changed compared to the original
  ✓ Changes are previewed before applying (I can review the diff)
  ✓ I can accept or reject individual changes
  ✓ All corrections are merged into the transcript
  ✓ A new version is created with an audit trail
```

### User Story 4: Viewing Correction History

```
AS A platform admin or reviewer
I WANT TO see who corrected what, when, and why
SO THAT I can quality-assure transcripts and track improvements

ACCEPTANCE CRITERIA:
  ✓ I can see a complete audit trail of all corrections
  ✓ Each correction shows: original text, corrected text, who changed it, when
  ✓ I can revert to a previous version if needed
  ✓ I can download a report of all corrections
  ✓ Corrections are tagged (AI error, user correction, bulk import, etc.)
```

### User Story 5: Low-Confidence Review Workflow

```
AS A reviewer
I WANT TO focus on the parts the AI was unsure about
SO THAT I don't waste time reviewing parts that are clearly correct

ACCEPTANCE CRITERIA:
  ✓ There's a "Jump to Next Low-Confidence Segment" button
  ✓ Low-confidence segments are highlighted in yellow/red
  ✓ I can see the AI confidence score for each segment
  ✓ I can quickly approve or reject AI transcription for each segment
  ✓ I can mark segments as "reviewed" to track progress
  ✓ Progress bar shows "X of Y segments reviewed"
```

---

## Functional Requirements

### F1: Transcript Display & Navigation

**F1.1 Transcript Rendering**
- Display full transcript text with speaker labels
- Format: `[Speaker Name] (Timestamp): [Text segment]`
- Support for multi-speaker interviews (auto-detect speaker changes)
- Speaker names are clickable → jump to all segments from that speaker

**F1.2 Scrolling & Navigation**
- Smooth scroll to segment (from audio player, confidence map, etc.)
- Keyboard navigation: Arrow keys to move between segments
- Search within transcript (Ctrl+F)
- Jump to specific timestamp (input box: `[mm:ss]`)

**F1.3 Segment Grouping**
- Group transcript into sentences/paragraphs (not just words)
- Each segment has:
  - Segment ID
  - Speaker label
  - Start & end timestamp
  - Segment-level confidence score (average of word-level scores)
  - Word count

### F2: Confidence-Based Highlighting

**F2.1 Color Coding System**
```
🟢 Green (90-100%):    High confidence → likely correct
🟡 Yellow (70-89%):    Medium confidence → review recommended
🔴 Red (< 70%):        Low confidence → needs review
⚪ Gray:               User-corrected word
```

**F2.2 Confidence Scoring**
- Word-level confidence: Provided by Whisper model
- Segment-level confidence: Average of word scores in segment
- Overall transcript score: Weighted average (longer segments weighted more)

**F2.3 Confidence Tooltip**
- Hover over a word → tooltip shows confidence score (e.g., "92% confident")
- Tooltip also shows alternative hypotheses (if Whisper provides top-3)
  Example: `AI thought: "கூடம்" (confidence: 65%) | Alternatives: ["கூட", "கூடி"]`

### F3: Inline Editing

**F3.1 Edit Mode**
- Click on any word to enter edit mode for that word
- Or: Double-click to enter edit mode
- Or: Select a range → right-click → "Edit selected text"

**F3.2 Edit UI**
```
Original text: "kolam-ஐ ஆரம்பிக்கும் போது"
                              ↑ [Click word]

Edit dialog:
┌─────────────────────────┐
│ Original: ஆரம்பிக்கும் │
│ Confidence: 73%        │
│                        │
│ Correct to:            │
│ [Text input: ___]      │
│                        │
│ [Cancel] [Save]        │
└─────────────────────────┘

Result: "kolam-ஐ ஆரம்பிக்க போது" (corrected word highlighted in gray)
```

**F3.3 Bulk Edit Mode**
- Select multiple words/lines
- Right-click → "Edit selected text"
- Opens dialog to edit selected region
- Supports adding/removing words

**F3.4 Change Tracking**
- Changed words are highlighted in light gray
- Hover → tooltip shows "Changed: [original] → [corrected] | by [user] | [timestamp]"
- Sidebar shows count of changes (e.g., "12 changes")

### F4: Audio Playback Sync

**F4.1 Audio Player**
- Integrated into the review interface
- Shows current playback position
- Clicking any word → audio plays from that timestamp
- Speaker icon next to word → click to hear just that word/phrase

**F4.2 Waveform Display (Optional, Phase 2)**
- Visual waveform of audio with transcript overlay
- Segments color-coded by confidence
- Click on waveform → jump to that segment

### F5: Export Functionality

**F5.1 Copy to Clipboard**
- Button: [Copy All to Clipboard]
- Copies transcript in clean format with speaker labels and timestamps
- Format:
```
Interview: Kolam Design Masterclass
Duration: 43 min 22 sec
Recorded: 2026-09-04
Quality Score: 73%

---

Speaker A (Savitri, 0:00-0:15):
Kolam-ஐ ஆரம்பிக்கும் போது, நாம் முதலில் [??] நிலத்தை தயாரித்து கொள்ள வேண்டும்.

Speaker B (Student, 0:15-0:22):
அப்ப நிலம் சாஃப்ட் இருக்க வேண்டுமா?

[Original confidence score: 73% | Edited: No]
```

**F5.2 Export Formats**
- TXT (plain text)
- DOCX (Word document)
- SRT (subtitle format with timestamps)
- JSON (structured data with confidence scores)

**F5.3 Download Options**
- [Download as TXT]
- [Download as DOCX]
- [Download as SRT]
- [Download as JSON]

### F6: Import/Merge Functionality

**F6.1 Paste Corrected Transcript**
- Button: [Paste Corrected Text]
- Opens dialog with large text input
- User pastes corrected version from Google Docs/Word/etc.

**F6.2 Diff Detection**
- System compares pasted text with original
- Detects all changes (word-by-word, using edit distance algorithm)
- Generates list of changes with context

**F6.3 Change Preview & Approval**
```
Dialog: "Review Detected Changes"
┌─────────────────────────────────────────┐
│ 23 changes detected. Review below:      │
│                                         │
│ ✓ Change 1: Line 3                     │
│   Original: கூடம் நிலம்               │
│   Corrected: கூட நிலம்               │
│   [Accept] [Reject] [View Context]    │
│                                         │
│ ✓ Change 2: Line 8                     │
│   Original: இல்ல                      │
│   Corrected: இல்லை                    │
│   [Accept] [Reject] [View Context]    │
│                                         │
│ [Select All] [Deselect All]            │
│ [Accept Selected] [Cancel]              │
└─────────────────────────────────────────┘
```

**F6.4 Change Merging**
- User can accept/reject individual changes
- Only accepted changes are applied
- System updates main transcript
- Creates new version in revision history
- Recalculates confidence scores (user corrections marked as 100% confident)

### F7: Version Control & Audit Trail

**F7.1 Version History View**
```
Transcript: "Kolam Design Masterclass"

Revision History:
─────────────────────────────────────────────────────
[1] 2026-09-04 14:30:00  |  AI Generation
    → 1,247 words | Quality: 73%
    
[2] 2026-09-04 14:35:00  |  User Savitri Edit
    → Changed 1 word | Quality: 74%
    → "Change 1 word" [Details]
    
[3] 2026-09-04 14:40:00  |  Bulk Import (Sridhar)
    → Changed 23 words | Quality: 89%
    → "External review by Tamil linguist" [Details]
    
[4] 2026-09-04 15:00:00  |  Published
    → Final Quality: 89%

[Current Version: 3] [Revert to Version 1] [Revert to Version 2]
```

**F7.2 Detailed Change Audit**
- Click [Details] on any revision
- Shows all changes in that revision with context
- User who made the change
- Timestamp
- Notes/reason (if provided)
- Ability to revert just that revision

**F7.3 Revert Functionality**
- Can revert to any previous version
- Creates a new revision (doesn't delete history)
- Example: "Reverted to version 2 (2026-09-04 14:35:00)"

### F8: Quality Scoring & Review Progress

**F8.1 Confidence-Based Quality Score**
```
Initial Score = Average of all word-level confidence scores
                (Whisper output)

Score Updated When:
  - User corrects a word (user correction = 100% confidence)
  - User imports external corrections (imported = 95% confidence)
  - Segment is reviewed but not changed (reviewed = 100% confidence)

Example:
  Original: "The transcript is 73% likely to be correct"
  After 23 corrections: "The transcript is 89% likely to be correct"
```

**F8.2 Review Progress Bar**
```
Segments Reviewed: 12 of 18 (67%)
[████████░░░░░░░░░░░] 67%

Low-Confidence Segments to Review: 8
[████░░░░░░░░░░░░░░] 40%

[Review Next] [Mark All As Reviewed]
```

**F8.3 Review Status Per Segment**
- Segments can have status: `pending`, `in_review`, `reviewed`, `flagged`
- User can manually mark segment as "reviewed" (checkbox next to segment)

---

## Technical Specifications

### T1: Frontend Technology Stack

**Framework**: React 18.x (TypeScript)
**UI Library**: Material-UI v5 or Chakra UI
**State Management**: Redux Toolkit or Zustand
**Editor Library**: Slate.js or ProseMirror (for rich text editing)
**Audio Player**: Wavesurfer.js or native HTML5 audio API
**Diff Library**: diff-match-patch (Google's library)

**Key Dependencies**:
```
react: ^18.2.0
react-dom: ^18.2.0
typescript: ^5.0.0
@mui/material: ^5.14.0
redux-toolkit: ^1.9.0
axios: ^1.6.0
wavesurfer.js: ^6.3.0
diff-match-patch: ^20121119.0.0
react-hotkeys-hook: ^4.4.0
```

### T2: Backend Technology Stack

**Framework**: FastAPI (Python 3.10+)
**Database**: PostgreSQL 15
**Cache**: Redis 7
**Task Queue**: Celery + Redis
**Diffing Algorithm**: difflib (Python stdlib) + custom merge logic

**Key Modules**:
```
api/endpoints/transcripts.py
  - GET /api/transcription/{id} (get full transcript)
  - PATCH /api/transcription/{id}/word (update single word)
  - PUT /api/transcription/{id}/segments (bulk update)
  - POST /api/transcription/{id}/import (import corrected text)

transcription/transcript_diff_merge.py
  - DiffMergeEngine class
  - Methods: detect_changes(), merge_changes(), revert_version()

models/transcript.py
  - Transcript model (SQLAlchemy ORM)
  - TranscriptRevision model
  - TranscriptWord model
```

### T3: API Endpoints

#### GET /api/transcription/{id}
**Purpose**: Retrieve full transcript with metadata
**Response**:
```json
{
  "id": "uuid",
  "job_id": "uuid",
  "title": "Kolam Design Masterclass",
  "duration_seconds": 2602,
  "status": "draft",
  "segments": [
    {
      "id": "seg_001",
      "speaker": "Savitri",
      "start_time": 0,
      "end_time": 15,
      "text": "Kolam-ஐ ஆரம்பிக்கும் போது...",
      "words": [
        {
          "text": "Kolam-ஐ",
          "confidence": 0.95,
          "position": 0,
          "is_corrected": false,
          "corrected_at": null
        },
        {
          "text": "ஆரம்பிக்கும்",
          "confidence": 0.73,
          "position": 1,
          "is_corrected": false,
          "alternatives": ["ஆரம்பிக்க", "ஆரம்பிக்க"]
        }
      ],
      "confidence": 0.84,
      "is_reviewed": false
    }
  ],
  "quality_score": 0.73,
  "created_at": "2026-09-04T14:30:00Z",
  "last_edited_at": "2026-09-04T14:40:00Z",
  "last_edited_by": "user_123"
}
```

#### PATCH /api/transcription/{id}/word
**Purpose**: Update a single word
**Request**:
```json
{
  "word_position": 5,
  "segment_id": "seg_001",
  "original_text": "கூடம்",
  "corrected_text": "கூட",
  "notes": "Wrong suffix"
}
```
**Response**: Updated transcript with new quality score

#### POST /api/transcription/{id}/import
**Purpose**: Import corrected transcript
**Request**:
```json
{
  "corrected_text": "[Full corrected transcript]",
  "source": "google_docs"
}
```
**Response**:
```json
{
  "changes_detected": 23,
  "changes": [
    {
      "type": "word_change",
      "segment_id": "seg_003",
      "position": 12,
      "original": "கூடம்",
      "corrected": "கூட",
      "confidence": 0.65
    }
  ],
  "action_required": "review_changes"
}
```

#### POST /api/transcription/{id}/import/apply
**Purpose**: Apply imported corrections
**Request**:
```json
{
  "apply_changes": [0, 1, 3, 5],  // indices of changes to apply
  "skip_changes": [2, 4]
}
```
**Response**: Updated transcript with merged corrections

#### GET /api/transcription/{id}/audit-trail
**Purpose**: Get audit trail / revision history
**Response**:
```json
{
  "id": "uuid",
  "revisions": [
    {
      "version": 1,
      "type": "ai_generation",
      "timestamp": "2026-09-04T14:30:00Z",
      "changes_count": 0,
      "quality_score": 0.73,
      "user": null
    },
    {
      "version": 2,
      "type": "user_correction",
      "timestamp": "2026-09-04T14:35:00Z",
      "changes_count": 1,
      "quality_score": 0.74,
      "user": "savitri_user_id",
      "details": [{"word_id": 5, "original": "...", "corrected": "..."}]
    }
  ]
}
```

---

## UI/UX Design

### Layout: Three-Panel Design

```
┌─────────────────────────────────────────────────────────────────┐
│                         Header Bar                              │
│  Interview: "Kolam Design Masterclass" | Status: Draft (73%)   │
│  [Audio Player ─────────●──────── 22:15]  Speed: [1.0x]       │
└─────────────────────────────────────────────────────────────────┘

┌──────────────────┬──────────────────────────┬──────────────────┐
│ Left Sidebar     │ Main Editor Panel        │ Right Sidebar    │
│ (Confidence Map) │ (Transcript Text)        │ (Tools & Actions)│
│                  │                          │                  │
│ Segment Quality  │                          │ [Save Draft]     │
│ ████████░ 85%    │ Speaker A (Savitri):     │ [Publish]        │
│ ███████░░ 78%    │ "kolam-ஐ 🟢 ஆரம்பிக்கும் │                 │
│ █████░░░░ 65% ⚠️ │ 🟡 போது, நாம் 🔴 முதலில│ Export:          │
│ ██░░░░░░░ 23% ❌ │ கூட நிலத்தை..."          │ [Copy All]       │
│                  │                          │ [Download DOCX]  │
│ [Jump to Low]    │ Speaker B (Student):    │                  │
│                  │ "அப்ப நிலம் சாஃப்ட      │ Import:          │
│ Review Progress: │ இருக்க வேண்டுமா?"         │ [Paste Text]     │
│ 12 of 18 (67%)   │                          │                  │
│ [████████░░]     │ [Click word to edit]     │ Statistics:      │
│                  │ [Double-click to edit]   │ Words: 1,247     │
│                  │                          │ Edited: 12       │
│                  │                          │ Conf Segments: 8 │
└──────────────────┴──────────────────────────┴──────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ Footer: Version Control                                         │
│ Current Version: 2 | [View History] | [Revert to Version 1]   │
└─────────────────────────────────────────────────────────────────┘
```

### Color Scheme (Confidence Highlighting)

```
Color Palette:
  🟢 High Confidence (90-100%):    #4CAF50 (Green)
  🟡 Medium Confidence (70-89%):   #FFC107 (Amber)
  🔴 Low Confidence (< 70%):       #F44336 (Red)
  ⚪ User-Corrected:               #E0E0E0 (Light Gray) + tooltip
  
Text Selection:
  Highlight color: #FFEB3B (Bright Yellow, 30% opacity)
  Edited word outline: 2px dotted #2196F3
```

### Interaction Patterns

#### Pattern 1: Click to Edit
```
User sees: "kolam-ஐ ஆரம்பிக்கும் போது"
           word #2 has yellow background (medium confidence)

User clicks: "ஆரம்பிக்கும்"

Modal appears:
┌──────────────────────────┐
│ Original: ஆரம்பிக்கும்   │
│ Confidence: 73%          │
│ Alternatives:            │
│  - ஆரம்பிக்க            │
│  - ஆரம்பிக்கி           │
│                          │
│ Correct to: [______]     │
│                          │
│ [Cancel] [Save]          │
└──────────────────────────┘

User types: "ஆரம்பிக்க"
Clicks [Save]

Result: Word updated, marked as gray (user-corrected)
```

#### Pattern 2: Copy & Paste Workflow
```
Step 1: User clicks [Copy All to Clipboard]
        System copies full transcript with formatting

Step 2: User opens Google Docs, pastes content
        Edits freely in Google Docs
        Makes 23 corrections

Step 3: User copies corrected text from Google Docs
        Returns to Mentible

Step 4: User clicks [Paste Corrected Text]
        Pastes into dialog box

Step 5: System detects 23 changes, shows preview
        User reviews, accepts all 23 changes

Step 6: Changes merged, new version created
        Quality score increases from 73% to 89%
        Audit trail shows: "23 corrections imported by Savitri"
```

#### Pattern 3: Low-Confidence Review
```
User clicks [Review Low-Confidence Segments]

UI highlights first low-confidence segment:
  "போது, நாம் 🔴 முதலில் கூட நிலத்தை..."
                ↑ (confidence: 23%)

Below the text:
  "AI thinks: முதலில் (23% confident)"
  "Alternatives: [முதலில் | முதல் | முதலிய]"
  
  [Approve AI] [Correct to: ______] [Skip]

User clicks [Correct to:], types correction
Clicks [Save], moves to next low-confidence segment

Progress: "Segment 2 of 8 reviewed"
[████░░░░] 25%
```

---

## Database Schema

### Tables

#### transcripts
```sql
CREATE TABLE transcripts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID NOT NULL REFERENCES transcription_jobs(id),
    title VARCHAR(255),
    duration_seconds INTEGER,
    
    -- Content (immutable original, mutable current)
    original_text TEXT NOT NULL,          -- AI-generated (never changed)
    current_text TEXT NOT NULL,           -- Latest version
    
    -- Status & Quality
    status VARCHAR(50) DEFAULT 'draft',   -- draft, review, published
    quality_score FLOAT DEFAULT 0.0,      -- 0.0-1.0 (updated as corrections made)
    
    -- Versioning
    version INTEGER DEFAULT 1,
    latest_revision_id UUID,
    
    -- Metadata
    created_at TIMESTAMP DEFAULT NOW(),
    last_edited_at TIMESTAMP,
    last_edited_by UUID,
    published_at TIMESTAMP,
    
    CONSTRAINT valid_status CHECK (status IN ('draft', 'review', 'published')),
    CONSTRAINT valid_quality CHECK (quality_score >= 0 AND quality_score <= 1),
    INDEX idx_job_id (job_id),
    INDEX idx_status (status)
);
```

#### transcript_segments
```sql
CREATE TABLE transcript_segments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transcript_id UUID NOT NULL REFERENCES transcripts(id),
    
    speaker_name VARCHAR(255) NOT NULL,
    start_time_seconds FLOAT,
    end_time_seconds FLOAT,
    
    original_text TEXT NOT NULL,
    current_text TEXT NOT NULL,
    
    segment_confidence FLOAT,   -- avg of word-level confidence
    is_reviewed BOOLEAN DEFAULT FALSE,
    
    word_count INTEGER,
    created_at TIMESTAMP DEFAULT NOW(),
    
    INDEX idx_transcript_id (transcript_id),
    INDEX idx_speaker (speaker_name),
    INDEX idx_confidence (segment_confidence)
);
```

#### transcript_words
```sql
CREATE TABLE transcript_words (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    segment_id UUID NOT NULL REFERENCES transcript_segments(id),
    transcript_id UUID NOT NULL REFERENCES transcripts(id),
    
    word_text VARCHAR(255) NOT NULL,
    position_in_segment INTEGER,          -- Word order in segment
    position_in_transcript INTEGER,       -- Word order overall
    
    -- Confidence (from AI)
    ai_confidence FLOAT,                  -- 0.0-1.0 (Whisper score)
    ai_alternatives VARCHAR(255),         -- "word1|word2|word3"
    
    -- Corrections
    is_corrected BOOLEAN DEFAULT FALSE,
    original_text VARCHAR(255),
    corrected_text VARCHAR(255),
    corrected_by UUID,
    corrected_at TIMESTAMP,
    
    created_at TIMESTAMP DEFAULT NOW(),
    
    INDEX idx_segment_id (segment_id),
    INDEX idx_transcript_id (transcript_id),
    INDEX idx_is_corrected (is_corrected),
    INDEX idx_position (position_in_transcript)
);
```

#### transcript_revisions
```sql
CREATE TABLE transcript_revisions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transcript_id UUID NOT NULL REFERENCES transcripts(id),
    
    version INTEGER NOT NULL,             -- 1, 2, 3, ...
    change_type VARCHAR(50),              -- ai_generation, user_correction, bulk_import, revert
    
    change_summary TEXT,                  -- "Updated 1 word", "Imported 23 changes"
    changes_count INTEGER DEFAULT 0,
    
    quality_score_before FLOAT,
    quality_score_after FLOAT,
    
    user_id UUID,                         -- NULL if AI-generated
    user_notes TEXT,
    
    created_at TIMESTAMP DEFAULT NOW(),
    
    CONSTRAINT valid_change_type CHECK (
        change_type IN ('ai_generation', 'user_correction', 'bulk_import', 'revert')
    ),
    
    INDEX idx_transcript_version (transcript_id, version),
    INDEX idx_user (user_id),
    INDEX idx_created_at (created_at)
);
```

#### transcript_revision_changes
```sql
CREATE TABLE transcript_revision_changes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    revision_id UUID NOT NULL REFERENCES transcript_revisions(id),
    
    word_id UUID NOT NULL REFERENCES transcript_words(id),
    segment_id UUID NOT NULL REFERENCES transcript_segments(id),
    
    original_text VARCHAR(255),
    corrected_text VARCHAR(255),
    
    position_in_transcript INTEGER,
    
    created_at TIMESTAMP DEFAULT NOW(),
    
    INDEX idx_revision_id (revision_id),
    INDEX idx_word_id (word_id)
);
```

---

## Testing Strategy

### Unit Tests

#### Test: Confidence Highlighting
```python
def test_confidence_highlighting():
    """Test that words are colored correctly based on confidence"""
    words = [
        {"text": "word1", "confidence": 0.95},  # High
        {"text": "word2", "confidence": 0.75},  # Medium
        {"text": "word3", "confidence": 0.65},  # Low
    ]
    
    result = apply_confidence_highlighting(words)
    
    assert result[0]["color"] == "#4CAF50"  # Green
    assert result[1]["color"] == "#FFC107"  # Amber
    assert result[2]["color"] == "#F44336"  # Red
```

#### Test: Diff Detection
```python
def test_diff_detection():
    """Test that system detects all changes when importing corrected text"""
    original = "kolam-ஐ ஆரம்பிக்கும் போது"
    corrected = "kolam-ஐ ஆரம்பிக்க போது"  # Changed one word
    
    changes = detect_changes(original, corrected)
    
    assert len(changes) == 1
    assert changes[0]["original"] == "ஆரம்பிக்கும்"
    assert changes[0]["corrected"] == "ஆரம்பிக்க"
    assert changes[0]["position"] == 2
```

#### Test: Merge Logic
```python
def test_merge_corrections():
    """Test that corrections are properly merged into transcript"""
    original_transcript = [...segments...]
    corrections = [{"position": 5, "original": "word1", "corrected": "word2"}]
    
    merged = merge_corrections(original_transcript, corrections)
    
    assert merged[5]["text"] == "word2"
    assert merged[5]["is_corrected"] == True
    assert merged[5]["corrected_by"] == user_id
```

### Integration Tests

#### Test: Full Review Workflow
```python
def test_full_review_workflow():
    """Test complete user flow: upload → review → correct → export"""
    
    # 1. Upload interview
    transcription = create_transcription(interview_mp3)
    assert transcription.status == "draft"
    
    # 2. Get transcript
    transcript = get_transcript(transcription.id)
    assert len(transcript.segments) > 0
    
    # 3. Make inline corrections
    update_word(transcript.id, word_id=1, corrected_text="새로운 단어")
    
    # 4. Export
    exported = export_to_text(transcript.id)
    assert "새로운 단어" in exported
    
    # 5. Verify quality score increased
    updated = get_transcript(transcription.id)
    assert updated.quality_score > transcript.quality_score
```

#### Test: Import/Merge Workflow
```python
def test_import_merge_workflow():
    """Test importing corrected transcript and merging changes"""
    
    # Original transcript
    original = get_transcript(transcript_id)
    original_score = original.quality_score
    
    # User edits externally, imports corrected version
    corrected_text = "[Corrected full transcript]"
    
    # Detect changes
    changes = preview_import(transcript_id, corrected_text)
    assert len(changes) > 0
    
    # Apply changes
    apply_import(transcript_id, changes)
    
    # Verify
    updated = get_transcript(transcript_id)
    assert updated.quality_score > original_score
    assert updated.version > original.version
```

### UI Tests (Frontend)

#### Test: Edit Modal Opens
```javascript
test('clicking a word opens edit modal', async () => {
  const { getByText, getByRole } = render(<TranscriptEditor />);
  
  const word = getByText('ஆரம்பிக்கும்');
  fireEvent.click(word);
  
  const modal = getByRole('dialog');
  expect(modal).toBeInTheDocument();
  expect(getByText(/Original:/)).toBeInTheDocument();
});
```

#### Test: Copy to Clipboard
```javascript
test('copy button copies transcript to clipboard', async () => {
  const { getByText } = render(<TranscriptEditor />);
  
  const copyButton = getByText('Copy All to Clipboard');
  fireEvent.click(copyButton);
  
  const clipboard = await navigator.clipboard.readText();
  expect(clipboard).toContain('Speaker A');
  expect(clipboard).toContain('kolam-ஐ');
});
```

---

## Performance & Scalability

### Performance Targets

| Metric | Target | Notes |
|--------|--------|-------|
| Load transcript | < 2 seconds | 1,500 word interview |
| Inline edit save | < 500ms | Single word change |
| Bulk import/merge | < 5 seconds | 50 word changes |
| Export to clipboard | < 1 second | Copy 1,500 word transcript |
| Confidence highlighting | < 500ms | Re-render with colors |

### Optimization Strategies

1. **Lazy Loading**
   - Load transcript in chunks (first 100 words immediately)
   - Load remaining segments on scroll

2. **Caching**
   - Cache transcript in Redis after first load
   - Cache confidence scores
   - Invalidate cache on edit

3. **Debouncing**
   - Debounce save on text input (500ms)
   - Batch multiple small edits into single DB write

4. **Indexing**
   - Index transcript_words by position
   - Index transcript_segments by transcript_id
   - Index revisions by transcript_id, version

---

## Security & Data Privacy

### Access Control

```
Permissions:
  Owner (knowledge holder):
    - View own transcripts
    - Edit own transcripts
    - Publish own transcripts
    - Download own transcripts
    - Delete own transcripts
    
  Collaborator (invited reviewer):
    - View shared transcripts
    - Make corrections (with audit trail)
    - Cannot delete
    
  Admin:
    - View all transcripts
    - Audit access for quality assurance
    - Revert problematic changes
```

### Data Encryption

- At rest: PostgreSQL encryption (pg_crypt)
- In transit: HTTPS/TLS 1.3
- Uploaded files: S3 server-side encryption

### Audit Logging

- All changes logged with:
  - User ID
  - Timestamp
  - Original & corrected text
  - IP address
  - User agent
- Immutable audit trail (cannot be deleted)

### Data Retention

- Audio files: Delete after 90 days (or user request)
- Transcripts: Retain indefinitely (user owned)
- Audit logs: Retain for 1 year (compliance)
- Deleted transcripts: Soft delete (recover within 30 days)

---

## Implementation Checklist

### Backend (Phase 2, Week 4)
- [ ] Database schema created & migrated
- [ ] API endpoints implemented
- [ ] Diff/merge algorithm working
- [ ] Audit trail logging
- [ ] Version control system
- [ ] API tests passing (>90% coverage)

### Frontend (Phase 2, Week 4)
- [ ] Transcript editor component built
- [ ] Confidence highlighting working
- [ ] Inline edit modal
- [ ] Copy/paste functionality
- [ ] Export options (TXT, DOCX, SRT)
- [ ] Import/paste dialog
- [ ] UI tests passing

### Integration
- [ ] Frontend ↔ Backend API working
- [ ] End-to-end workflow tested
- [ ] Performance benchmarks met
- [ ] Security review completed
- [ ] User documentation written

---

## Future Enhancements (Phase 3+)

- [ ] Waveform visualization with transcript overlay
- [ ] Collaborative editing (real-time sync, multiple users)
- [ ] AI suggestions for low-confidence words
- [ ] Speaker identification assistance (auto-suggest speaker names)
- [ ] Integration with external services (Google Docs, Overleaf)
- [ ] Mobile app support for on-the-go editing
- [ ] Feedback loop for model retraining

---

**Document Version**: 1.0  
**Status**: Ready for Engineering  
**Next Step**: Start Phase 2, Week 4 development

