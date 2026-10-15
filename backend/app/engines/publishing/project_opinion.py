"""Project opinion evidence, deduplicated by organization/platform identity."""

from __future__ import annotations

from collections import defaultdict
from datetime import date, timedelta

from pydantic import BaseModel, Field

from app.engines.publishing import opinion_monitor, opinion_strategy, storage
from app.engines.publishing.account_content import _account_rows
from app.engines.publishing.daily_comment_report import (
    DailyCommentReport,
    _local_demo_preview,
)
from app.engines.publishing.lead_identity import lead_account_key_from_row
from app.engines.publishing.opinion_details import (
    OpinionDetails,
    OpinionPerformance,
    OpinionPerformancePoint,
    OpinionPost,
    OpinionVoice,
    _published_day,
    get_opinion_details,
)
from app.engines.publishing.opinion_monitor import OpinionDailyPoint, OpinionOverview
from app.engines.publishing.opinion_strategy import (
    OpinionAction,
    OpinionActionSummary,
    OpinionStrategy,
    _period,
)


class ProjectSource(BaseModel):
    project_id: str
    account_id: str
    account_name: str


class ProjectOpinionPost(OpinionPost, ProjectSource):
    source_item_id: str


class ProjectOpinionVoice(OpinionVoice, ProjectSource):
    source_comment_id: str
    source_item_id: str


class ProjectOpinionAction(OpinionAction, ProjectSource):
    source_action_id: str
    platform: str


class ProjectOpinionDailyPoint(OpinionDailyPoint):
    covered_accounts: int = 0
    total_accounts: int = 0
    collection_complete: bool = False


class ProjectOpinionOverview(OpinionOverview):
    daily: list[ProjectOpinionDailyPoint] = Field(default_factory=list)


class ProjectOpinionPerformance(OpinionPerformance):
    rate: float | None = None


class ProjectOpinionDetails(OpinionDetails):
    posts: list[ProjectOpinionPost] = Field(default_factory=list)
    comments: list[ProjectOpinionVoice] = Field(default_factory=list)
    performance: ProjectOpinionPerformance = Field(default_factory=ProjectOpinionPerformance)


class ProjectOpinionActions(OpinionActionSummary):
    actions: list[ProjectOpinionAction] = Field(default_factory=list)


class ProjectOpinionMonitor(BaseModel):
    overview: ProjectOpinionOverview
    details: ProjectOpinionDetails
    actions: ProjectOpinionActions


def _accounts(user_id: str, project_id: str) -> list[dict]:
    # _account_rows checks project membership and the user's organization even
    # when the project has no channel bindings.
    unique: dict[str, dict] = {}
    for account in _account_rows(user_id, project_id):
        unique.setdefault(lead_account_key_from_row(account), account)
    return list(unique.values())


def _identity(kind: str, key: str, raw_id: str) -> str:
    # The key is a fixed-length SHA256 identity; raw provider IDs may contain ':'.
    return f"{kind}:{key}:{raw_id}"


def _source(account: dict) -> dict:
    return {name: account[name] for name in ("project_id", "account_name")} | {"account_id": account["id"]}


