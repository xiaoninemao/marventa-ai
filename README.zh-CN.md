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
- 发布设置依次选择渠道、账号、日期与时间；要求完整选择本地日期和时间，日期必须在今天之后。已计划的设置点击“编辑”后才能修改。
- 支持取消已有定时发布，或重新安排已取消、失败的计划，保留原有内容。
- 开启后端调度后，通过官方接口上传并创建抖音图文或视频作品，记录平台结果并防止重复执行。
- 发布中与已发布时，前后端均锁定内容和设置；失败保留内容并明确原因，结果不确定时提示先检查平台再重试。

授权条件、平台限制、启用方式与小红书可用性见[定时发布](#定时发布)。

### 市场洞察

- 支持 Markdown、PDF、DOCX 和仓库内容解析
- 生成结构化产品与市场分析
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

## 参与贡献

欢迎提交聚焦的问题和 Pull Request。参与前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md) 和 [社区行为准则](CODE_OF_CONDUCT.md)。

## 许可证

Marventa AI 基于 [MIT License](LICENSE) 发布。
