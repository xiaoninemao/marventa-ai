<div align="center">

<img src="frontend/public/assets/brand/marventa-logo.png" alt="Marventa AI" width="104" />

# Marventa AI

### 把营销知识，转化为团队可以持续复用的作品。

一个开源的营销工作区，用于市场理解、创作上下文沉淀、内容生产、发布管理与线索发现。

[English](README.md) · **简体中文**

[![Website](https://img.shields.io/badge/Website-marventa.tech-7C3AED)](https://marventa.tech)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Python](https://img.shields.io/badge/Python-3.11+-3776AB.svg)](backend/requirements.txt)
[![Next.js](https://img.shields.io/badge/Next.js-16-black.svg)](frontend/package.json)

[产品](#产品) · [核心能力](#核心能力) · [快速开始](#快速开始) · [配置](#配置)

</div>

---

## 产品

Marventa AI 将营销工作的上下文持续连接起来：

```text
研究 → 理解 → 创作 → 审核 → 发布 → 复盘
```

文档转化为结构化市场洞察，案例与素材成为可复用创作上下文，对话形成可编辑内容卡片，发布计划连接内容和授权账号，账号内容与评论分析再将表现和潜在需求带回工作区。

整个工作流围绕项目、权限、持久版本和明确的数据状态组织，而不是停留在一次性提示词。

## 核心能力

### 项目与协作

- 按项目组织洞察、案例、素材、创作、发布计划和最终作品。
- 管理组织与项目角色、邀请、创建者信息和渠道账号访问权限。
- 定义项目品牌语气、目标受众、核心价值、视觉方向和禁用词。

### 市场洞察

- 分析 Markdown、PDF、DOCX 和仓库内容，提取定位、受众、竞品、场景和营销方向。
- 可选结合有界公开研究，保留来源、引文和明确限制。
- 将已完成洞察直接作为智能创作上下文。

### 案例库与素材

- 收集图片、视频、正文和支持的公开链接案例，并生成结构化创作分析。
- 通过素材集管理可复用图片、视频和可编辑文案。
- 在不修改项目原件的情况下引用选定案例与素材。

### 智能创作

- 基于项目洞察、案例、文案、品牌规范及可选图片、视频和音频上下文创作短视频或图文内容。
- 生成覆盖方案、标题、正文、话题和视觉方向的五类结构化内容卡片。
- 支持单卡修改、版本恢复、在线协作和中英双语作品报告。
- 交付前检查品牌冲突、禁用词、重复表达、无依据声明、平台适配和敏感营销表达。

### 多模态理解

- 每轮最多引用 5 张 JPEG、PNG 或 WebP 图片和 1 个支持的视频。
- 使用 FFmpeg 抽取有序视频关键帧，不向模型发送原视频。
- 可选通过 OpenAI-compatible 转写模型提取音频，并将带时间戳的台词与相邻画面结合。
- 临时媒体不进入对话存储；授权素材的转写结果会缓存，避免重复处理。

### 发布管理

- 通过项目素材、文案、账号和时间创建图片或视频发布计划。
- 在首页发布日历中查看已排期日期。
- 自动保存可编辑内容，锁定已提交计划，保留失败内容，并安全取消或重新安排。
- 通过可选后端调度器发布已授权的抖音内容。

### 账号内容与线索追踪

- 分开浏览平台可读取内容与通过 Marventa 创建的发布记录。
- 查看可用播放方式、可见状态、图集和互动指标。
- 同一账号跨项目共享账号级每日 Top 50 评论快照。
- 使用规则或 AI 判断意向，查看依据与建议动作，并确认或忽略线索。

### 作品集

- 在独立作品列表中保存完成的策略报告。
- 阅读、预览并导出完整中英文 PDF。

## 权限

项目权限独立于组织角色。

| 能力 | 项目成员 | 资产创建者 | 项目管理员 / 所有者 |
| --- | ---: | ---: | ---: |
| 查看项目资产 | 是 | 是 | 是 |
| 管理洞察、案例或创作 | — | 自己创建的内容 | 全部项目内容 |
| 编辑素材和发布计划 | — | 自己创建的内容 | 是 |
| 管理项目成员和规范 | — | — | 是 |

发布生命周期锁定同样适用于创建者和项目管理员。

## 架构

```text
Next.js 16 / React 19
          │ HTTP JSON API
          ▼
FastAPI / Python 3.11+
          │
          ├── SQLite 或 PostgreSQL
          ├── 本地或 S3-compatible 媒体
          ├── OpenAI-compatible AI 接口
          └── 平台官方接口
```

Marventa 默认自托管。SQLite 与本地媒体不需要额外基础设施；生产环境可切换到 PostgreSQL 和 S3-compatible 对象存储。

AI 请求会将相关输入发送到你配置的服务商。处理敏感材料前，请确认服务商的隐私与数据保留条款。

## 快速开始

### 环境要求

- Python 3.11+
- Node.js 22.18+
- npm 10+
- 启用视频理解时需要 FFmpeg 和 ffprobe

### 配置

```bash
git clone https://github.com/xiaoninemao/Marventa-AI.git
cd Marventa-AI

cp backend/.env.example backend/.env
cp frontend/.env.local.example frontend/.env.local
```

在 `backend/.env` 中设置足够长且随机的 `JWT_SECRET`。系统启动时可以暂不配置 AI，但 AI 分析与创作功能需要有效凭证。

### 启动

macOS 或 Linux：

```bash
chmod +x scripts/start-local.sh scripts/stop-local.sh
./scripts/start-local.sh
```

Windows PowerShell：

```powershell
.\scripts\start-local.ps1
```

- Web：[http://localhost:3000](http://localhost:3000)
- API：[http://localhost:8765](http://localhost:8765)
- API 文档：`DEBUG=true` 时访问 [http://localhost:8765/docs](http://localhost:8765/docs)

可通过 `Ctrl+C`、`bash scripts/stop-local.sh` 或 `.\scripts\stop-local.ps1` 停止服务。

## 配置

完整配置参考见 [`backend/.env.example`](backend/.env.example)。

### AI 接口

```env
AI_API_KEY=your-api-key
AI_BASE_URL=https://your-provider.example/v1
AI_MODEL=your-chat-model
```

所有 AI 功能默认使用 `AI_*`，只有显式开启时才使用产品级替代接口。

| 可选替代接口 | 产品范围 |
| --- | --- |
| `MARKET_INSIGHT_AI_*` | 文档洞察与有界公开研究 |
| `CASE_LIBRARY_AI_*` | 包含图片输入的结构化案例分析 |
| `CONTENT_STUDIO_AI_*` | 对话、内容卡、修改、报告和质量检查 |
| `LEAD_TRACKING_AI_*` | 评论线索判断 |

每组替代接口都需要 `*_OVERRIDE_ENABLED=true`，并完整填写 API Key、Base URL 和 Model。已启用但不完整时会明确失败，不会静默切换到其他接口。

### 图片、视频与音频

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

后端会校验媒体限制、抽取有界关键帧并删除临时文件。音频转写使用独立开关，并且必须明确配置转写模型。

### 有界公开研究

```env
INSIGHT_RESEARCH_ENABLED=true
INSIGHT_SEARCH_PROVIDER=tavily
TAVILY_API_KEY=your-search-provider-key
```

研究过程受搜索、页面、上下文、Token 和时间预算限制。读取器只允许公开 HTTP(S)，拒绝本地和私网地址，将网页视为不可信证据，并保留引用与限制。研究完成只表示有界证据流程完成，不证明所有陈述都正确。

### 渠道账号与定时发布

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

- Token 加密保存，不会返回浏览器。
- 抖音真实发布需要官方批准的 `video.create.bind` 能力及账号授权。
- 平台接受创建请求不代表内容已经公开展示，仍需经过平台审核。
- 调度器默认关闭，避免升级后意外执行历史计划。
- 小红书目前开放账号信息，但没有可核实的公开服务端笔记发布契约。获得官方规范前保持禁用；Marventa 不使用非官方签名或 Cookie 自动化。

### 存储与数据库

SQLite 和本地媒体是默认配置：

```env
DATABASE_URL=
MEDIA_STORAGE_BACKEND=local
```

生产环境可使用 PostgreSQL 16+ 和私有 S3-compatible 存储：

```env
DATABASE_URL=postgresql://user:password@database.example.com:5432/marventa

MEDIA_STORAGE_BACKEND=s3
MEDIA_S3_BUCKET=marventa-media
MEDIA_S3_REGION=auto
MEDIA_S3_ENDPOINT_URL=
MEDIA_S3_ACCESS_KEY_ID=
MEDIA_S3_SECRET_ACCESS_KEY=
```

迁移工具：

```bash
cd backend
.venv/bin/python scripts/migrate_sqlite_to_postgres.py --help
.venv/bin/python scripts/migrate_media_to_object_storage.py --help
```

迁移前请同时备份数据库和媒体，数据库迁移期间停止写入，验证目标环境，并保留源备份直到恢复流程经过测试。

## 开发

后端测试：

```bash
cd backend
.venv/bin/python -m pytest
```

前端检查：

```bash
cd frontend
npm test
npm run lint
npx tsc --noEmit
npm run build
```

PostgreSQL 集成测试需要 `TEST_POSTGRES_DATABASE_URL`。

## 安全

- 部署前替换所有示例密钥。
- 公网部署必须使用 HTTPS。
- 对象存储默认保持私有。
- 渠道账号只授予必要权限。
- 数据库与媒体需要一起备份。
- 将模型、搜索和平台服务商视为外部数据处理方。

请通过 [GitHub Security Advisories](https://github.com/xiaoninemao/Marventa-AI/security/advisories/new) 报告漏洞，不要提交公开 Issue。

## 参与贡献

参见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 许可证

MIT，详见 [LICENSE](LICENSE)。
