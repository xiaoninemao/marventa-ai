<div align="center">

<img src="frontend/public/assets/brand/marventa-logo.png" alt="Marventa AI" width="104" />

# Marventa AI

### 把营销知识，转化为团队可以持续复用的作品。

一个开源营销工作区，覆盖市场理解、Agent 创作、发布运营与线索发现。

[English](README.md) · **简体中文**

[![Website](https://img.shields.io/badge/Website-marventa.tech-7C3AED)](https://marventa.tech)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Python](https://img.shields.io/badge/Python-3.11+-3776AB.svg)](backend/requirements.txt)
[![Next.js](https://img.shields.io/badge/Next.js-16-black.svg)](frontend/package.json)

[产品概览](#产品概览) · [工作流程](#工作流程) · [核心能力](#核心能力) · [快速开始](#快速开始) · [配置](#配置)

</div>

## 产品概览

营销团队每天使用产品文档、内容案例、图片、视频、草稿、发布记录和用户反馈。Marventa 围绕项目组织这些资料，让团队在研究、创作、交付和复盘中持续使用同一批知识。

```text
研究 → 理解 → 规划 → 创作 → 发布 → 复盘
```

智能创作通过 Agent 参与这条工作链路：澄清目标、制定计划、读取项目引用、调用工具，并在对话中组合作品。品牌规范和可复用资料为决策提供上下文，团队负责审阅产出和控制交付。

团队可以沉淀产品理解、发展创作方向、保留独立作品与版本，并将渠道反馈用于后续营销。自托管支持自主选择数据存储、AI 服务商和部署环境。

## 工作流程

### 1. 建立项目

为产品、活动、账号或长期内容计划创建项目，邀请协作者，将洞察、案例、素材、创作、发布计划和作品归入同一项目。

项目所有者和管理员可以在品牌规范中定义语气、受众、价值主张、视觉方向和禁用词。设置自动保存，并指导后续智能创作。

### 2. 建立市场理解

导入 Markdown、PDF、DOCX 或仓库内容。市场洞察分析定位、受众、竞争、使用场景、优势与营销方向。可选公开研究补充来源与引文，并明确资料的局限。

### 3. 准备创作参考

研究图文、视频、文字和支持的公开链接案例。案例分析提取开场钩子、受众适配、营销角度、内容结构和可复用经验。

将图片、视频和可编辑文案整理为素材集，在创作时引用，保留资料的项目归属与访问权限。

### 4. 与 Agent 创作

通过对话探索方向、请求计划或执行创作任务。Chat、Plan、Action 围绕所选模式和目标协同工作。

Agent 读取相关品牌规范、洞察、案例和素材，使用可用工具生成或导入媒体，再组合作品。流式回复和工具活动展示进度，后台任务支持取消以及重新打开页面后的恢复。

在作品区审阅媒体、标题、文案和标签，通过对话细化结果，引用某一张图片进行定向替换，或预览并恢复历史版本。

### 5. 保存与完善作品

将成果保存到作品集，媒体以独立副本保留。编辑正文、调整图片顺序、替换媒体，也可以手动创建命名的图文或视频作品。

只有媒体的作品可以标记为已完成。只有文案的作品保留为可编辑草稿；可发布作品必须包含媒体。

### 6. 发布与复盘

创建命名发布草稿，选择已完成的作品集作品，再在发布设置中配置渠道、已连接账号和时间。计划保存独立的媒体与文案副本，首页日历将排期日期关联到发布计划。

账号内容展示可获取的渠道作品与 Marventa 发布记录。线索追踪汇总每日评论，结合证据与建议动作识别潜在需求。

## 核心能力

### 项目与协作

- 共享项目资料、组织边界和项目独立角色。
- 邀请成员、成员管理、创建者归属和管理员维护的品牌规范。
- 搜索、类型／状态筛选、分页和明确的操作反馈。

### 市场洞察

- 文档与仓库分析，覆盖产品、受众、竞争和定位。
- 可选有界公开研究，保留来源、引用与局限。
- 可编辑分析结果，可直接引用到智能创作。

### 案例库与素材

- 图文、视频、文字及支持的公开链接案例，提供结构化分析。
- 素材集管理媒体与可编辑文案，支持 TXT、Markdown、PDF、DOCX 导入。
- 富文本编辑、媒体预览、案例收藏和项目内复用。

### Agent 化智能创作

- **Chat：** 沟通需求、澄清目标、识别缺失信息。
- **Plan：** 比较方向，形成可执行的创作计划。
- **Action：** 调用工具生成／导入媒体，组合作品。
- 自动协调，以及独立的规划、创作模式。
- 项目引用、品牌约束、多模态上下文和实时查看者状态。
- 流式回复、可见工具活动、持久化任务恢复与取消。
- 图文作品、已有视频作品，以及视频脚本和分镜。
- 使用真实参考图定向编辑、作品历史与版本恢复。

生图使用独立配置的服务商。视频作品可以使用已有媒体，暂不支持原生视频生成。

### 作品集

- 命名图文／视频作品，独立媒体、内容标题、文案和标签。
- 素材选择、本地上传、图片排序和单视频替换。
- 媒体与正文预览，并发编辑冲突校验。
- 纯媒体完成作品与纯文案草稿。

### 发布管理

- 先创建草稿、再选择成品，单独配置发布设置。
- 独立只读副本，保留已保存的媒体顺序和正文。
- 已计划、发布中、已发布状态的生命周期锁定。
- 取消、重新安排、失败反馈与持久化执行记录。
- 可选后端调度器，通过抖音官方 API 发布。

### 账号内容与线索追踪

- 按渠道账号浏览，查看媒体、可用互动指标和分页内容。
- 分开展示平台可读取内容与 Marventa 发布记录。
- 同一组织内，跨项目绑定的同一账号只展示一个线索追踪入口。
- 每日 Top 50 评论快照，规则／AI 意向判断与人工复核。
- 证据、建议动作、确认、忽略与重置。

### 多模态理解

智能创作每轮支持最多五张 JPEG／PNG／WebP 图片和一个视频。视频理解使用按时间排序的关键帧；可选音频转写提供时间戳语音上下文，并按素材缓存。

后端校验媒体限制并清理临时文件。会话保留文字与引用标识，临时 base64 图片、音频和抽帧数据不作为消息正文保存。

## 权限与结果状态

项目访问权限独立于组织角色。

| 能力 | 项目成员 | 内容创建者 | 项目管理员／所有者 |
| --- | ---: | ---: | ---: |
| 查看项目资料 | 是 | 是 | 是 |
| 管理洞察、案例与创作 | — | 自己的内容 | 项目全部内容 |
| 编辑素材与发布计划 | — | 自己的内容 | 是 |
| 管理成员与品牌规范 | — | — | 是 |

发布生命周期锁定同样约束创建者与管理员。真实平台数据、演示数据、不可用能力与失败有独立状态。虚拟账号不会发布，服务商错误明确展示；平台接收与公开可见分别呈现。

AI 分析、研究和创作结果需要人工审阅。服务端执行已配置禁用词的精确匹配校验；模型产出不代表事实准确、法律合规或平台审核通过。

## 自托管与架构

```text
Next.js 16 / React 19
          │ HTTP JSON API
          ▼
FastAPI / Python 3.11+
          ├── Agent 后台任务与发布调度器
          ├── SQLite 或 PostgreSQL
          ├── 本地或 S3 兼容媒体存储
          ├── 已配置的 AI 服务商
          └── 官方渠道 API
```

默认使用 SQLite 和本地媒体。生产部署可使用 PostgreSQL 16+ 和私有 AWS S3、Cloudflare R2、MinIO 或其他 S3 兼容存储。

AI 请求会将相关输入发送给你配置的服务商。处理敏感资料前，请核对其隐私、数据保留和使用条款。

## 快速开始

需要 Python 3.11+、Node.js 20+、npm 10+。视频／音频处理需要 FFmpeg 和 ffprobe。

```bash
git clone https://github.com/xiaoninemao/marventa-ai.git
cd marventa-ai
cp backend/.env.example backend/.env
cp frontend/.env.local.example frontend/.env.local
```

在 `backend/.env` 中设置足够长的随机 `JWT_SECRET`，按需配置 AI 凭据。

**macOS / Linux**

```bash
bash scripts/start-local.sh
```

**Windows PowerShell**

```powershell
.\scripts\start-local.ps1
```

- Web：[localhost:3000](http://localhost:3000)
- 后端：[localhost:8765](http://localhost:8765)
- API 文档：`DEBUG=true` 时访问 [localhost:8765/docs](http://localhost:8765/docs)

使用 `Ctrl+C`、`bash scripts/stop-local.sh` 或 `.\scripts\stop-local.ps1` 停止服务。

## 配置

完整设置与默认值见[后端环境模板](backend/.env.example)和[前端环境模板](frontend/.env.local.example)。

### AI 服务商

```env
AI_API_KEY=your-api-key
AI_BASE_URL=https://your-provider.example/v1
AI_MODEL=your-chat-model
```

AI 功能默认使用 `AI_*`。可选的 `MARKET_INSIGHT_AI_*`、`CASE_LIBRARY_AI_*`、`CONTENT_STUDIO_AI_*` 和 `LEAD_TRACKING_AI_*` 独立配置需要明确开启开关并填写完整凭据。

智能创作对话模型必须支持工具调用和结构化输出。生图工具使用独立的 `CONTENT_STUDIO_IMAGE_*` 配置与 OpenAI 兼容生成／编辑接口。参考图编辑需要服务商支持对应协议，不支持时明确报错。

### 媒体与 Agent 运行

- `CONTENT_STUDIO_MULTIMODAL_*`：图像／视频理解和媒体输入限制。
- `CONTENT_STUDIO_TRANSCRIPTION_*`：可选音频转写。
- `CONTENT_STUDIO_JOB_*`：工作线程数、任务超时与有界重试。
- `CONTENT_STUDIO_SEEDREAM_*`／`CONTENT_STUDIO_SEEDANCE_*`：预留图像／视频服务商配置，尚未接通原生适配器。

任务与进度共用每个会话唯一的串行自适应轮询。后台任务支持恢复与取消，逐次模型耗时用于延迟诊断。已生产媒体的失败任务需要明确重试，避免重复付费生成。

### 研究、授权与发布

公开研究使用 `INSIGHT_RESEARCH_*`、`INSIGHT_SEARCH_PROVIDER` 与服务商凭据。搜索和页面读取有固定预算，并保留来源局限。

通过 `DOUYIN_CHANNEL_*`、`CHANNEL_CREDENTIAL_ENCRYPTION_KEY` 和 `FRONTEND_BASE_URL` 配置渠道授权。Token 加密保存，不返回浏览器。抖音发布需要获批的 `video.create.bind` 能力和对应账号授权。

`PUBLISHING_SCHEDULER_ENABLED=false` 为默认值，开启前请检查已有计划。调度器运行在后端，通过数据库认领和心跳协调任务；重试结果不确定的发布前应先检查平台状态。小红书发布暂未开放。

### 数据库与媒体

通过 `DATABASE_URL` 使用 PostgreSQL，通过 `MEDIA_STORAGE_BACKEND=s3` 和 `MEDIA_S3_*` 使用对象存储。保持存储桶私有，不同部署使用独立前缀。

迁移工具：

```bash
cd backend
.venv/bin/python scripts/migrate_sqlite_to_postgres.py --help
.venv/bin/python scripts/migrate_media_to_object_storage.py --help
```

## 运维与开发

数据库与媒体一起备份。迁移时暂停写入、验证恢复，通过部署密钥管理轮换凭据，监控后台任务健康、授权过期和服务商配额。

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

PostgreSQL 集成测试使用专用 `TEST_POSTGRES_URL` 数据库，参见[数据库 CI](.github/workflows/backend-databases.yml)。

## 参与贡献

欢迎提交 Issue 和 Pull Request。行为修改请提供复现步骤与相关测试结果；敏感安全问题请通过仓库可用的私密报告渠道反馈。

## 许可证

[MIT License](LICENSE)。