def _overview(accounts: list[dict], project_id: str, days: int) -> ProjectOpinionOverview:
    start, end = map(date.fromisoformat, _period(days))
    training_start = end - timedelta(days=29)
    rows: list[dict] = []
    runs_by_day: dict[str, list[dict]] = defaultdict(list)
    simulated = False
    for account in accounts:
        key = lead_account_key_from_row(account)
        runs, comments = opinion_monitor._opinion_evidence(account, training_start.isoformat(), end.isoformat())
        for run in runs:
            if run["status"] in ("completed", "partial"):
                runs_by_day[run["local_date"]].append(run)
                if run["local_date"] >= start.isoformat():
                    simulated = simulated or bool(run["is_simulated"])
        rows.extend({
            **row,
            "comment_id": _identity("comment", key, row["comment_id"]),
            "comment_user_id": _identity("user", key, row["comment_user_id"]) if row["comment_user_id"] else "",
            "item_id": _identity("post", key, row["item_id"]),
        } for row in comments)
    runs = [{
        "local_date": day,
        "status": "completed" if len(items) == len(accounts) and all(
            item["status"] == "completed" and not item["limited"] for item in items
        ) else "partial",
        "limited": any(item["limited"] for item in items),
        "last_synced_at": max(item["last_synced_at"] for item in items),
    } for day, items in sorted(runs_by_day.items())]
    rows.sort(key=lambda row: (row["local_date"], row["comment_id"]), reverse=True)
    base = opinion_monitor._overview_from_evidence(
        f"project:{project_id}", runs, rows, days, start, end, simulated,
    )
    result = ProjectOpinionOverview.model_validate(base.model_dump())
    if result.incomplete_days:
        result.status = "partial"
    # Account endpoints retain their original shape; project points explicitly
    # distinguish partial collection from verified zero and missing collection.
    points = {point.date: point for point in base.daily}
    result.daily = []
    for offset in range(days):
        day = (start + timedelta(days=offset)).isoformat()
        items = runs_by_day.get(day, [])
        complete = bool(accounts) and len(items) == len(accounts) and all(
            item["status"] == "completed" and not item["limited"] for item in items
        )
        point = points.get(day, OpinionDailyPoint(date=day))
        values = point.model_dump()
        if len(items) != len(accounts) or not accounts:
            values.update(comments=None, negative_percent=None)
        result.daily.append(ProjectOpinionDailyPoint(
            **values, covered_accounts=len(items), total_accounts=len(accounts),
            collection_complete=complete,
        ))
    return result


def _sum_complete(values: list[int | None]) -> int | None:
    return sum(values) if values and all(value is not None for value in values) else None


def _details(user_id: str, project_id: str, accounts: list[dict], days: int) -> ProjectOpinionDetails:
    result = ProjectOpinionDetails(period_days=days)
    performances = []
    risk_count = 0
    for account in accounts:
        key = lead_account_key_from_row(account)
        details = get_opinion_details(user_id, project_id, account["id"], days)
        result.is_simulated = result.is_simulated or details.is_simulated
        risk_count += details.performance.risk_count
        for post in details.posts:
            result.posts.append(ProjectOpinionPost(
                **(post.model_dump() | {"item_id": _identity("post", key, post.item_id)}),
                **_source(account), source_item_id=post.item_id,
            ))
        for comment in details.comments:
            result.comments.append(ProjectOpinionVoice(
                **(comment.model_dump() | {
                    "comment_id": _identity("comment", key, comment.comment_id),
                    "item_id": _identity("post", key, comment.item_id),
                }), **_source(account),
                source_comment_id=comment.comment_id, source_item_id=comment.item_id,
            ))
        if details.posts:
            performances.append(details)
    result.posts.sort(key=lambda item: (item.engagement is None, -(item.engagement or 0), item.item_id))
    result.comments.sort(key=lambda item: (item.created_at, item.likes + item.replies * 2), reverse=True)
    start, _ = _period(days)
    daily = []
    for offset in range(days):
        day = (date.fromisoformat(start) + timedelta(days=offset)).isoformat()
        previous_day = (date.fromisoformat(day) - timedelta(days=days)).isoformat()
        totals = {}
        for target_day, fields in (
            (day, ("views", "engagement")),
            (previous_day, ("previous_views", "previous_engagement")),
        ):
            points = [next(point for point in details.performance.daily if point.date == day)
                      for details in performances if any(
                          not (published := _published_day(post.published_at)) or published <= target_day
                          for post in details.posts)]
            totals.update({field: _sum_complete([getattr(point, field) for point in points])
                           for field in fields})
        daily.append(OpinionPerformancePoint(date=day, **totals))
    views = _sum_complete([post.views for post in result.posts])
    engagement = _sum_complete([post.engagement for post in result.posts])
    result.performance = ProjectOpinionPerformance(
        post_count=len(result.posts), views=views,
        engagement=engagement, rate=round(engagement / views * 100, 2)
        if views and engagement is not None else None,
        risk_count=risk_count,
        daily=daily,
    )
    return result


