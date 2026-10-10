from __future__ import annotations

import asyncio
import json
import logging
import time
import uuid
from contextvars import ContextVar
from datetime import datetime, timezone
from urllib.parse import urlsplit

from fastapi import HTTPException, Request
from openai import APIConnectionError, APIStatusError

from app import config
from app.database import is_postgresql
from app.engines.content_generator import storage
from app.media_storage import delete_media

logger = logging.getLogger(__name__)
current_job: ContextVar[tuple[str, str] | None] = ContextVar("creation_agent_job", default=None)
ACTIVE = ("queued", "running", "cancelling")
LEASE_SECONDS = 60


class JobStopped(RuntimeError):
    pass


def ensure_schema(conn) -> None:
    conn.execute("""
        CREATE TABLE IF NOT EXISTS creation_agent_jobs (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL REFERENCES creation_sessions(id) ON DELETE CASCADE,
            user_id TEXT NOT NULL,
            operation TEXT NOT NULL,
            request_key TEXT NOT NULL,
            payload TEXT NOT NULL,
            submitted_message TEXT NOT NULL DEFAULT 'null',
            base_url TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'queued',
            attempts INTEGER NOT NULL DEFAULT 0,
            owner TEXT NOT NULL DEFAULT '',
            lease_until DOUBLE PRECISION NOT NULL DEFAULT 0,
            deadline DOUBLE PRECISION NOT NULL DEFAULT 0,
            available_at DOUBLE PRECISION NOT NULL DEFAULT 0,
            result TEXT NOT NULL DEFAULT 'null',
            error TEXT NOT NULL DEFAULT '',
            owned_keys TEXT NOT NULL DEFAULT '[]',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            UNIQUE (session_id, user_id, operation, request_key)
        )
    """)
    columns = [row[1] for row in conn.execute("PRAGMA table_info(creation_agent_jobs)").fetchall()]
    if "submitted_message" not in columns:
        conn.execute("ALTER TABLE creation_agent_jobs ADD COLUMN submitted_message TEXT NOT NULL DEFAULT 'null'")
    conn.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_jobs_active_session
        ON creation_agent_jobs(session_id) WHERE status IN ('queued', 'running', 'cancelling')
    """)
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_agent_jobs_claim
        ON creation_agent_jobs(status, available_at, created_at)
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS creation_agent_progress (
            session_id TEXT NOT NULL REFERENCES creation_sessions(id) ON DELETE CASCADE,
            user_id TEXT NOT NULL,
            state TEXT NOT NULL,
            PRIMARY KEY (session_id, user_id)
        )
    """)


def empty_progress() -> dict:
    return {"steps": [], "messages": {}, "events": [], "active_stage": "", "running": False, "failed": False}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _transaction():
    conn = storage._get_conn()
    conn.execute("BEGIN IMMEDIATE")
    return conn


def _row(conn, job_id: str, *, lock: bool = False):
    query = "SELECT * FROM creation_agent_jobs WHERE id = ?"
    if lock and is_postgresql(conn):
        query += " FOR UPDATE"
    row = conn.execute(query, (job_id,)).fetchone()
    if row is None:
        raise LookupError("Agent task not found")
    return row


def get_job(job_id: str, user_id: str, session_id: str) -> dict:
    conn = storage._get_conn()
    try:
        row = _row(conn, job_id)
        if row["user_id"] != user_id or row["session_id"] != session_id:
            raise LookupError("Agent task not found")
        return {
            "id": row["id"], "operation": row["operation"], "status": row["status"],
            "attempts": row["attempts"], "error": row["error"],
            "result": json.loads(row["result"]), "created_at": row["created_at"],
            "updated_at": row["updated_at"],
            "submitted_message": json.loads(row["submitted_message"]),
        }
    finally:
        conn.close()


def find_submission(session_id: str, user_id: str, operation: str, request_key: str, payload: dict) -> str | None:
    conn = storage._get_conn()
    try:
        row = conn.execute(
            "SELECT id, payload FROM creation_agent_jobs "
            "WHERE session_id = ? AND user_id = ? AND operation = ? AND request_key = ?",
            (session_id, user_id, operation, request_key),
        ).fetchone()
        if row:
            if row["payload"] != json.dumps(payload, sort_keys=True, ensure_ascii=False):
                raise ValueError("Agent request ID was reused with different input")
            return row["id"]
        return None
    finally:
        conn.close()


