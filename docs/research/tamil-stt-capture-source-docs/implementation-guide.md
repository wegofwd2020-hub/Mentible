# Tamil Speech-to-Text Transcription for Mentible
## Implementation Guide & Architecture

**Document Version**: 1.0  
**Date**: September 2026  
**Project**: Mentible - Interview Transcription Module  
**Target Language**: Tamil  
**Use Case**: Transcribing 2-person interviews (teacher-student / interviewer-interviewee)

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Design Options](#design-options)
3. [Recommended Architecture](#recommended-architecture)
4. [System Architecture](#system-architecture)
5. [Implementation Roadmap](#implementation-roadmap)
6. [Cost Analysis](#cost-analysis)
7. [Risk Mitigation](#risk-mitigation)
8. [Success Metrics](#success-metrics)

---

## Executive Summary

This document outlines three implementation strategies for integrating Tamil speech-to-text (STT) transcription into Mentible:

- **Option A (Cloud-based)**: Google Cloud Speech-to-Text API — fastest to market, managed service
- **Option B (Hybrid)**: Whisper (local) + Cloud fallback — balance of cost and control
- **Option C (Self-hosted)**: Fine-tuned Indic model — maximum control, highest effort

### Recommendation: **Option B (Hybrid)** for Production
- **Best for**: Mentible's learning platform use case
- **Rationale**: Cost-effective, acceptable quality for educational content, maintains data privacy
- **Timeline**: 3-4 weeks to production
- **Monthly Cost**: $200-500 depending on interview volume

---

## Design Options

### Option A: Cloud-Based (Google Cloud Speech-to-Text)

#### Pros
✅ Highest accuracy for Tamil (85-90%)  
✅ Built-in speaker diarization (essential for 2-person interviews)  
✅ Minimal infrastructure setup  
✅ Automatic updates (no model maintenance)  
✅ Handles code-switching (Tamil + English) reasonably well  

#### Cons
❌ Recurring costs scale with usage (~$0.0001/second)  
❌ Data leaves your infrastructure (privacy concern)  
❌ API rate limits and quota management needed  
❌ No control over model updates  
❌ Network dependency (requires internet connection)  

#### Best For
- Rapid MVP deployment
- Variable, unpredictable interview volume
- When data privacy is not a primary concern
- Learning platform pilots with external experts

---

### Option B: Hybrid (Whisper + Cloud Fallback)

#### Pros
✅ Lower ongoing costs (local processing is free)  
✅ Data privacy (interviews stay on-premise)  
✅ Offline capability  
✅ No quota/rate limit concerns  
✅ Fallback option for edge cases  
✅ Flexible post-processing pipeline  

#### Cons
❌ Lower baseline accuracy for Tamil (60-75%)  
❌ Requires GPU for reasonable inference speed  
❌ Diarization requires separate component  
❌ More operational complexity  
❌ Model size (~3GB for large model)  

#### Best For
- Production deployment with privacy requirements
- Predictable interview volume
- Long-term cost optimization
- Internal interviews (less accuracy pressure)

---

### Option C: Fine-Tuned Indic Model

#### Pros
✅ Potential highest accuracy (90%+)  
✅ Optimized for Tamil-specific phonetics  
✅ Complete data ownership  
✅ No ongoing API costs  

#### Cons
❌ 4-8 week development timeline  
❌ Requires annotated Tamil training data ($5-15K)  
❌ Expensive GPU infrastructure for training  
❌ Ongoing maintenance burden  
❌ Requires ML expertise  

#### Best For
- Strategic long-term investment
- High-volume deployments (1000+ interviews/month)
- When accuracy is mission-critical
- Building proprietary IP

---

## Recommended Architecture

### Selection: **Option B (Hybrid)**

**Reasoning**:
1. **Cost Efficiency**: For Mentible's expected volume (estimate: 50-200 interviews/month), local Whisper + occasional cloud fallback = ~$200-500/month
2. **Quality-Cost Balance**: 75-80% accuracy suitable for educational transcription with human review workflow
3. **Privacy**: Educational content stays on-premise
4. **Flexibility**: Can upgrade to fine-tuned model or cloud-only later
5. **Operational Control**: No vendor lock-in, owns the infrastructure

---

## System Architecture

### High-Level Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    Mentible Application                      │
│                   (Django/FastAPI)                           │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
        ┌──────────────────────────────────────┐
        │   STT Orchestration Service          │
        │   (Python FastAPI)                   │
        │                                      │
        │  - File validation (MP3)             │
        │  - Audio preprocessing               │
        │  - Speaker diarization               │
        │  - Chunk management                  │
        │  - Error handling & retry            │
        └──────────────────────────────────────┘
                    │              │
         ┌──────────┘              └──────────┐
         ▼                                     ▼
    ┌──────────────────┐         ┌──────────────────┐
    │  Whisper STT     │         │  Google Cloud    │
    │  (Local)         │         │  Speech API      │
    │                  │         │  (Fallback)      │
    │  - GPU enabled   │         │                  │
    │  - Tamil model   │         │  - Diarization   │
    │  - Batch mode    │         │  - High accuracy │
    └──────────────────┘         └──────────────────┘
         │                             │
         └──────────────┬──────────────┘
                        ▼
        ┌──────────────────────────────────┐
        │  Post-Processing Pipeline        │
        │                                  │
        │  - Diarization (local or API)    │
        │  - Confidence scoring            │
        │  - Speaker labeling              │
        │  - Text normalization            │
        │  - Formatting (JSON/SRT)         │
        └──────────────────────────────────┘
                        │
                        ▼
        ┌──────────────────────────────────┐
        │  Transcript Storage & Review     │
        │                                  │
        │  - PostgreSQL (transcripts)      │
        │  - S3/Local (audio + results)    │
        │  - Human review workflow         │
        │  - Version control               │
        └──────────────────────────────────┘
```

### Component Breakdown

#### 1. **File Ingestion Service**
- Accepts MP3 uploads from Mentible UI
- Validates file format, size (max 500MB)
- Converts MP3 to WAV for processing
- Stores in temporary queue

#### 2. **Audio Preprocessing**
- Normalize audio levels
- Detect silence and trim
- Split into chunks (Whisper token limit: 30 seconds per chunk)
- Generate metadata (duration, quality score)

#### 3. **Whisper Transcription (Local)**
- Load OpenAI Whisper model (base or small for Tamil)
- Process audio chunks sequentially
- Collect confidence scores
- Fallback to cloud if local quality < threshold

#### 4. **Speaker Diarization**
- **Option B1 (Local)**: PyAnnote (open-source, lower accuracy)
- **Option B2 (Hybrid)**: Google Cloud Speech-to-Text diarization for high-quality interviews
- **Option B3 (Manual)**: UI for manual speaker assignment during review

#### 5. **Post-Processing Pipeline**
- Merge chunks into continuous transcript
- Apply speaker labels (Speaker A, Speaker B)
- Add timestamps
- Confidence scoring per segment
- Format output (JSON, SRT, plain text)

#### 6. **Storage & Management**
- PostgreSQL: Transcript metadata + content
- Redis: Caching (transcripts, diarization results)
- S3 or local filesystem: Original audio + intermediate results
- Versioning: Track corrections/edits

#### 7. **Human Review & Refinement Workflow** [CRITICAL FEATURE]
- Web UI for reviewing/editing transcripts
- Flag low-confidence segments (visual highlighting)
- Inline editing with change tracking
- Export transcript (copy/paste to external tools)
- Import corrected transcript (paste back into platform)
- Version control and audit trail
- Quality feedback loop for model improvement
- Confidence scoring by segment

---

## Transcript Review & Refinement Workflow

### Why This Is Critical

**Reality Check**: Whisper's Tamil accuracy is 75-80%, which means:
- 1 in 5 words may be incorrect
- In a 1-hour interview (average 800-1000 words), expect 160-200 errors
- Without a review mechanism, transcriptions are unusable for publication

**The Solution**: A robust review & refinement interface that allows users to:
1. **Identify errors** quickly (confidence highlighting)
2. **Correct errors** inline without re-uploading
3. **Export for external editing** (when platform editor isn't sufficient)
4. **Import corrections** (paste refined text back into system)
5. **Track changes** (audit trail for quality assurance)
6. **Provide feedback** (improves models over time)

### Component Architecture: Transcript Review Service

```
Transcript Review Pipeline:
┌─────────────────────────────────────────────────────────┐
│              Transcription Service Output               │
│  (Raw Tamil text + confidence scores + timestamps)     │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│          Confidence Scoring & Segmentation              │
│                                                         │
│  - Word-level confidence (0.0-1.0)                      │
│  - Segment-level average confidence                     │
│  - Flag low-confidence (< 0.7) for review              │
│  - Generate quality report                              │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
         ┌───────────────────────────────┐
         │   Transcript Review UI        │
         │   (Browser-based Editor)      │
         │                               │
         │  - Inline editing             │
         │  - Confidence highlighting    │
         │  - Audio playback sync        │
         │  - Speaker segments           │
         └───────────────┬───────────────┘
                         │
              ┌──────────┼──────────┐
              │          │          │
              ▼          ▼          ▼
        ┌─────────┐ ┌────────┐ ┌────────────┐
        │ Save    │ │ Export │ │ Publish    │
        │ Draft   │ │ (Copy) │ │ (Submit)   │
        └─────────┘ └────┬───┘ └────────────┘
                         │
                         ▼
            ┌────────────────────────┐
            │ External Editor        │
            │ (Google Docs, Word,    │
            │  Notes, Notepad++)     │
            └────────┬───────────────┘
                     │
                     ▼
            ┌────────────────────────┐
            │ Import (Paste Back)    │
            │ Corrected Transcript   │
            └────────────────────────┘
```

### User Interface: Transcript Review Screen

#### Layout Components

**Header**
```
┌──────────────────────────────────────────────────────────┐
│  Interview: "Kolam Design Masterclass"                  │
│  By: Savitri (Expert)                                   │
│  Duration: 43 min 22 sec                                │
│  Status: [Draft] Quality Score: 73%                     │
│                                                         │
│  [Audio Player ────────────●──────────── 22:15]        │
│  [Play] [Pause] [Speed: 1.0x]                          │
└──────────────────────────────────────────────────────────┘
```

**Left Sidebar: Confidence Map**
```
┌────────────────┐
│ Confidence     │ ← Confidence-scored segments
│ Summary        │
│                │
│ ████████░ 85%  │   Excellent (segment 1)
│ ███████░░ 78%  │   Good (segment 2)
│ █████░░░░ 65%  │⚠️ Needs Review (segment 3)
│ ██░░░░░░░ 23%  │❌ Low Confidence (segment 4)
│ ███████░░ 71%  │   OK (segment 5)
│                │
│ Jump to low    │
│ confidence ▼   │
└────────────────┘
```

**Main Editor: Transcript Text**
```
┌────────────────────────────────────────────────────────────┐
│ [Edit Mode] [View Only] [Changes: 12]                     │
│                                                            │
│ Speaker A (Savitri):                                       │
│ "Kolam-ஐ ஆரம்பிக்கும் போது, நாம் முதலில் [LOW] நிலத்தை" │
│                                              ↑             │
│                                    [Low Confidence]       │
│                                                            │
│ Speaker B (Student):                                       │
│ "அப்ப நிலம் ஸாஃப்ட் இருக்க வேண்டுமா?"                  │
│                                                            │
│ Speaker A (Savitri):                                       │
│ "[LOW] இல்லை, நிலம் கொஞ்சம் [MED] இருக்க வேண்டும்"     │
│                          ↑                ↑                │
│                  [Low Confidence]  [Medium Confidence]    │
│                                                            │
│ [Continue reading...]                                      │
└────────────────────────────────────────────────────────────┘
```

**Right Sidebar: Tools**
```
┌─────────────────────────┐
│ Actions                 │
│                         │
│ [Save Draft]           │
│ [Mark Complete]        │
│ [Publish]              │
│                         │
│ Export Options          │
│ ─────────────────────── │
│ [Copy All to Clipboard]│
│ [Export as TXT]        │
│ [Export as SRT]        │
│ [Download as DOCX]     │
│                         │
│ Import Corrections      │
│ ─────────────────────── │
│ [Paste Corrected Text] │
│ [Import DOCX]          │
│ [Merge Changes]        │
│                         │
│ Statistics              │
│ ─────────────────────── │
│ Total Words: 1,247      │
│ Edited: 23 (1.8%)      │
│ Low Conf Segments: 8   │
│ Status: 82% Reviewed   │
└─────────────────────────┘
```

### Feature Details

#### 1. Inline Editing
```
User clicks on a word/segment to edit:

Before: "kolam-ஐ ஆரம்பிக்கும் போது, நாம் முதலில் கூடம் நிலத்தை"
                                                    ↑ [WRONG]

After: "kolam-ஐ ஆரம்பிக்கும் போது, நாம் முதலில் கூட நிலத்தை"
                                                    ↑ [CORRECTED]

Change Tracked:
  - Original text stored
  - Timestamp of change
  - User ID (who corrected)
  - Flagged as "user correction" (not AI)
```

#### 2. Confidence-Based Highlighting
```
Color Coding:
  🟢 Green (90-100%): High confidence, likely correct
  🟡 Yellow (70-89%): Medium confidence, review recommended
  🔴 Red (< 70%):    Low confidence, needs review
  ⚪ Gray:           Manual correction by user

Visual Example:
  "kolam-ஐ 🟢 ஆரம்பிக்கும் 🟢 போது 🟡 நாம் 🔴 முதலில் கூட நிலத்தை"
```

#### 3. Export/Import Workflow

**Export Option A: Copy to Clipboard**
```
User clicks [Copy All to Clipboard]

Copied Text Format:
───────────────────────────────────────────
Speaker A (Savitri, 0:00-0:15):
Kolam-ஐ ஆரம்பிக்கும் போது, நாம் முதலில் [??] நிலத்தை தயாரித்து கொள்ள வேண்டும்.

Speaker B (Student, 0:15-0:22):
அப்ப நிலம் சாஃப்ட் இருக்க வேண்டுமா?

[Original confidence score: 73% | Edited: No]
───────────────────────────────────────────

User:
1. Pastes into Google Docs / Word / Notes
2. Reviews and corrects with domain expert (if needed)
3. Copies corrected version
4. Returns to Mentible UI
```

**Export Option B: Download DOCX/TXT**
```
User clicks [Export as DOCX]

Generated file contains:
  - Title & metadata
  - Speaker-labeled transcript
  - Timestamps
  - Confidence scores
  - Formatting preserved
  - Ready to edit in Word offline
```

**Import: Paste Corrected Text**
```
User clicks [Paste Corrected Text]

Dialog opens:
┌──────────────────────────────────────────┐
│ Paste corrected transcript below:        │
│                                          │
│ [Large text input box]                   │
│                                          │
│ [Preview Changes] [Cancel] [Merge]      │
└──────────────────────────────────────────┘

System:
  1. Parses pasted text
  2. Detects speaker changes & timestamps
  3. Compares with original (word-by-word diff)
  4. Highlights what changed
  5. Applies corrections to master transcript
  6. Updates confidence scores
  7. Records audit trail
```

**Change Merge Example**
```
Original:       "kolam-ஐ ஆரம்பிக்கும் போது, நாம் முதலில் கூடம் நிலத்தை"
Corrected:      "kolam-ஐ ஆரம்பிக்கும் போது, நாம் முதலில் கூட நிலத்தை"
Detected Diff:  1 word changed (கூடம் → கூட)

Merge Preview:
  ✓ Change 1: கூடம் → கூட (Line 12)  [ACCEPT]
  ✓ Change 2: நிலத்தை → நிலத்தை (No change)
  ✓ Change 3: தயாரித்து → தயாரிக்க (Line 15)  [ACCEPT]

[Confirm Merge] [Review Individual Changes]
```

#### 4. Version Control & Audit Trail

**Database Schema**
```sql
-- Main transcript
CREATE TABLE transcripts (
    id UUID PRIMARY KEY,
    job_id UUID REFERENCES transcription_jobs(id),
    original_text TEXT,          -- AI-generated text (immutable)
    current_text TEXT,           -- Latest version (editable)
    version INTEGER DEFAULT 1,
    status ENUM ('draft', 'review', 'published'),
    quality_score FLOAT,
    last_edited_at TIMESTAMP,
    last_edited_by UUID,
    created_at TIMESTAMP,
    published_at TIMESTAMP
);

-- Change history (audit trail)
CREATE TABLE transcript_revisions (
    id UUID PRIMARY KEY,
    transcript_id UUID REFERENCES transcripts(id),
    revision_number INTEGER,
    change_type ENUM ('word_correction', 'segment_edit', 'import_merge'),
    original_text TEXT,
    corrected_text TEXT,
    segment_id UUID,              -- Which segment/speaker changed
    word_position INTEGER,         -- Position in transcript
    edited_by UUID REFERENCES users(id),
    edited_at TIMESTAMP,
    notes TEXT,                   -- User note explaining the change
    INDEX (transcript_id, revision_number)
);

-- Word-level confidence tracking
CREATE TABLE transcript_words (
    id UUID PRIMARY KEY,
    transcript_id UUID,
    word TEXT,
    position INTEGER,
    original_confidence FLOAT,    -- AI confidence
    is_corrected BOOLEAN,
    corrected_by UUID,
    corrected_at TIMESTAMP,
    INDEX (transcript_id, position)
);
```

**Audit Trail Example**
```
Transcript: "Kolam Design Masterclass"
Status: Draft (23 corrections)

Revision History:
─────────────────────────────────────────────────────────
[1] 2026-09-04 14:30:00 UTC  |  AI Generation
    → Original transcript generated (1,247 words)
    → Quality Score: 73%
    
[2] 2026-09-04 14:35:00 UTC  |  User: Savitri
    → Corrected: "கூடம்" → "கூட" (Line 12)
    → Note: "Wrong suffix"
    
[3] 2026-09-04 14:40:00 UTC  |  User: Sridhar
    → Bulk import: 23 corrections
    → Changed 1.8% of content
    → Note: "External review by Tamil linguistic expert"
    → Quality Score: 89%
    
[4] 2026-09-04 15:00:00 UTC  |  Publish
    → Status: Published
    → Final Quality Score: 89%
─────────────────────────────────────────────────────────

[View Details] [Revert to Version X] [Download All Versions]
```

#### 5. Feedback Loop for Model Improvement

**Collecting Corrections for Retraining**
```
When users make corrections, the system learns:

Each correction is tagged:
  - Original word (AI-generated)
  - Corrected word (user-provided)
  - Context (surrounding words)
  - Audio segment
  - Confidence score
  - Audio quality metrics

Over time (after 1000+ corrections), these become training data:
  - Identify common Whisper errors in Tamil
  - Analyze patterns (e.g., retroflex consonants often confused)
  - Fine-tune Whisper or train custom model
  - Improve accuracy for future transcriptions

Monthly Quality Report:
  "Most common errors in August:
   - Retroflex 'ಡ' confused with 'ட' (45 instances)
   - Geminated consonants (32 instances)
   - Vowel length distinctions (28 instances)
   → Recommend fine-tuning on these phoneme pairs"
```

---



### Phase 1: MVP (Weeks 1-2) - Foundation & Testing

#### Week 1: Infrastructure & Setup
**Day 1-2: Development Environment**
```
Tasks:
  - Set up Python 3.10+ virtual environment
  - Install Whisper: pip install openai-whisper
  - Install PyAnnote: pip install pyannote.audio
  - Install supporting libs: librosa, scipy, numpy, pydub
  - Set up PostgreSQL local database
  - Configure AWS S3 or local storage for audio files
```

**Day 3-4: Basic Transcription Pipeline**
```
Python Module: transcription/whisper_engine.py
  - Load Whisper Tamil model (base model: ~140MB)
  - Implement audio chunk processing
  - Test with sample Tamil interview MP3
  - Measure accuracy vs. manual transcription
  - Measure inference time
```

**Day 5: Diarization Prototype**
```
Python Module: transcription/diarization_engine.py
  - Implement PyAnnote speaker segmentation
  - Test on sample 2-person interview
  - Measure accuracy (speaker switch detection)
  - Document limitations
```

#### Week 2: Integration & Cloud Fallback
**Day 1-2: Cloud Integration**
```
Python Module: transcription/google_cloud_client.py
  - Set up Google Cloud credentials
  - Implement Speech-to-Text API wrapper
  - Configure diarization settings
  - Implement fallback logic (when local quality < 70%)
```

**Day 3-4: Quality Framework**
```
Python Module: transcription/quality_metrics.py
  - Implement confidence scoring
  - Define fallback thresholds
  - Create quality report generation
  - Test on diverse audio samples (clean, noisy, accented)
```

**Day 5: Testing & Documentation**
```
  - Unit tests for transcription module
  - Integration tests with sample MP3s
  - Performance benchmarking
  - Generate sample outputs
```

---

### Phase 2: Production Setup (Weeks 3-4)

#### Week 3: API Service & Storage

**Day 1-2: FastAPI Service**
```
Python Module: api/transcription_service.py
  - Create REST API endpoints:
    POST /api/transcribe (upload MP3)
    GET /api/transcription/{id} (retrieve status)
    GET /api/transcription/{id}/result (get transcript)
    PUT /api/transcription/{id} (update/correct)
  - Implement request validation
  - Add authentication/authorization
  - Error handling & logging
```

**Day 3-4: Database Schema**
```sql
Tables:
  - transcription_jobs (id, file_path, status, created_at, updated_at)
  - transcription_results (id, job_id, transcript_text, language, confidence, diarization_data)
  - speaker_segments (id, result_id, speaker_label, start_time, end_time, text)
  - quality_scores (id, result_id, whisper_confidence, diarization_accuracy, overall_score)
  - corrections (id, result_id, original_text, corrected_text, user_id, timestamp)
```

**Day 5: Storage & Caching**
```
  - S3 bucket structure for audio/results
  - Redis cache for recent transcriptions
  - Implement cleanup jobs (archive old audio after 90 days)
```

#### Week 4: Transcript Review UI & Deployment

**Day 1-2: Transcript Review Interface**
```
Frontend: React component (TypeScript)
  - Confidence-colored highlighting
  - Inline edit mode
  - Audio playback sync (click word → play audio at that timestamp)
  - Speaker segment detection & labeling
  - Copy/paste interface
  
Files:
  - components/TranscriptEditor.tsx
  - components/ConfidenceHighlighter.tsx
  - components/AudioPlayerSync.tsx
  - services/transcriptService.ts
  - services/diffMergeService.ts (for import/merge logic)
  
Testing:
  - Unit tests for diff/merge algorithm
  - Integration test: export → edit → import
  - Test on 5 sample Tamil transcripts
```

**Day 2-3: Import/Export & Merge Logic**
```
Backend: Python module for transcript diffing
  - Parse imported text
  - Detect speaker changes
  - Word-by-word comparison with original
  - Merge corrections into database
  - Handle conflicts (if original text changed)
  - Generate change summary
  
Files:
  - transcription/transcript_diff_merge.py
  - api/endpoints/transcript_corrections.py (PATCH, PUT)
  - Tests with sample corrected transcripts
```

**Day 4: Audit Trail & Versioning**
```
Database: Implement revision tracking
  - Store original + all versions
  - Track who changed what, when
  - Allow revert to previous version
  - Generate audit report
  
API Endpoints:
  - GET /api/transcription/{id}/versions
  - GET /api/transcription/{id}/version/{version_number}
  - POST /api/transcription/{id}/revert/{version_number}
  - GET /api/transcription/{id}/audit-trail
```

**Day 5: Containerization & Deployment**

**Containerization**
```
Dockerfile:
  - Python 3.10 base image
  - GPU support (CUDA 11.8)
  - Install dependencies
  - Whisper model download/caching
  - Health check endpoint
```

**Day 3-4: Deployment Infrastructure**
```
Options:
  A) Docker Compose (local development/testing)
  B) Kubernetes (scalable production on AWS/GCP)
  C) EC2 + GPU instance (single machine, cost-effective)
  
Recommended: EC2 g4dn.xlarge instance
  - 1x NVIDIA T4 GPU (sufficient for ~50 concurrent jobs/day)
  - 4 vCPU, 16GB RAM
  - Ubuntu 22.04 LTS
  - ~$0.53/hour (~$380/month)
```

**Day 5: Monitoring & Alerting**
```
  - Prometheus metrics for job queue depth, latency
  - CloudWatch/DataDog dashboards
  - Alert thresholds (queue > 100, latency > 5min)
  - Logging (structured JSON logs to CloudWatch)
```

---

### Phase 3: Optimization & Scale (Weeks 5-6, Post-MVP)

**Week 5: Performance Tuning**
```
  - Profile inference time bottlenecks
  - Optimize GPU memory usage
  - Batch processing for multiple concurrent requests
  - Cache Whisper model in GPU memory
  - Implement request queuing (Celery + Redis)
```

**Week 6: User Interface & Feedback Loop**
```
  - Build transcript review UI (React component)
  - Implement manual correction workflow
  - Add confidence highlighting
  - Collect user feedback for future fine-tuning
```

---

## Cost Analysis

### Option B (Hybrid) - Detailed Cost Breakdown

#### Infrastructure Costs

**Compute (GPU Instance)**
```
EC2 g4dn.xlarge (1x T4 GPU)
  - On-demand: $0.53/hour
  - Reserved (1-year): $0.35/hour
  
Monthly Cost (730 hours):
  - On-demand: $387
  - Reserved: $256 (recommended for stable load)
```

**Storage**
```
Audio Files (S3)
  - Assumption: 100 interviews/month × 60 min avg
  - Raw MP3: ~1MB/min = 6,000 MB/month = 6GB
  - S3 Standard: $0.023/GB = $0.14/month
  
Transcripts (Database)
  - PostgreSQL RDS (db.t3.micro, free tier for 12 months after)
  - After free tier: ~$15-20/month
  
Total Storage: $15-20/month
```

**Data Transfer**
```
Outbound from AWS: $0.02/GB
  - Estimated 10GB/month of transcript downloads
  - Cost: $0.20/month
```

#### Software Licenses

```
Google Cloud Speech-to-Text (Fallback Only)
  - $0.0001/second of audio
  - Assumption: 10% of interviews use fallback
  - 100 interviews × 60 min × 10% = 600 min = 36,000 sec
  - Cost: $3.60/month (very low usage)

Whisper (OpenAI Model)
  - FREE (open-source, self-hosted)
```

#### Development & Operations

```
Initial Setup (One-time)

Backend (Transcription Pipeline):
  - Whisper integration (40 hours @ $150/hour): $6,000
  - Diarization + post-processing (30 hours): $4,500
  - Cloud fallback integration (20 hours): $3,000
  - Testing & QA (40 hours): $6,000
  
Frontend (Transcript Review UI) [CRITICAL]:
  - UI design & prototyping (20 hours): $3,000
  - Confidence highlighting component (30 hours): $4,500
  - Inline editing & audio sync (35 hours): $5,250
  - Export/import & diff-merge logic (25 hours): $3,750
  - Audit trail & versioning UI (20 hours): $3,000
  - Testing (30 hours): $4,500
  
Infrastructure & DevOps:
  - Database schema & migrations (20 hours): $3,000
  - Deployment & CI/CD (15 hours): $2,250
  - Documentation (15 hours): $2,250
  
Total Development: $47,000
  (Up from $33,000 due to review UI complexity)

Ongoing (Monthly)
  - Monitoring & alerting: $100-200
  - Maintenance (5 hours/month): $750
  - Model updates/improvements: $500
  - Total Ongoing: $1,350-1,550/month
```

#### Total Cost Estimate (Monthly)

| Component | Cost |
|-----------|------|
| **Compute (EC2)** | $256-387 |
| **Storage** | $15-20 |
| **Cloud Fallback (Google)** | $3-5 |
| **Operations & Maintenance** | $1,350-1,550 |
| **TOTAL** | **$1,624-1,962/month** |

**Per Interview Cost**: $1,624 ÷ 100 interviews = ~$16/interview

---

### Comparison: All Options

| Metric | Option A (Cloud) | Option B (Hybrid) | Option C (Fine-tuned) |
|--------|------------------|------------------|----------------------|
| **Initial Setup** | $3,000 | $47,000 * | $95,000+ |
| **Monthly (100 interviews)** | $1,800-2,400 | $1,624-1,962 | $800-1,200 |
| **Per-Interview Cost** | $18-24 | $16-20 | $8-12 |
| **Accuracy (Tamil)** | 85-90% | 75-80%** | 90-95% |
| **Break-even Point** | Never (no startup cost) | ~22 months | ~36 months |
| **Data Privacy** | ❌ (cloud) | ✅ (local) | ✅ (local) |
| **Operational Load** | Low | Medium | High |
| **Review UI** | Limited | ✅ Full-featured | ✅ Full-featured |

*Includes $14K for Transcript Review UI (essential for usability)  
**With review workflow, effective accuracy reaches 85-90% after user corrections

---

### Cost Optimization Strategies

1. **Use Reserved Instances** (saves 30% on EC2)
2. **Batch Processing** at off-peak hours (reduce queue depth)
3. **Audio Preprocessing** (reduce Whisper processing time by 10-15%)
4. **Caching** (avoid re-transcribing same audio)
5. **Progressive Rollout** (start with Option A, migrate to B as volume increases)

---

## Risk Mitigation

### Technical Risks

#### Risk 1: Low Transcription Accuracy
**Probability**: High (60-75% baseline for Whisper Tamil)  
**Impact**: User frustration, manual correction overhead  

**Mitigation**:
- Implement confidence scoring; flag low-confidence segments
- Require human review for accuracy-critical content
- Plan for Option B2 (cloud fallback) for high-stakes interviews
- Collect correction feedback to fine-tune models over time

#### Risk 2: Speaker Diarization Failure
**Probability**: Medium (overlapping speech, similar voices)  
**Impact**: Cannot distinguish speaker A vs B  

**Mitigation**:
- Use Google Cloud diarization for key interviews (fallback)
- Provide UI for manual speaker assignment during review
- Add speaker identification hints (name labels) in audio metadata

#### Risk 3: Infrastructure Downtime
**Probability**: Low (~99.5% uptime SLA)  
**Impact**: Interview transcription blocked  

**Mitigation**:
- Use AWS Auto Scaling + health checks
- Implement request queue with retry logic
- Fallback to cloud transcription if local service fails
- Monitor queue depth; alert on slowness

#### Risk 4: GPU Memory Exhaustion
**Probability**: Medium (if multiple concurrent requests)  
**Impact**: Out-of-memory crashes, job failures  

**Mitigation**:
- Implement request queuing (Celery) with controlled parallelism
- Profile GPU memory usage; right-size instance
- Implement graceful degradation (queue requests, process sequentially)

---

### Operational Risks

#### Risk 5: Model Maintenance
**Probability**: Medium  
**Impact**: Whisper model updates may change behavior; fine-tuned models degrade  

**Mitigation**:
- Pin Whisper version in requirements.txt
- Test model updates in staging before production
- Keep version control of model files
- Document model training/versioning process

#### Risk 6: Data Privacy Compliance
**Probability**: Medium (GDPR, CCPA if international students)  
**Impact**: Legal liability if interview data exposed  

**Mitigation**:
- Store audio files encrypted at rest (S3 encryption)
- Implement access controls (IAM policies)
- Auto-delete audio after 90 days (retain transcripts)
- Comply with FERPA (educational data privacy)

---

## Success Metrics

### Quantitative Metrics

#### Accuracy
```
Word Error Rate (WER) = (S + D + I) / N
  where:
    S = substitutions
    D = deletions
    I = insertions
    N = reference words

Target: < 25% WER (acceptable for educational content with review)
Measurement: Monthly spot-checks on 20 random interviews
```

#### Performance
```
End-to-End Latency = Transcription Time + Diarization Time
  
Target:
  - 60-min interview: transcribed within 10-15 minutes
  - Speaker diarization: within 2 minutes
  - Total SLA: < 20 minutes from upload to completion

Measurement: Average latency from job_received to job_completed
```

#### Reliability
```
Availability = (Total Time - Downtime) / Total Time

Target: 99.5% uptime (< 3.6 hours downtime/month)
Measurement: CloudWatch monitoring, alerting on failures
```

#### Cost Efficiency
```
Cost per Interview = Monthly Spend / Interview Count

Target: $15-20/interview
Track: Actual spend vs. budget by month
```

### Qualitative Metrics

1. **User Satisfaction**
   - Survey: "How accurate was the transcript?" (1-5 scale)
   - Target: 4/5 average rating

2. **Manual Review Overhead**
   - % of interviews requiring significant corrections
   - Target: < 20% (for interviews with clear audio)

3. **Time-to-Production**
   - Days from upload to usable transcript
   - Target: Same-day turnaround for most interviews

---

## Deployment Checklist

### Pre-Deployment
- [ ] All unit tests passing (>90% code coverage)
- [ ] Integration tests with real MP3 samples
- [ ] Load testing: simulate 100 concurrent uploads
- [ ] Security audit: credential management, data encryption
- [ ] Database migrations tested in staging
- [ ] API documentation complete
- [ ] Monitoring dashboards configured
- [ ] Runbooks for common incidents

### Day-of-Deployment
- [ ] Backup production database
- [ ] Drain job queue (wait for pending jobs)
- [ ] Deploy to staging first; run smoke tests
- [ ] Deploy to production during low-traffic window
- [ ] Monitor error rates for 2 hours post-deployment
- [ ] Alert team on Slack when complete

### Post-Deployment (Week 1)
- [ ] Daily check: error rates, latency, queue depth
- [ ] Collect user feedback on accuracy
- [ ] Review CloudWatch logs for issues
- [ ] Plan for performance optimizations
- [ ] Plan for next iteration (diarization improvement, UI refinement)

---

## Appendix: Sample Configuration Files

### Python Requirements (requirements.txt)
```
openai-whisper>=20230314
google-cloud-speech>=2.20.0
pyannote.audio>=3.0.0
torch>=2.0.0
torchaudio>=2.0.0
fastapi>=0.104.0
uvicorn>=0.24.0
pydantic>=2.0.0
sqlalchemy>=2.0.0
psycopg2-binary>=2.9.0
boto3>=1.28.0
redis>=5.0.0
pydub>=0.25.0
librosa>=0.10.0
celery>=5.3.0
python-dotenv>=1.0.0
structlog>=23.0.0
```

### Environment Variables (.env.example)
```
# AWS
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=xxx
AWS_SECRET_ACCESS_KEY=xxx
S3_BUCKET=mentible-transcriptions

# Google Cloud
GOOGLE_CLOUD_PROJECT=xxx
GOOGLE_CLOUD_CREDENTIALS_PATH=/path/to/credentials.json

# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/mentible_transcription
REDIS_URL=redis://localhost:6379/0

# Whisper
WHISPER_MODEL_SIZE=base  # small, base, medium
WHISPER_DEVICE=cuda  # cuda, cpu

# API
API_HOST=0.0.0.0
API_PORT=8000
LOG_LEVEL=INFO
```

### Docker Compose (docker-compose.yml)
```yaml
version: '3.8'

services:
  postgres:
    image: postgres:15-alpine
    environment:
      POSTGRES_DB: mentible_transcription
      POSTGRES_USER: mentible
      POSTGRES_PASSWORD: secure_password
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"

  transcription_service:
    build: .
    ports:
      - "8000:8000"
    environment:
      DATABASE_URL: postgresql://mentible:secure_password@postgres:5432/mentible_transcription
      REDIS_URL: redis://redis:6379/0
      GOOGLE_CLOUD_CREDENTIALS_PATH: /app/credentials.json
    volumes:
      - ./credentials.json:/app/credentials.json:ro
      - audio_cache:/tmp/audio
    depends_on:
      - postgres
      - redis
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 1
              capabilities: [gpu]

volumes:
  postgres_data:
  audio_cache:
```

---

## Next Steps

1. **Review this document** with your team
2. **Validate assumptions** (expected interview volume, accuracy requirements)
3. **Proceed with Phase 1** (MVP - 2 weeks)
4. **Gather user feedback** on transcription quality
5. **Plan Phase 2** (production deployment)
6. **Establish metrics** dashboard for monitoring

---

## Questions & Clarifications Needed

Before proceeding, clarify:

1. **Expected Volume**: How many interviews/month? (Current estimate: 50-200)
2. **Audio Quality**: Studio-quality or mobile recordings?
3. **Accuracy Requirements**: Acceptable error rate? (Suggested: 75-80% for MVP)
4. **Timeline**: When do you need this production-ready?
5. **Data Privacy**: Can interview audio be sent to Google Cloud?
6. **Speaker Diarization**: Is automatic speaker detection essential, or manual OK initially?
7. **Budget**: Do you have capital for infrastructure? (Initial ~$33K + $1.6K/month)

---

## Document History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | Sep 2026 | Architecture | Initial design document |
| TBD | TBD | TBD | Deployment learnings & cost actuals |

---

**Document Confidentiality**: Internal - Mentible Team Only  
**Last Updated**: September 2026  
**Next Review**: December 2026
