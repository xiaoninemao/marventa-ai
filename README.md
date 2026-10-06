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

### Project workspaces

- Explicit project membership and roles
- Workspace actions explain unmet requirements, permission restrictions, editing locks, and pending operations through localized toasts instead of gray controls; action guards and server validation remain enforced.
- Chinese and English action captions use shared concise verbs and consistent progress labels; contextual headings and accessible descriptions retain the details needed to identify the action.
- Project-bound insights, cases, creations, media, and portfolio work
- Platform-authorized Xiaohongshu and Douyin account connections at project level; disconnecting an account requires confirmation.
- Creator attribution and project-aware permissions
- Searchable project navigation across the core workflow
- Project, Case Library, Content Studio, Portfolio, Publishing, and Organization lists include page navigation, totals, and page-size selection in a bottom-aligned, sticky footer. Searches and filters reset the page, and deleting the last item on a page returns to a valid page. The home dashboard remains a five-project preview.

### Materials management

- Project material sets organize images, videos, and editable rich-text copy, with real-media collage covers and in-app previews.
- Upload media or import one TXT, Markdown, PDF, or DOCX document at a time as editable copy. Imports retain readable text and supported formatting, not embedded images or complex page layouts; textless PDFs require OCR and are not supported.
- Write and edit rich-text copy with safe, isolated previews. New copy titles come from the first sentence or non-empty line; editing the body does not change its title.
- Rename and delete collections or individual materials without replacing existing files. Collection names are unique; duplicate filenames receive numeric suffixes.
- Repeated file selections are detected, and original project materials remain independent of publication snapshots.

### Publishing management

- Create and rename project-scoped plans, then manage image or single-video media alongside a plain-text publication title and body.
- Large image previews support insertion-based drag ordering; videos use a full-width player with controls and uncropped playback. Material imports are batched, and platform limits still apply.
- Media changes save immediately. Title/body edits and imported copy autosave, with visible progress, failure recovery, and protection against older requests overwriting newer edits.
- Publication settings select the channel, account, date, and time. A complete local date/time is required, with dates strictly after today. Scheduled content and settings are read-only; cancel the scheduled publication before making changes.
- Cancel an existing scheduled publication or arrange a cancelled/failed plan again without deleting its content.
- An opt-in backend scheduler uploads and creates Douyin image/video posts through official APIs, records platform results, and protects against duplicate execution.
- Publishing and published plans lock content and settings on both server and client. Failures retain content and explain how to retry; uncertain outcomes require checking the platform first.

