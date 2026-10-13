"""Generate fictional comment reports and promotion snapshots in an external SQLite DB."""

from __future__ import annotations

import argparse
import getpass
import json
import os
import sys
from datetime import datetime, time, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from dotenv import load_dotenv


BACKEND = Path(__file__).resolve().parents[1]
REPOSITORY = BACKEND.parent
PROJECT_TITLE = "本地模拟营销项目"
ACCOUNT_ID = "local-portable-opinion-demo-v1"
PLATFORM_USER_ID = "local-test-portable-opinion-v1"
WORKS = (
    ("local-opinion-work-1", "产品演示（虚构作品）", 22500, 1250, 190, 65),
    ("local-opinion-work-2", "智能营销功能介绍（虚构作品）", 18300, 960, 170, 53),
    ("local-opinion-work-3", "企业营销案例（虚构作品）", 14200, 740, 120, 41),
)
# Source phrases are templates. Generated comments and statistics are stored only in the external DB.
COMMENT_TEMPLATES = (
    ("能安排产品演示和报价吗？", 18, 3, 0),
    ("试用多久可以决定采购？", 12, 2, 0),
    ("新成员需要更清楚的上手教程。", 10, 2, 0),
    ("页面打开有点慢，希望优化加载速度。", 22, 4, 0),
    ("演示流程很顺畅，说明也容易理解。", 14, 1, 0),
    ("希望 CRM 线索可以同步到飞书。", 25, 5, 1),
    ("我们不需要 CRM 对接，现有导出就够用了。", 31, 6, 1),
    ("能否增加多账号权限和审批流程？", 17, 3, 1),
    ("审批提醒有时收不到，需要排查。", 20, 4, 1),
    ("CRM 对接文档在哪里？", 11, 1, 1),
    ("希望报表支持按渠道筛选。", 19, 3, 2),
    ("不要删除现有的报表导出功能。", 24, 4, 2),
    ("报表导出速度很慢，希望改进。", 29, 5, 2),
    ("周报格式清楚，复盘时很好用。", 13, 2, 2),
    ("私有化部署需要哪些服务器配置？", 16, 2, 2),
)
SCENARIOS = ("试用阶段", "团队协作时", "最近一次复盘", "新项目上线后", "日常使用中", "周会准备时")


