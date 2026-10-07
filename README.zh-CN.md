<div align="center">

<img src="frontend/public/assets/brand/marventa-logo.png" alt="Marventa AI" width="104" />

# Marventa AI

### 把营销知识，转化为团队可以持续复用的作品。

面向研究、洞察、内容创作、素材管理与发布管理的一站式开源工作台。

**简体中文** · [English](README.md)

[![Website](https://img.shields.io/badge/官网-marventa.tech-7C3AED)](https://marventa.tech)
[![License: MIT](https://img.shields.io/badge/许可证-MIT-yellow.svg)](LICENSE)
[![Python](https://img.shields.io/badge/Python-3.11+-3776AB.svg)](backend/requirements.txt)
[![Next.js](https://img.shields.io/badge/Next.js-16-black.svg)](frontend/package.json)
[![PRs Welcome](https://img.shields.io/badge/欢迎提交-PR-brightgreen.svg)](CONTRIBUTING.md)

[产品价值](#产品价值) · [工作流程](#工作流程) · [核心能力](#核心能力) · [快速开始](#快速开始) · [模型配置](#ai-模型配置)

</div>

---

## 产品价值

营销工作通常不缺少想法，真正缺少的是完整而持续的上下文：

- 产品知识散落在文件、文档和仓库中；
- 优秀案例沉没在收藏夹和聊天记录里；
- 每次活动都从新的空白提示词开始；
- AI 生成结果难以审核、整理和再次使用。

Marventa AI 将这些上下文收拢到以项目为中心的工作区中。

资料转化为结构化市场洞察，案例转化为可引用经验，对话转化为可编辑内容卡片，最终决策转化为始终与项目、成员和资料来源关联的双语营销报告。

```text
研究 → 理解 → 创作 → 整理素材 → 安排发布 → 复用
```

你得到的不只是一次独立的 AI 回答，而是一套会随项目持续积累的营销知识。

## 工作流程

### 组织项目

创建项目，邀请协作者，将研究资料、媒体、案例、创作过程和最终作品统一管理。

### 建立理解

导入 Markdown、PDF、Word 或代码仓库内容，生成结构化的产品定位、目标受众、竞品、使用场景和营销角度分析。

可选启用有界研究 Agent，搜索公开来源、读取网页，并为分析附上可追溯证据与限制说明。

### 学习案例

通过上传或支持的公开链接建立项目案例库，分析开场钩子、内容结构、目标受众、复用经验、亮点和改进空间。

### 带着上下文创作

在智能创作中引用已完成的洞察和已分析的案例，选择渠道和形式，生成一组风格与内容形式一致的方案、标题、正文、话题标签和视觉方向。

### 审核与交付

继续对话、单独修改卡片、恢复历史版本，并将确认后的内容生成正式的中英双语报告，支持预览和 PDF 导出。

### 整理与发布

将可复用的图片、视频和文案整理为项目素材集，引用素材创建发布计划，自动保存发布文案，并在开启后端调度后安排已授权的抖音发布。

## 核心能力

### 项目与协作

- 按项目组织洞察、案例、素材、创作、发布计划和最终作品。
- 管理组织与项目角色、成员邀请、渠道账号访问和创建者信息。
- 通过搜索、筛选和分页浏览团队工作区，并获得清晰的权限与操作反馈。

### 市场洞察

- 将 Markdown、PDF、DOCX 或仓库内容转化为产品、受众、竞品、定位和营销方向分析。
- 可选结合有界公开研究，保留来源、引文与明确限制。
- 将已完成洞察直接作为智能创作上下文。

### 案例库

- 按项目沉淀图片、视频、正文和支持的公开链接案例。
- 分析开场、受众、营销角度、亮点和可复用经验。
- 收藏案例并在创作时引用。

### 素材

- 通过素材集管理图片、视频和可编辑文案。
- 导入 TXT、Markdown、PDF 和 DOCX 文案，在工作区编辑富文本并预览媒体。
- 在智能创作和发布管理中复用素材，同时保留项目原件。

### 智能创作

- 基于项目洞察、案例、文案与可选图片上下文进行短视频或图文创作对话。
- 生成五类结构化内容卡片，支持单卡修改、版本恢复和活动记录。
- 生成中英双语长篇报告，并显示同一创作中的在线成员。

### 发布管理

- 组合图片或视频、文案、账号与发布时间，形成发布计划。
- 持续保存内容，锁定已提交计划，保留失败内容，并安全取消或重新安排。
- 通过可选调度器调用官方接口发布抖音内容并保存执行记录。

### 账号内容

- 分开查看平台可读取作品与通过 Marventa 发布的记录。
- 浏览图集、已保存视频、官方内嵌播放、可见状态和平台提供的互动指标。
- 明确展示不可用、授权、接口失败和模拟数据状态。

### 线索追踪

- 同一渠道账号跨项目只展示一次，同时保留组织权限边界。
- 查看账号级每日 Top 50 评论快照，并在所有项目绑定中获得一致结果。
- 使用规则或 AI 判断意向，查看依据与建议动作，并确认或忽略线索。

### 作品集

- 在独立作品列表中管理完成的策略报告。
- 阅读、预览并导出完整中英文 PDF。

## 权限模型

项目权限明确且独立于组织角色。

| 能力 | 项目成员 | 资产创建者 | 项目管理员 / 所有者 |
| --- | ---: | ---: | ---: |
| 查看项目资产 | 是 | 是 | 是 |
| 管理洞察、案例或创作 | — | 自己创建的内容 | 项目内全部内容 |
| 编辑或删除素材和发布计划 | — | 自己创建的内容 | 是 |
| 管理项目成员 | — | — | 是 |

组织管理员不会自动获得项目管理权限。
发布生命周期的锁定规则同样适用于创建者和项目管理员。

## 为自托管而设计

Marventa 默认使用 SQLite 和本地上传文件，生产部署可选择 PostgreSQL 与 S3 兼容对象存储。AI 服务通过你自己的 OpenAI 兼容凭据接入。

团队可以自行决定：

- 项目数据保存在哪里；
- 每类 AI 任务使用哪家模型服务；
- 如何管理备份与访问策略；
- 何时把资料发送给外部模型服务。

AI 请求仍会把相关输入发送到所配置的模型服务商。处理敏感资料前，请检查服务商的隐私与数据保留政策。

## 技术架构

```text
Next.js 16 / React 19
          │
          │ HTTP JSON API
          ▼
FastAPI
          │
          ├── 市场洞察
          ├── 案例库
          ├── 智能创作
          ├── 作品集
          ├── 素材管理
          ├── 发布管理
          └── 组织与项目权限
          │
          ├── SQLite / PostgreSQL
          ├── 本地 / S3 兼容媒体
          └── OpenAI 兼容模型服务
```

| 层级 | 技术 |
| --- | --- |
| 前端 | Next.js 16、React 19、TypeScript、Tailwind CSS |
| 后端 | FastAPI、Python 3.11+、Pydantic |
| 存储 | SQLite 或 PostgreSQL；本地或 S3 兼容媒体 |
| AI | OpenAI 兼容 Chat Completions 接口 |
| 浏览器提取 | Playwright Chromium，用于受支持流程的浏览器回退 |

## 快速开始

### 环境要求

- Python 3.11+
- Node.js 22.18+
- npm 10+

### 1. 克隆并配置

```bash
git clone https://github.com/xiaoninemao/Marventa-AI.git
cd Marventa-AI

cp backend/.env.example backend/.env
cp frontend/.env.local.example frontend/.env.local
```

在 `backend/.env` 中设置足够长的随机 `JWT_SECRET`。模型凭据可以立即配置，也可以稍后补充；没有模型服务时，工作区仍可启动并管理已有内容。

### 2. 启动

macOS 或 Linux：

```bash
chmod +x scripts/start-local.sh scripts/stop-local.sh
./scripts/start-local.sh
```

Windows PowerShell：

```powershell
.\scripts\start-local.ps1
```

启动脚本会准备 Python 环境、安装依赖、下载 Playwright Chromium，并启动前后端服务。

- Web 应用：[http://localhost:3000](http://localhost:3000)
- API：[http://localhost:8765](http://localhost:8765)
- API 文档：[http://localhost:8765/docs](http://localhost:8765/docs)，需启用 `DEBUG=true`

### 3. 停止

macOS/Linux 可在启动终端按 `Ctrl+C`，或运行：

```bash
bash scripts/stop-local.sh
```

Windows：

```powershell
.\scripts\stop-local.ps1
```

## 渠道账号授权

项目集成使用平台官方账号授权流程：

- 抖音使用网页 OAuth，并由后端处理回调。
- 小红书网页应用使用官方设备授权流程，在前端显示二维码并由后端轮询状态。
- Token 使用独立 Fernet 密钥加密保存，不会返回浏览器。

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

生成 `CHANNEL_CREDENTIAL_ENCRYPTION_KEY`：

```bash
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

小红书账号开放平台当前公开开放 `basic_info`，尚未公开开放笔记发布能力。抖音发布能力需要单独申请，并应在实际发布时再次取得授权。连接账号本身不代表已经取得平台发布权限。

## 定时发布

开启前先检查已有发布计划，然后在后端环境中配置：

```env
PUBLISHING_SCHEDULER_ENABLED=true
PUBLISHING_POLL_SECONDS=10
```

修改配置后重启后端。调度在后端运行期间自动执行，不依赖浏览器页面保持打开。默认关闭，避免升级后意外发布历史计划。

- **抖音图文与视频发布：**应用需获批 `video.create.bind` 能力，账号需真实授权该权限，并配置上述 OAuth 参数和 Fernet 密钥。虚拟账号没有平台凭证，不会发起平台发布请求；授权过期需重新连接账号。
- 使用官方[视频上传与创建](https://developer.open-douyin.com/docs/resource/zh-CN/dop/develop/openapi/video-management/douyin/create-video/video-create)、[图片上传与图文创建](https://developer.open-douyin.com/docs/resource/zh-CN/dop/develop/openapi/video-management/douyin/create-image-text/create-image-text)接口，图片按已保存顺序上传。标题、正文和标签合计最多 1,000 字符，图文发布最多 30 张、每张最多 20 MB；素材库本身仍不限制图片总数。
- 平台创建成功后保存 `item_id` 和创建结果的 `video_id`、记录时间，并锁定计划。创建成功**不等于已经公开展示**，审核及可见范围仍以平台为准。
- 失败记录明确原因且不泄露凭证，可重新设置计划。数据库领取与心跳避免多进程重复执行；中断任务恢复为失败，不自动重复提交。若创建请求超时或结果不确定，重新安排前应先检查平台账号，避免重复作品。
- **小红书限制：**官方[权限说明](https://openaccount.xiaohongshu.com/docs/scope)当前将 `write_notes` 标为“规划中”，仅开放 `basic_info`，没有可核实的公开服务端创作者上传/发布契约。发布渠道选择中暂时禁用小红书，历史计划仍可查看，再次保存设置前需切换到抖音；项目账号集成保留。历史小红书定时计划会明确失败，不发起平台请求；不会猜测接口或使用非官方签名、Cookie 自动化。接入小红书真实发布需提供获批合作接口规范。

## 对象存储

开发环境默认继续使用本地媒体目录。生产部署可将头像、案例媒体、项目素材、发布快照和市场洞察源文件切换到任意 S3 兼容服务，包括 AWS S3、Cloudflare R2 和 MinIO。

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

- AWS S3：填写实际区域，并将 `MEDIA_S3_ENDPOINT_URL` 留空。
- Cloudflare R2：区域使用 `auto`，Endpoint 使用账号对应的 S3 地址。
- MinIO：填写部署 Endpoint 和对应的寻址模式。
- 建议使用私有 Bucket。Marventa 会为媒体请求生成短期预签名地址。
- 只有明确使用公共 Bucket/CDN 时才配置 `MEDIA_S3_PUBLIC_BASE_URL`。
- 多个 Marventa 实例共用 Bucket 时，应设置不同的 `MEDIA_S3_PREFIX`。

现有本地媒体可以保持原有相对路径迁移，不需要修改数据库：

```bash
cd backend
.venv/bin/python scripts/migrate_media_to_object_storage.py --dry-run
.venv/bin/python scripts/migrate_media_to_object_storage.py
```

迁移脚本会上传并验证每个对象，但不会删除本地文件。确认应用在对象存储模式下工作正常后，再自行清理本地媒体目录。

## 生产数据库

**v1.2.0 PostgreSQL 提示：**原始标签存在发布数据表初始化兼容问题，可能报错或阻塞请求，SQLite 不受影响。相关修复已通过 PostgreSQL 16 实测，并包含在 [v1.2.1](https://github.com/xiaoninemao/marventa-ai/releases/tag/v1.2.1) 中；PostgreSQL 部署请使用 v1.2.1 或更新版本。v1.2.0 标签未被改写。

旧发布任务、统计、复盘、全局社交账号和账号记忆的 CRUD 实现已移除。历史表仍用于迁移、组织清理和管理导出兼容，代码清理不会删除已有记录；现有项目账号和定时发布接口不变。

SQLite 仍是无需配置的默认数据库：

```env
DATABASE_URL=
```

生产环境和多实例部署可以使用 PostgreSQL 16+：

```env
DATABASE_URL=postgresql://marventa:password@database.example.com:5432/marventa
```

同一套业务存储模块支持两种后端。PostgreSQL 使用原生事务、外键、范围约束触发器、自增标识列和冲突处理。数据库 URL 属于部署密钥，不能提交到仓库。

迁移已有安装时，先创建空 PostgreSQL 数据库、停止应用写入并备份 SQLite 和媒体，再运行：

```bash
cd backend
.venv/bin/python scripts/migrate_sqlite_to_postgres.py \
  --sqlite-path data/market_insight.db \
  --database-url 'postgresql://marventa:password@host:5432/marventa'
```

仅查看源数据库表和记录数，不连接 PostgreSQL：

```bash
.venv/bin/python scripts/migrate_sqlite_to_postgres.py \
  --sqlite-path data/market_insight.db \
  --database-url 'postgresql://unused' \
  --dry-run
```

目标数据库必须为空。迁移脚本会初始化 PostgreSQL 表结构、按依赖顺序复制数据，并核对每张表的记录数。完成生产验证前应保留 SQLite 备份。

## AI 模型配置

```env
AI_API_KEY=your-api-key
AI_BASE_URL=https://your-provider.example/v1
AI_MODEL=your-chat-model

# 示例：只让案例库分析使用支持图片的替代接口。
CASE_LIBRARY_AI_OVERRIDE_ENABLED=true
CASE_LIBRARY_AI_API_KEY=your-alternative-key
CASE_LIBRARY_AI_BASE_URL=https://your-vision-provider.example/v1
CASE_LIBRARY_AI_MODEL=your-vision-capable-model

JWT_SECRET=replace-with-a-long-random-string
```

| 配置 | 用途 |
| --- | --- |
| `AI_*` | 所有 AI 功能共用的统一默认接口 |
| `MARKET_INSIGHT_AI_*` | 可选的市场洞察接口，同时服务文档分析与公开研究 Agent |
| `CASE_LIBRARY_AI_*` | 可选的案例库分析接口，包括图片输入 |
| `CONTENT_STUDIO_AI_*` | 可选的智能创作接口，对话、内容卡片、单卡修改和报告生成共用 |
| `LEAD_TRACKING_AI_*` | 可选的评论线索分析接口 |

每组替代接口都有默认关闭的 `*_OVERRIDE_ENABLED` 开关。关闭时，即使填写了替代值也始终使用 `AI_*`；开启时必须完整填写该功能的 API Key、Base URL 和 Model，缺项会明确报错，不会静默回退。请填写 OpenAI 兼容 API 的基础地址，不要填写完整的 `/chat/completions` 路径。模型必须支持对应功能使用的参数和结构化 JSON 输出；图片分析还需要支持 `image_url` 输入。

智能创作图片上下文默认关闭：

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

启用后，本轮引用的 JPEG、PNG、WebP 素材会按限制作为 `image_url` 内容发送给智能创作当前生效的模型。每轮还可选择一个不超过 100 MB、时长不超过 5 分钟的 MP4、MOV、WebM 或 M4V 视频；后端 FFmpeg 会临时抽取 4 张按时间排序的 JPEG 关键帧。原视频与音频不会发送给模型，也不执行音频转写。重新生成和内容卡生成会根据最近一条用户消息的授权素材引用重新构建视觉输入。数据库只保存文本与素材 ID，不保存 base64 图片或关键帧；后端主机需安装 FFmpeg 和 ffprobe。

### 可选的有界市场研究

市场洞察保留上传、仓库解析、项目权限、历史记录及所选输出语言。默认生成基于
文档的摘要，**并不代表经过外部核实的市场研究**。如需启用公开网页研究：

```env
INSIGHT_RESEARCH_ENABLED=true
INSIGHT_SEARCH_PROVIDER=tavily
TAVILY_API_KEY=your-search-provider-key
```

启用公开研究时，市场洞察当前生效的模型须支持 OpenAI 兼容的函数工具调用。单个自适应循环使用可选择的
搜索接口（首个适配器为 Tavily HTTP），随后读取搜索返回的页面；不使用多 Agent
框架，也不会猜测或自动更换搜索服务。具有工具权限的模型只接收固定公开分类标签，
不接收上传原文、私有产品名或文档摘录，因此搜索可能较泛，需人工判断竞品相关性。
服务端只用固定分类及白名单意图词（竞品、比较、替代、价格、功能、部署、企业、
开源的英文词）构造查询，不转发模型任意文本、产品名或可能含凭证的仓库 URL。
上传内容仍会发送到您配置的 AI 服务进行原有文档分析及无工具的最终综合。
网页内容是不可信证据，不能作为执行指令。

硬上限：6 次搜索、12 次页面读取、12 轮工具规划、180 秒研究时间，且受原有
600 秒工作任务截止时间约束。研究阶段请求的输出 token 总额不超过 16,000
（原有文档摘要另有 4,096 token）；每页最多 512 KB、4,000 字符、3 次重定向。
研究模型上下文最多 48 KB JSON，证据摘录也会截断。
读取器只允许标准端口上的公开 HTTP(S)，检查每次重定向及全部 DNS 地址，
将实际连接固定到已经验证的 IP，并校验 HTTPS 主机证书；拒绝 URL 凭证、
私网地址、压缩响应及不支持的内容类型。不执行浏览器脚本、不携带登录 Cookie、
不访问本地网络。丢失任务租约后停止后续外发调用，在途请求有超时限制，
过期任务不能发布结果。

`AIAnalysis.research` 对旧记录可缺省，通过现有 JSON 存储持久化：

```text
{status: completed|partial|unavailable|edited,
 sources: [{id,title,url:string|null,kind:web|document,retrieved_at,excerpt}],
 claims: [{id,text,kind:fact|inference,source_ids,quote}],
 competitors: [{name,comparison,source_ids}],
 limitations: string[], searched_at: string|null}
```

只有成功读取并验证的网页才能成为网页来源，搜索摘要和模型编造的 URL 不会进入
来源清单。系统检查引用 ID 及引文是否确实存在于已读取的文本中，**不证明事实
正确性、完整性、竞品身份或来源独立性**。`completed` 只代表有界证据流程完成，
不表示全部陈述为真。
完成状态至少需要两个实际读取的网页、带匹配字面引文的公开网页陈述及有来源支持的
竞品比较；仅有搜索摘要、文档声明或模型返回空列表不能满足该条件。
未配置、搜索/读取失败或模型不支持工具时显示 `unavailable`；
预算不足、丢弃不合格引用或综合失败时显示带限制说明的 `partial`。摘要 JSON 无效
时任务失败，不会生成“成功”的空结果。文档摘要仍可让原有历史任务完成，但研究
可能不可用。人工修改由服务端设置为 `edited`，仅保留之前已存储的证据，原有证据
不再被视为支持修改后的摘要。手动创建的洞察不能 AI 分析或重试，没有研究元数据或
研究界面；服务端在手动创建、修改和重命名时丢弃客户端提供的研究数据。
文档洞察的重试会启动新的租约任务。

离线后端回归测试（不请求外部服务）：

```bash
cd backend
.venv/bin/python3.12 -m unittest tests.test_insight_research tests.test_research_web \
  tests.test_market_insight_language tests.test_market_insight_recovery
```

## 仓库结构

```text
Marventa-AI/
├── backend/
│   ├── app/                 # API、认证、存储和业务引擎
│   ├── scripts/             # 存储检查、备份与审计工具
│   └── tests/               # 后端回归测试
├── frontend/
│   ├── public/              # 本地界面资源
│   └── src/                 # Next.js 应用
└── scripts/                 # 跨平台开发脚本
```

运行时数据库、上传文件、日志、浏览器状态和环境配置不会进入版本控制。

## 开发

后端：

`TEST_POSTGRES_URL` 只能指向可丢弃的测试数据库，集成测试会重新创建其 `public` schema。

```bash
PYTHONPATH=backend:backend/tests backend/.venv/bin/python -m unittest discover -s backend/tests
backend/.venv/bin/python -m ruff check --select F,RUF100,B012,B018 backend/app backend/tests
backend/.venv/bin/python -m vulture backend/app --min-confidence 80
backend/.venv/bin/python -m pip check
```

前端：

```bash
cd frontend
npm ci
npm run lint
npx tsc --noEmit
npm test
npm run build
```

弹窗统一遵循一种交互规范：提交类的“取消”紧邻主操作按钮左侧，不显示关闭图标；预览类使用带无障碍名称的关闭图标，不显示“确定”和“取消”。查看与编辑混合的弹窗按模式切换。渠道授权介绍页使用无边框“返回 + 连接”，不额外显示“取消”。新增弹窗需登记到[弹窗交互回归清单](frontend/src/utils/dialog_actions.test.ts)。

## 安全

不要提交环境文件、API Key、浏览器配置、Cookie、客户资料或生产日志。公网部署应使用强随机 `JWT_SECRET`、`DEBUG=false`、HTTPS、适当的访问控制和经过验证的备份策略。

安全漏洞请按照 [SECURITY.md](SECURITY.md) 私下报告。

### 依赖维护

`next` 与 `eslint-config-next` 使用匹配的已修复版本。先应用兼容的依赖更新，再运行测试、类型检查、lint 和生产构建后部署。分别检查完整依赖树与生产依赖：

```bash
cd frontend
npm audit
npm audit --omit=dev
```

开发工具通告单独报告，不将其隐藏或标为已修复。若 `npm audit fix --force` 建议不兼容的框架或 lint 配置降级，不应直接执行。继续跟踪未修复的上游通告，更新锁文件后重新构建并重启前端。

截至 v1.4.1，由于当前 npm 代理尚未发布已修复版本，项目在本地固定官方上游 `source-map-js@1.2.2` Release 归档。通过根依赖与 npm override，Next.js、PostCSS 和 Tailwind 统一使用该安全版本；来源与 SHA-256 记录在 `frontend/vendor/`。`npm audit --omit=dev` 报告 0 个漏洞。完整审计仍有 5 条来自 ESLint/fast-glob/micromatch/braces 链的开发工具 high 通告，不执行不兼容降级或审计隐藏。

## 参与贡献

欢迎提交聚焦的问题和 Pull Request。参与前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md) 和 [社区行为准则](CODE_OF_CONDUCT.md)。

## 许可证

Marventa AI 基于 [MIT License](LICENSE) 发布。