See [Scheduled publication](#scheduled-publication) for activation, authorization requirements, platform limits, and Xiaohongshu availability.

### Account Content

- Image-text works support a compact gallery with image counts, thumbnails, and previous/next controls. Workspace publication images retain their saved order. The current platform contract returns a cover only, so a full platform gallery is not inferred from it.
- Workspace media URLs follow the backend address, including local HTTP development. Third-party platform media and share links still require public HTTPS URLs.
- Saved through-Marventa video records support direct playback with native controls and no autoplay. A platform `share_url` remains a webpage link, not a playable media URL; platform direct playback is not inferred from it.
- Public Douyin videos with a verified video ID can load the [official iframe player](https://developer.open-douyin.com/docs/resource/zh-CN/dop/develop/openapi/video-management/douyin/iframe-player/get-iframe-by-video) on click. The backend calls `GET /api/douyin/v1/video/get_iframe_by_video` without forwarding account credentials, extracts only an allowlisted player URL, and never injects provider HTML. Playback remains opt-in with autoplay disabled; this is embedded playback, not an MP4/HLS URL. The player API documents no extra permission application, while obtaining account works still requires `video.list` approval and authorization.
- Platform account reading and embedded playback have automated contract coverage but have not yet been validated against a real authorized account in this development environment.
- The verified list, video-detail, and basic-statistics contracts do not expose collection counts, complete gallery URLs, or a separate body field. These remain unavailable for platform records rather than guessed or inferred. Other restricted capabilities require separately verified applicable contracts and approval.
- Content details display the title separately from the body. Workspace publication records use the saved copy title and content; the current platform contract only provides a title, which is preserved without splitting it into an invented body.
- Content details show views, likes, comments, and shares in centered groups below the media preview. Unavailable metrics display `—`, not zero. Favorites are omitted because the verified platform contract does not supply them.

- Choose a channel, then a connected account through the navigation entry below Publishing. Switching channels clears the account selection and pagination. Every account selection reloads the first page, including reselecting the same account.
- Content-source selection is included in the URL, so bookmarked account/project views retain platform works or published-here records after refresh.
- Persisted platform-work simulations are stored separately and are available only on explicitly synthetic, credential-free accounts. Cards and details label them **Demo data**; no live platform request, share link, or official player is used. They do not replace authorization errors or provider results for real accounts.
- Platform works use Douyin's documented `video.list` read capability, including returned video and gallery entries. This older official contract is limited to four pages and is not a complete account archive; current application approval and coverage of newer formats must be confirmed with the platform.
- Keep platform results separate from **Published here**, which shows only through-Marventa records accepted by the platform, not proof of public visibility.
- Scope every request to the current organization and project membership. Unsupported platforms, expired authorization, missing read permissions, and provider errors remain explicit.
- To enable authorized Douyin reads, obtain application approval for `video.list`, add it to `DOUYIN_CHANNEL_SCOPES` (alongside existing approved scopes), and reauthorize the account. The existing default scope is unchanged. No unofficial Xiaohongshu scraping is used.

### Lead Tracking

- The first-level workspace groups accessible bindings by channel identity, showing the same platform account once with all associated projects. It retains project navigation, account/project search, channel filters, and shared pagination.
- Opening a grouped account uses a project binding only to authorize access to the account workspace. Within one organization, verified works, daily comment snapshots, Top 50 results, AI analysis, and human-review state are shared by stable platform-account identity, so the scheduler synchronizes and analyzes that account only once.
- Comment Insights and Lead Analysis are separate account-scoped tabs. When comment sync is enabled, the backend runs at 00:00 in the configured IANA timezone, stores the previous local calendar day's accessible comments, and displays a deterministic Top 50 ranked by `likes + replies × 2`, then newest comment and comment ID. Partial and unavailable snapshots remain explicit.
- A successful daily comment sync automatically runs Lead Analysis, producing a 0–100 intent score, high/medium/low intent, demand labels, scoring evidence, and a recommended action. Operators can mark each result confirmed, dismissed, or pending. `LEAD_TRACKING_ANALYSIS_MODE=rules` keeps analysis local and deterministic; explicitly selecting `ai` sends bounded batches to the configured `CASE_AI_*` OpenAI-compatible provider and identifies the model in the UI. Provider payloads omit commenter, account, and project identifiers, and every response must pass strict JSON, fixed-enum, and complete-ID-set validation. Refreshing the source snapshot invalidates stale same-day analysis, while rerunning analysis preserves reviews for comments that still exist. Any failed AI batch fails the whole analysis explicitly and never silently falls back to rules.
- Comment sync is opt-in (`LEAD_TRACKING_SYNC_ENABLED=true`) and requires approved `item.comment` access plus account reauthorization. It only follows verified works registered after successful official account-content reads, with bounded pages/comments and idempotent snapshots. Lead analysis does not infer phone numbers, private messaging identities, real-world identity, or conversion outcomes; persisted demonstrations remain explicitly labeled as simulated data.

### Market Insight

- Markdown, PDF, DOCX, and repository parsing
- An opt-in research Agent performs bounded public search and page reading before synthesis, with traceable sources, quoted evidence, and explicit analytical inferences. See [Optional bounded market research](#optional-bounded-market-research) for configuration, privacy boundaries, and limits.
- Research reports completed, partial, unavailable, or edited states honestly. Reference and quote checks establish provenance, not factual correctness; missing provider configuration does not become a successful empty research result.
- Structured product and market analysis
- AI-generated results are read-only in the interface; authorized users can still edit manually created insights.
- Analysis follows the selected interface language, with status refresh, interruption recovery, and safe manual retries.
- Background processing with clear completion and failure states
- Direct use of completed insights as creative context

### Case Library

- Image, video, text, and supported public-link imports
- Background enrichment of publicly available metadata
- On-demand structured AI analysis
- Analysis follows the selected interface language, with consistent detail previews and upload validation.
- Project-scoped favorites and creative references
- The case submission action is labeled **Upload** for both media uploads and public-link imports.

### Content Studio

- Guided conversations grounded in project knowledge
- Independent insight and case reference flows
- Choose a material set, then reference its images, videos, or copy. Selections are retained when switching sets within the current project. Selected references are saved with the submitted message and creation context; copy text becomes AI context, while media references provide metadata rather than automatic visual or video analysis.
- Short-video and image-text planning
- Five structured content cards for every generation
- Card-level editing, activity history, versioning, and rollback
- Standard card titles follow the interface language without changing custom titles or translating stored content.
- Complete original-content previews and consistent reference-card layouts
- Live presence for collaborators viewing the same creation

### Portfolio

- Reports use a continuous, single-column reading layout with clear chapter headings instead of separate cards. The detail view is read-only, with bilingual preview and PDF export.

- Dedicated work list and report detail views
- Background generation states
- Complete Chinese and English report versions
- Seven substantive strategy sections
- Modular editing, preview, and PDF export

### Team collaboration

- Personal and custom organizations
- Organization and project roles with separate permission boundaries
- Persistent invitation and role-change notifications
- Stable account identities and profile images

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
CASE_AI_API_KEY=your-api-key
CASE_AI_BASE_URL=https://your-provider.example/v1
CASE_AI_MODEL=your-chat-model

CASE_ANALYSIS_AI_API_KEY=your-api-key
CASE_ANALYSIS_AI_BASE_URL=https://your-provider.example/v1
CASE_ANALYSIS_AI_MODEL=your-vision-capable-model

# Optional. Empty values inherit CASE_AI_*.
MODIFY_CARD_AI_API_KEY=
MODIFY_CARD_AI_BASE_URL=
MODIFY_CARD_AI_MODEL=

JWT_SECRET=replace-with-a-long-random-string
```

| Configuration | Purpose |
| --- | --- |
| `CASE_AI_*` | Market insight, conversation, content cards, and reports |
| `CASE_ANALYSIS_AI_*` | Structured case analysis, including image inputs |
| `MODIFY_CARD_AI_*` | Optional separate provider for card editing |

Use an OpenAI-compatible API base URL rather than the full `/chat/completions` path. Models must support the request parameters and structured JSON used by the selected feature. Image analysis additionally requires `image_url` input support.

### Optional bounded market research

Market insight keeps uploads, repositories, project permissions, history and the selected
output language. By default it produces a document-based summary, **not verified market
research**. To opt into public-web research, configure:

```env
INSIGHT_RESEARCH_ENABLED=true
INSIGHT_SEARCH_PROVIDER=tavily
TAVILY_API_KEY=your-search-provider-key
```

The selected `CASE_AI_*` model must support OpenAI-compatible function tool calls.
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
