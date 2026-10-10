<div align="center">

<img src="frontend/public/assets/brand/marventa-logo.png" alt="Marventa AI" width="104" />

# Marventa AI

### Turn marketing knowledge into work your team can build on.

An open-source workspace for market understanding, agent-driven creation, publishing operations, and lead discovery.

**English** · [简体中文](README.zh-CN.md)

[![Website](https://img.shields.io/badge/Website-marventa.tech-7C3AED)](https://marventa.tech)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Python](https://img.shields.io/badge/Python-3.11+-3776AB.svg)](backend/requirements.txt)
[![Next.js](https://img.shields.io/badge/Next.js-16-black.svg)](frontend/package.json)

[Overview](#overview) · [Workflow](#workflow) · [Capabilities](#capabilities) · [Quick start](#quick-start) · [Configuration](#configuration)

</div>

## Overview

Marketing teams work with product documents, campaign examples, images, videos, drafts, publishing records, and customer feedback. Marventa organizes these resources around projects so teams can use the same knowledge throughout research, creation, delivery, and review.

```text
Research → Understand → Plan → Create → Publish → Learn
```

Content Studio brings agents into this workflow. They can clarify a goal, develop a plan, read project references, call tools, and assemble a work through conversation. Brand guidance and reusable sources support their decisions; people review the output and control delivery.

Teams can build shared product understanding, develop creative directions, keep independent works and versions, and use channel feedback in subsequent campaigns. Self-hosting gives teams control over their data, AI providers, and storage.

## Workflow

### 1. Organize the project

Create a project for a product, campaign, account, or content program. Invite collaborators and keep insights, cases, materials, creations, publication plans, and saved works within the project.

Project owners and administrators define brand voice, audience, value proposition, visual direction, and prohibited terms in Guidelines. These settings autosave and guide Content Studio work.

### 2. Build market understanding

Import Markdown, PDF, DOCX, or repository content. Market Insight produces structured analysis of positioning, audiences, competitors, use cases, strengths, and campaign directions. Optional public research adds sources and citations with explicit limitations.

### 3. Prepare creative references

Study image, video, text, and supported public-link cases. Case analysis identifies hooks, audience fit, marketing angles, content structure, and reusable lessons.

Organize images, videos, and editable copy into material sets. Reference those assets during creation and retain their project ownership and permissions.

### 4. Create with agents

Use conversation to explore a direction, request a plan, or execute a creative task. Chat, Plan, and Action agents coordinate around the selected mode and goal.

Agents read relevant brand guidelines, insights, cases, and materials, then use available tools to generate or import media and assemble a work. Streamed replies and tool activity show progress. Background tasks support cancellation and recovery when the page is reopened.

Review the media, title, copy, and tags in the work canvas. Refine the result through conversation, reference an individual image for replacement, or preview and restore a previous version.

### 5. Save and refine works

Save the result to Portfolio, where media is kept as an independent copy. Edit the content, reorder images, replace media, or create a named image/video work manually.

Media-only works can be completed. Copy-only works remain editable drafts; every publishable work requires media.

### 6. Publish and learn

Create a named publication draft, select a completed Portfolio work, then configure the channel, connected account, and time in Publication settings. The plan holds an independent media/copy snapshot. The homepage calendar links scheduled dates to publication plans.

Account Content displays available channel works and Marventa publication records. Lead Tracking summarizes daily comments and identifies potential demand with evidence and suggested actions.

## Capabilities

### Projects and collaboration

- Shared project assets, organization boundaries, and project-specific roles.
- Invitations, member management, creator attribution, and manager-controlled guidelines.
- Search, type/status filters, pagination, and explicit operation feedback.

### Market Insight

- Document and repository analysis covering product, audience, competitors, and positioning.
- Optional bounded public research with sources, quotations, and limitations.
- Editable results that can be referenced in Content Studio.

### Case Library and Materials

- Image, video, text, and supported public-link cases with structured analysis.
- Material sets containing media and editable copy; TXT, Markdown, PDF, and DOCX import.
- Rich-text editing, media previews, favorites for cases, and project-scoped reuse.

### Agent-driven Content Studio

- **Chat:** communicate, clarify goals, and identify missing information.
- **Plan:** compare directions and produce an executable creative plan.
- **Action:** use tools to generate/import media and assemble works.
- Automatic coordination with separate planning and creation modes.
- Project references, brand constraints, multimodal context, and live viewer presence.
- Streamed responses, visible tool activity, durable task recovery, and cancellation.
- Image/copy works and existing-video works with scripts and storyboards.
- Targeted image editing with actual reference images, work history, and version restoration.

Image generation uses a separately configured provider. Video works can use existing media; native video generation is currently unavailable.

### Portfolio

- Named image/video works with independent media, content titles, copy, and tags.
- Material selection and local upload, ordered images, and single-video replacement.
- Media/copy previews and conflict checks for concurrent edits.
- Media-only completed works and copy-only drafts.

### Publishing

- Draft-first creation, completed-work selection, and separate publication settings.
- Independent read-only snapshots with the saved media order and content.
- Lifecycle locks for scheduled, publishing, and published plans.
- Cancellation, rescheduling, failure feedback, and durable execution records.
- Optional official Douyin publication through a backend scheduler.

### Account Content and Lead Tracking

- Channel-account browsing, media galleries, available interaction metrics, and pagination.
- Separate platform-readable content and Marventa publication records.
- One lead-tracking account across linked projects within an organization.
- Daily Top 50 comment snapshots, rule-based or AI-assisted qualification, and human review.
- Evidence, recommended actions, confirmation, dismissal, and reset.

### Multimodal understanding

Content Studio can use up to five JPEG/PNG/WebP images and one video per turn. Video understanding uses ordered keyframes; optional audio transcription adds timestamped speech context and material-level caching.

The backend validates media limits and removes temporary files. Conversations retain text and reference identifiers; temporary base64 images, audio, and extracted frames are not stored as message content.

## Permissions and result states

Project access is independent from organization role.

| Capability | Project member | Asset creator | Project admin / owner |
| --- | ---: | ---: | ---: |
| View project assets | Yes | Yes | Yes |
| Manage insights, cases, and creations | — | Own work | All project work |
| Edit materials and publication plans | — | Own content | Yes |
| Manage members and guidelines | — | — | Yes |

Publication lifecycle locks apply to creators and managers. Real platform data, demonstration data, unavailable capabilities, and failures have distinct states. Virtual accounts do not publish; provider errors remain visible. Platform acceptance and public visibility are separate outcomes.

AI-generated analysis, research, and creative output require human review. Exact configured prohibited-term matches are enforced by the server; model output does not establish factual accuracy, legal clearance, or platform approval.

## Self-hosting and architecture

```text
Next.js 16 / React 19
          │ HTTP JSON API
          ▼
FastAPI / Python 3.11+
          ├── Agent workers and publication scheduler
          ├── SQLite or PostgreSQL
          ├── Local or S3-compatible media
          ├── Configured AI providers
          └── Official channel APIs
```

SQLite and local media are the defaults. Production installations can use PostgreSQL 16+ and private AWS S3, Cloudflare R2, MinIO, or other S3-compatible storage.

AI requests send relevant input to your configured provider. Review its privacy, retention, and usage terms before processing sensitive material.

## Quick start

Requires Python 3.11+, Node.js 20+, and npm 10+. Install FFmpeg and ffprobe for video/audio processing.

```bash
git clone https://github.com/xiaoninemao/marventa-ai.git
cd marventa-ai
cp backend/.env.example backend/.env
cp frontend/.env.local.example frontend/.env.local
```

Set a long random `JWT_SECRET` in `backend/.env`, then configure AI credentials as needed.

**macOS / Linux**

```bash
bash scripts/start-local.sh
```

**Windows PowerShell**

```powershell
.\scripts\start-local.ps1
```

- Web application: [localhost:3000](http://localhost:3000)
- Backend: [localhost:8765](http://localhost:8765)
- API documentation: [localhost:8765/docs](http://localhost:8765/docs) when `DEBUG=true`

Stop with `Ctrl+C`, `bash scripts/stop-local.sh`, or `.\scripts\stop-local.ps1`.

## Configuration

Full settings and defaults: [backend environment template](backend/.env.example) and [frontend environment template](frontend/.env.local.example).

### AI providers

```env
AI_API_KEY=your-api-key
AI_BASE_URL=https://your-provider.example/v1
AI_MODEL=your-chat-model
```

AI features use `AI_*` by default. Optional `MARKET_INSIGHT_AI_*`, `CASE_LIBRARY_AI_*`, `CONTENT_STUDIO_AI_*`, and `LEAD_TRACKING_AI_*` overrides each require their explicit enable switch and complete credentials.

Content Studio's conversation model must support tool calls and structured output. Its image tool uses independent `CONTENT_STUDIO_IMAGE_*` settings and an OpenAI-compatible generation/editing provider. Reference editing requires the corresponding image-edit protocol; unsupported requests fail explicitly.

### Media and Agent runtime

- `CONTENT_STUDIO_MULTIMODAL_*`: image/video understanding and bounded media input.
- `CONTENT_STUDIO_TRANSCRIPTION_*`: optional audio transcription.
- `CONTENT_STUDIO_JOB_*`: worker count, task timeout, and bounded retries.
- `CONTENT_STUDIO_SEEDREAM_*` / `CONTENT_STUDIO_SEEDANCE_*`: reserved image/video provider settings; native adapters are not connected.

Task and progress observation uses one serial adaptive polling stream per session. Background workers provide recovery and cancellation; per-model timing records support latency diagnosis. Failed media-producing tasks need explicit retry to avoid repeated paid generation.

### Research, authorization, and publishing

Public research uses `INSIGHT_RESEARCH_*`, `INSIGHT_SEARCH_PROVIDER`, and provider credentials. Search and page reading have fixed budgets and preserve source limitations.

Configure `DOUYIN_CHANNEL_*`, `CHANNEL_CREDENTIAL_ENCRYPTION_KEY`, and `FRONTEND_BASE_URL` for channel authorization. Tokens are encrypted and are not returned to the browser. Douyin publishing needs approved `video.create.bind` capability and account authorization.

`PUBLISHING_SCHEDULER_ENABLED=false` is the default. Review stored plans before enabling it. The scheduler runs in the backend and uses database claims and heartbeats. Verify platform state before retrying an uncertain publication. Xiaohongshu publishing remains disabled.

### Database and media

Use `DATABASE_URL` for PostgreSQL and `MEDIA_STORAGE_BACKEND=s3` with `MEDIA_S3_*` for object storage. Keep buckets private and use separate prefixes for installations.

Migration utilities:

```bash
cd backend
.venv/bin/python scripts/migrate_sqlite_to_postgres.py --help
.venv/bin/python scripts/migrate_media_to_object_storage.py --help
```

## Operations and development

Back up database records and media together. Stop writes during transfers, validate recovery, rotate credentials through deployment secrets, and monitor worker health, authorization expiry, and provider quotas.

Backend tests:

```bash
cd backend
.venv/bin/python -m pytest
```

Frontend checks:

```bash
cd frontend
npm test
npm run lint
npx tsc --noEmit
npm run build
```

PostgreSQL integration tests use a dedicated `TEST_POSTGRES_URL` database. See the [database CI workflow](.github/workflows/backend-databases.yml).

## Contributing

Issues and pull requests are welcome. Include reproduction steps and relevant test results for behavior changes. Report sensitive security issues privately through the repository's available reporting channels.

## License

[MIT License](LICENSE).
