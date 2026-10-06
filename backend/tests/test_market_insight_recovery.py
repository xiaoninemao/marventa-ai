import sqlite3
import tempfile
import threading
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from app import config, media_storage
from app.auth import storage as auth_storage
from app.engines.market_insight import ai_analyzer, storage
from app.engines.market_insight.models import AIAnalysis, ParsedDocument
from app.engines.publishing import storage as publishing_storage


class MarketInsightRecoveryTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory(dir=Path.cwd())
        self.addCleanup(directory.cleanup)
        self.db_path = str(Path(directory.name) / "recovery.db")
        self.enterContext(patch.object(config, "DATABASE_URL", ""))
        self.enterContext(patch.object(ai_analyzer, "_active_workers", set()))
        for module in (auth_storage, publishing_storage, storage):
            self.enterContext(patch.object(module, "DB_PATH", self.db_path))
        for module in (media_storage, storage):
            self.enterContext(patch.object(module, "MEDIA_ROOT", directory.name))
        self.owner = auth_storage.create_user("owner", "owner@example.com", "test-hash")
        self.project = publishing_storage.create_manual_project(
            self.owner["id"], title="Recovery",
        )
        self.now = 1_800_000_000
        self.enterContext(patch.object(storage.time, "time", lambda: self.now))

    def save(self, status="analyzing", analysis=None):
        doc = ParsedDocument(
            title="Original title", source_type="repo",
            raw_text="Original source", ai_analysis=analysis,
        )
        record = storage.save_insight(
            doc, "source.md", 42, self.owner["id"], self.project.id, status,
        )
        storage.add_insight_source(
            record.id, "source.md", 42, "repo", doc.raw_text,
        )
        return doc, record

    def row(self, record_id):
        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            return conn.execute("SELECT * FROM insights WHERE id = ?", (record_id,)).fetchone()

    def start_worker(self, doc, record):
        targets = []
        with patch.object(
            ai_analyzer.threading, "Thread",
            side_effect=lambda target, daemon: SimpleNamespace(start=lambda: targets.append(target)),
        ):
            ai_analyzer.analyze_async(doc, record.id, self.owner["id"])
        return targets

    def test_claim_is_atomic_and_not_in_api_payloads(self):
        doc, record = self.save()
        row = self.row(record.id)
        self.assertEqual(row["analysis_attempt_id"], doc._analysis_attempt_id)
        self.assertEqual(row["analysis_lease_until"], self.now + storage.ANALYSIS_LEASE_SECONDS)
        self.assertEqual(row["analysis_deadline"], self.now + storage.ANALYSIS_TIMEOUT_SECONDS)
        self.assertNotIn("_analysis_attempt_id", doc.model_dump())
        self.assertNotIn("analysis_attempt_id", record.model_dump())
        self.assertEqual(storage.get_insight(record.id).status, "analyzing")
        self.assertEqual(storage.list_history(self.owner["id"])[0].status, "analyzing")

    def test_restart_recovers_expired_attempt_preserving_sources_and_analysis(self):
        previous = AIAnalysis(product_name="Previous result")
        doc, record = self.save(analysis=previous)
        self.now += storage.ANALYSIS_LEASE_SECONDS
        storage.init_db()
        recovered = storage.get_insight(record.id)
        self.assertEqual(recovered.status, "failed")
        self.assertEqual(recovered.ai_analysis, previous)
        self.assertEqual(recovered.title, record.title)
        with sqlite3.connect(self.db_path) as conn:
            self.assertEqual(conn.execute(
                "SELECT raw_text FROM insight_sources WHERE insight_id = ?", (record.id,),
            ).fetchone()[0], doc.raw_text)
        self.assertIsNone(self.row(record.id)["analysis_attempt_id"])

    def test_startup_does_not_clear_another_process_live_attempt(self):
        doc, record = self.save()
        self.now += storage.ANALYSIS_LEASE_SECONDS - 1
        storage.init_db()
        self.assertEqual(self.row(record.id)["status"], "analyzing")
        self.assertTrue(storage.renew_analysis_lease(record.id, doc._analysis_attempt_id))
        self.now += storage.ANALYSIS_LEASE_SECONDS - 1
        self.assertEqual(storage.get_insight(record.id).status, "analyzing")

    def test_detail_and_list_polling_recover_lost_heartbeat(self):
        for reader in (
            lambda record: storage.get_insight(record.id),
            lambda record: next(r for r in storage.list_history(self.owner["id"]) if r.id == record.id),
        ):
            with self.subTest(reader=reader):
                doc, record = self.save()
                self.now += storage.ANALYSIS_LEASE_SECONDS
                self.assertEqual(reader(record).status, "failed")
                self.assertFalse(storage.renew_analysis_lease(record.id, doc._analysis_attempt_id))

    def test_legacy_schema_migrates_and_recovers_without_touching_completed(self):
        _, legacy = self.save()
        _, completed = self.save(status="completed")
        with sqlite3.connect(self.db_path) as conn:
            for name in ("analysis_attempt_id", "analysis_lease_until", "analysis_deadline"):
                conn.execute(f"ALTER TABLE insights DROP COLUMN {name}")
        storage.init_db()
        storage.init_db()
        self.assertEqual(storage.get_insight(legacy.id).status, "failed")
        self.assertEqual(storage.get_insight(completed.id).status, "completed")

    def test_retry_recovers_without_prior_poll_and_claims_a_new_attempt(self):
        old_doc, record = self.save()
        self.now += storage.ANALYSIS_LEASE_SECONDS
        doc, owner_id = storage.prepare_insight_retry(record.id, self.owner["id"])
        self.assertEqual(owner_id, self.owner["id"])
        self.assertIn(old_doc.raw_text, doc.raw_text)
        self.assertNotEqual(doc._analysis_attempt_id, old_doc._analysis_attempt_id)
        self.assertEqual(storage.get_insight(record.id).status, "analyzing")
        with self.assertRaises(storage.InsightRetryNotAllowed):
            storage.prepare_insight_retry(record.id, self.owner["id"])

    def test_late_results_and_heartbeats_cannot_overwrite_retry(self):
        old_doc, record = self.save()
        self.now += storage.ANALYSIS_LEASE_SECONDS
        doc, _ = storage.prepare_insight_retry(record.id, self.owner["id"])
        for result in (None, AIAnalysis(product_name="Stale result")):
            self.assertFalse(storage.finish_analysis(record.id, old_doc._analysis_attempt_id, result))
        self.assertFalse(storage.renew_analysis_lease(record.id, old_doc._analysis_attempt_id))
        self.assertEqual(self.row(record.id)["analysis_attempt_id"], doc._analysis_attempt_id)
        fresh = AIAnalysis(product_name="Fresh result")
        self.assertTrue(storage.finish_analysis(record.id, doc._analysis_attempt_id, fresh))
        self.assertFalse(storage.finish_analysis(record.id, old_doc._analysis_attempt_id))
        self.assertEqual(storage.get_insight(record.id).ai_analysis, fresh)

    def test_wrong_owner_token_cannot_modify_healthy_job(self):
        doc, record = self.save()
        self.assertFalse(storage.renew_analysis_lease(record.id, "wrong-token"))
        self.assertFalse(storage.finish_analysis(record.id, "wrong-token"))
        self.assertEqual(self.row(record.id)["analysis_attempt_id"], doc._analysis_attempt_id)
        self.assertEqual(storage.get_insight(record.id).status, "analyzing")

    def test_retry_without_sources_rolls_back_claim(self):
        _, record = self.save(status="failed")
        with sqlite3.connect(self.db_path) as conn:
            conn.execute("DELETE FROM insight_sources WHERE insight_id = ?", (record.id,))
        with self.assertRaises(storage.InsightRetryNotAllowed):
            storage.prepare_insight_retry(record.id, self.owner["id"])
        self.assertEqual(self.row(record.id)["status"], "failed")
        self.assertIsNone(self.row(record.id)["analysis_attempt_id"])

    def test_deadline_expires_even_with_healthy_heartbeats(self):
        doc, record = self.save()
        deadline = self.now + storage.ANALYSIS_TIMEOUT_SECONDS
        while self.now + ai_analyzer.ANALYSIS_HEARTBEAT_SECONDS < deadline:
            self.now += ai_analyzer.ANALYSIS_HEARTBEAT_SECONDS
            self.assertTrue(storage.renew_analysis_lease(record.id, doc._analysis_attempt_id))
        self.now = deadline
        self.assertFalse(storage.finish_analysis(
            record.id, doc._analysis_attempt_id, AIAnalysis(product_name="Too late"),
        ))
        self.assertFalse(storage.renew_analysis_lease(record.id, doc._analysis_attempt_id))
        self.assertEqual(storage.get_insight(record.id).status, "failed")

    def test_worker_success_and_failure(self):
        for result, expected in ((AIAnalysis(product_name="New result"), "completed"), (None, "failed")):
            with self.subTest(expected=expected):
                doc, record = self.save()
                heartbeat, run = self.start_worker(doc, record)
                with patch.object(ai_analyzer, "_analyze_text", return_value=result), patch.object(
                    ai_analyzer, "_has_case_ai_provider", return_value=True,
                ):
                    run()
                heartbeat()
                self.assertEqual(storage.get_insight(record.id).status, expected)
                self.assertIsNone(self.row(record.id)["analysis_attempt_id"])

    def test_missing_provider_fails_without_external_call(self):
        doc, record = self.save()
        heartbeat, run = self.start_worker(doc, record)
        with patch.object(
            ai_analyzer,
            "get_ai_provider",
            return_value=SimpleNamespace(configured=False),
        ), patch.object(
            ai_analyzer, "_get_case_ai_client",
        ) as client:
            run()
            client.assert_not_called()
        heartbeat()
        self.assertEqual(storage.get_insight(record.id).status, "failed")

    def test_provider_exception_logs_type_not_document_content(self):
        doc, record = self.save()
        heartbeat, run = self.start_worker(doc, record)
        with patch.object(ai_analyzer, "analyze_document", side_effect=ValueError("SECRET DOCUMENT")), \
                self.assertLogs(ai_analyzer.logger, level="ERROR") as logs:
            run()
        heartbeat()
        self.assertIn("ValueError", " ".join(logs.output))
        self.assertNotIn("SECRET DOCUMENT", " ".join(logs.output))
        self.assertEqual(storage.get_insight(record.id).status, "failed")

    def test_heartbeat_stops_hung_worker_at_deadline_without_polling(self):
        doc, record = self.save()

        class ClockEvent:
            stopped = False

            def wait(event, seconds):
                self.now += seconds
                return event.stopped

            def set(event):
                event.stopped = True

        with patch.object(ai_analyzer.threading, "Event", ClockEvent):
            heartbeat, run = self.start_worker(doc, record)
        heartbeat()
        self.assertEqual(self.row(record.id)["status"], "failed")
        with patch.object(ai_analyzer, "analyze_document", return_value=ParsedDocument(
            title="Late", source_type="repo", ai_analysis=AIAnalysis(product_name="Late"),
        )):
            run()
        self.assertEqual(self.row(record.id)["status"], "failed")
        self.assertIsNone(self.row(record.id)["ai_analysis"])

    def test_stale_dispatch_does_not_call_provider_or_start_threads(self):
        doc, record = self.save()
        self.now += storage.ANALYSIS_LEASE_SECONDS
        storage.prepare_insight_retry(record.id, self.owner["id"])
        self.assertEqual(self.start_worker(doc, record), [])
        self.assertEqual(storage.get_insight(record.id).status, "analyzing")

    def test_unclaimed_input_cannot_start_worker(self):
        _, record = self.save()
        unclaimed = ParsedDocument(title="Unclaimed", source_type="repo")
        with self.assertLogs(ai_analyzer.logger, level="WARNING"):
            self.assertEqual(self.start_worker(unclaimed, record), [])
        self.assertEqual(self.row(record.id)["status"], "analyzing")

    def test_real_worker_completion_stops_heartbeat(self):
        doc, record = self.save()
        entered, release = threading.Event(), threading.Event()
        threads = []
        real_thread = threading.Thread

        def thread_factory(**kwargs):
            thread = real_thread(**kwargs)
            threads.append(thread)
            return thread

        def analyze(*args, **kwargs):
            entered.set()
            if not release.wait(5):
                raise TimeoutError("Test worker was not released")
            return ParsedDocument(
                title="Result", source_type="repo", ai_analysis=AIAnalysis(product_name="Result"),
            )

        with patch.object(ai_analyzer.threading, "Thread", side_effect=thread_factory), patch.object(
            ai_analyzer, "analyze_document", side_effect=analyze,
        ):
            try:
                ai_analyzer.analyze_async(doc, record.id)
                self.assertTrue(entered.wait(5))
                self.assertFalse(ai_analyzer.drain_analysis_workers(timeout=0))
                self.assertEqual(storage.get_insight(record.id).status, "analyzing")
            finally:
                release.set()
                for thread in threads:
                    thread.join(5)
        self.assertEqual(len(threads), 2)
        self.assertTrue(all(thread.daemon and not thread.is_alive() for thread in threads))
        self.assertEqual(storage.get_insight(record.id).status, "completed")
        self.assertTrue(ai_analyzer.drain_analysis_workers(timeout=0))

    def test_drain_waits_for_worker_without_stopping_heartbeat(self):
        doc, record = self.save()
        heartbeat, run = self.start_worker(doc, record)
        self.assertFalse(ai_analyzer.drain_analysis_workers(timeout=0))
        self.now += ai_analyzer.ANALYSIS_HEARTBEAT_SECONDS
        self.assertTrue(storage.renew_analysis_lease(record.id, doc._analysis_attempt_id))
        self.assertEqual(self.row(record.id)["status"], "analyzing")
        with patch.object(ai_analyzer, "analyze_document", return_value=doc):
            run()
        heartbeat()
        self.assertTrue(ai_analyzer.drain_analysis_workers(timeout=0))

    def test_drain_waiter_is_notified_when_worker_finishes(self):
        doc, record = self.save()
        heartbeat, run = self.start_worker(doc, record)
        waiting, drained = threading.Event(), threading.Event()

        def wait_for_worker():
            waiting.set()
            if ai_analyzer.drain_analysis_workers(timeout=5):
                drained.set()

        waiter = threading.Thread(target=wait_for_worker, daemon=True)
        waiter.start()
        try:
            self.assertTrue(waiting.wait(5))
            self.assertFalse(drained.is_set())
            with patch.object(ai_analyzer, "analyze_document", return_value=doc):
                run()
            self.assertTrue(drained.wait(5))
        finally:
            waiter.join(5)
        heartbeat()
        self.assertFalse(waiter.is_alive())

    def test_thread_start_failure_marks_attempt_failed(self):
        doc, record = self.save()
        with patch.object(ai_analyzer.threading, "Thread", side_effect=RuntimeError("cannot start")), \
                self.assertLogs(ai_analyzer.logger, level="ERROR"):
            ai_analyzer.analyze_async(doc, record.id)
        self.assertEqual(storage.get_insight(record.id).status, "failed")
        self.assertTrue(ai_analyzer.drain_analysis_workers(timeout=0))

    def test_heartbeat_database_failure_is_bounded_and_logs_no_secrets(self):
        doc, record = self.save()
        heartbeat, _ = self.start_worker(doc, record)
        with (
            patch.object(ai_analyzer.threading.Event, "wait", return_value=False),
            patch.object(storage, "_get_conn", side_effect=sqlite3.OperationalError("SECRET")),
            self.assertLogs(ai_analyzer.logger, level="ERROR") as logs,
        ):
            heartbeat()
        self.assertNotIn("SECRET", " ".join(logs.output))
        self.now += storage.ANALYSIS_LEASE_SECONDS
        self.assertEqual(storage.get_insight(record.id).status, "failed")