def _actions(user_id: str, project_id: str, accounts: list[dict], days: int) -> ProjectOpinionActions:
    start, end = _period(days)
    result = ProjectOpinionActions(
        period_days=days, start_date=start, end_date=end,
        llm_available=opinion_strategy._llm_available(),
    )
    report_dates: set[str] = set()
    pending: set[str] = set()
    negative: set[str] = set()
    unexpanded_pending = unexpanded_negative = 0
    for account in accounts:
        key = lead_account_key_from_row(account)
        summary = opinion_strategy.get_opinion_actions(user_id, project_id, account["id"], days)
        result.is_simulated = result.is_simulated or summary.is_simulated
        for action in summary.actions:
            result.actions.append(ProjectOpinionAction(
                **(action.model_dump() | {
                    "id": _identity("action", key, action.id),
                    "evidence_comment_ids": [_identity("comment", key, raw) for raw in action.evidence_comment_ids],
                }), **_source(account), source_action_id=action.id, platform=account["platform"],
            ))
        with storage._get_conn() as conn:
            reports = conn.execute(
                """SELECT local_date, report_json FROM lead_daily_reports
                   WHERE account_key = ? AND organization_id = ? AND local_date BETWEEN ? AND ?
                     AND status IN ('completed', 'partial') ORDER BY local_date DESC""",
                (key, account["organization_id"], start, end),
            ).fetchall()
        seen: set[str] = set()
        for row in reports:
            report = DailyCommentReport.model_validate_json(row["report_json"])
            if report.organization_id != account["organization_id"] or report.account_key != key:
                continue
            if report.is_simulated and not _local_demo_preview(account):
                continue
            report_dates.add(row["local_date"])
            if not report.work_analyses:
                # Older summaries may have aggregate counts but no expanded
                # comment records. Preserve those counts rather than invent 0.
                unexpanded_pending += report.pending_review_comments
                unexpanded_negative += report.negative_feedback_comments
            for work in report.work_analyses:
                for comment in work.comments:
                    identity = _identity("comment", key, comment.comment_id)
                    if identity in seen:
                        continue
                    seen.add(identity)
                    if comment.pending_review:
                        pending.add(identity)
                    if "negative_feedback" in comment.signals and comment.stance == "support":
                        negative.add(identity)
    result.report_days = len(report_dates)
    result.pending_review_comments = len(pending) + unexpanded_pending
    result.negative_feedback_comments = len(negative) + unexpanded_negative
    result.actions.sort(key=lambda action: (
        action.completed, action.status != "accepted",
        -int(action.latest_date.replace("-", "")), action.topic, action.id,
    ))
    return result


def get_project_opinion_monitor(user_id: str, project_id: str, days: int = 7) -> ProjectOpinionMonitor:
    _period(days)
    accounts = _accounts(user_id, project_id)
    return ProjectOpinionMonitor(
        overview=_overview(accounts, project_id, days),
        details=_details(user_id, project_id, accounts, days),
        actions=_actions(user_id, project_id, accounts, days),
    )


def generate_project_opinion_strategy(user_id: str, project_id: str, days: int = 7) -> OpinionStrategy:
    _period(days)
    accounts = _accounts(user_id, project_id)
    summary = _actions(user_id, project_id, accounts, days)
    active_ids = {action.id for action in summary.actions if not action.completed}
    quotes: dict[str, list[dict[str, str]]] = defaultdict(list)
    for account in accounts:
        key = lead_account_key_from_row(account)
        account_summary = opinion_strategy.get_opinion_actions(user_id, project_id, account["id"], days)
        for action_id, evidence in opinion_strategy._action_quotes(account, account_summary).items():
            identity = _identity("action", key, action_id)
            if identity in active_ids:
                quotes[identity] = [
                    {**item, "id": _identity("comment", key, item["id"])} for item in evidence
                ]
    return opinion_strategy._strategy_from_evidence(summary, quotes)
