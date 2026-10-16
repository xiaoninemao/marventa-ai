# 每日智能评论简报

此模块在现有「评论洞察」和「线索分析」之外运行，沿用 FastAPI、Next.js、账号组织隔离和评论快照。旧接口与线索意向分保持兼容；新简报不给单条评论打 1–100 分，而是展示观点、议题证据和证据等级。

## 启用条件

1. 抖音开放平台应用获批 `video.list` 和 `item.comment`，并由真实账号重新授权。暂不支持的平台、未授权账号和本地模拟评论不会形成真实日报。
2. 配置共享持久数据库。单机可使用现有 SQLite；多实例部署建议设置 `DATABASE_URL` 使用 PostgreSQL。多个 worker 通过数据库任务认领避免重复处理。
3. 在 `backend/.env` 配置：

```dotenv
LEAD_TRACKING_SYNC_ENABLED=true
LEAD_DAILY_REPORT_ENABLED=true
LEAD_TRACKING_TIMEZONE=Asia/Shanghai
LEAD_DAILY_RETRY_MINUTES=15
LEAD_DAILY_SEMANTIC_MODEL_PATH=
LEAD_DAILY_REPORT_LLM_ENABLED=false
```

后端启动后会尝试处理昨天及前两天未完成的任务，每 15 分钟检查一次。每个账号、日期最多尝试五次，失败指数退避。任务会从官方 `video.list` 发现作品，按评论时间读取前一日评论；超过作品或评论读取上限会标记采集不完整。无评论时也保存空简报。完成后向同时具有组织成员身份和对应项目访问权限的用户发送站内通知。

「舆情追踪 → 项目 → 账号分析」点击账号卡片打开详情弹窗，包含评论洞察、意向评估和每日简报，不提供页面级作品选择器。关闭、Escape 或点击遮罩返回原账号列表，保留筛选和分页；意向分析与线索复核保存期间阻止关闭。每日简报默认展示最新日报，只保留话题反馈分析、产品／营销建议和可展开的关联原始证据；不显示产品评论跳转、导出、核心评论列表、日期选择器或刷新按钮，失败时保留重试。评论浏览与线索复核使用独立页签。历史通知链接仍可指定日期并打开日报。项目监测总览汇总该项目全部账号，账号弹窗继续使用原有账号权限与数据范围；旧详情链接跳转到项目列表并打开对应弹窗。

## 受限路演数据

生产环境可用 `LEAD_ROADSHOW_PREVIEW_ACCOUNT_IDS` 显式列出允许展示路演快照的渠道账号 ID（英文逗号分隔，默认空）。每个账号必须保留 `demo` 授权状态、`local-test-` 平台身份且没有平台凭据；真实授权账号、未列入名单的账号和其他项目不会因此获得演示访问权限。无需打开 DEBUG 或启用默认演示用户。

快照和日报始终保留 `is_simulated=true`，日报不标记采集完整、不发送通知、不调用付费模型，不能作为真实平台采集或发布凭证。纯演示周期的总览话题使用确定性规则展示；真实或混合周期仍沿用原有主题模型要求。关闭名单后模拟快照恢复为不可用。正文、产品名称和素材不需要逐条附加“模拟”字样，界面仍保留已有的数据来源提示。

## 语义模型

语义模型为可选的本地、经过领域数据微调的中文 BERT 分类器。缺少模型时，简报仍可用规则归类，但所有评论标记待人工复核，且不会给出「较高可信度需求」。安装训练与推理依赖：

```powershell
cd backend
.venv\Scripts\python.exe -m pip install -r requirements-semantic.txt
```

准备三份**人工标注真实评论** JSONL，分别为训练、验证和测试集。每行格式如下：

```json
{"text":"我不需要这个导出功能","labels":["reject_feature"]}
```

可用标签：`purchase_intent`、`feature_request`、`negative_feedback`、`reject_feature`、`keep_feature`、`sarcasm_ambiguity`。一条评论可有多个标签。将相同或高度相似评论去重，并按账号或时间划分数据，避免测试泄漏。训练命令：

```powershell
.venv\Scripts\python.exe scripts/train_comment_semantics.py --train data/train.jsonl --validation data/validation.jsonl --test data/test.jsonl --output data/models/comment-bert-v1
```

脚本用验证集校准概率与分类阈值，在独立测试集上检查各类别的精确率、召回率和否定句误报，生成 `validation.json`。只有达到门槛且 `validated=true` 的本地检查点才会被服务加载。配置 `LEAD_DAILY_SEMANTIC_MODEL_PATH` 为该目录的绝对路径后重启后端。训练依赖较重，建议在资源充足的机器离线训练，再将检查点部署到服务器。首次上线应人工抽查否定句、反讽和多议题评论。

## 可选 LLM

`LEAD_DAILY_REPORT_LLM_ENABLED=true` 时，复用 `LEAD_TRACKING_AI_*` 或通用 `AI_*` 服务商。发送前会脱敏联系信息。LLM 只能在预定义产品／营销动作中选择，且必须引用本次真实评论 ID；服务端拒绝未知议题、未知评论和不允许的动作，失败时使用确定性建议。证据等级、样本量和趋势完全由服务端计算。

## 数据口径

- 「前一日评论」指昨日发表在账号已验证作品下的评论，包括旧作品昨日收到的新评论。
- 简报按账号和日期保存已采集评论。账号反馈分析使用本日各作品全部已获取且去重的评论，关联原始证据标注所属作品；不展示核心评论或按作品浏览评论的独立列表。后台保留完整的作品级证据供项目汇总使用，`点赞数 + 回复数 × 2` 不进入证据等级。页面不显示评论数、不同评论者和作品数三栏统计卡片。
- 议题展示正反意见、不同评论者、作品覆盖和近七日报告趋势。「采集完整」仅表示本次官方接口遍历未触及系统上限，不代表覆盖平台全部用户。采集不完整或模型未验证时不产生「较高可信度需求」。样本不足时只建议观察或访谈。
- 日报读取接口重新检查当前组织和项目访问权限。旧版 Top 50 评论洞察和线索分析保持原状；历史话题决策和评论复核记录继续生效，数据库表不删除，舆情策略和意向复核仍使用这些记录。

## 验证

```powershell
$env:PYTHONPATH="backend"
backend\.venv\Scripts\python.exe -m unittest discover -s backend/tests -p test_daily_comment_report.py -q
cd frontend
node node_modules/typescript/bin/tsc --noEmit
```

后端接口：`GET /api/v1/publishing/projects/{project_id}/channel-accounts/{account_id}/lead-tracking/daily-reports?date=YYYY-MM-DD`，不传日期时读取默认日报，历史通知仍可传入日期。已移除不再使用的 `daily-report-dates`、`daily-report-download`、`daily-comment-reviews` 和 `daily-report-decisions` 路由及其专用导出／筛选／写入逻辑；旧调用方需停止调用这些接口，它们不再提供服务。评论洞察、意向复核、项目汇总和策略接口不受影响。
