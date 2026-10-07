<div align="center">

<img src="frontend/public/assets/brand/marventa-logo.png" alt="Marventa AI" width="104" />

# Marventa AI

### Turn marketing knowledge into work your team can build on.

An open-source workspace for market understanding, reusable creative context, content production, publishing, and lead discovery.

**English** · [简体中文](README.zh-CN.md)

[![Website](https://img.shields.io/badge/Website-marventa.tech-7C3AED)](https://marventa.tech)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Python](https://img.shields.io/badge/Python-3.11+-3776AB.svg)](backend/requirements.txt)
[![Next.js](https://img.shields.io/badge/Next.js-16-black.svg)](frontend/package.json)

[Product](#product) · [Capabilities](#capabilities) · [Quick start](#quick-start) · [Configuration](#configuration)

</div>

---

## Product

Marventa AI keeps the context behind marketing work connected:

```text
Research → Understand → Create → Review → Publish → Learn
```

Documents become structured market insight. Cases and materials become reusable creative context. Conversations become editable content cards. Publishing plans connect content to authorized accounts, while account content and comment analysis bring performance and potential demand back into the workspace.

The workspace is organized around projects, permissions, durable versions, and explicit data states—not isolated prompts.

## Capabilities

### Projects and collaboration

- Organize insights, cases, materials, creations, publications, and finished work by project.
- Manage organization and project roles, invitations, creator attribution, and channel-account access.
- Define project brand voice, audience, value proposition, visual direction, and prohibited terms.

### Market Insight

- Analyze Markdown, PDF, DOCX, and repository content for positioning, audience, competitors, use cases, and campaign direction.
- Optionally enrich analysis with bounded public-web research, citations, and explicit limitations.
- Reuse completed insights directly inside Content Studio.

### Case Library and materials

- Collect image, video, text, and supported public-link cases with structured creative analysis.
- Organize reusable images, videos, and editable copy into project material sets.
- Reference selected cases and materials without changing the project originals.

### Content Studio

- Create short-video or image-text concepts from project insight, cases, copy, brand guidelines, and optional visual or audio context.
- Generate five structured cards covering the plan, headlines, copy, hashtags, and visual direction.
- Modify individual cards, restore versions, collaborate with live presence, and generate bilingual reports.
- Check brand conflicts, prohibited terms, repetition, unsupported claims, platform fit, and sensitive promotional language before delivery.

### Multimodal understanding

- Attach up to five JPEG, PNG, or WebP images and one supported video per turn.
- Sample ordered video keyframes with FFmpeg instead of sending the original video.
- Optionally transcribe extracted audio with an OpenAI-compatible transcription model and align timestamped speech with nearby frames.
- Keep temporary media out of stored conversations; cache authorized transcripts to avoid repeated processing.

### Publishing

- Build image or video publication plans from project materials, copy, account, and schedule settings.
- Review scheduled dates in the homepage calendar.
- Autosave editable content, lock submitted plans, retain failures, and safely cancel or reschedule eligible work.
- Publish authorized Douyin content through the optional backend scheduler.

### Account Content and Lead Tracking

- Browse platform-readable content separately from records created through Marventa.
- Review available playback, visibility, galleries, and engagement metrics.
- Maintain an account-level daily Top 50 comment snapshot across linked projects.
- Qualify intent with rules or AI, inspect evidence and suggested actions, and confirm or dismiss leads.

### Portfolio

- Keep completed strategy reports in a dedicated work list.
- Read, preview, and export complete Chinese and English versions as PDF.

## Permissions

Project access is independent from organization role.

| Capability | Project member | Asset creator | Project admin / owner |
| --- | ---: | ---: | ---: |
| View project assets | Yes | Yes | Yes |
| Manage an insight, case, or creation | — | Own work | All project work |
| Edit materials and publication plans | — | Own content | Yes |
| Manage project membership and guidelines | — | — | Yes |

Publication lifecycle locks continue to apply to creators and project managers.

## Architecture

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

Marventa is self-hosted by default. SQLite and local media require no external infrastructure; PostgreSQL and S3-compatible storage are available for production deployments.

AI requests send the relevant input to the provider you configure. Review that provider's privacy and retention terms before processing sensitive material.

## Quick start

### Requirements

- Python 3.11+
- Node.js 22.18+
- npm 10+
- FFmpeg and ffprobe when video understanding is enabled

### Configure

```bash
git clone https://github.com/xiaoninemao/Marventa-AI.git
cd Marventa-AI

cp backend/.env.example backend/.env
cp frontend/.env.local.example frontend/.env.local
```

Set a long random `JWT_SECRET` in `backend/.env`. AI credentials are optional at startup but required for AI-powered analysis and creation.

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

- Web: [http://localhost:3000](http://localhost:3000)
- API: [http://localhost:8765](http://localhost:8765)
- API docs: [http://localhost:8765/docs](http://localhost:8765/docs) when `DEBUG=true`

Stop with `Ctrl+C`, `bash scripts/stop-local.sh`, or `.\scripts\stop-local.ps1`.

## Configuration

The complete configuration reference lives in [`backend/.env.example`](backend/.env.example).

### AI providers

```env
AI_API_KEY=your-api-key
AI_BASE_URL=https://your-provider.example/v1
AI_MODEL=your-chat-model
```

Every AI feature uses `AI_*` unless its product-area override is explicitly enabled.

| Optional override | Product area |
| --- | --- |
| `MARKET_INSIGHT_AI_*` | Document insight and bounded public research |
| `CASE_LIBRARY_AI_*` | Structured case analysis, including images |
| `CONTENT_STUDIO_AI_*` | Conversation, cards, edits, reports, and quality checks |
| `LEAD_TRACKING_AI_*` | Comment lead qualification |

Each override requires its `*_OVERRIDE_ENABLED=true` switch plus a complete API key, base URL, and model. Incomplete enabled overrides fail explicitly; they do not silently use another provider.

### Images, video, and audio

```env
CONTENT_STUDIO_MULTIMODAL_ENABLED=true
CONTENT_STUDIO_MULTIMODAL_MAX_IMAGES=5
CONTENT_STUDIO_MULTIMODAL_MAX_VIDEOS=1
CONTENT_STUDIO_MULTIMODAL_MAX_VIDEO_BYTES=104857600
CONTENT_STUDIO_MULTIMODAL_MAX_VIDEO_SECONDS=300

CONTENT_STUDIO_TRANSCRIPTION_ENABLED=false
CONTENT_STUDIO_TRANSCRIPTION_MODEL=
CONTENT_STUDIO_TRANSCRIPTION_MAX_AUDIO_BYTES=26214400
```

The backend validates media limits, extracts bounded keyframes, and deletes temporary files. Audio transcription is independently opt-in and requires an explicit transcription model.

### Bounded public research

```env
INSIGHT_RESEARCH_ENABLED=true
INSIGHT_SEARCH_PROVIDER=tavily
TAVILY_API_KEY=your-search-provider-key
```

Research is bounded by request, page, context, token, and time budgets. The reader permits public HTTP(S) only, rejects local/private network destinations, treats retrieved pages as untrusted evidence, and preserves citations and limitations. A completed research run means the bounded evidence workflow completed; it does not prove every claim is correct.

### Channel accounts and scheduled publishing

```env
DOUYIN_CHANNEL_CLIENT_KEY=
DOUYIN_CHANNEL_CLIENT_SECRET=
DOUYIN_CHANNEL_REDIRECT_URI=https://api.example.com/api/v1/publishing/channel-accounts/oauth/douyin/callback

XIAOHONGSHU_CHANNEL_APP_ID=
XIAOHONGSHU_CHANNEL_APP_SECRET=
CHANNEL_CREDENTIAL_ENCRYPTION_KEY=
FRONTEND_BASE_URL=https://app.example.com

PUBLISHING_SCHEDULER_ENABLED=false
PUBLISHING_POLL_SECONDS=10
```

- Tokens are encrypted at rest and never returned to the browser.
- Douyin publishing requires the officially approved `video.create.bind` capability and matching account authorization.
- Platform acceptance is not proof of public visibility; moderation still applies.
- The scheduler is disabled by default so an upgrade cannot publish stored plans unexpectedly.
- Xiaohongshu currently exposes account information but no verified public server-side note-publishing contract. Publishing remains disabled until an approved official specification is available; Marventa does not use unofficial signing or cookie automation.

### Storage and database

SQLite and local media are the defaults:

```env
DATABASE_URL=
MEDIA_STORAGE_BACKEND=local
```

Production can use PostgreSQL 16+ and a private S3-compatible bucket:

```env
DATABASE_URL=postgresql://user:password@database.example.com:5432/marventa

MEDIA_STORAGE_BACKEND=s3
MEDIA_S3_BUCKET=marventa-media
MEDIA_S3_REGION=auto
MEDIA_S3_ENDPOINT_URL=
MEDIA_S3_ACCESS_KEY_ID=
MEDIA_S3_SECRET_ACCESS_KEY=
```

Migration utilities:

```bash
cd backend
.venv/bin/python scripts/migrate_sqlite_to_postgres.py --help
.venv/bin/python scripts/migrate_media_to_object_storage.py --help
```

Back up the database and media before migration, stop writes during database transfer, validate the destination, and keep the source backup until recovery has been tested.

## Development

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

PostgreSQL integration tests require `TEST_POSTGRES_DATABASE_URL`.

## Security

- Replace all example secrets before deployment.
- Use HTTPS for public deployments.
- Keep object-storage buckets private unless public delivery is intentional.
- Grant only required channel scopes.
- Back up the database and media together.
- Treat model, search, and platform providers as external processors.

Report vulnerabilities through [GitHub Security Advisories](https://github.com/xiaoninemao/Marventa-AI/security/advisories/new), not public issues.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT — see [LICENSE](LICENSE).