def latest_active_job(user_id: str, session_id: str) -> dict | None:
    conn = storage._get_conn()
    try:
        row = conn.execute(
            "SELECT id FROM creation_agent_jobs WHERE session_id = ? AND user_id = ? "
            "AND status IN ('queued', 'running', 'cancelling')",
            (session_id, user_id),
        ).fetchone()
    finally:
        conn.close()
    return get_job(row["id"], user_id, session_id) if row else None


def require_idle(session_id: str, conn=None) -> None:
    if current_job.get():
        check_current_job(conn, session_id=session_id)
        return
    owns_connection = conn is None
    conn = conn or storage._get_conn()
    try:
        if conn.execute(
            "SELECT 1 FROM creation_agent_jobs WHERE session_id = ? "
            "AND status IN ('queued', 'running', 'cancelling')", (session_id,),
        ).fetchone():
            raise ValueError("An Agent task is already active for this creation")
    finally:
        if owns_connection:
            conn.close()


def _put_progress(conn, user_id: str, session_id: str, state: dict) -> None:
    previous = conn.execute(
        "SELECT state FROM creation_agent_progress WHERE session_id = ? AND user_id = ?"
        + (" FOR UPDATE" if is_postgresql(conn) else ""),
        (session_id, user_id),
    ).fetchone()
    state["revision"] = (json.loads(previous["state"]).get("revision", 0) if previous else 0) + 1
    conn.execute(
        "INSERT INTO creation_agent_progress(session_id, user_id, state) VALUES (?, ?, ?) "
        "ON CONFLICT(session_id, user_id) DO UPDATE SET state = excluded.state",
        (session_id, user_id, json.dumps(state, ensure_ascii=False)),
    )


def get_progress(user_id: str, session_id: str) -> dict:
    conn = storage._get_conn()
    try:
        row = conn.execute(
            "SELECT state FROM creation_agent_progress WHERE session_id = ? AND user_id = ?",
            (session_id, user_id),
        ).fetchone()
        state = json.loads(row["state"]) if row else empty_progress()
        if state.get("job_id"):
            job = _row(conn, state["job_id"])
            state.update(
                status=job["status"], running=job["status"] in ACTIVE,
                failed=job["status"] in {"failed", "interrupted", "timed_out"},
                error=job["error"],
            )
            if job["status"] == "succeeded":
                result = json.loads(job["result"])
                state["completed_session_updated_at"] = (
                    result.get("data", {}).get("session", {}).get("updated_at", "")
                    if isinstance(result, dict) else ""
                )
        return state
    finally:
        conn.close()


def get_state(user_id: str, session_id: str, job_id: str = "") -> dict:
    conn = storage._get_conn()
    try:
        condition = "AND id = ?" if job_id else ""
        parameters = [user_id, session_id, user_id, session_id]
        if job_id:
            parameters.append(job_id)
        row = conn.execute(
            "SELECT progress.state AS progress_state, job.* "
            "FROM (SELECT 1 AS singleton) base "
            "LEFT JOIN creation_agent_progress progress ON progress.user_id = ? AND progress.session_id = ? "
            "LEFT JOIN creation_agent_jobs job ON job.id = ("
            "SELECT id FROM creation_agent_jobs WHERE user_id = ? AND session_id = ? "
            + condition + " ORDER BY created_at DESC, id DESC LIMIT 1)",
            parameters,
        ).fetchone()
        if job_id and not row["id"]:
            raise LookupError("Agent task not found")
        progress = json.loads(row["progress_state"]) if row["progress_state"] else empty_progress()
        progress.setdefault("revision", 0)
        job = None
        if row["id"]:
            job = {
                "id": row["id"], "operation": row["operation"], "status": row["status"],
                "attempts": row["attempts"], "error": row["error"],
                "result": json.loads(row["result"]), "created_at": row["created_at"],
                "updated_at": row["updated_at"], "submitted_message": json.loads(row["submitted_message"]),
            }
            if progress.get("job_id") != job["id"]:
                progress = {**empty_progress(), "revision": progress["revision"], "job_id": job["id"]}
            progress.update(
                status=job["status"], running=job["status"] in ACTIVE,
                failed=job["status"] in {"failed", "interrupted", "timed_out"}, error=job["error"],
            )
            if job["status"] == "succeeded":
                progress["completed_session_updated_at"] = job["result"].get("data", {}).get("session", {}).get("updated_at", "")
        return {"job": job, "progress": progress}
    finally:
        conn.close()


