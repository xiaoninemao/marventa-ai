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

### 项目工作区

- 明确的项目成员与角色
- 工作区操作通过本地化 toast 说明未满足的条件、权限限制、编辑锁与处理中状态，不再只置灰；操作拦截与后端校验仍然有效。
- 中英文操作按钮使用统一的简短动词与处理中状态；弹窗标题和无障碍描述保留识别操作所需的上下文。
- 洞察、案例、创作、媒体和作品全部绑定项目
- 通过平台授权完成项目级小红书与抖音账号连接；断开账号连接前需要二次确认。
- 创建者信息与项目级权限
- 核心流程均支持项目搜索与快速切换
- 项目、案例库、智能创作、作品集、发布管理与组织列表的分页栏固定在内容区底部，支持页码、总条数和每页数量；搜索与筛选后重置页码，删除后自动调整到有效页面。首页仍只预览最近五个项目。

### 素材管理

- 通过项目素材集管理图片、视频和可编辑富文本文案，提供真实媒体拼贴封面与应用内预览。
- 支持上传媒体，或每次导入一个 TXT、Markdown、PDF、DOCX 文档作为可编辑文案。导入保留可读文字与支持的格式，不包含嵌入图片或复杂排版；无可提取文字的 PDF 暂不支持 OCR。
- 支持富文本文案编写、编辑和隔离预览，新文案根据首句或首个非空行生成标题，修改正文不会更改标题。
- 支持素材集与素材重命名、删除；素材集不允许重名，同名文件自动添加数字后缀，不覆盖原文件。
- 重复选文件会提示，发布计划引用素材时保留项目原件的独立性。

### 发布管理

- 创建与重命名项目发布计划，分别管理图片或单个视频，以及纯文本发布标题和正文。
- 图片提供大图预览与插入式拖动排序，视频采用全宽播放器；素材导入分批提交，实际发布仍受平台限制。
- 媒体修改即时保存，标题、正文及导入文案自动保存，提供状态反馈、失败重试和防止旧请求覆盖新输入的保护。
- 发布设置依次选择渠道、账号、日期与时间；要求完整选择本地日期和时间，日期必须在今天之后。已计划的内容和设置只读，取消定时发布后才能修改。
- 支持取消已有定时发布，或重新安排已取消、失败的计划，保留原有内容。
- 开启后端调度后，通过官方接口上传并创建抖音图文或视频作品，记录平台结果并防止重复执行。
- 已计划、发布中与已发布时，前后端均锁定内容和设置；失败保留内容并明确原因，结果不确定时提示先检查平台再重试。

