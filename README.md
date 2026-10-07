<div align="center">

<img src="frontend/public/assets/brand/marventa-logo.png" alt="Marventa AI" width="104" />

# Marventa AI

### Turn marketing knowledge into work your team can build on.

An open-source workspace for research, insight, content creation, materials management, and publishing management.

**English** · [简体中文](README.zh-CN.md)

[![Website](https://img.shields.io/badge/Website-marventa.tech-7C3AED)](https://marventa.tech)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Python](https://img.shields.io/badge/Python-3.11+-3776AB.svg)](backend/requirements.txt)
[![Next.js](https://img.shields.io/badge/Next.js-16-black.svg)](frontend/package.json)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

[Product](#product) · [Workflow](#workflow) · [Capabilities](#capabilities) · [Quick start](#quick-start) · [Configuration](#ai-configuration)

</div>

---

## Product

Marketing work rarely begins with a lack of ideas. It begins with scattered context:

- product knowledge lives across documents and repositories;
- useful examples disappear into bookmarks and chat threads;
- each campaign starts from another blank prompt;
- generated copy is difficult to review, organize, and reuse.

Marventa AI brings that context into a project-centered workspace.

Research becomes structured market insight. Cases become reusable references. Conversations become editable content cards. Final decisions become bilingual reports that remain connected to the project, the people, and the source material behind them.

```text
Research → Understand → Create → Organize materials → Arrange publication → Reuse
```

The result is not another isolated AI response. It is a growing body of marketing knowledge your team can return to.

## Workflow

### Organize

Create a project, invite collaborators, and keep research, media, cases, creations, and finished work in one place.

### Understand

Import product material from Markdown, PDF, Word, or a repository. Turn it into structured positioning, audience, competitor, use-case, and marketing-angle analysis.

Optionally enable a bounded research Agent to search public sources, read pages, and attach traceable evidence and limitations to the analysis.

### Learn from examples

Build a project case library from uploads and supported public links. Analyze hooks, content structure, audience, reusable lessons, strengths, and improvement opportunities.

### Create with context

Reference completed insights and analyzed cases inside Content Studio. Choose a channel and format, then generate a consistent set of plans, headlines, copy, hashtags, and visual direction.

### Refine and deliver

Continue the conversation, edit individual cards, restore earlier versions, and turn approved content into a formal bilingual report with preview and PDF export.

### Organize and publish

Collect reusable images, videos, and copy into project material sets. Build publication plans from those materials, maintain copy with autosave, and schedule authorized Douyin publications when the backend scheduler is enabled.

## Capabilities

### Projects and collaboration

- Organize insights, cases, materials, creations, publications, and finished work by project.
- Manage organization and project roles, invitations, channel-account access, and creator attribution.
- Search, filter, and paginate shared workspaces with clear permission and operation feedback.

### Market Insight

- Turn Markdown, PDF, DOCX, or repository content into structured product, audience, competitor, positioning, and campaign analysis.
- Optionally enrich analysis with bounded public research, traceable sources, quotations, and explicit limitations.
- Reuse completed insights as context in Content Studio.

### Case Library

- Collect image, video, text, and supported public-link examples by project.
- Produce structured analysis of hooks, audiences, marketing angles, strengths, and reusable lessons.
- Favorite and reference selected cases during creation.

### Materials

- Organize images, videos, and editable copy into reusable project material sets.
- Import TXT, Markdown, PDF, and DOCX copy, edit rich text, and preview source media in the workspace.
- Reuse materials in Content Studio and Publishing without changing project originals.

### Content Studio

- Develop short-video or image-text concepts through guided conversations grounded in project insights, cases, copy, and optional image context.
- Generate five structured content cards, refine individual cards, restore earlier versions, and keep a visible activity history.
- Produce bilingual long-form reports and collaborate with live viewer presence.

### Publishing

- Assemble image or video publication plans with ordered media, copy, account, and schedule settings.
- Save work continuously, lock submitted plans, retain failed content, and safely cancel or reschedule eligible plans.
- Publish authorized Douyin content through the optional scheduler with durable execution records.

### Account Content

- Browse platform-readable works separately from records published through Marventa.
- Review galleries, saved videos, official embedded playback, visibility, and available engagement metrics.
- Preserve explicit unavailable, authorization, provider, and demonstration-data states.

### Lead Tracking

- View each channel account once across its linked projects while retaining organization access boundaries.
- Review a daily account-level Top 50 comment snapshot and consistent results across every project binding.
- Qualify intent with rules or AI, inspect evidence and recommended actions, and confirm or dismiss leads.

### Portfolio

- Keep finished strategy reports in a dedicated work list.
- Read, preview, and export complete Chinese and English versions as PDF.

## Permissions

Project access is deliberate and independent from organization role.

| Capability | Project member | Asset creator | Project admin / owner |
| --- | ---: | ---: | ---: |
| View project assets | Yes | Yes | Yes |
| Manage an insight, case, or creation | — | Own work | All project work |
| Edit or delete materials and publication plans | — | Own content | Yes |
| Manage project membership | — | — | Yes |

Organization administrators do not automatically inherit project-management access.
Publication lifecycle locks also apply to creators and project managers.

## Designed for self-hosting

Marventa defaults to SQLite and local uploaded files, with optional PostgreSQL and S3-compatible object storage for production. AI services are connected through your own OpenAI-compatible credentials.

This gives teams control over:

- where project data is stored;
- which model provider is used for each AI task;
- how backups and access policies are managed;
- when material is sent to an external model service.

AI requests still send the relevant input to the configured provider. Review the provider's privacy and retention terms before processing sensitive material.

## Architecture

```text
Next.js 16 / React 19
          │
          │ HTTP JSON API
          ▼
FastAPI
          │
          ├── Market Insight
          ├── Case Library
          ├── Content Studio
          ├── Portfolio
          ├── Materials management
          ├── Publishing management
          └── Organization and project access
          │
          ├── SQLite / PostgreSQL
          ├── Local / S3-compatible media
          └── OpenAI-compatible providers
```

| Layer | Technology |
| --- | --- |
| Frontend | Next.js 16, React 19, TypeScript, Tailwind CSS |
| Backend | FastAPI, Python 3.11+, Pydantic |
| Storage | SQLite or PostgreSQL; local or S3-compatible media |
| AI | OpenAI-compatible Chat Completions endpoints |
| Browser extraction | Playwright Chromium for supported fallback flows |

## Quick start

### Requirements

- Python 3.11+
- Node.js 22.18+
- npm 10+

### 1. Clone and configure

```bash
git clone https://github.com/xiaoninemao/Marventa-AI.git
cd Marventa-AI

cp backend/.env.example backend/.env
cp frontend/.env.local.example frontend/.env.local
```

Set a long random `JWT_SECRET` in `backend/.env`. AI credentials can be added immediately or later; the workspace can start and manage existing content without them.

### 2. Start

macOS or Linux:

```bash
chmod +x scripts/start-local.sh scripts/stop-local.sh
./scripts/start-local.sh
```

Windows PowerShell:

```powershell
.\scripts\start-local.ps1
```

The startup scripts prepare the Python environment, install dependencies, download Playwright Chromium, and start both services.

- Web application: [http://localhost:3000](http://localhost:3000)
- API: [http://localhost:8765](http://localhost:8765)
- API documentation: [http://localhost:8765/docs](http://localhost:8765/docs), when `DEBUG=true`

### 3. Stop

Press `Ctrl+C` in the macOS/Linux startup terminal, or run:

```bash
bash scripts/stop-local.sh
```

Windows:

```powershell
.\scripts\stop-local.ps1
```

## Channel authorization

Project integrations use each platform's official account-authorization flow:

- Douyin uses Web OAuth with a server callback.
- Xiaohongshu web applications use the official device flow with a QR code and backend polling.
- Tokens are encrypted at rest with a dedicated Fernet key and are never returned to the browser.

```env
DOUYIN_CHANNEL_CLIENT_KEY=
DOUYIN_CHANNEL_CLIENT_SECRET=
DOUYIN_CHANNEL_REDIRECT_URI=https://api.example.com/api/v1/publishing/channel-accounts/oauth/douyin/callback

XIAOHONGSHU_CHANNEL_APP_ID=
XIAOHONGSHU_CHANNEL_APP_SECRET=
XIAOHONGSHU_CHANNEL_CLIENT_NAME=Marventa AI

FRONTEND_BASE_URL=https://app.example.com
CHANNEL_CREDENTIAL_ENCRYPTION_KEY=
```

Generate `CHANNEL_CREDENTIAL_ENCRYPTION_KEY` with:

```bash
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

The current public Xiaohongshu account platform exposes `basic_info` but not public
note-publishing access. Douyin publishing requires a separately approved capability and
must be authorized at publishing time. Connecting an account does not claim either
publishing permission.

## Scheduled publication

Review existing scheduled plans before enabling the scheduler in the backend environment:

```env
PUBLISHING_SCHEDULER_ENABLED=true
PUBLISHING_POLL_SECONDS=10
```

Restart the backend after changing configuration. The scheduler runs while the backend is running, independent of browser tabs. It is disabled by default to prevent an upgrade from unexpectedly publishing stored plans.

- **Douyin image/video publishing:** requires application approval for the `video.create.bind` capability and a real account authorized for that scope. Configure the OAuth client and Fernet key above. Virtual accounts have no platform credentials and are never used for publishing requests. Expired authorization requires reconnection.
- The adapter uses the official [video upload/create](https://developer.open-douyin.com/docs/resource/zh-CN/dop/develop/openapi/video-management/douyin/create-video/video-create) and [image upload/create](https://developer.open-douyin.com/docs/resource/zh-CN/dop/develop/openapi/video-management/douyin/create-image-text/create-image-text) APIs. Images are uploaded in saved order. Combined title, body, and tags must fit 1,000 characters; image posts allow up to 30 images and 20 MB per image. The material library itself remains unlimited.
- Successful platform creation stores both `item_id` and the creation `video_id`, records the time, and locks the plan on both server and client. Creation acceptance is **not proof of public visibility**: platform moderation still applies.
- Failures record a readable reason without credentials and allow manual scheduling again. Database claims and heartbeats prevent simultaneous workers from publishing the same plan. Interrupted requests are recovered as failures, not automatically resubmitted. If creation times out or its result is unclear, verify the platform account before retrying to avoid duplicates.
- **Xiaohongshu limitation:** the official [scope documentation](https://openaccount.xiaohongshu.com/docs/scope) currently lists `write_notes` as planned and only opens `basic_info`. No verified public server-side creator upload/create contract is available. Xiaohongshu is disabled in the publication channel selector; existing plans remain viewable but must switch to Douyin before saving settings again. Account integrations are retained. Existing scheduled Xiaohongshu plans fail explicitly without a platform request; this implementation does not invent endpoints or use unofficial signing/cookie automation. A verified partner publishing specification is required to add that adapter.

## Object storage

Local media remains the default for development. Production deployments can switch
avatars, case media, project materials, publication snapshots, and market-insight source files to any S3-compatible
service, including AWS S3, Cloudflare R2, and MinIO.

```env
MEDIA_STORAGE_BACKEND=s3
MEDIA_S3_BUCKET=marventa-media
MEDIA_S3_PREFIX=production
MEDIA_S3_REGION=auto
MEDIA_S3_ENDPOINT_URL=https://<account-id>.r2.cloudflarestorage.com
MEDIA_S3_ACCESS_KEY_ID=
MEDIA_S3_SECRET_ACCESS_KEY=
MEDIA_S3_ADDRESSING_STYLE=path
MEDIA_S3_PRESIGNED_TTL_SECONDS=900
```

- For AWS S3, set the AWS region and leave `MEDIA_S3_ENDPOINT_URL` empty.
- For Cloudflare R2, use region `auto` and the account-specific S3 endpoint.
- For MinIO, use its endpoint URL and the addressing style required by the deployment.
- Keep the bucket private. Marventa redirects media requests to short-lived presigned
  URLs. `MEDIA_S3_PUBLIC_BASE_URL` is optional for intentionally public buckets/CDNs.
- Use a unique `MEDIA_S3_PREFIX` when multiple installations share one bucket.

Existing local files can be copied without database changes because object keys preserve
their current relative paths:

```bash
cd backend
.venv/bin/python scripts/migrate_media_to_object_storage.py --dry-run
.venv/bin/python scripts/migrate_media_to_object_storage.py
```

The migration uploads and verifies every object but retains local files. Remove local
media only after the application has been validated against object storage.

## Production database

**v1.2.0 PostgreSQL notice:** the original tag has a publishing-schema initialization issue that can fail or block requests. SQLite is unaffected. The corrective changes are verified against PostgreSQL 16 and included in [v1.2.1](https://github.com/xiaoninemao/marventa-ai/releases/tag/v1.2.1); PostgreSQL deployments should use v1.2.1 or later. The v1.2.0 tag has not been rewritten.

Retired publishing-task, metric, review, global social-account, and account-memory CRUD implementations have been removed. Historical tables remain for migration, organization cleanup, and administrative export compatibility; cleanup does not delete existing stored records. Current project accounts and scheduled-publication APIs are unchanged.

SQLite remains the zero-configuration default:

```env
DATABASE_URL=
```

Production and multi-instance deployments can use PostgreSQL 16+:

```env
DATABASE_URL=postgresql://marventa:password@database.example.com:5432/marventa
```

The same application storage modules support both backends. PostgreSQL uses native
transactions, foreign keys, scoped triggers, identity columns, and conflict handling.
The database URL is a deployment secret and must not be committed.

To move an existing installation, create an empty PostgreSQL database, stop application
writes, back up SQLite and media, then run:

```bash
cd backend
.venv/bin/python scripts/migrate_sqlite_to_postgres.py \
  --sqlite-path data/market_insight.db \
  --database-url 'postgresql://marventa:password@host:5432/marventa'
```

Preview the source table counts without connecting to PostgreSQL:

```bash
.venv/bin/python scripts/migrate_sqlite_to_postgres.py \
  --sqlite-path data/market_insight.db \
  --database-url 'postgresql://unused' \
  --dry-run
```

The destination must be empty. The migration initializes the PostgreSQL schema, copies
tables in dependency order, and verifies every table's row count before reporting
success. Keep the SQLite backup until the PostgreSQL deployment has been validated.

## AI configuration

```env
AI_API_KEY=your-api-key
AI_BASE_URL=https://your-provider.example/v1
AI_MODEL=your-chat-model

# Example: route Case Library analysis to a vision-capable alternative.
CASE_LIBRARY_AI_OVERRIDE_ENABLED=true
CASE_LIBRARY_AI_API_KEY=your-alternative-key
CASE_LIBRARY_AI_BASE_URL=https://your-vision-provider.example/v1
CASE_LIBRARY_AI_MODEL=your-vision-capable-model

JWT_SECRET=replace-with-a-long-random-string
```

| Configuration | Purpose |
| --- | --- |
| `AI_*` | Unified default used by every AI feature |
| `MARKET_INSIGHT_AI_*` | Optional provider for document insight and its public-research Agent |
| `CASE_LIBRARY_AI_*` | Optional provider for structured case analysis, including image inputs |
| `CONTENT_STUDIO_AI_*` | Optional provider shared by conversation, content cards, card modification, and report generation |
| `LEAD_TRACKING_AI_*` | Optional provider for comment lead qualification |

Each alternative has an `*_OVERRIDE_ENABLED` switch, which defaults to `false`. A disabled switch always uses `AI_*`, even when alternative values are present. An enabled switch requires its API key, base URL, and model; incomplete alternatives fail explicitly and never fall back silently. Use an OpenAI-compatible API base URL rather than the full `/chat/completions` path. Models must support the request parameters and structured JSON used by the selected feature. Image analysis additionally requires `image_url` input support.

Content Studio image context is opt-in:

```env
CONTENT_STUDIO_MULTIMODAL_ENABLED=true
CONTENT_STUDIO_MULTIMODAL_MAX_IMAGES=5
CONTENT_STUDIO_MULTIMODAL_MAX_IMAGE_BYTES=5242880
CONTENT_STUDIO_MULTIMODAL_MAX_TOTAL_BYTES=15728640
CONTENT_STUDIO_MULTIMODAL_MAX_VIDEOS=1
CONTENT_STUDIO_MULTIMODAL_MAX_VIDEO_BYTES=104857600
CONTENT_STUDIO_MULTIMODAL_MAX_VIDEO_SECONDS=300
CONTENT_STUDIO_MULTIMODAL_VIDEO_FRAMES=4
```

When enabled, current-turn JPEG, PNG, and WebP materials are sent as bounded `image_url` content. One MP4, MOV, WebM, or M4V material up to 100 MB and five minutes is converted by backend FFmpeg into four ordered JPEG keyframes; the original video and audio are not sent to the model, and audio is not transcribed. Regeneration and content-card generation rebuild the latest user turn's visual inputs from authorized material references. Stored messages retain text and reference IDs, not base64 images or extracted frames. FFmpeg and ffprobe are required on the backend host.

### Optional bounded market research

Market insight keeps uploads, repositories, project permissions, history and the selected
output language. By default it produces a document-based summary, **not verified market
research**. To opt into public-web research, configure:

```env
INSIGHT_RESEARCH_ENABLED=true
INSIGHT_SEARCH_PROVIDER=tavily
TAVILY_API_KEY=your-search-provider-key
```

The effective Market Insight model must support OpenAI-compatible function tool calls when public research is enabled.
A single adaptive loop uses the selectable search-provider interface (initial adapter:
Tavily HTTP) and reads returned pages; no multi-agent framework or guessed fallback search
is used. The tool-enabled model sees only a fixed public category label, never uploaded
raw text, private product names or extracted document excerpts. Searches can therefore
be generic; the server constructs queries from that category and allowlisted intent
terms only (competitors, comparison, alternatives, pricing, features, deployment,
enterprise, open source), never arbitrary model text, product names or repository URLs.
Review competitor relevance. Uploaded text is still sent to your configured
AI provider for the existing document analysis and tool-free final synthesis. Web text
is untrusted evidence, not instructions.

Hard ceilings are 6 searches, 12 page reads, 12 tool-planning turns and 180 research
seconds, within the existing 600-second claimed worker deadline. Requested research
output tokens are capped at 16,000 (plus the existing 4,096-token document summary);
research model context is capped at 48 KB of JSON with bounded evidence excerpts;
page text is capped at 4,000 characters and 512 KB per response, with at most 3 redirects.
The reader permits public HTTP(S) on standard ports only, validates every redirect and
all DNS answers, pins the actual socket to a validated IP, verifies HTTPS host certificates,
and rejects credentials, private addresses, compressed responses and unsupported types.
No browser execution, JavaScript, authentication cookies or local-network fetch is used.
Lease loss stops subsequent outgoing calls; in-flight calls have bounded timeouts and
stale workers cannot publish results.

`AIAnalysis.research` is optional for old records and persisted in the existing JSON:

```text
{status: completed|partial|unavailable|edited,
 sources: [{id,title,url:string|null,kind:web|document,retrieved_at,excerpt}],
 claims: [{id,text,kind:fact|inference,source_ids,quote}],
 competitors: [{name,comparison,source_ids}],
 limitations: string[], searched_at: string|null}
```

Only successfully retrieved, validated pages become web sources; search snippets and
model-authored URLs do not. Claim references and literal quote containment are checked
against bounded retrieved text. **These checks do not prove factual correctness,
completeness, competitor identity, or independence of sources.** `completed` means the
bounded evidence pipeline completed, not that every statement is true.
Completion requires at least two actually retrieved web pages, a public-web claim with
a matching literal cited quote, and a supported competitor comparison; search snippets,
document-only claims and empty model lists cannot satisfy it.
Missing configuration, failed search/reads or unsupported tool calls report `unavailable`; incomplete budgets,
discarded citations or failed synthesis report `partial` with limitations. Invalid summary
JSON fails the analysis rather than becoming a successful blank result. A document-only
summary may still complete the existing history job while research is unavailable.
Human edits are marked `edited` server-side, preserving only previously stored evidence
and invalidating its applicability to the edited summary. Manual-created insights cannot
run AI analysis or retry and have no research metadata/UI; server-side creation, edits
and renames discard any client-supplied research. Retry of document insights explicitly
runs a new claimed attempt.

Offline backend regression tests (no provider requests):

```bash
cd backend
.venv/bin/python3.12 -m unittest tests.test_insight_research tests.test_research_web \
  tests.test_market_insight_language tests.test_market_insight_recovery
```

## Repository layout

```text
Marventa-AI/
├── backend/
│   ├── app/                 # API, authentication, storage, and engines
│   ├── scripts/             # Storage integrity, backup, and audit tools
│   └── tests/               # Backend regression tests
├── frontend/
│   ├── public/              # Local interface assets
│   └── src/                 # Next.js application
└── scripts/                 # Cross-platform development scripts
```

Runtime databases, uploads, logs, browser state, and environment files are excluded from version control.

## Development

Backend:

Set `TEST_POSTGRES_URL` only to a disposable test database: the integration tests recreate its `public` schema.

```bash
PYTHONPATH=backend:backend/tests backend/.venv/bin/python -m unittest discover -s backend/tests
backend/.venv/bin/python -m ruff check --select F,RUF100,B012,B018 backend/app backend/tests
backend/.venv/bin/python -m vulture backend/app --min-confidence 80
backend/.venv/bin/python -m pip check
```

Frontend:

```bash
cd frontend
npm ci
npm run lint
npx tsc --noEmit
npm test
npm run build
```

Dialog actions follow one convention: confirmation forms place Cancel immediately to the left of the primary action, without a close icon; previews use an accessible close icon, without Confirm or Cancel. View/edit dialogs switch between these patterns. The channel authorization introduction uses borderless Back + Connect instead of a redundant Cancel. New dialogs must be included in the [dialog action regression inventory](frontend/src/utils/dialog_actions.test.ts).

## Security

Do not commit environment files, API keys, browser profiles, cookies, customer material, or production logs. Public deployments should use a strong `JWT_SECRET`, `DEBUG=false`, HTTPS, appropriate access controls, and a tested backup policy.

Report vulnerabilities privately according to [SECURITY.md](SECURITY.md).

### Dependency maintenance

Keep `next` and `eslint-config-next` on matching patched releases. Apply compatible dependency updates, then rerun tests, type checking, lint, and the production build before deployment. Check both the full dependency tree and production dependencies:

```bash
cd frontend
npm audit
npm audit --omit=dev
```

Development-tool advisories are reported separately, not treated as fixed or hidden. Avoid `npm audit fix --force` when it proposes an incompatible framework or lint-config downgrade. Track unresolved upstream advisories and rebuild/restart the frontend after updating the lockfile.

As of v1.4.1, the official upstream `source-map-js@1.2.2` release archive is pinned locally because the configured npm proxy has not published the patched version. A root dependency plus npm override makes Next.js, PostCSS, and Tailwind use the same fixed package; provenance and SHA-256 are recorded under `frontend/vendor/`. `npm audit --omit=dev` reports zero vulnerabilities. The full audit still reports five high-severity development-only entries in the ESLint/fast-glob/micromatch/braces chain; no incompatible downgrade or audit suppression is applied.

## Contributing

Focused issues and pull requests are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md) before contributing.

## License

Marventa AI is released under the [MIT License](LICENSE).
