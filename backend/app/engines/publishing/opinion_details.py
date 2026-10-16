"""Evidence and available work statistics for an account-period opinion view."""

from __future__ import annotations

import hashlib
from datetime import date, datetime, timedelta
from typing import Literal
from zoneinfo import ZoneInfo

from pydantic import BaseModel, Field

from app.config import LEAD_TRACKING_TIMEZONE
from app.engines.publishing import storage
from app.engines.publishing.account_content import _scoped_account
from app.engines.publishing.daily_comment_report import (
    DailyCommentReport,
    _demo_preview_allowed,
)
from app.engines.publishing.lead_identity import lead_account_key_from_row
from app.engines.publishing.opinion_monitor import _sentiment
from app.engines.publishing.opinion_strategy import _period


class OpinionPost(BaseModel):
    item_id: str
    title: str
    share_url: str = ""
    published_at: str = ""
    platform: str
    views: int | None = None
    engagement: int | None = None
    rate: float | None = None
    summary: str = ""


class OpinionVoice(BaseModel):
    comment_id: str
    item_id: str
    item_title: str = ""
    share_url: str = ""
    author: str
    content: str
    created_at: str
    likes: int
    replies: int
    topic: str = ""
    mood: Literal["positive", "neutral", "negative"]
    review_required: bool = False
    evidence: list[str] = Field(default_factory=list)
    platform: str


class OpinionPerformancePoint(BaseModel):
    date: str
    views: int | None = None
    engagement: int | None = None
    previous_views: int | None = None
    previous_engagement: int | None = None


class OpinionPerformance(BaseModel):
    post_count: int = 0
    views: int | None = None
    engagement: int | None = None
    risk_count: int = 0
    daily: list[OpinionPerformancePoint] = Field(default_factory=list)


class OpinionDetails(BaseModel):
    period_days: int
    is_simulated: bool = False
    posts: list[OpinionPost] = Field(default_factory=list)
    comments: list[OpinionVoice] = Field(default_factory=list)
    performance: OpinionPerformance = Field(default_factory=OpinionPerformance)


def _local_date(value: int) -> str:
    return datetime.fromtimestamp(value, ZoneInfo(LEAD_TRACKING_TIMEZONE)).strftime("%Y-%m-%d %H:%M")


def _published_day(value: str) -> str:
    if not value:
        return ""
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(
            ZoneInfo(LEAD_TRACKING_TIMEZONE)
        ).date().isoformat()
    except ValueError:
        return ""


def _snapshot_totals(
    snapshots: dict[tuple[str, str], dict], published_days: dict[str, str],
    item_ids: set[str], day: str,
) -> tuple[int | None, int | None]:
    active = [item_id for item_id in item_ids if not published_days[item_id] or published_days[item_id] <= day]
    if not active:
        return None, None
    previous_day = (date.fromisoformat(day) - timedelta(days=1)).isoformat()
    view_deltas: list[int] = []
    engagement_deltas: list[int] = []
    for item_id in active:
        current = snapshots.get((day, item_id))
        previous = snapshots.get((previous_day, item_id)) if published_days[item_id] < day else None
        if current is None:
            return None, None
        if current["views"] is not None and (previous is not None and previous["views"] is not None or published_days[item_id] == day):
            delta = current["views"] - (previous["views"] if previous else 0)
            if delta >= 0:
                view_deltas.append(delta)
        if all(current[field] is not None for field in ("likes", "comments", "shares")) and (
            previous is not None and all(previous[field] is not None for field in ("likes", "comments", "shares"))
            or published_days[item_id] == day
        ):
            current_total = sum(current[field] for field in ("likes", "comments", "shares"))
            previous_total = sum(previous[field] for field in ("likes", "comments", "shares")) if previous else 0
            if current_total >= previous_total:
                engagement_deltas.append(current_total - previous_total)
    return (sum(view_deltas) if len(view_deltas) == len(active) else None,
            sum(engagement_deltas) if len(engagement_deltas) == len(active) else None)