def record_model_timing(timing: dict) -> None:
    context = current_job.get()
    if not context:
        return
    conn = _transaction()
    try:
        job = _row(conn, context[0], lock=True)
        row = conn.execute(
            "SELECT state FROM creation_agent_progress WHERE session_id = ? AND user_id = ?"
            + (" FOR UPDATE" if is_postgresql(conn) else ""),
            (job["session_id"], job["user_id"]),
        ).fetchone()
        state = json.loads(row["state"]) if row else empty_progress()
        if job["owner"] != context[1] or state.get("job_id") != job["id"]:
            conn.commit()
            return
        entry = {key: timing[key] for key in ("kind", "model", "elapsed_ms", "first_token_ms", "succeeded")}
        entries = [*state.get("model_timings", []), entry]
        state["model_timings"] = entries[-64:]
        state["model_timings_truncated"] = state.get("model_timings_truncated", False) or len(entries) > 64
        state["model_call_count"] = state.get("model_call_count", 0) + 1
        state["model_elapsed_ms"] = state.get("model_elapsed_ms", 0) + entry["elapsed_ms"]
        _put_progress(conn, job["user_id"], job["session_id"], state)
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def update_progress(user_id: str, session_id: str, *, start=False, stage="", message="", event=None, failed=None) -> None:
    if failed is None:
        check_current_job()
    conn = _transaction()
    try:
        context = current_job.get()
        job = _row(conn, context[0], lock=True) if context else None
        if job is not None:
            if job["owner"] != context[1]:
                logger.info("Ignoring progress from retired Agent task %s", context[0])
                conn.commit()
                return
            if failed is None:
                check_current_job(conn)
        row = conn.execute(
            "SELECT state FROM creation_agent_progress WHERE session_id = ? AND user_id = ?"
            + (" FOR UPDATE" if is_postgresql(conn) else ""),
            (session_id, user_id),
        ).fetchone()
        previous = json.loads(row["state"]) if row else empty_progress()
        state = empty_progress() if start or not row else previous
        if context:
            if row and state.get("job_id") not in {None, context[0]}:
                logger.info("Ignoring progress from retired Agent task %s", context[0])
                conn.commit()
                return
            state["job_id"] = context[0]
            state["parent_user_message_id"] = previous.get("parent_user_message_id")
        if start:
            stage = "preparing_context"
        if stage:
            if stage not in state["steps"]:
                state["steps"].append(stage)
            if event:
                from app.engines.content_generator.agent_conversation import (
                    upsert_event,
                )
                upsert_event(state["events"], event.model_dump(mode="json"))
            elif message:
                state["messages"][stage] = message
                state["events"].append({"type": "message", "content": message})
            else:
                state["events"].append({"type": "status", "stage": stage})
            state.update(active_stage=stage, running=True, failed=False)
        if failed is not None:
            state.update(running=False, failed=failed)
        _put_progress(conn, user_id, session_id, state)
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def enqueue(
    session_id: str, user_id: str, operation: str, payload: dict, base_url: str, request_key: str,
    submitted_message: dict | None = None,
) -> str:
    if operation not in {"chat", "rewrite", "regenerate"}:
        raise ValueError("Invalid Agent task operation")
    serialized = json.dumps(payload, sort_keys=True, ensure_ascii=False)
    conn = _transaction()
    try:
        parent = conn.execute(
            "SELECT id, messages FROM creation_sessions WHERE id = ?"
            + (" FOR UPDATE" if is_postgresql(conn) else ""), (session_id,),
        ).fetchone()
        if parent is None:
            raise LookupError("Session not found")
        existing = conn.execute(
            "SELECT id, payload FROM creation_agent_jobs "
            "WHERE session_id = ? AND user_id = ? AND operation = ? AND request_key = ?",
            (session_id, user_id, operation, request_key),
        ).fetchone()
        if existing:
            if existing["payload"] != serialized:
                raise ValueError("Agent request ID was reused with different input")
            conn.commit()
            return existing["id"]
        if conn.execute(
            "SELECT 1 FROM creation_agent_jobs WHERE session_id = ? "
            "AND status IN ('queued', 'running', 'cancelling')", (session_id,),
        ).fetchone():
            raise ValueError("An Agent task is already active for this creation")
        job_id = uuid.uuid4().hex
        now = _now()
        conn.execute(
            "INSERT INTO creation_agent_jobs"
            "(id, session_id, user_id, operation, request_key, payload, submitted_message, base_url, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (job_id, session_id, user_id, operation, request_key, serialized,
             json.dumps(submitted_message, ensure_ascii=False), base_url, now, now),
        )
        state = empty_progress()
        state.update(job_id=job_id, running=True, status="queued")
        last_user = next((message for message in reversed(json.loads(parent["messages"])) if message["role"] == "user"), {})
        state["parent_user_message_id"] = (
            submitted_message.get("client_message_id") if submitted_message else last_user.get("client_message_id")
        )
        _put_progress(conn, user_id, session_id, state)
        conn.commit()
        return job_id
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def check_current_job(conn=None, *, session_id: str = "") -> None:
    context = current_job.get()
    if not context:
        return
    owns_connection = conn is None
    conn = conn or storage._get_conn()
    try:
        row = _row(conn, context[0], lock=not owns_connection)
        if session_id and row["session_id"] != session_id:
            raise JobStopped("Agent task does not match creation")
        if row["status"] in {"cancelling", "cancelled"}:
            raise JobStopped("Agent task cancelled")
        if row["deadline"] <= time.time():
            raise JobStopped("Agent task timed out")
        if row["owner"] != context[1] or row["lease_until"] <= time.time():
            raise JobStopped("Agent task interrupted; retry to continue")
        if row["status"] != "running":
            raise JobStopped("Agent task interrupted; retry to continue")
    finally:
        if owns_connection:
            conn.close()


