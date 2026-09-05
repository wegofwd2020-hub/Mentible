# Integration Design: MP3 Upload in Projects/Input
## Embedding Tamil Speech-to-Text into Mentible Workflow

**Document Type**: Integration Design & UX Flow  
**Project**: Mentible  
**Feature**: MP3 Upload Button in Projects/Input Section  
**Priority**: P0 (Critical Path)  
**Status**: Ready for Implementation  
**Date**: September 2026  

---

## Table of Contents

1. [Overview](#overview)
2. [Existing Mentible Context](#existing-mentible-context)
3. [New Upload Button UI](#new-upload-button-ui)
4. [User Journey](#user-journey)
5. [Backend Integration](#backend-integration)
6. [State Management](#state-management)
7. [Error Handling](#error-handling)
8. [Implementation Checklist](#implementation-checklist)

---

## Overview

### What We're Adding

A new button in the existing **Projects/Input → Transcripts** section that allows users to:
- Upload MP3 interview files
- Automatically trigger transcription
- Route results into the transcript review interface
- Seamlessly integrate with existing Mentible learning content workflow

### Why This Matters

**Current State** (Without MP3 Upload):
- Users must record/find MP3 files outside Mentible
- No clear path to convert audio → transcripts → learning content
- Friction point for knowledge holders

**New State** (With MP3 Upload):
- "I have an interview MP3" → Click button → Upload → Transcription starts
- Seamless workflow from audio → editable transcript → published course
- Knowledge holders stay within Mentible ecosystem

---

## Existing Mentible Context

### Current Projects/Input Interface

```
Mentible Platform (Navigation)
├── Projects
│   ├── [My Projects] ────────────── New Button ──────────────────┐
│   │   ├── Project: "Kolam Design Course"                        │
│   │   ├── Project: "Tamil Recipes"                              │
│   │   └── [+ New Project]                                       │
│   │                                                              │
│   └── Input                                                      │
│       ├── [📄 Documents]  [📸 Images]  [📹 Videos]  [🎵 Audio] │
│       │                                                          │
│       ├── Transcripts ◄─────────────────────────────────────────┤
│       │   Current options:                                      │
│       │   - Import text transcript                              │
│       │   - Copy/paste transcript                               │
│       │   - Upload transcript file (TXT/DOCX)                   │
│       │                                                          │
│       │   ✨ NEW: [🎙️ Upload MP3 Interview]                    │
│       │                                                          │
│       └── [Manage] [Settings]                                   │
│                                                                 │
└── (Learning Content, Settings, etc.)                            │
                                                                  │
                                     [MP3 Upload Button Here] ────┘
```

### Existing Transcript Import Options

Current Transcripts section supports:
1. **Manual text input**: Copy/paste transcript text
2. **File upload**: Upload TXT, DOCX, PDF transcript
3. **URL import**: (If connected to Google Docs, etc.)

### New Option We're Adding

4. **MP3 Audio upload**: Record interview → Upload MP3 → Auto-transcribe → Review → Publish

---

## New Upload Button UI

### Button Location & Design

**Location**: Mentible UI - Projects → Input → Transcripts section

**Current UI** (Before):
```
┌──────────────────────────────────────────────────────┐
│ 📄 Transcripts                                       │
│                                                      │
│ Ways to add a transcript:                           │
│                                                      │
│ ┌─────────────────────────────────────────┐         │
│ │ ✏️  Paste Text                          │         │
│ │ Add transcript by copying & pasting     │         │
│ └─────────────────────────────────────────┘         │
│                                                      │
│ ┌─────────────────────────────────────────┐         │
│ │ 📤 Upload File                          │         │
│ │ Import transcript (.txt, .docx)         │         │
│ └─────────────────────────────────────────┘         │
│                                                      │
└──────────────────────────────────────────────────────┘
```

**New UI** (After - Add this option):
```
┌──────────────────────────────────────────────────────┐
│ 📄 Transcripts                                       │
│                                                      │
│ Ways to add a transcript:                           │
│                                                      │
│ ┌─────────────────────────────────────────┐         │
│ │ 🎙️  Upload Interview MP3                │         │
│ │ Record interview → Auto-transcribe      │ ← NEW   │
│ └─────────────────────────────────────────┘         │
│                                                      │
│ ┌─────────────────────────────────────────┐         │
│ │ ✏️  Paste Text                          │         │
│ │ Add transcript by copying & pasting     │         │
│ └─────────────────────────────────────────┘         │
│                                                      │
│ ┌─────────────────────────────────────────┐         │
│ │ 📤 Upload File                          │         │
│ │ Import transcript (.txt, .docx)         │         │
│ └─────────────────────────────────────────┘         │
│                                                      │
└──────────────────────────────────────────────────────┘
```

### Button Component Details

**Button Properties**:
```
Label:        "🎙️ Upload Interview MP3"
Subtitle:     "Record interview → Auto-transcribe (Tamil)"
Icon:         🎙️ (microphone)
Color:        Primary accent color (blue/purple)
Action:       Opens file picker (accept: .mp3, .wav, .m4a)
Size:         Full width (matches other transcript options)
Disabled:     If project not selected, show tooltip "Select a project first"
```

**Button Styling** (React/Material-UI example):
```jsx
<Card
  onClick={handleOpenMp3Uploader}
  sx={{
    padding: '24px',
    cursor: 'pointer',
    transition: 'all 0.2s',
    border: '2px solid transparent',
    '&:hover': {
      border: '2px solid primary.main',
      backgroundColor: 'action.hover',
      transform: 'translateY(-2px)',
    },
    '&:active': {
      transform: 'translateY(0)',
    }
  }}
>
  <Box display="flex" alignItems="center" gap={2}>
    <MicIcon sx={{ fontSize: 32, color: 'primary.main' }} />
    <Box>
      <Typography variant="h6">Upload Interview MP3</Typography>
      <Typography variant="body2" color="textSecondary">
        Record interview → Auto-transcribe (Tamil)
      </Typography>
    </Box>
  </Box>
</Card>
```

### File Upload Dialog

When user clicks button:

```
┌──────────────────────────────────────────────────┐
│ Upload Interview Recording                   [×] │
├──────────────────────────────────────────────────┤
│                                                  │
│  Select an MP3 or WAV file from your computer   │
│                                                  │
│  Supported formats: .mp3, .wav, .m4a             │
│  Max file size: 500 MB                           │
│  Max duration: 4 hours                           │
│                                                  │
│  📂 [Choose File] or Drag & Drop Here            │
│     (Click or drag file to upload)              │
│                                                  │
│  ┌──────────────────────────────────────────┐   │
│  │ Selected file: kolam_interview.mp3        │   │
│  │ Size: 87 MB | Duration: 43 min 22 sec    │   │
│  └──────────────────────────────────────────┘   │
│                                                  │
│  Interview Details (Optional):                   │
│  Title: [Kolam Design Masterclass______]         │
│  Description: [________________________]         │
│  Speaker Name: [Savitri_______________]         │
│  Language: [Tamil ▼]                            │
│                                                  │
│                        [Cancel]  [Upload]       │
└──────────────────────────────────────────────────┘
```

### Validation

**File Validation Rules**:
```
✓ File type: Only .mp3, .wav, .m4a accepted
✓ File size: Max 500 MB
✓ Duration: Max 4 hours (240 minutes)
✓ Audio quality: Must be playable MP3/WAV

Error Messages:
❌ "File too large (650 MB). Max 500 MB allowed."
❌ "Invalid file format. Please upload .mp3 or .wav"
❌ "Audio file appears corrupted or invalid format"
❌ "Please select a file before uploading"
```

---

## User Journey

### End-to-End Flow: "I Have an Interview MP3"

```
Step 1: Knowledge Holder Prepares
─────────────────────────────────────────────────
User: "I recorded a 45-minute interview about Kolam design"
      "I want to share this as a Mentible course"

Action:
  - Opens Mentible app
  - Goes to Projects → Input → Transcripts
  - Sees "🎙️ Upload Interview MP3" button
  
         ┌─────────────────────────────┐
         │ 🎙️ Upload Interview MP3     │
         │ Record interview → Trans...  │
         └─────────────────────────────┘
         
  - Clicks button

Step 2: Upload Interview
─────────────────────────────────────────────────
System:
  - Opens file dialog
  - User selects: kolam_interview.mp3 (87 MB, 43 min)
  - Optional: Fills in title, description, speaker name
  
  Title: "Kolam Design Masterclass"
  Speaker: "Savitri"
  Description: "Learn traditional Kolam patterns"

  - Clicks [Upload]

Step 3: Transcription Processing
─────────────────────────────────────────────────
System:
  - Receives MP3 file
  - Stores in S3 / local storage
  - Creates transcription job
  - Shows progress UI
  
         Upload Progress:
         [████████████░░░░░░░░] 75% (65 MB uploaded)
         
  - MP3 processing starts
         
         Transcribing...
         [████░░░░░░░░░░░░░░░░] 20% (8 min 42 sec processed)
         (Estimated time: 8 minutes)
         
  - Whisper model transcribes audio (Tamil)
  - Quality score calculated (73%)
  - Creates confidence-scored segments

Step 4: Transcription Complete
─────────────────────────────────────────────────
System: 
  - Transcription done
  - Routes user to Transcript Review Interface
  
  ┌────────────────────────────────────────┐
  │ Transcription Complete ✓               │
  │                                        │
  │ Title: Kolam Design Masterclass        │
  │ Duration: 43 min 22 sec                │
  │ Words transcribed: 1,247               │
  │ Quality Score: 73%                     │
  │                                        │
  │ [View & Edit Transcript] ← CLICK HERE  │
  │ [Publish as Draft] [Discard]           │
  └────────────────────────────────────────┘

Step 5: User Reviews Transcript
─────────────────────────────────────────────────
User:
  - Clicks "View & Edit Transcript"
  - Enters Transcript Review Interface
  
  (See: transcript_review_feature_spec.md)
  
  UI shows:
  - Transcript text with confidence highlighting
  - 🔴 Red words (low confidence) need review
  - Audio playback synced to text
  
  User:
  - Reviews low-confidence words
  - Clicks on red words to correct
  - Or: Exports to Google Docs for external review
  - Makes ~23 corrections
  
  Quality Score: 73% → 89% (after corrections)

Step 6: Publish
─────────────────────────────────────────────────
User:
  - Reviews final transcript
  - Clicks [Publish]
  - Transcript stored in project
  - Ready to build learning content (Q&A, summaries, etc.)
  
  Status: "Published" ✓
  
  ┌────────────────────────────────────────┐
  │ Kolam Design Masterclass               │
  │ Interview transcription (43 min)       │
  │ Quality: 89% (Reviewed)                │
  │ Words: 1,247                           │
  │                                        │
  │ [Edit] [Download] [Use in Course]      │
  └────────────────────────────────────────┘
```

### Alternative: "I Want to Use External Tools"

```
Step 1: Upload MP3 (same as above)
↓
Step 2: System Transcribes & Routes to Review
↓
Step 3: User Chooses "Export for External Review"
        ┌────────────────────────────────┐
        │ Export Transcript               │
        │                                │
        │ [Copy to Clipboard]            │
        │ [Download as DOCX]             │
        │ [Download as TXT]              │
        └────────────────────────────────┘
        
        Clicks [Download as DOCX]
        
Step 4: Opens in Google Docs / Word
        - Shares with Tamil linguistics expert
        - Expert makes 45 corrections
        - Adds notes and explanations

Step 5: User Copies Corrected Text
        - Copies from Google Docs
        - Returns to Mentible
        - Clicks "Paste Corrected Text"
        - System merges 45 changes
        - Quality score: 73% → 94%

Step 6: Publish
        - Final transcript with expert review
        - Published to course
```

---

## Backend Integration

### Service Architecture

```
Mentible Frontend (Projects/Input)
            │
            ▼ User uploads MP3
    ┌──────────────────────────────┐
    │ Transcript Upload Handler    │
    │ (REST API: POST /api/        │
    │  transcription/upload)       │
    └──────────┬───────────────────┘
               │
               ▼
    ┌──────────────────────────────┐
    │ File Validation & Storage    │
    │ - Check format (.mp3, .wav)  │
    │ - Check size (< 500 MB)      │
    │ - Store in S3/filesystem     │
    │ - Create job record          │
    └──────────┬───────────────────┘
               │
               ▼
    ┌──────────────────────────────┐
    │ Queue Transcription Job      │
    │ (Celery + Redis)             │
    │ - Add to job queue           │
    │ - Return job_id to frontend  │
    └──────────┬───────────────────┘
               │
               ▼
    ┌──────────────────────────────┐
    │ Audio Preprocessing          │
    │ - Convert MP3 to WAV         │
    │ - Normalize levels           │
    │ - Chunk into segments        │
    └──────────┬───────────────────┘
               │
               ▼
    ┌──────────────────────────────┐
    │ Whisper Transcription        │
    │ (Local or Cloud Fallback)    │
    │ - Generate Tamil transcript  │
    │ - Calculate confidence       │
    │ - Generate diarization       │
    └──────────┬───────────────────┘
               │
               ▼
    ┌──────────────────────────────┐
    │ Post-Processing              │
    │ - Format transcript          │
    │ - Add speaker labels         │
    │ - Add timestamps             │
    │ - Store in database          │
    └──────────┬───────────────────┘
               │
               ▼
    ┌──────────────────────────────┐
    │ Route to Review Interface    │
    │ - Redirect user to editor    │
    │ - Show transcript with UI    │
    │ - Ready for corrections      │
    └──────────────────────────────┘
```

### API Endpoint

**POST /api/transcription/upload**

**Request**:
```
Content-Type: multipart/form-data

{
  "file": <MP3 file binary>,
  "project_id": "uuid",
  "title": "Kolam Design Masterclass",
  "description": "Interview about traditional Kolam patterns",
  "speaker_name": "Savitri",
  "language": "ta"  (Tamil)
}
```

**Response** (Immediate):
```json
{
  "job_id": "transcription_job_123",
  "status": "queued",
  "message": "Transcription queued. Processing started.",
  "review_url": "/projects/{project_id}/transcripts/{job_id}/review",
  "polling_endpoint": "/api/transcription/{job_id}/status"
}
```

### Polling for Status

**GET /api/transcription/{job_id}/status**

**Response** (Initial):
```json
{
  "job_id": "transcription_job_123",
  "status": "processing",
  "progress": 0.15,  // 15%
  "message": "Converting audio format... (1 min 42 sec of 43 min 22 sec processed)",
  "estimated_time_remaining": 480  // seconds
}
```

**Response** (Complete):
```json
{
  "job_id": "transcription_job_123",
  "status": "completed",
  "progress": 1.0,
  "transcript_id": "transcript_456",
  "message": "Transcription complete",
  "transcript_preview": {
    "title": "Kolam Design Masterclass",
    "duration": 2602,
    "word_count": 1247,
    "quality_score": 0.73,
    "segments_count": 18
  },
  "review_url": "/projects/{project_id}/transcripts/transcript_456/review"
}
```

---

## State Management

### Frontend State (React)

```javascript
// Transcript Upload State
{
  // Upload dialog state
  uploadDialog: {
    open: boolean,
    selectedFile: File | null,
    title: string,
    description: string,
    speakerName: string,
    language: 'ta' | 'en' | etc,
  },
  
  // Upload progress state
  uploadProgress: {
    isUploading: boolean,
    uploadedBytes: number,
    totalBytes: number,
    percentComplete: number,  // 0-100
  },
  
  // Transcription processing state
  transcriptionStatus: {
    jobId: string | null,
    status: 'queued' | 'processing' | 'completed' | 'failed',
    progress: number,  // 0.0-1.0
    message: string,
    estimatedTimeRemaining: number,  // seconds
  },
  
  // Error state
  error: {
    hasError: boolean,
    errorMessage: string,
    errorCode: string,
  },
  
  // Completion state
  completion: {
    transcriptId: string | null,
    reviewUrl: string | null,
    autoNavigateToReview: boolean,
  }
}
```

### Polling Mechanism

```javascript
// Start polling when transcription job begins
useEffect(() => {
  if (transcriptionStatus.jobId && transcriptionStatus.status === 'processing') {
    const interval = setInterval(() => {
      fetchTranscriptionStatus(transcriptionStatus.jobId)
        .then(response => {
          setTranscriptionStatus(response);
          
          // If complete, navigate to review interface
          if (response.status === 'completed') {
            clearInterval(interval);
            navigateTo(response.review_url);
          }
        })
        .catch(err => {
          setError({
            hasError: true,
            errorMessage: err.message,
            errorCode: err.code
          });
          clearInterval(interval);
        });
    }, 2000);  // Poll every 2 seconds
    
    return () => clearInterval(interval);
  }
}, [transcriptionStatus.jobId, transcriptionStatus.status]);
```

---

## Error Handling

### Upload Errors

**File Validation Errors**:
```
Error: INVALID_FILE_TYPE
Message: "Invalid file format. Please upload .mp3 or .wav file"
Solution: User selects different file

Error: FILE_TOO_LARGE
Message: "File too large (650 MB). Max 500 MB allowed."
Solution: User compresses audio or splits interview

Error: AUDIO_CORRUPTED
Message: "Audio file appears corrupted or unplayable"
Solution: User re-exports audio from recording app

Error: DURATION_TOO_LONG
Message: "Audio duration too long (5 hours). Max 4 hours."
Solution: User splits interview into multiple parts
```

**UI Error Display**:
```
┌──────────────────────────────────────────┐
│ ❌ Upload Failed                         │
├──────────────────────────────────────────┤
│                                          │
│ File too large (650 MB)                  │
│ Maximum allowed size: 500 MB             │
│                                          │
│ Try compressing your audio file or      │
│ splitting the interview into parts.      │
│                                          │
│ [← Back]  [Choose Different File]       │
└──────────────────────────────────────────┘
```

### Processing Errors

**Transcription Errors**:
```
Error: TRANSCRIPTION_FAILED
Message: "Failed to transcribe audio (GPU out of memory)"
Solution: Retry (system will queue for next available slot)

Error: LANGUAGE_NOT_SUPPORTED
Message: "Detected language: Kannada. Only Tamil supported."
Solution: User re-records interview in Tamil

Error: AUDIO_QUALITY_POOR
Message: "Audio quality too poor for transcription (excessive noise)"
Solution: User re-records in quieter environment
```

**Retry Logic**:
```javascript
// Exponential backoff retry
async function retryTranscriptionWithBackoff(jobId, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await transcribeAudio(jobId);
    } catch (error) {
      if (attempt === maxRetries) throw error;
      
      const delayMs = Math.pow(2, attempt) * 1000;  // 2s, 4s, 8s
      await sleep(delayMs);
    }
  }
}
```

### User Feedback

```
Success State:
┌──────────────────────────────────────────┐
│ ✓ Transcription Complete!                │
│                                          │
│ Your interview has been transcribed      │
│ Review & edit the transcript below       │
│                                          │
│ Quality Score: 89%                       │
│ Words: 1,247                             │
│                                          │
│ [View & Edit] [Publish as Draft]         │
└──────────────────────────────────────────┘

Error State:
┌──────────────────────────────────────────┐
│ ❌ Transcription Failed                  │
│                                          │
│ Error: GPU unavailable                   │
│ Please try again in a few moments        │
│                                          │
│ [Retry] [Cancel Upload]                  │
└──────────────────────────────────────────┘
```

---

## Implementation Checklist

### Phase 1: UI Component (Week 4, Days 1-2)

**Frontend Implementation**:
- [ ] Create `Mp3UploaderDialog.tsx` component
- [ ] Add file input with drag-and-drop support
- [ ] Implement file validation (type, size, duration)
- [ ] Add upload progress bar
- [ ] Display error messages on validation failure
- [ ] Add optional metadata fields (title, description, speaker)
- [ ] Style to match existing Mentible UI
- [ ] Add to `Projects/Input/Transcripts` section
- [ ] Test on desktop and mobile
- [ ] Accessibility: ARIA labels, keyboard navigation

**Styling**:
```css
/* Upload button in Transcripts section */
.transcript-option {
  padding: 24px;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
  border: 2px solid transparent;
  
  &:hover {
    border-color: primary.main;
    background-color: action.hover;
    transform: translateY(-2px);
  }
}

/* File input styling */
.file-input-area {
  border: 2px dashed primary.main;
  border-radius: 8px;
  padding: 32px;
  text-align: center;
  cursor: pointer;
  
  &:hover {
    background-color: action.hover;
  }
  
  &.drag-over {
    background-color: primary.light;
    border-color: primary.dark;
  }
}

/* Progress bar */
.upload-progress {
  height: 4px;
  border-radius: 2px;
  background-color: action.disabled;
  overflow: hidden;
  
  & .progress-fill {
    height: 100%;
    background: linear-gradient(90deg, primary.main, primary.light);
    transition: width 0.3s ease;
  }
}
```

### Phase 2: Backend Integration (Week 4, Days 3-4)

**Backend Implementation**:
- [ ] Create `/api/transcription/upload` POST endpoint
- [ ] Implement file validation logic
- [ ] Add S3/local storage file handling
- [ ] Create transcription job record in DB
- [ ] Queue job in Celery/Redis
- [ ] Return job_id to frontend
- [ ] Implement `/api/transcription/{job_id}/status` polling endpoint
- [ ] Add error handling and logging
- [ ] Test with sample MP3 files
- [ ] Load test: concurrent uploads

**Database Updates**:
```sql
-- Add fields to transcription_jobs table (if needed)
ALTER TABLE transcription_jobs ADD COLUMN IF NOT EXISTS (
  uploaded_filename VARCHAR(255),
  uploaded_at TIMESTAMP,
  speaker_name VARCHAR(255),
  duration_seconds INTEGER,
  audio_quality_score FLOAT  -- 0.0-1.0
);
```

### Phase 3: Integration & Testing (Week 4, Day 5)

**Integration Testing**:
- [ ] Test full flow: Upload MP3 → Queue → Transcribe → Review
- [ ] Test file type validation
- [ ] Test file size limits
- [ ] Test concurrent uploads
- [ ] Test progress UI updates
- [ ] Test completion redirect to review interface
- [ ] Test error handling and retry logic
- [ ] Test on different browsers (Chrome, Firefox, Safari)
- [ ] Test on mobile (iOS, Android)
- [ ] Performance: < 2s from upload to queue confirmation

**User Testing**:
- [ ] Recruit 3-5 beta testers (knowledge holders)
- [ ] Have them upload real interviews
- [ ] Collect feedback on UX
- [ ] Measure time-to-transcription
- [ ] Measure accuracy of transcriptions
- [ ] Iterate based on feedback

### Phase 4: Documentation & Launch (Week 4, Day 5+)

**Documentation**:
- [ ] Write user guide for MP3 upload feature
- [ ] Create tutorial video (3-5 min)
- [ ] Document supported file formats & limits
- [ ] Document troubleshooting guide
- [ ] Create API documentation for developers

**Launch**:
- [ ] Deploy to staging environment
- [ ] Smoke test full workflow
- [ ] Deploy to production
- [ ] Monitor error rates and performance
- [ ] Alert team on Slack when complete
- [ ] Send announcement to users

---

## Component Integration Points

### Mentible Component Hierarchy

```
Projects
  ├── ProjectList.tsx
  ├── ProjectDetail.tsx
  └── Input
      ├── InputTabs.tsx
      │   ├── [Documents]
      │   ├── [Images]
      │   ├── [Videos]
      │   ├── [Audio]
      │   └── [Transcripts] ← We're here
      │       ├── TranscriptOptions.tsx
      │       │   ├── PasteTextOption.tsx
      │       │   ├── UploadFileOption.tsx (existing)
      │       │   └── UploadMp3Option.tsx ← NEW COMPONENT
      │       │       ├── Mp3UploaderDialog.tsx
      │       │       ├── UploadProgress.tsx
      │       │       └── TranscriptionStatus.tsx
      │       │
      │       └── TranscriptList.tsx
      │
      └── Hooks
          ├── useMp3Upload.ts ← NEW HOOK
          ├── useTranscriptionStatus.ts ← NEW HOOK
          └── useTranscriptReview.ts (existing)
```

### Data Flow Diagram

```
User Interaction
        │
        ▼
┌─────────────────────────────────┐
│ UploadMp3Option Component       │
│ - Shows upload button           │
│ - Opens file dialog             │
│ - Triggers upload               │
└────────────┬────────────────────┘
             │
             ▼
┌─────────────────────────────────┐
│ MP3 File Selected               │
│ - Validate file                 │
│ - Show preview                  │
│ - Collect metadata              │
└────────────┬────────────────────┘
             │
             ▼
┌─────────────────────────────────┐
│ useMp3Upload Hook               │
│ - POST /api/transcription/       │
│   upload                        │
│ - Send file + metadata          │
│ - Receive job_id               │
└────────────┬────────────────────┘
             │
             ▼
┌─────────────────────────────────┐
│ TranscriptionStatus Component   │
│ - Poll /api/transcription/      │
│   {job_id}/status              │
│ - Show progress bar             │
│ - Display ETA                   │
└────────────┬────────────────────┘
             │
             ▼
┌─────────────────────────────────┐
│ Transcription Complete          │
│ - Fetch transcript              │
│ - Navigate to review interface  │
│ - TranscriptReview Component    │
└─────────────────────────────────┘
```

---

## Configuration & Environment Variables

### Frontend .env
```
REACT_APP_API_BASE_URL=http://localhost:8000
REACT_APP_MAX_FILE_SIZE=524288000  # 500MB in bytes
REACT_APP_MAX_DURATION_MINUTES=240  # 4 hours
REACT_APP_POLL_INTERVAL_MS=2000    # Poll every 2 seconds
```

### Backend .env
```
# Transcription settings
TRANSCRIPTION_MAX_FILE_SIZE=524288000  # 500MB
TRANSCRIPTION_MAX_DURATION=14400  # 4 hours in seconds
TRANSCRIPTION_TIMEOUT=3600  # 1 hour
TRANSCRIPTION_MODEL_SIZE=base  # Whisper model
TRANSCRIPTION_LANGUAGE=ta  # Tamil

# Queue settings
CELERY_BROKER_URL=redis://localhost:6379/0
CELERY_RESULT_BACKEND=redis://localhost:6379/1
CELERY_MAX_RETRIES=3

# Storage
S3_BUCKET_TRANSCRIPTIONS=mentible-transcriptions
S3_UPLOAD_EXPIRY_HOURS=24  # Delete after 24 hours
```

---

## Security Considerations

### File Upload Security

1. **Virus Scanning** (Optional, Phase 2):
   - Scan uploaded MP3 with ClamAV
   - Reject suspicious files
   - Log all uploads for audit trail

2. **Access Control**:
   - Only project owner can upload MP3s
   - Uploaded files linked to project_id
   - Prevent direct file access via URL

3. **Rate Limiting**:
   - Max 10 uploads/hour per user
   - Max 1 GB/day per user
   - Prevents abuse/DoS

### Code Sample: Rate Limiting

```python
from fastapi import HTTPException, status
from datetime import datetime, timedelta
import redis

redis_client = redis.Redis(host='localhost', port=6379, db=0)

async def check_upload_rate_limit(user_id: str):
    """Check if user has exceeded upload limits"""
    
    # Rate limit: 10 uploads per hour
    key = f"upload_rate:{user_id}:hour"
    count = redis_client.incr(key)
    
    if count == 1:
        redis_client.expire(key, 3600)  # 1 hour TTL
    
    if count > 10:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many uploads. Max 10 per hour."
        )
    
    # Size limit: 1 GB per day
    size_key = f"upload_size:{user_id}:day"
    total_size = redis_client.get(size_key) or 0
    
    if total_size > 1_000_000_000:  # 1 GB
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Upload quota exceeded. Max 1 GB per day."
        )
```

---

## Future Enhancements (Phase 3+)

- [ ] Drag-and-drop upload area
- [ ] Multiple file upload (batch)
- [ ] Direct audio recording in browser (getUserMedia API)
- [ ] Audio preview/playback before submitting
- [ ] Automatic language detection (vs. pre-selecting Tamil)
- [ ] Integration with external recording services (Google Drive, Dropbox)
- [ ] Speaker diarization hint (allow user to provide speaker names)
- [ ] Custom Whisper model fine-tuned on Tamil interviews
- [ ] Real-time transcription display (stream results as they're transcribed)
- [ ] Mobile app support (React Native)

---

## Success Metrics

### Technical Metrics
- **Upload Success Rate**: > 99% (failures < 1 in 100)
- **Average Upload Time**: < 30 seconds for 100 MB file
- **Transcription Queue Time**: < 5 minutes (from upload to start of processing)
- **Transcription Accuracy**: 75-80% WER (Word Error Rate)
- **API Response Time**: < 500ms for status polling

### User Metrics
- **Feature Adoption**: 50% of new projects use MP3 upload (within 3 months)
- **User Satisfaction**: > 4/5 rating on feature usability
- **Time to Publishable Transcript**: < 30 min (including user review)
- **Retry Rate**: < 5% (failures that require retry)

### Business Metrics
- **Knowledge Holder Onboarding**: 20+ new creators in first quarter
- **Interview Content Volume**: 100+ published interviews in first 6 months
- **Learner Engagement**: 1000+ learners accessing interview content
- **Revenue Impact**: Interview content drives 10%+ of course subscriptions

---

## Questions & Clarifications

Before starting implementation, clarify with product/UX team:

1. **Button Placement**: Should MP3 upload be first option, or after existing options?
2. **Auto-navigation**: After transcription completes, auto-navigate to review interface, or show completion dialog?
3. **Language Selection**: Pre-select Tamil, or let users choose language?
4. **Speaker Names**: Require speaker name input, or optional?
5. **Monetization**: Will MP3 transcription be free or paid feature?
6. **Analytics**: What events should we track? (upload, transcription start, completion, review actions)

---

**Document Version**: 1.0  
**Status**: Ready for Engineering  
**Next Step**: Kickoff meeting with frontend & backend teams  