授权条件、平台限制、启用方式与小红书可用性见[定时发布](#定时发布)。

### 账号内容

- 多图图文支持紧凑图片预览、张数、缩略图与前后切换；“本系统发布”按保存的顺序读取图片。当前平台接口只有封面，不将封面当作完整图集。
- 本系统媒体地址跟随后端地址，支持本地 HTTP 开发环境；第三方平台媒体和分享链接仍只接受公网 HTTPS 地址。
- “本系统发布”中已保存的视频支持原生播放器直接播放，不自动播放。平台 `share_url` 仍是作品网页链接，不作为视频媒体流地址使用，不能据此推断平台直播放能力。
- 有有效视频编号的抖音公开视频可点击加载[官方 iframe 播放器](https://developer.open-douyin.com/docs/resource/zh-CN/dop/develop/openapi/video-management/douyin/iframe-player/get-iframe-by-video)。后端调用 `GET /api/douyin/v1/video/get_iframe_by_video`，不转发账号凭证，只提取白名单播放器地址，不注入平台返回的 HTML。关闭自动播放、由用户主动加载；这是内嵌播放，不是 MP4/HLS 直链。播放器文档说明无需额外申请权限，但获取账号作品仍需要获批并授权 `video.list`。
- 平台账号读取与内嵌播放已通过自动化接口契约测试，但当前开发环境尚未使用真实授权账号完成验证。
- 已核对的列表、视频详情及基础统计接口未提供收藏数、完整图集地址和独立正文；平台作品保留缺失状态，不推测或伪造这些数据。其他受限能力需要另外核实适用接口与申请条件。
- 内容详情分开展示标题与正文。“本系统发布”读取保存的文案标题和内容；当前平台接口只提供标题字段，保留原文，不按换行虚构正文。
- 内容详情在媒体预览下方居中展示播放、点赞、评论与分享；未提供的数据显示 `—`，不当作零。已核对的平台接口不提供收藏数，因此不展示收藏字段。

- 入口位于发布管理下方，先选择渠道，再选择已连接账号；切换渠道时清空账号选择并重置分页。每次选择账号都会重新拉取第一页，包括再次选择同一账号。
- 内容来源保存在链接中，收藏或刷新账号/项目页面后，仍保留“平台作品”或“本系统发布”的选择。
- 持久化的平台作品模拟数据单独存储，仅适用于明确的模拟账号且无平台凭证。卡片和详情显示“模拟数据”，不发起真实平台请求，不提供平台分享链接或官方播放器；不会替代真实账号的授权错误或接口结果。
- 平台作品使用抖音已公开文档中的 `video.list` 读取能力，展示接口返回的视频与图集。此旧版官方接口最多提供四页，不代表账号的完整作品档案；当前应用能否获准使用以及新版体裁覆盖范围，需要平台确认。
- 平台作品与“本系统发布”分开显示；后者仅代表通过 Marventa 提交且被平台受理，不证明已公开展示。
- 每次请求均检查当前组织与项目成员权限；平台不支持、授权过期、缺少读取权限及接口失败都会明确提示。
- 启用抖音读取前，先申请并获准 `video.list`，将其加入 `DOUYIN_CHANNEL_SCOPES`（保留其他已获准权限），再重新授权账号。现有默认授权范围不变，不使用小红书非官方抓取。

### 线索追踪

- 一级工作区按渠道账号聚合可访问绑定；同一平台账号只显示一次，并在卡片中列出全部关联项目。支持项目侧栏、账号/项目搜索、渠道筛选和统一分页。
- 点击实体后进入账号线索分析工作区；项目参数只用于验证用户是否可通过某个项目访问该账号。同一组织内同一平台账号的作品目标、每日评论快照、Top 50、AI 分析和人工确认全都按账号身份共享，调度器只同步和分析一次。
- 账号工作区分为“评论洞察”和“线索分析”。启用评论同步后，后端按所配 IANA 时区每天 00:00 汇总前一自然日可访问评论，按“点赞数＋回复数 × 2”、评论时间和评论 ID 稳定排序，展示 Top 50；部分完成及不可用状态均明确显示。
- 每日评论同步成功后会自动执行线索分析，输出 0–100 意向分、高/中/低意向、需求标签、评分依据和建议动作；运营人员可将结果标记为已确认、已忽略或待确认。`LEAD_TRACKING_ANALYSIS_MODE=rules` 使用完全本地的可解释规则；显式设置为 `ai` 后，会通过配置的 `CASE_AI_*` OpenAI-compatible 服务按受控批次分析评论，并在页面标明模型。发送给模型的数据不包含评论用户 ID、账号 ID 或项目 ID，模型输出必须通过固定枚举、完整 ID 集合和严格 JSON 校验。重新同步评论会使同日旧分析失效，重新分析则保留仍存在评论的人工确认状态；任一 AI 批次失败都会整体标记失败，不会静默回退为规则结果。
- 评论同步默认关闭；启用 `LEAD_TRACKING_SYNC_ENABLED=true` 前需获批 `item.comment` 并重新授权账号。系统只跟踪官方账号内容读取成功后登记的作品，限制页数和评论数，快照可幂等重跑。线索分析不会推断手机号、微信、真实身份或成交结果；持久化演示数据始终明确标记为模拟数据。

### 市场洞察

- 支持 Markdown、PDF、DOCX 和仓库内容解析
- 可选启用有界研究 Agent，在综合分析前搜索公开资料并读取网页，附带可追溯来源、引文和明确标记的分析推断；配置、隐私边界与执行限制见下方市场研究说明。
- 如实区分研究完成、部分完成、不可用及人工修改状态。引用与引文检查只确认来源，不证明事实正确；缺少服务配置不会伪装成成功的空研究结果。
- 生成结构化产品与市场分析
- AI 生成的结果在界面中只读；有管理权限的成员仍可编辑手动创建的洞察。
- 分析跟随界面语言，支持状态自动刷新、中断恢复和安全的手动重试。
- 清晰的后台处理、完成和失败状态
- 已完成洞察可直接作为智能创作上下文

### 案例库

- 支持图片、视频、正文和公开链接导入
- 后台补充可公开获取的信息
- 按需执行结构化 AI 分析
- 分析跟随界面语言，提供统一的详情预览与上传校验。
- 项目级收藏和创作引用
- 案例提交按钮统一使用“上传”，媒体上传与公开链接导入逻辑保持不变。

### 智能创作

- 围绕项目知识进行引导式对话
- 独立的洞察与案例引用流程
- 先选择当前项目的素材集，再勾选其中的图片、视频和文案；切换素材集时保留已选项。引用随提交消息与创作上下文保存。文案原文提供给 AI，媒体引用提供素材信息，不代表自动识别图片或分析视频。
- 支持短视频和图文内容策划
- 每次生成五类结构化内容卡片
- 支持单卡修改、活动记录、版本管理和恢复
- 标准卡片标题随界面语言切换，不改写自定义标题或翻译已保存正文。
- 完整保留原文的内容预览与一致的引用卡片布局
- 支持查看同一创作中的在线成员

### 作品集

- 报告采用连续单栏阅读排版与清晰章节层级，不再拆成独立卡片；详情只读，保留双语预览和 PDF 导出。

- 独立作品列表和报告详情
- 清晰的后台生成状态
- 完整对应的中英文报告版本
- 七个具备执行细节的策略章节
- 支持模块化编辑、预览和 PDF 导出

### 团队协作

- 个人默认组织与自建组织
- 组织角色和项目角色使用独立权限边界
- 持久化邀请与角色变化通知
- 稳定的账号身份与可上传头像

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
CASE_AI_API_KEY=your-api-key
CASE_AI_BASE_URL=https://your-provider.example/v1
CASE_AI_MODEL=your-chat-model

CASE_ANALYSIS_AI_API_KEY=your-api-key
CASE_ANALYSIS_AI_BASE_URL=https://your-provider.example/v1
CASE_ANALYSIS_AI_MODEL=your-vision-capable-model

# 可选；留空时继承 CASE_AI_*。
MODIFY_CARD_AI_API_KEY=
MODIFY_CARD_AI_BASE_URL=
MODIFY_CARD_AI_MODEL=

JWT_SECRET=replace-with-a-long-random-string
```

| 配置 | 用途 |
| --- | --- |
| `CASE_AI_*` | 市场洞察、对话、内容卡片和报告 |
| `CASE_ANALYSIS_AI_*` | 结构化案例分析，包括图片输入 |
| `MODIFY_CARD_AI_*` | 可选的单卡修改独立模型服务 |

请填写 OpenAI 兼容 API 的基础地址，不要填写完整的 `/chat/completions` 路径。模型必须支持对应功能使用的参数和结构化 JSON 输出；图片分析还需要支持 `image_url` 输入。

### 可选的有界市场研究

市场洞察保留上传、仓库解析、项目权限、历史记录及所选输出语言。默认生成基于
文档的摘要，**并不代表经过外部核实的市场研究**。如需启用公开网页研究：

```env
INSIGHT_RESEARCH_ENABLED=true
INSIGHT_SEARCH_PROVIDER=tavily
TAVILY_API_KEY=your-search-provider-key
```

`CASE_AI_*` 模型须支持 OpenAI 兼容的函数工具调用。单个自适应循环使用可选择的
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

截至 v1.4.0，`npm audit --omit=dev` 对 `source-map-js → postcss → next` 依赖链报告 3 条关联 high 通告，对应 [GHSA-68fv-2mgg-jv7q](https://github.com/advisories/GHSA-68fv-2mgg-jv7q)。通告要求 `source-map-js >=1.2.2`，但 npm 当前最新版本仍为 `1.2.1`；npm 唯一建议是将 Next.js 不兼容地降级到 12.0.8。因此该上游通告按“未解决”公开记录，不隐藏，也不执行强制修复。

## 参与贡献

欢迎提交聚焦的问题和 Pull Request。参与前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md) 和 [社区行为准则](CODE_OF_CONDUCT.md)。

## 许可证

Marventa AI 基于 [MIT License](LICENSE) 发布。