def register_media(key: str) -> None:
    context = current_job.get()
    if not context:
        return
    conn = _transaction()
    try:
        check_current_job(conn)
        job_id = context[0]
        row = _row(conn, job_id)
        keys = json.loads(row["owned_keys"])
        if key not in keys:
            keys.append(key)
        conn.execute("UPDATE creation_agent_jobs SET owned_keys = ? WHERE id = ?", (json.dumps(keys), job_id))
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def commit_checkpoint(conn, result: dict) -> None:
    context = current_job.get()
    if context:
        check_current_job(conn)
        conn.execute(
            "UPDATE creation_agent_jobs SET status = 'succeeded', result = ?, owned_keys = '[]', "
            "lease_until = 0, updated_at = ? WHERE id = ?",
            (json.dumps(result, ensure_ascii=False), _now(), context[0]),
        )


def cancel(job_id: str, user_id: str, session_id: str) -> None:
    conn = _transaction()
    try:
        row = _row(conn, job_id, lock=True)
        if row["user_id"] != user_id or row["session_id"] != session_id:
            raise LookupError("Agent task not found")
        if row["status"] in {"queued", "running", "cancelling"}:
            status = "cancelled" if row["status"] == "queued" else "cancelling"
            conn.execute(
                "UPDATE creation_agent_jobs SET status = ?, error = 'Agent task cancelled', updated_at = ? WHERE id = ?",
                (status, _now(), job_id),
            )
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def claim(owner: str) -> dict | None:
    conn = _transaction()
    cleanup: list[tuple[str, list[str]]] = []
    try:
        now = time.time()
        expired = conn.execute(
            "SELECT * FROM creation_agent_jobs WHERE status IN ('running', 'cancelling') AND lease_until <= ?"
            + (" FOR UPDATE SKIP LOCKED" if is_postgresql(conn) else ""), (now,),
        ).fetchall()
        for row in expired:
            status = "cancelled" if row["status"] == "cancelling" else "interrupted"
            cleanup.append((row["id"], json.loads(row["owned_keys"])))
            detail = "Agent task cancelled" if status == "cancelled" else "Agent task interrupted; retry to continue"
            conn.execute(
                "UPDATE creation_agent_jobs SET status = ?, error = ?, updated_at = ? WHERE id = ?",
                (status, detail, _now(), row["id"]),
            )
        row = conn.execute(
            "SELECT * FROM creation_agent_jobs WHERE status = 'queued' AND owned_keys = '[]' AND available_at <= ? "
            "ORDER BY created_at, id LIMIT 1"
            + (" FOR UPDATE SKIP LOCKED" if is_postgresql(conn) else ""), (now,),
        ).fetchone()
        if row:
            conn.execute(
                "UPDATE creation_agent_jobs SET status = 'running', owner = ?, attempts = attempts + 1, "
                "lease_until = ?, deadline = ?, updated_at = ? WHERE id = ?",
                (owner, now + LEASE_SECONDS, now + config.CONTENT_STUDIO_JOB_TIMEOUT_SECONDS, _now(), row["id"]),
            )
            row = dict(_row(conn, row["id"]))
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
    for job_id, keys in cleanup:
        cleanup_media(job_id, keys)
    return dict(row) if row else None