def get_opinion_details(user_id: str, project_id: str, account_id: str, days: int = 7) -> OpinionDetails:
    start, end = _period(days)
    account = _scoped_account(user_id, project_id, account_id)
    key = lead_account_key_from_row(account)
    allow_demo = _demo_preview_allowed(account)
    result = OpinionDetails(period_days=days)
    if account["authorization_status"] == "demo" and not allow_demo:
        return result
    previous_start = (date.fromisoformat(start) - timedelta(days=days + 1)).isoformat()
    with storage._get_conn() as conn:
        reports = conn.execute(
            """SELECT report_json FROM lead_daily_reports
               WHERE account_key = ? AND organization_id = ?
                 AND local_date BETWEEN ? AND ? AND status IN ('completed', 'partial')
               ORDER BY local_date DESC""",
            (key, account["organization_id"], start, end),
        ).fetchall()
        targets = [dict(row) for row in conn.execute(
            """SELECT item_id, title, share_url, published_at, views, likes, comments, shares
               FROM lead_tracking_account_targets WHERE account_key = ?""", (key,),
        ).fetchall()]
        snapshots = [dict(row) for row in conn.execute(
            """SELECT local_date, item_id, views, likes, comments, shares
               FROM lead_tracking_post_metric_snapshots
               WHERE account_key = ? AND local_date BETWEEN ? AND ?""",
            (key, previous_start, end),
        ).fetchall()]

    voices: dict[str, OpinionVoice] = {}
    post_moods: dict[str, list[str]] = {}
    risk_ids: set[str] = set()
    for row in reports:
        report = DailyCommentReport.model_validate_json(row["report_json"])
        if report.organization_id != account["organization_id"] or report.account_key != key:
            continue
        if report.is_simulated and not allow_demo:
            continue
        result.is_simulated = result.is_simulated or report.is_simulated
        for work in report.work_analyses:
            for comment in work.comments:
                if comment.comment_id in voices:
                    continue
                raw_mood = _sentiment(comment.content)
                mood = raw_mood if raw_mood in ("positive", "neutral", "negative") else "neutral"
                author_code = hashlib.sha256(
                    f"{key}\0{comment.comment_user_id}".encode("utf-8")
                ).hexdigest()[:4].upper()
                voices[comment.comment_id] = OpinionVoice(
                    comment_id=comment.comment_id, item_id=comment.item_id,
                    item_title=comment.item_title, share_url=comment.share_url,
                    author=f"用户 {author_code}", content=comment.content,
                    created_at=_local_date(comment.create_time), likes=comment.digg_count,
                    replies=comment.reply_comment_total,
                    topic=comment.topics[0] if comment.topics else "",
                    mood=mood, review_required=comment.pending_review,
                    evidence=comment.signals[:4], platform=account["platform"],
                )
                post_moods.setdefault(comment.item_id, []).append(mood)
                if not comment.reviewed and mood == "negative":
                    risk_ids.add(comment.comment_id)

    result.comments = sorted(voices.values(), key=lambda item: (item.created_at, item.likes + item.replies * 2), reverse=True)
    recent_snapshot_ids = {row["item_id"] for row in snapshots if start <= row["local_date"] <= end}
    published_days = {target["item_id"]: _published_day(target["published_at"] or "") for target in targets}
    for target in targets:
        published = target["published_at"] or ""
        local_day = published_days[target["item_id"]]
        if not (local_day and start <= local_day <= end) \
                and target["item_id"] not in post_moods \
                and target["item_id"] not in recent_snapshot_ids:
            continue
        figures = [target["likes"], target["comments"], target["shares"]]
        engagement = sum(figures) if all(value is not None for value in figures) else None
        views = target["views"]
        rate = round(engagement / views * 100, 2) if views and engagement is not None else None
        moods = post_moods.get(target["item_id"], [])
        summary = f"本周期收录 {len(moods)} 条评论，其中正向 {moods.count('positive')} 条、负向 {moods.count('negative')} 条。" if moods else ""
        result.posts.append(OpinionPost(
            item_id=target["item_id"], title=target["title"] or target["item_id"],
            share_url=target["share_url"], published_at=published,
            platform=account["platform"], views=views, engagement=engagement,
            rate=rate, summary=summary,
        ))
    result.posts.sort(key=lambda item: (item.engagement is None, -(item.engagement or 0), item.item_id))
    item_ids = {post.item_id for post in result.posts}
    snapshot_map = {(row["local_date"], row["item_id"]): row for row in snapshots}
    points = []
    for offset in range(days):
        day = date.fromisoformat(start) + timedelta(days=offset)
        previous_day = day - timedelta(days=days)
        views, engagement = _snapshot_totals(snapshot_map, published_days, item_ids, day.isoformat())
        previous_views, previous_engagement = _snapshot_totals(
            snapshot_map, published_days, item_ids, previous_day.isoformat(),
        )
        points.append(OpinionPerformancePoint(
            date=day.isoformat(), views=views, engagement=engagement,
            previous_views=previous_views, previous_engagement=previous_engagement,
        ))
    result.performance = OpinionPerformance(
        post_count=len(result.posts),
        views=sum(post.views for post in result.posts if post.views is not None)
            if all(post.views is not None for post in result.posts) else None,
        engagement=sum(post.engagement for post in result.posts if post.engagement is not None)
            if all(post.engagement is not None for post in result.posts) else None,
        risk_count=len(risk_ids), daily=points,
    )
    return result
