from __future__ import annotations

import asyncio
import json
import logging
import sqlite3
import uuid
from collections.abc import Callable
from contextlib import closing
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Protocol

from app.engines.publishing import publication_plans as plans
from app.engines.publishing.material_copy import copy_html_to_text

logger = logging.getLogger(__name__)


class PublicationExecutionError(RuntimeError):
    def __init__(self, message: str, *, outcome_unknown: bool = False) -> None:
        super().__init__(message)
        self.outcome_unknown = outcome_unknown


@dataclass(frozen=True)
class PublicationAsset:
    name: str
    media_type: str
    mime_type: str
    object_key: str


@dataclass(frozen=True)
class PublicationJob:
    plan_id: str
    attempt_id: str
    account_id: str
    platform: str
    platform_user_id: str
    credential_blob: str = field(repr=False)
    authorization_status: str
    token_expires_at: str
    scopes: tuple[str, ...]
    media_mode: str
    title: str
    content: str
    tags: tuple[str, ...]
    assets: tuple[PublicationAsset, ...]


@dataclass(frozen=True)
class PublicationResult:
    platform_post_id: str
    platform_video_id: str = ""


class PublicationPublisher(Protocol):
    async def publish(
        self, job: PublicationJob, before_submit: Callable[[], None],
    ) -> PublicationResult: ...


def _utc(value: str) -> datetime:
    date = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return date.replace(tzinfo=timezone.utc) if date.tzinfo is None else date.astimezone(timezone.utc)


def _stamp(now: datetime) -> str:
    return now.astimezone(timezone.utc).isoformat(timespec="seconds")