def heartbeat(job_id: str, owner: str) -> None:
    conn = _transaction()
    cleanup: list[str] = []
    try:
        row = _row(conn, job_id, lock=True)
        if row["owner"] == owner and row["status"] in {"running", "cancelling"}:
            if row["deadline"] <= time.time():
                status = "cancelled" if row["status"] == "cancelling" else "timed_out"
                error = "Agent task cancelled" if status == "cancelled" else "Agent task timed out"
                cleanup = json.loads(row["owned_keys"])
                conn.execute(
                    "UPDATE creation_agent_jobs SET status = ?, error = ?, lease_until = 0, "
                    "updated_at = ? WHERE id = ?", (status, error, _now(), job_id),
                )
            else:
                conn.execute(
                    "UPDATE creation_agent_jobs SET lease_until = ?, updated_at = ? WHERE id = ?",
                    (time.time() + LEASE_SECONDS, _now(), job_id),
                )
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
    cleanup_media(job_id, cleanup)


def finish(job: dict, error: Exception | None = None, result: dict | None = None) -> None:
    conn = _transaction()
    cleanup: list[str] = []
    try:
        row = _row(conn, job["id"], lock=True)
        if row["owner"] != job["owner"] or row["status"] not in {"running", "cancelling"}:
            conn.commit()
            return
        status = "succeeded"
        detail = ""
        if error or row["status"] == "cancelling" or row["deadline"] <= time.time():
            root = error
            while root is not None and root.__cause__:
                root = root.__cause__
            state_row = conn.execute(
                "SELECT state FROM creation_agent_progress WHERE session_id = ? AND user_id = ?",
                (row["session_id"], row["user_id"]),
            ).fetchone()
            steps = json.loads(state_row["state"])["steps"] if state_row else []
            transient = isinstance(root, APIConnectionError) or (
                isinstance(root, APIStatusError) and (root.status_code == 429 or root.status_code >= 500)
            )
            if row["status"] == "cancelling":
                status, detail = "cancelled", "Agent task cancelled"
            elif row["deadline"] <= time.time():
                status, detail = "timed_out", "Agent task timed out"
            elif isinstance(root, JobStopped):
                status, detail = "interrupted", str(root)
            elif transient and row["attempts"] < config.CONTENT_STUDIO_JOB_MAX_ATTEMPTS and not (
                {"generating_image", "importing_material", "composing_work"} & set(steps)
            ):
                status, detail = "queued", "Retrying a transient AI service failure"
            else:
                status = "failed"
                detail = str(error.detail) if isinstance(error, HTTPException) else "Agent task failed; check backend logs"
            cleanup = json.loads(row["owned_keys"])
            if status != "queued" and state_row:
                stopped_progress = json.loads(state_row["state"])
                for event in stopped_progress["events"]:
                    if event["type"] == "tool" and event["status"] == "running":
                        event["status"] = "cancelled" if status == "cancelled" else "failed"
                    if event["type"] == "message":
                        event["streaming"] = False
                _put_progress(conn, row["user_id"], row["session_id"], stopped_progress)
        conn.execute(
            "UPDATE creation_agent_jobs SET status = ?, result = ?, error = ?, "
            "lease_until = 0, available_at = ?, updated_at = ? WHERE id = ?",
            (status, json.dumps(result), detail, time.time() + 2 * row["attempts"], _now(), row["id"]),
        )
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
    cleanup_media(job["id"], cleanup)


