<div align="center">

<img src="frontend/public/assets/brand/marventa-logo.png" alt="Marventa AI" width="104" />

# Marventa AI

### Turn marketing knowledge into work your team can build on.

An open-source, all-in-one workspace for market understanding, creative production, publishing operations, and lead discovery.

**English** · [简体中文](README.zh-CN.md)

[![Website](https://img.shields.io/badge/Website-marventa.tech-7C3AED)](https://marventa.tech)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Python](https://img.shields.io/badge/Python-3.11+-3776AB.svg)](backend/requirements.txt)
[![Next.js](https://img.shields.io/badge/Next.js-16-black.svg)](frontend/package.json)

[Overview](#overview) · [Workflow](#workflow) · [Capabilities](#capabilities) · [Quick start](#quick-start) · [Configuration](#configuration)

</div>

---

## Overview

Marketing teams accumulate useful knowledge every day: product documents, customer questions, campaign examples, images, videos, drafts, channel feedback, and publishing records. That knowledge often remains scattered across folders, chat threads, spreadsheets, and individual prompts.

Marventa AI organizes it around projects.

Each project brings together the context needed to understand a market, study examples, create content, review quality, prepare publication, and examine the response. Team members can return to the same sources, versions, decisions, and results as work develops.

```text
Research → Understand → Create → Review → Publish → Learn
```

This creates an end-to-end marketing workflow with a memory of its own. Research informs creation, brand guidance shapes review, publication records connect to channel results, and audience response becomes context for the next round of work.

AI supports the parts that benefit from synthesis, comparison, drafting, and classification. People retain control over sources, creative judgment, approvals, channel authorization, and final delivery.

Marventa is designed for teams that want:

- a shared record of product and market understanding;
- reusable creative references and materials;
- structured AI-assisted creation with human review;
- clear permissions and durable history;
- self-hosted control over data, providers, and infrastructure.

## Workflow

### 1. Organize the project

Create a project for a product, campaign, account, or content program. Invite collaborators and keep insight, cases, materials, creations, publication plans, and completed reports within the same project boundary.

Project owners and administrators can define brand voice, audience, value proposition, visual direction, and prohibited terms in the Guidelines tab. These settings autosave and guide subsequent Content Studio work.

### 2. Build market understanding

Import Markdown, PDF, DOCX, or repository content. Market Insight turns the source material into structured analysis covering positioning, target audiences, competitors, use cases, strengths, and campaign directions.

Teams that need external evidence can enable bounded public research. The research flow searches public sources, reads eligible pages, stores citations, and records limitations alongside the analysis.

### 3. Learn from examples

Create a case library from images, videos, text, and supported public links. Case analysis extracts hooks, audience fit, content structure, marketing angles, strengths, and reusable lessons.

Favorite the cases that represent a useful pattern and reference them directly during creation.

### 4. Prepare reusable materials

Organize project images, videos, and copy into material sets. Text files and office documents can be imported as editable copy. Media remains available for preview, Content Studio references, and publication plans.

Materials preserve the project original while downstream work keeps a reference to it.

### 5. Create and review

Content Studio uses a guided conversation to clarify the product, audience, format, platform, and creative direction. It can draw context from completed insight, analyzed cases, project copy, brand guidelines, images, and video.

A completed generation produces five coordinated cards:

1. content plan or script;
2. headline options;
3. publication copy;
4. hashtags;
5. visual direction.

Cards can be edited individually, restored from earlier versions, and turned into a bilingual long-form report. A quality check reviews the complete set before delivery.

### 6. Publish and learn

Build a publication plan from ordered media, saved copy, a connected channel account, and a scheduled time. The homepage calendar shows scheduled dates and links back to Publishing.

Account Content separates platform-readable works from Marventa publication records. Lead Tracking summarizes daily comments at account level and identifies potential demand with evidence and suggested actions.

## Capabilities

### Projects and collaboration

- Project-centered organization for every major asset and activity.
- Organization and project roles with independent access boundaries.
- Invitations, creator attribution, member management, and project-level administration.
- Search, filtering, pagination, clear empty states, and explicit operation feedback.

### Market Insight

- Markdown, PDF, DOCX, and repository input.
- Structured product, audience, competitor, positioning, and campaign analysis.
- Optional bounded public research with sources, quotations, and limitations.
- Editable history and direct reuse inside Content Studio.

### Case Library

- Image, video, text, and supported public-link cases.
- Structured analysis of hooks, audience, angles, highlights, and reusable lessons.
- Favorites and project-scoped references for later creation.
- Explicit analysis states and retry behavior.

### Materials

- Material sets for images, videos, and editable copy.
- TXT, Markdown, PDF, and DOCX copy import.
- Rich-text editing, media preview, creator attribution, and project permissions.
- Reuse across Content Studio and Publishing.

### Content Studio

- Guided short-video and image-text creation.
- Project insight, cases, materials, and brand guidelines as reusable context.
- Five coordinated content cards with individual editing.
- Version history, rollback, activity history, and live viewer presence.
- Bilingual report generation, preview, and PDF export.

### Creative quality

Quality review covers:

- brand consistency;
- configured prohibited terms;
- platform and format fit;
- repeated language across cards;
- unsupported numerical, comparative, or performance claims;
- promotional language that may require legal, policy, or subject-matter review.

Model findings remain review guidance. Exact prohibited-term matches are checked by the server and block work generation until the content is revised.

### Multimodal understanding

- Up to five JPEG, PNG, or WebP images per turn.
- One MP4, MOV, WebM, or M4V video per turn.
- Ordered video keyframes extracted with FFmpeg.
- Optional timestamped audio transcription through the configured Content Studio provider.
- Transcript caching tied to the authorized project material.
- Temporary file cleanup after processing.

The original video is not sent to the model. Stored conversations retain text and material identifiers, not base64 images, audio files, or extracted frames.

### Publishing

- Image-text and video publication plans.
- Ordered media, saved copy, account selection, and scheduling.
- Autosave for editable content.
- Locked states for scheduled, publishing, and published plans.
- Explicit failures, cancellation, rescheduling, and durable execution records.
- Optional official Douyin publication through a backend scheduler.

### Account Content

- Platform-readable content and Marventa publication records shown separately.
- Image galleries, saved videos, official embedded playback, and available metrics.
- Explicit provider, authorization, visibility, unavailable, and demonstration-data states.

### Lead Tracking

- One account entity across its linked projects within an organization.
- Daily account-level Top 50 comment snapshots.
- Stable results shared across project bindings.
- Rule-based or AI-assisted intent qualification.
- Evidence, recommended action, confirmation, dismissal, and reset.

### Portfolio

- Dedicated list for completed strategy reports.
- Chinese and English report content.
- Reading view, preview, and PDF export.

## Data and result states

Marventa keeps real platform data, simulated demonstration data, unavailable capabilities, and failures visibly distinct.

- Virtual accounts do not make platform publication requests.
- Demonstration records retain a visible simulation label.
- Provider failures remain errors and do not become successful empty results.
- Enabled provider overrides with incomplete configuration fail explicitly.
- Platform acceptance and public visibility are shown as separate outcomes.
- AI quality review and public research preserve their limitations.

## Permissions

Project access is independent from organization role.

| Capability | Project member | Asset creator | Project admin / owner |
| --- | ---: | ---: | ---: |
| View project assets | Yes | Yes | Yes |
| Manage an insight, case, or creation | — | Own work | All project work |
| Edit materials and publication plans | — | Own content | Yes |
| Manage project members and guidelines | — | — | Yes |

Lifecycle locks continue to apply after a publication plan is scheduled or submitted.

## Self-hosting and architecture

```text
Next.js 16 / React 19
          │ HTTP JSON API
          ▼
FastAPI / Python 3.11+
          │
          ├── SQLite or PostgreSQL
          ├── Local or S3-compatible media
          ├── OpenAI-compatible AI providers
          └── Official channel APIs
```

| Layer | Default | Production option |
| --- | --- | --- |
| Database | SQLite | PostgreSQL 16+ |
| Media | Local filesystem | AWS S3, Cloudflare R2, MinIO, or another S3-compatible service |
| AI | User-configured OpenAI-compatible provider | Product-area provider overrides |
| Publishing | Disabled scheduler | Authorized official Douyin API |

AI requests send relevant input to the provider you configure. Review provider privacy and retention terms before processing sensitive material.

## Quick start

### Requirements

- Python 3.11+
- Node.js 22.18+
- npm 10+
- FFmpeg and ffprobe when video understanding is enabled

### Clone and configure

```bash
git clone https://github.com/xiaoninemao/Marventa-AI.git
cd Marventa-AI

cp backend/.env.example backend/.env
cp frontend/.env.local.example frontend/.env.local
```

Set a long random `JWT_SECRET` in `backend/.env`. AI credentials can be added when AI-powered features are needed.

### Start

macOS or Linux:

```bash
chmod +x scripts/start-local.sh scripts/stop-local.sh
./scripts/start-local.sh
```

Windows PowerShell:

```powershell
.\scripts\start-local.ps1
```

- Web application: [http://localhost:3000](http://localhost:3000)
- API: [http://localhost:8765](http://localhost:8765)
- API documentation: [http://localhost:8765/docs](http://localhost:8765/docs) when `DEBUG=true`

Stop with `Ctrl+C`, `bash scripts/stop-local.sh`, or `.\scripts\stop-local.ps1`.

## Configuration

The complete environment reference lives in [`backend/.env.example`](backend/.env.example).

### AI providers

```env
AI_API_KEY=your-api-key
AI_BASE_URL=https://your-provider.example/v1
AI_MODEL=your-chat-model
```

Every AI feature uses `AI_*` by default.

| Optional override | Product area |
| --- | --- |
| `MARKET_INSIGHT_AI_*` | Document insight and bounded public research |
| `CASE_LIBRARY_AI_*` | Case analysis, including image input |
| `CONTENT_STUDIO_AI_*` | Conversation, cards, edits, reports, and quality review |
| `LEAD_TRACKING_AI_*` | Comment lead qualification |

Each override requires `*_OVERRIDE_ENABLED=true` plus a complete API key, base URL, and model. A disabled switch always uses `AI_*`. An enabled incomplete override returns a configuration error.

### Images, video, and audio

```env
CONTENT_STUDIO_MULTIMODAL_ENABLED=true
CONTENT_STUDIO_MULTIMODAL_MAX_IMAGES=5
CONTENT_STUDIO_MULTIMODAL_MAX_IMAGE_BYTES=5242880
CONTENT_STUDIO_MULTIMODAL_MAX_TOTAL_BYTES=15728640
CONTENT_STUDIO_MULTIMODAL_MAX_VIDEOS=1
CONTENT_STUDIO_MULTIMODAL_MAX_VIDEO_BYTES=104857600
CONTENT_STUDIO_MULTIMODAL_MAX_VIDEO_SECONDS=300
CONTENT_STUDIO_MULTIMODAL_VIDEO_FRAMES=4

CONTENT_STUDIO_TRANSCRIPTION_ENABLED=false
CONTENT_STUDIO_TRANSCRIPTION_MODEL=
CONTENT_STUDIO_TRANSCRIPTION_MAX_AUDIO_BYTES=26214400
```

The backend validates media limits before provider calls. FFmpeg extracts bounded JPEG keyframes and a temporary mono audio track when transcription is enabled. Temporary files are deleted after processing.

### Bounded public research

```env
INSIGHT_RESEARCH_ENABLED=true
INSIGHT_SEARCH_PROVIDER=tavily
TAVILY_API_KEY=your-search-provider-key
```

Public research has fixed search, page, redirect, context, token, and time budgets. The reader accepts public HTTP(S) on standard ports, validates redirects and resolved addresses, rejects private-network destinations, and treats retrieved text as untrusted evidence.

Sources and quote matches improve traceability. They do not establish factual correctness, completeness, competitor identity, or source independence. Review the resulting claims before use.

### Channel authorization

```env
DOUYIN_CHANNEL_CLIENT_KEY=
DOUYIN_CHANNEL_CLIENT_SECRET=
DOUYIN_CHANNEL_REDIRECT_URI=https://api.example.com/api/v1/publishing/channel-accounts/oauth/douyin/callback

XIAOHONGSHU_CHANNEL_APP_ID=
XIAOHONGSHU_CHANNEL_APP_SECRET=
CHANNEL_CREDENTIAL_ENCRYPTION_KEY=
FRONTEND_BASE_URL=https://app.example.com
```

Channel tokens are encrypted at rest and are never returned to the browser.

Douyin publication requires the officially approved `video.create.bind` capability and matching account authorization. Platform acceptance does not confirm public visibility; moderation and account visibility rules still apply.

Xiaohongshu currently exposes account information but no verified public server-side note-publishing contract. Publication remains disabled until an approved official specification is available. Marventa does not use unofficial signing or cookie automation.

### Scheduler

```env
PUBLISHING_SCHEDULER_ENABLED=false
PUBLISHING_POLL_SECONDS=10
```

The scheduler runs in the backend process and does not depend on an open browser tab. It is disabled by default. Review stored plans before enabling it.

Database claims and heartbeats prevent concurrent workers from publishing the same plan. Interrupted or uncertain requests remain explicit; verify the platform account before retrying a request with an unknown outcome.

### Database and media storage

SQLite and local media are the development defaults:

```env
DATABASE_URL=
MEDIA_STORAGE_BACKEND=local
```

Production deployments can use PostgreSQL 16+ and a private S3-compatible bucket:

```env
DATABASE_URL=postgresql://user:password@database.example.com:5432/marventa

MEDIA_STORAGE_BACKEND=s3
MEDIA_S3_BUCKET=marventa-media
MEDIA_S3_PREFIX=production
MEDIA_S3_REGION=auto
MEDIA_S3_ENDPOINT_URL=
MEDIA_S3_ACCESS_KEY_ID=
MEDIA_S3_SECRET_ACCESS_KEY=
```

Use a unique prefix when installations share a bucket. Keep the bucket private and serve media through short-lived presigned URLs.

Migration utilities:

```bash
cd backend
.venv/bin/python scripts/migrate_sqlite_to_postgres.py --help
.venv/bin/python scripts/migrate_media_to_object_storage.py --help
```

Back up the database and media together. Stop writes during database transfer, validate the destination, and keep the source backup until recovery has been tested.

## Operations

- Back up database records and referenced media as one recovery set.
- Rotate JWT, channel, storage, and provider credentials through deployment secrets.
- Monitor scheduler failures and provider authorization expiry.
- Verify platform state before retrying an uncertain publication request.
- Keep FFmpeg available on workers that process video or audio.
- Review AI provider usage, privacy terms, quotas, and retention policies.

## Development

Backend:

```bash
cd backend
.venv/bin/python -m pytest
```

Frontend:

```bash
cd frontend
npm test
npm run lint
npx tsc --noEmit
npm run build
```

PostgreSQL integration tests require `TEST_POSTGRES_DATABASE_URL`.

## Security

- Replace all example secrets before deployment.
- Use HTTPS for public deployments.
- Grant only required channel scopes.
- Keep object-storage buckets private unless public delivery is intentional.
- Apply database and media retention policies appropriate to the organization.
- Treat model, search, and channel providers as external data processors.

Report vulnerabilities through [GitHub Security Advisories](https://github.com/xiaoninemao/Marventa-AI/security/advisories/new), not public issues.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT — see [LICENSE](LICENSE).