class PublicationExecutor:
    def __init__(
        self, publisher: PublicationPublisher, *,
        clock: Callable[[], datetime] = lambda: datetime.now(timezone.utc),
        lease_seconds: int = 180,
    ) -> None:
        if lease_seconds < 30:
            raise ValueError("Publication execution lease must be at least 30 seconds")
        self.publisher = publisher
        self.clock = clock
        self.lease_seconds = lease_seconds

    def claim(self) -> PublicationJob | None:
        now = self.clock()
        stamp = _stamp(now)
        with closing(plans._connection_factory()) as conn, conn:
            conn.execute("BEGIN IMMEDIATE")
            candidates = conn.execute("""
                SELECT p.id, p.scheduled_for FROM project_publications p
                LEFT JOIN publication_executions e ON e.plan_id = p.id
                WHERE p.status = 'scheduled' AND COALESCE(e.state, '') != 'running'
            """).fetchall()
            due = []
            for candidate in candidates:
                try:
                    scheduled = _utc(candidate["scheduled_for"])
                except ValueError:
                    logger.error("Publication %s has an invalid scheduled time", candidate["id"])
                    continue
                if scheduled <= now:
                    due.append((scheduled, candidate["id"]))
            for _, plan_id in sorted(due):
                suffix = " FOR UPDATE SKIP LOCKED" if getattr(conn, "dialect", "") == "postgresql" else ""
                row = conn.execute("SELECT * FROM project_publications WHERE id = ?" + suffix, (plan_id,)).fetchone()
                if row is None or row["status"] != "scheduled" or _utc(row["scheduled_for"]) > now:
                    continue
                execution = conn.execute("SELECT state FROM publication_executions WHERE plan_id = ?", (plan_id,)).fetchone()
                if execution is not None and execution["state"] == "running":
                    continue
                attempt_id = uuid.uuid4().hex
                conn.execute("""
                    INSERT INTO publication_executions (
                        plan_id, attempt_id, state, started_at, heartbeat_at
                    ) VALUES (?, ?, 'running', ?, ?)
                    ON CONFLICT (plan_id) DO UPDATE SET
                        attempt_id = excluded.attempt_id, state = 'running',
                        started_at = excluded.started_at, heartbeat_at = excluded.heartbeat_at,
                        submission_started = 0, published_at = '', platform_post_id = '', platform_video_id = '',
                        error_message = '', outcome_unknown = 0
                """, (plan_id, attempt_id, stamp, stamp))
                account = conn.execute("""
                    SELECT * FROM project_channel_accounts WHERE id = ? AND project_id = ?
                """, (row["channel_account_id"], row["project_id"])).fetchone()
                contents = conn.execute("""
                    SELECT * FROM publication_contents WHERE plan_id = ? ORDER BY position, id
                """, (plan_id,)).fetchall()
                body = [row["copy_text"] or ""]
                body.extend(copy_html_to_text(item["content_html"] or "")
                            for item in contents if item["media_type"] == "document")
                return PublicationJob(
                    plan_id=plan_id, attempt_id=attempt_id,
                    account_id=row["channel_account_id"],
                    platform=account["platform"] if account else "",
                    platform_user_id=account["platform_user_id"] if account else "",
                    credential_blob=account["credential_blob"] if account else "",
                    authorization_status=account["authorization_status"] if account else "",
                    token_expires_at=account["token_expires_at"] if account else "",
                    scopes=tuple(json.loads(account["scopes"])) if account else (),
                    media_mode=row["media_mode"], title=row["copy_title"],
                    content="\n\n".join(part for part in body if part), tags=tuple(json.loads(row["copy_tags"])),
                    assets=tuple(PublicationAsset(
                        name=item["name"], media_type=item["media_type"],
                        mime_type=item["mime_type"], object_key=item["object_key"],
                    ) for item in contents if item["media_type"] != "document"),
                )
        return None

    def heartbeat(self, job: PublicationJob) -> bool:
        with closing(plans._connection_factory()) as conn, conn:
            return conn.execute("""
                UPDATE publication_executions SET heartbeat_at = ?
                WHERE plan_id = ? AND attempt_id = ? AND state = 'running'
            """, (_stamp(self.clock()), job.plan_id, job.attempt_id)).rowcount == 1

    def before_submit(self, job: PublicationJob) -> None:
        with closing(plans._connection_factory()) as conn, conn:
            changed = conn.execute("""
                UPDATE publication_executions SET submission_started = 1, heartbeat_at = ?
                WHERE plan_id = ? AND attempt_id = ? AND state = 'running'
            """, (_stamp(self.clock()), job.plan_id, job.attempt_id)).rowcount
        if changed != 1:
            raise PublicationExecutionError("Publication execution ownership was lost; no new submission was made")

    def finish(
        self, job: PublicationJob, *, result: PublicationResult | None = None,
        error: PublicationExecutionError | None = None,
    ) -> None:
        stamp = _stamp(self.clock())
        with closing(plans._connection_factory()) as conn, conn:
            conn.execute("BEGIN IMMEDIATE")
            if getattr(conn, "dialect", "") == "postgresql":
                conn.execute("SELECT id FROM project_publications WHERE id = ? FOR UPDATE", (job.plan_id,))
            changed = conn.execute("""
                UPDATE publication_executions SET state = ?, heartbeat_at = ?,
                    published_at = ?, platform_post_id = ?, platform_video_id = ?, error_message = ?, outcome_unknown = ?
                WHERE plan_id = ? AND attempt_id = ? AND state = 'running'
            """, (
                "succeeded" if result else "failed", stamp, stamp if result else "",
                result.platform_post_id if result else "", result.platform_video_id if result else "",
                str(error) if error else "",
                int(error.outcome_unknown) if error else 0, job.plan_id, job.attempt_id,
            )).rowcount
            if changed != 1:
                raise PublicationExecutionError(
                    "Publication result could not be recorded; verify the platform before retrying",
                    outcome_unknown=result is not None,
                )
            conn.execute("UPDATE project_publications SET status = ?, updated_at = ? WHERE id = ?",
                         ("published" if result else "failed", stamp, job.plan_id))

    def recover_expired(self) -> int:
        cutoff = self.clock() - timedelta(seconds=self.lease_seconds)
        recovered = 0
        with closing(plans._connection_factory()) as conn, conn:
            conn.execute("BEGIN IMMEDIATE")
            rows = conn.execute("SELECT * FROM publication_executions WHERE state = 'running'").fetchall()
            for row in rows:
                if _utc(row["heartbeat_at"]) >= cutoff:
                    continue
                if getattr(conn, "dialect", "") == "postgresql":
                    conn.execute("SELECT id FROM project_publications WHERE id = ? FOR UPDATE", (row["plan_id"],))
                message = ("Publishing was interrupted. The platform may already have accepted the post; "
                           "verify the account before scheduling again" if row["submission_started"] else
                           "Publishing was interrupted before submission; set the publication plan again")
                changed = conn.execute("""
                    UPDATE publication_executions SET state = 'failed', error_message = ?, outcome_unknown = ?
                    WHERE plan_id = ? AND attempt_id = ? AND state = 'running' AND heartbeat_at = ?
                """, (message, int(bool(row["submission_started"])), row["plan_id"], row["attempt_id"], row["heartbeat_at"])).rowcount
                if changed:
                    conn.execute("UPDATE project_publications SET status = 'failed', updated_at = ? WHERE id = ?",
                                 (_stamp(self.clock()), row["plan_id"]))
                    recovered += 1
                    logger.warning("Recovered interrupted publication %s; no automatic resubmission", row["plan_id"])
        return recovered

    async def run_once(self) -> bool:
        await asyncio.to_thread(self.recover_expired)
        job = await asyncio.to_thread(self.claim)
        if job is None:
            return False
        stop = asyncio.Event()

        async def renew() -> None:
            while not stop.is_set():
                try:
                    await asyncio.wait_for(stop.wait(), timeout=self.lease_seconds / 3)
                except TimeoutError:
                    if not await asyncio.to_thread(self.heartbeat, job):
                        logger.error("Lost execution ownership for publication %s", job.plan_id)
                        return

        renew_task = asyncio.create_task(renew())
        result = None
        error = None
        try:
            result = await self.publisher.publish(job, lambda: self.before_submit(job))
            if not result.platform_post_id:
                raise PublicationExecutionError("Platform did not return a post ID", outcome_unknown=True)
        except PublicationExecutionError as exc:
            result = None
            error = exc
            logger.warning("Publication %s failed: %s", job.plan_id, exc)
        except asyncio.CancelledError:
            logger.warning("Publication %s interrupted; durable recovery will prevent duplicate retries", job.plan_id)
            raise
        except (sqlite3.Error, OSError, ValueError, RuntimeError) as exc:
            logger.error("Publication %s failed unexpectedly (%s)", job.plan_id, type(exc).__name__)
            result = None
            error = PublicationExecutionError(
                "Publishing encountered an unexpected error; verify the platform before scheduling again",
                outcome_unknown=True,
            )
        finally:
            stop.set()
            await renew_task
        await asyncio.to_thread(self.finish, job, result=result, error=error)
        return True

    async def serve(self, stop: asyncio.Event, *, interval: float = 10) -> None:
        logger.info("Publication scheduler started")
        while not stop.is_set():
            try:
                handled = await self.run_once()
            except (sqlite3.Error, OSError, ValueError, RuntimeError) as exc:
                logger.error("Publication scheduler iteration failed (%s)", type(exc).__name__)
                handled = False
            if handled:
                continue
            try:
                await asyncio.wait_for(stop.wait(), timeout=interval)
            except TimeoutError:
                pass
        logger.info("Publication scheduler stopped")