def seed(output_dir: Path, days: int) -> dict[str, object]:
    output_dir = output_dir.resolve()
    if output_dir.is_relative_to(REPOSITORY):
        raise ValueError("The output directory must be outside the repository")
    output_dir.mkdir(parents=True, exist_ok=True)
    database = output_dir / "preview.db"
    load_dotenv(BACKEND / ".env", override=False)
    if not os.getenv("DEMO_PASSWORD", "").strip():
        if not sys.stdin.isatty():
            raise RuntimeError("Set DEMO_PASSWORD before running the demo generator")
        password = getpass.getpass("Local demo account password: ")
        if not password:
            raise RuntimeError("A local demo password is required")
        os.environ["DEMO_PASSWORD"] = password
    os.environ.update({
        "DB_PATH": str(database), "DATABASE_URL": "", "DEBUG": "true",
        "ENABLE_DEMO_USER": "true", "LEAD_DAILY_LOCAL_DEMO_PREVIEW": "true",
        "LEAD_DAILY_REPORT_ENABLED": "false", "LEAD_DAILY_REPORT_LLM_ENABLED": "false",
        "LEAD_DAILY_SEMANTIC_MODEL_PATH": "", "LEAD_TRACKING_ANALYSIS_MODE": "rules",
        "LEAD_TRACKING_SYNC_ENABLED": "false", "PUBLISHING_SCHEDULER_ENABLED": "false",
    })
    sys.path.insert(0, str(BACKEND))
    from app.main import app  # noqa: F401,E402 - initialize schema and local demo user
    from app.auth.storage import get_user_by_login  # noqa: E402
    from app.config import DEMO_USERNAME, LEAD_TRACKING_TIMEZONE  # noqa: E402
    from app.engines.publishing import daily_comment_report, lead_analysis, lead_tracking, storage  # noqa: E402
    from app.engines.publishing.lead_identity import lead_account_key_from_row  # noqa: E402
    from app.engines.publishing.projects import list_projects  # noqa: E402

    user = get_user_by_login(DEMO_USERNAME)
    if user is None:
        raise RuntimeError("Could not initialize the local demo account")
    project = next((item for item in list_projects(user["id"]) if item.title == PROJECT_TITLE), None)
    if project is None:
        project = storage.create_manual_project(
            user["id"], title=PROJECT_TITLE,
            notes="所有作品、用户、评论及推广统计均为虚构，仅供本地功能测试。",
        )
    stamp = lead_tracking._now()
    with storage._get_conn() as conn:
        existing = conn.execute(
            "SELECT project_id, platform_user_id, authorization_status, credential_blob "
            "FROM project_channel_accounts WHERE id = ?", (ACCOUNT_ID,),
        ).fetchone()
        if existing and (existing["project_id"] != project.id
                         or existing["platform_user_id"] != PLATFORM_USER_ID
                         or existing["authorization_status"] != "demo"
                         or existing["credential_blob"]):
            raise RuntimeError("The demo account ID is already used by different data")
        if not existing:
            conn.execute("""INSERT INTO project_channel_accounts
                (id, project_id, platform, account_name, platform_user_id, notes,
                 created_by_user_id, authorization_status, scopes, credential_blob, created_at, updated_at)
                VALUES (?, ?, 'douyin', 'Marventa AI 本地虚拟账号', ?,
                        '虚构账号，不连接平台，不同步真实评论。', ?, 'demo', '[]', '', ?, ?)""",
                (ACCOUNT_ID, project.id, PLATFORM_USER_ID, user["id"], stamp, stamp),
            )
    account = lead_tracking._internal_account(project.id, ACCOUNT_ID)
    if account is None or not daily_comment_report._local_demo_preview(account):
        raise RuntimeError("The external SQLite local-demo guard is not active")
    key = lead_account_key_from_row(account)
    zone = ZoneInfo(LEAD_TRACKING_TIMEZONE)
    yesterday = datetime.now(zone).date() - timedelta(days=1)
    first_day = yesterday - timedelta(days=days - 1)
    published = datetime.combine(first_day - timedelta(days=35), time(8), timezone.utc).isoformat().replace("+00:00", "Z")
    with storage._get_conn() as conn:
        for item_id, title, views, likes, comments, shares in WORKS:
            conn.execute("""INSERT INTO lead_tracking_account_targets
                (account_key, platform, platform_user_id, item_id, discovered_at, last_seen_at,
                 title, share_url, published_at, views, likes, comments, shares)
                VALUES (?, 'douyin', ?, ?, ?, ?, ?, '', ?, ?, ?, ?, ?)
                ON CONFLICT(account_key, item_id) DO UPDATE SET
                  title=excluded.title, published_at=excluded.published_at,
                  views=excluded.views, likes=excluded.likes,
                  comments=excluded.comments, shares=excluded.shares""",
                (key, PLATFORM_USER_ID, item_id, stamp, stamp, title, published,
                 views, likes, comments, shares),
            )

    for offset in range(days):
        selected = first_day + timedelta(days=offset)
        with storage._get_conn() as conn:
            existing_run = conn.execute(
                "SELECT is_simulated FROM lead_tracking_account_comment_runs "
                "WHERE account_key = ? AND local_date = ?", (key, selected.isoformat()),
            ).fetchone()
        if existing_run and not existing_run["is_simulated"]:
            raise RuntimeError(f"Refusing to replace a real comment snapshot: {selected}")
        rows = []
        for index in range(1, 15):
            phrase, likes, replies, work_index = COMMENT_TEMPLATES[(index + offset * 4) % len(COMMENT_TEMPLATES)]
            context = SCENARIOS[(index + offset) % len(SCENARIOS)]
            created = int(datetime.combine(selected, time(8 + index % 10, index % 60), zone).timestamp())
            rows.append(lead_tracking._comment({
                "comment_id": f"local-portable-{selected:%Y%m%d}-{index:02d}",
                "comment_user_id": f"fictional-user-{(index + offset * 7) % 89:02d}",
                "content": f"{phrase}（{context}）", "create_time": created,
                "digg_count": likes + offset % 5, "reply_comment_total": replies,
                "top": False,
            }, WORKS[work_index][0]))
        lead_tracking._save_run(
            key, selected, "completed", False,
            "本地虚构评论快照；并非平台采集结果。", rows, is_simulated=True,
        )
        daily_comment_report.generate_daily_report(account, selected, notify=False)
        analysis = lead_analysis.get_lead_analysis(user["id"], project.id, ACCOUNT_ID, selected)
        if analysis.status != "completed":
            lead_analysis.analyze_comment_snapshot(user["id"], project.id, ACCOUNT_ID, selected)

    # A prior-period baseline and two full 30-day windows allow either trend selector.
    snapshot_start = yesterday - timedelta(days=60)
    with storage._get_conn() as conn:
        for offset in range(61):
            local_date = (snapshot_start + timedelta(days=offset)).isoformat()
            fraction = (offset + 1) / 61
            for item_id, _, views, likes, comments, shares in WORKS:
                conn.execute("""INSERT INTO lead_tracking_post_metric_snapshots
                    (account_key, local_date, item_id, views, likes, comments, shares, observed_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(account_key, local_date, item_id) DO UPDATE SET
                      views=excluded.views, likes=excluded.likes,
                      comments=excluded.comments, shares=excluded.shares,
                      observed_at=excluded.observed_at""",
                    (key, local_date, item_id, round(views * fraction), round(likes * fraction),
                     round(comments * fraction), round(shares * fraction), stamp),
                )
    manifest = {"database": str(database), "project_id": project.id,
                "account_id": ACCOUNT_ID, "demo_username": DEMO_USERNAME,
                "days": days, "is_simulated": True}
    (output_dir / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    return manifest


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, default=Path.home() / ".marventa" / "local-demo")
    parser.add_argument("--days", type=int, choices=(14, 30), default=30)
    args = parser.parse_args()
    print(json.dumps(seed(args.output_dir, args.days), ensure_ascii=False, indent=2))
