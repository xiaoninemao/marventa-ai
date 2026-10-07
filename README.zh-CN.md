<div align="center">

<img src="frontend/public/assets/brand/marventa-logo.png" alt="Marventa AI" width="104" />

# Marventa AI

### 把营销知识，转化为团队可以持续复用的作品。

一个开源的营销工作区，覆盖市场理解、创作生产、发布运营和线索发现。

[English](README.md) · **简体中文**

[![Website](https://img.shields.io/badge/Website-marventa.tech-7C3AED)](https://marventa.tech)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Python](https://img.shields.io/badge/Python-3.11+-3776AB.svg)](backend/requirements.txt)
[![Next.js](https://img.shields.io/badge/Next.js-16-black.svg)](frontend/package.json)

[产品概览](#产品概览) · [工作流程](#工作流程) · [核心能力](#核心能力) · [快速开始](#快速开始) · [配置](#配置)

</div>

---

## 产品概览

营销团队每天都会积累大量有价值的信息：产品资料、客户问题、行业案例、图片视频、文案草稿、渠道反馈和发布记录。这些信息通常散落在文件夹、聊天记录、表格和个人提示词中，很难持续复用。

Marventa AI 以项目为中心整理这些内容。

一个项目可以同时保存市场洞察、案例、素材、创作过程、内容版本、发布计划和最终作品。团队成员能够围绕同一批资料协作，并在后续工作中继续使用已有结论、版本和反馈。

```text
研究 → 理解 → 创作 → 审核 → 发布 → 复盘
```

Marventa 适合希望建立以下能力的团队：

- 持续沉淀产品与市场认知；
- 复用案例、素材和品牌规范；
- 在人工审核下使用 AI 提升创作效率；
- 保留明确的权限、版本和操作记录；
- 自主控制数据、模型接口和部署环境。

## 工作流程

### 1. 建立项目

为产品、活动、账号或长期内容计划创建项目，邀请协作者，将洞察、案例、素材、创作、发布计划和作品归入同一项目范围。

项目所有者和管理员可以在“规范”标签中维护品牌语气、目标受众、核心价值、视觉方向和禁用词。内容自动保存，并用于后续智能创作。

### 2. 建立市场理解

导入 Markdown、PDF、DOCX 或代码仓库内容。市场洞察会整理产品定位、目标受众、竞品、使用场景、优势和营销方向。

需要外部证据时，可以启用有界公开研究。研究流程搜索公开来源、读取符合条件的网页，并将引用和限制说明保存在分析结果中。

### 3. 学习案例

通过图片、视频、正文和支持的公开链接建立案例库。案例分析会提取开场钩子、受众匹配、内容结构、营销角度、亮点和可复用经验。

团队可以收藏具有代表性的案例，并在创作时直接引用。

### 4. 整理素材

将项目图片、视频和文案整理为素材集。文本文件和办公文档可以导入为可编辑文案，媒体可以用于预览、智能创作和发布计划。

下游工作保存素材引用，项目原件保持独立。

### 5. 创作与审核

智能创作通过对话确认产品、受众、内容形式、目标平台和创作方向。对话可以引用已完成洞察、已分析案例、项目文案、品牌规范、图片和视频。

一次完整生成包含五类相互配合的内容卡片：

1. 内容方案或脚本；
2. 标题备选；
3. 发布文案；
4. 话题标签；
5. 视觉方向。

每张卡片都可以单独修改，也可以恢复历史版本。确认后的内容能够生成中英双语长篇报告。交付前可对整组卡片执行质量检查。

### 6. 发布与复盘

通过有序媒体、文案、渠道账号和发布时间创建发布计划。首页日历展示已排期日期，并可以进入发布管理。

账号内容将平台可读取作品与 Marventa 发布记录分开呈现。线索追踪按账号汇总每日评论，并从评论中识别潜在需求，保留判断依据和建议动作。

## 核心能力

### 项目与协作

- 按项目组织所有主要资产和工作记录。
- 组织角色与项目角色分别管理，权限边界清晰。
- 支持成员邀请、创建者信息、成员管理和项目级管理。
- 提供搜索、筛选、分页、空状态和明确的操作反馈。

### 市场洞察

- 支持 Markdown、PDF、DOCX 和仓库输入。
- 生成产品、受众、竞品、定位和营销方向分析。
- 可选使用带来源、引文和限制说明的有界公开研究。
- 保留可编辑历史，并在智能创作中直接引用。

### 案例库

- 管理图片、视频、正文和支持的公开链接案例。
- 分析开场、受众、营销角度、亮点和可复用经验。
- 支持收藏和项目内引用。
- 明确展示分析状态、失败原因和重试入口。

### 素材

- 使用素材集管理图片、视频和可编辑文案。
- 支持 TXT、Markdown、PDF 和 DOCX 文案导入。
- 提供富文本编辑、媒体预览、创建者信息和项目权限。
- 在智能创作与发布管理中复用。

### 智能创作

- 支持短视频与图文内容的引导式创作。
- 复用项目洞察、案例、素材和品牌规范。
- 生成五类协调一致的内容卡片，并支持单卡修改。
- 保留版本、回滚和活动记录。
- 显示同一创作中的在线成员。
- 生成、预览和导出中英双语报告。

### 创作质量

质量检查覆盖：

- 品牌规范一致性；
- 项目禁用词；
- 平台与内容形式匹配；
- 卡片之间的重复表达；
- 缺少资料支持的数字、对比和效果声明；
- 需要法务、平台规则或专业人员复核的营销表达。

模型检查结果用于人工审核。服务端会确定性检查禁用词，命中后暂停作品生成，内容修改完成后才能继续。

### 多模态理解

- 每轮最多引用 5 张 JPEG、PNG 或 WebP 图片。
- 每轮最多引用 1 个 MP4、MOV、WebM 或 M4V 视频。
- 使用 FFmpeg 抽取按时间排序的关键帧。
- 可选通过智能创作当前接口转写音频，并保留分段时间。
- 转写缓存与已授权项目素材绑定。
- 处理完成后清理临时文件。

原视频不会发送给模型。数据库保存文本和素材 ID，不保存 base64 图片、临时音频或关键帧。

### 发布管理

- 支持图文与视频发布计划。
- 管理有序媒体、文案、账号和发布时间。
- 自动保存可编辑内容。
- 对已计划、发布中和已发布状态执行锁定。
- 明确记录失败、取消、重新安排和执行结果。
- 可通过后端调度器调用抖音官方发布接口。

### 账号内容

- 分开展示平台可读取内容与 Marventa 发布记录。
- 查看图集、已保存视频、官方嵌入播放和可用互动指标。
- 明确区分平台状态、授权状态、不可用状态和模拟数据。

### 线索追踪

- 同一组织内，同一渠道账号跨项目只展示一次。
- 生成账号级每日 Top 50 评论快照。
- 多个项目绑定共享一致结果。
- 支持规则判断和 AI 意向判断。
- 展示依据、建议动作、人工确认、忽略与重置。

### 作品集

- 集中管理完成的策略报告。
- 保存完整中文与英文内容。
- 支持阅读、预览和 PDF 导出。

## 数据与结果状态

Marventa 会清楚区分真实平台数据、模拟演示数据、能力不可用和执行失败。

- 虚拟账号不会发起平台发布请求。
- 演示记录保留清晰的模拟标识。
- 服务商失败会显示为错误，不会转换为空白成功结果。
- 已开启但配置不完整的替代接口会明确失败。
- 平台接受创建请求与公开展示使用不同状态。
- AI 质量检查和公开研究均保留限制说明。

## 权限

项目权限独立于组织角色。

| 能力 | 项目成员 | 资产创建者 | 项目管理员 / 所有者 |
| --- | ---: | ---: | ---: |
| 查看项目资产 | 是 | 是 | 是 |
| 管理洞察、案例或创作 | — | 自己创建的内容 | 全部项目内容 |
| 编辑素材和发布计划 | — | 自己创建的内容 | 是 |
| 管理项目成员和规范 | — | — | 是 |

发布计划进入已计划或已提交状态后，生命周期锁定继续生效。

## 自托管与架构

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

| 层级 | 默认配置 | 生产环境选项 |
| --- | --- | --- |
| 数据库 | SQLite | PostgreSQL 16+ |
| 媒体 | 本地文件系统 | AWS S3、Cloudflare R2、MinIO 或其他 S3-compatible 服务 |
| AI | 用户配置的 OpenAI-compatible 接口 | 产品级替代接口 |
| 发布 | 调度器关闭 | 已授权的抖音官方接口 |

AI 请求会将相关输入发送到你配置的服务商。处理敏感材料前，请确认服务商的隐私和数据保留条款。

## 快速开始

### 环境要求

- Python 3.11+
- Node.js 22.18+
- npm 10+
- 启用视频理解时需要 FFmpeg 和 ffprobe

### 克隆与配置

```bash
git clone https://github.com/xiaoninemao/Marventa-AI.git
cd Marventa-AI

cp backend/.env.example backend/.env
cp frontend/.env.local.example frontend/.env.local
```

在 `backend/.env` 中设置足够长且随机的 `JWT_SECRET`。启用 AI 功能时再填写对应服务商凭证。

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

完整环境变量参考见 [`backend/.env.example`](backend/.env.example)。

### AI 接口

```env
AI_API_KEY=your-api-key
AI_BASE_URL=https://your-provider.example/v1
AI_MODEL=your-chat-model
```

所有 AI 功能默认使用 `AI_*`。

| 可选替代接口 | 产品范围 |
| --- | --- |
| `MARKET_INSIGHT_AI_*` | 文档洞察与有界公开研究 |
| `CASE_LIBRARY_AI_*` | 包含图片输入的案例分析 |
| `CONTENT_STUDIO_AI_*` | 对话、内容卡、修改、报告和质量检查 |
| `LEAD_TRACKING_AI_*` | 评论线索判断 |

每组替代接口都需要 `*_OVERRIDE_ENABLED=true`，并完整填写 API Key、Base URL 和 Model。关闭开关时统一使用 `AI_*`；开启后缺少配置会返回明确错误。

### 图片、视频与音频

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

后端会在调用模型前校验媒体限制。FFmpeg 负责抽取有界 JPEG 关键帧；启用转写后还会生成临时单声道音轨。所有临时文件都会在处理完成后删除。

### 有界公开研究

```env
INSIGHT_RESEARCH_ENABLED=true
INSIGHT_SEARCH_PROVIDER=tavily
TAVILY_API_KEY=your-search-provider-key
```

公开研究设置了搜索、页面、重定向、上下文、Token 和时间预算。读取器只允许标准端口的公开 HTTP(S)，校验重定向和解析地址，拒绝私网目标，并将网页内容作为不可信证据处理。

来源和引文匹配用于提升可追溯性，不能直接证明事实正确、信息完整、竞品身份或来源独立性。使用结论前需要人工复核。

### 渠道授权

```env
DOUYIN_CHANNEL_CLIENT_KEY=
DOUYIN_CHANNEL_CLIENT_SECRET=
DOUYIN_CHANNEL_REDIRECT_URI=https://api.example.com/api/v1/publishing/channel-accounts/oauth/douyin/callback

XIAOHONGSHU_CHANNEL_APP_ID=
XIAOHONGSHU_CHANNEL_APP_SECRET=
CHANNEL_CREDENTIAL_ENCRYPTION_KEY=
FRONTEND_BASE_URL=https://app.example.com
```

渠道 Token 加密保存，不会返回浏览器。

抖音真实发布需要官方批准的 `video.create.bind` 能力及账号授权。平台接受创建请求不代表内容已经公开展示，仍需经过平台审核和账号可见性判断。

小红书目前开放账号信息，但没有可核实的公开服务端笔记发布契约。获得官方规范前保持禁用。Marventa 不使用非官方签名或 Cookie 自动化。

### 调度器

```env
PUBLISHING_SCHEDULER_ENABLED=false
PUBLISHING_POLL_SECONDS=10
```

调度器运行在后端进程中，不依赖浏览器页面保持打开。默认关闭，启用前需要检查已有发布计划。

数据库领取和心跳用于避免多个进程同时执行同一计划。中断或结果不确定的请求会保留明确状态；再次尝试前应先检查平台账号，避免重复内容。

### 数据库与媒体存储

SQLite 和本地媒体是开发环境默认配置：

```env
DATABASE_URL=
MEDIA_STORAGE_BACKEND=local
```

生产环境可以使用 PostgreSQL 16+ 和私有 S3-compatible 存储：

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

多个安装共享存储桶时应使用不同前缀。存储桶建议保持私有，并通过短期预签名 URL 提供媒体。

迁移工具：

```bash
cd backend
.venv/bin/python scripts/migrate_sqlite_to_postgres.py --help
.venv/bin/python scripts/migrate_media_to_object_storage.py --help
```

迁移前请同时备份数据库和媒体。数据库迁移期间停止写入，完成后验证目标环境，并保留源备份直到恢复流程经过测试。

## 运维

- 将数据库记录和关联媒体作为同一套恢复数据备份。
- 通过部署密钥管理 JWT、渠道、存储和模型凭证。
- 关注调度失败和渠道授权过期。
- 结果不确定的发布请求需要先核对平台状态。
- 处理视频和音频的工作节点需要安装 FFmpeg。
- 定期检查模型服务的用量、隐私条款、额度和数据保留策略。

## 开发

后端：

```bash
cd backend
.venv/bin/python -m pytest
```

前端：

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
- 公网部署使用 HTTPS。
- 渠道账号只授予必要权限。
- 对象存储默认保持私有。
- 根据组织要求设置数据库和媒体保留策略。
- 将模型、搜索和渠道服务商视为外部数据处理方。

请通过 [GitHub Security Advisories](https://github.com/xiaoninemao/Marventa-AI/security/advisories/new) 报告漏洞，不要提交公开 Issue。

## 参与贡献

参见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 许可证

MIT，详见 [LICENSE](LICENSE)。