def cleanup_media(job_id: str, keys: list[str]) -> None:
    if not keys:
        return
    try:
        for key in keys:
            delete_media(key)
        conn = storage._get_conn()
        try:
            conn.execute(
                "UPDATE creation_agent_jobs SET owned_keys = '[]' WHERE id = ? AND status != 'succeeded'",
                (job_id,),
            )
            conn.commit()
        finally:
            conn.close()
    except Exception:
        logger.exception("Cleanup pending for Agent task %s", job_id)


def retry_cleanup() -> None:
    conn = storage._get_conn()
    try:
        rows = conn.execute(
            "SELECT id, owned_keys FROM creation_agent_jobs WHERE owned_keys != '[]' "
            "AND status NOT IN ('running', 'cancelling', 'succeeded') LIMIT 50",
        ).fetchall()
    finally:
        conn.close()
    for row in rows:
        cleanup_media(row["id"], json.loads(row["owned_keys"]))


async def execute(job: dict) -> dict:
    from app.api.content_generator import _replace_latest_reply, send_chat_message
    from app.engines.content_generator.models import ChatRequest
    from app.shared.response import ApiResponse

    parsed = urlsplit(job["base_url"])
    request = Request({
        "type": "http", "scheme": parsed.scheme, "server": (parsed.hostname, parsed.port),
        "headers": [(b"host", parsed.netloc.encode("ascii"))], "path": "/", "root_path": "",
        "query_string": b"",
    })
    payload = json.loads(job["payload"])
    if job["operation"] == "chat":
        response = await send_chat_message(
            job["session_id"], ChatRequest.model_validate(payload), request,
            {"id": job["user_id"]}, background=False,
        )
    elif job["operation"] in {"rewrite", "regenerate"}:
        response = await _replace_latest_reply(
            job["session_id"], job["user_id"], request, payload.get("agent_mode", "auto"),
            payload.get("message", "") if job["operation"] == "rewrite" else "",
        )
    else:
        raise ValueError("Invalid Agent task operation")
    if not isinstance(response, ApiResponse):
        raise TypeError("Agent execution returned an invalid response")
    return response.model_dump(mode="json")


class AgentJobWorker:
    def __init__(self):
        self.owner = uuid.uuid4().hex

    async def run(self, job: dict) -> None:
        token = current_job.set((job["id"], self.owner))
        task = asyncio.create_task(execute(job))
        try:
            while not task.done():
                await asyncio.wait({task}, timeout=10)
                if not task.done():
                    await asyncio.to_thread(heartbeat, job["id"], self.owner)
            result = await task
            await asyncio.to_thread(finish, job, result=result)
        except asyncio.CancelledError:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
            await asyncio.to_thread(finish, job, JobStopped("Agent task interrupted; retry to continue"))
            raise
        except Exception as exc:
            logger.exception("Agent task %s failed", job["id"])
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
            await asyncio.to_thread(finish, job, exc)
        finally:
            current_job.reset(token)

    async def serve(self, stop: asyncio.Event) -> None:
        active: set[asyncio.Task] = set()
        last_cleanup = 0.0
        try:
            while not stop.is_set():
                if time.time() - last_cleanup >= 10:
                    await asyncio.to_thread(retry_cleanup)
                    last_cleanup = time.time()
                for task in tuple(active):
                    if task.done():
                        active.remove(task)
                        task.result()
                if len(active) < config.CONTENT_STUDIO_JOB_WORKERS:
                    job = await asyncio.to_thread(claim, self.owner)
                    if job:
                        active.add(asyncio.create_task(self.run(job)))
                        continue
                try:
                    await asyncio.wait_for(stop.wait(), timeout=0.5)
                except TimeoutError:
                    pass
        finally:
            for task in active:
                task.cancel()
            if active:
                results = await asyncio.gather(*active, return_exceptions=True)
                for result in results:
                    if isinstance(result, Exception):
                        logger.error("Agent worker shutdown failed: %s", type(result).__name__)
