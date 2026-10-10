import asyncio
import json
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch
from uuid import uuid4

import httpx
from fastapi import HTTPException
from openai import APIConnectionError

from app import config
from app.api import content_generator as api
from app.engines.content_generator import agent_jobs as jobs
from app.engines.content_generator import storage
from app.engines.content_generator.models import AgentTurnResult
from tests import test_content_material_references as references


class AgentJobTests(unittest.TestCase):
    headers = references.ContentMaterialReferenceTests.headers
    upload = references.ContentMaterialReferenceTests.upload
    legacy = references.ContentMaterialReferenceTests.legacy
    create_copy = references.ContentMaterialReferenceTests.create_copy

    def setUp(self):
        references.ContentMaterialReferenceTests.setUp(self)
        self.enterContext(patch.object(config, "CONTENT_STUDIO_JOB_MAX_ATTEMPTS", 2))
        self.worker = jobs.AgentJobWorker()

    def submit(self, payload=None):
        return self.client.post(self.path + "/chat?background=true", headers=self.headers(), json=payload or {
            "message": "Create a work", "client_message_id": str(uuid4()), "agent_mode": "auto",
        })

    def queued(self):
        response = self.submit()
        self.assertEqual(response.status_code, 202, response.text)
        return response.json()["data"]["job"]

    def get(self, job_id):
        return jobs.get_job(job_id, self.owner["id"], self.creation.id)

    def change(self, job_id, **values):
        conn = storage._get_conn()
        try:
            columns = ", ".join(f"{key} = ?" for key in values)
            conn.execute(f"UPDATE creation_agent_jobs SET {columns} WHERE id = ?", (*values.values(), job_id))
            conn.commit()
        finally:
            conn.close()

    def context(self, job):
        token = jobs.current_job.set((job["id"], job["owner"]))
        self.addCleanup(jobs.current_job.reset, token)
        return job

    def test_queue_is_idempotent_scoped_and_rejects_changed_input_or_another_active_job(self):
        payload = {"message": "Same request", "client_message_id": str(uuid4())}
        first = self.submit(payload)
        second = self.submit(payload)
        self.assertEqual(first.status_code, 202)
        job_id = first.json()["data"]["job"]["id"]
        self.assertEqual(second.json()["data"]["job"]["id"], job_id)
        self.assertEqual(self.submit({**payload, "message": "Changed"}).status_code, 409)
        self.assertEqual(self.submit().status_code, 409)
        self.agent.assert_not_called()
        denied = self.client.get(self.path + f"/agent-jobs/{job_id}", headers=self.headers(self.outsider))
        self.assertEqual(denied.status_code, 404)
        active = self.client.get(self.path + "/agent-jobs/active", headers=self.headers())
        self.assertEqual(active.json()["data"]["id"], job_id)
        self.assertNotIn("payload", active.json()["data"])

    def test_combined_state_is_scoped_versioned_and_includes_terminal_result(self):
        idle = self.client.get(self.path + "/agent-state", headers=self.headers())
        self.assertEqual(idle.status_code, 200, idle.text)
        self.assertIsNone(idle.json()["data"]["job"])
        self.assertEqual(idle.json()["data"]["progress"]["revision"], 0)
        queued = self.queued()
        state = self.client.get(self.path + "/agent-state", headers=self.headers()).json()["data"]
        self.assertEqual(state["job"]["id"], queued["id"])
        self.assertTrue(state["progress"]["running"])
        revision = state["progress"]["revision"]
        asyncio.run(self.worker.run(jobs.claim(self.worker.owner)))
        done = self.client.get(self.path + "/agent-state", headers=self.headers()).json()["data"]
        self.assertEqual(done["job"]["status"], "succeeded")
        self.assertEqual(done["job"]["result"]["data"]["session"]["id"], self.creation.id)
        self.assertGreater(done["progress"]["revision"], revision)
        self.assertFalse(done["progress"]["running"])
        self.assertEqual(self.client.get(
            self.path + "/agent-state", params={"job_id": "missing"}, headers=self.headers(),
        ).status_code, 404)
        self.assertEqual(self.client.get(
            self.path + "/agent-state", headers=self.headers(self.outsider),
        ).status_code, 404)

    def test_combined_state_never_mixes_old_job_with_new_job_events(self):
        old = self.queued()
        jobs.cancel(old["id"], self.owner["id"], self.creation.id)
        new = self.queued()
        state = jobs.get_state(self.owner["id"], self.creation.id, old["id"])
        self.assertEqual(state["job"]["status"], "cancelled")
        self.assertEqual(state["progress"]["job_id"], old["id"])
        self.assertEqual(state["progress"]["events"], [])
        self.assertEqual(jobs.get_state(self.owner["id"], self.creation.id)["job"]["id"], new["id"])

    def test_model_metrics_are_available_in_combined_progress_without_prompt_or_credentials(self):
        job = self.queued()
        claimed = jobs.claim(self.worker.owner)
        self.context(claimed)
        jobs.record_model_timing({
            "kind": "routing", "model": "model", "elapsed_ms": 125, "first_token_ms": None,
            "succeeded": True, "prompt": "PRIVATE", "api_key": "SECRET",
        })
        progress = jobs.get_state(self.owner["id"], self.creation.id)["progress"]
        self.assertEqual(progress["job_id"], job["id"])
        self.assertEqual(progress["model_call_count"], 1)
        self.assertEqual(progress["model_elapsed_ms"], 125)
        self.assertNotIn("PRIVATE", json.dumps(progress))
        self.assertNotIn("SECRET", json.dumps(progress))

    def test_concurrent_workers_claim_a_job_only_once(self):
        job = self.queued()
        with ThreadPoolExecutor(max_workers=4) as executor:
            claims = list(executor.map(jobs.claim, ["one", "two", "three", "four"]))
        claimed = [value for value in claims if value]
        self.assertEqual(len(claimed), 1)
        self.assertEqual(claimed[0]["id"], job["id"])
        self.assertEqual(claimed[0]["attempts"], 1)

    def test_worker_commits_response_and_session_in_one_checkpoint(self):
        job = self.queued()
        claimed = jobs.claim(self.worker.owner)
        asyncio.run(self.worker.run(claimed))
        saved = self.get(job["id"])
        self.assertEqual(saved["status"], "succeeded")
        self.assertEqual(saved["result"]["data"]["session"]["id"], self.creation.id)
        self.assertEqual(saved["result"]["data"]["reply"]["content"], "AI reply")
        reloaded = storage.get_session(self.creation.id)
        self.assertEqual([message.role for message in reloaded.messages], ["user", "assistant"])
        self.assertEqual(saved["result"]["data"]["session"]["messages"][-1]["content"], "AI reply")
        progress = jobs.get_progress(self.owner["id"], self.creation.id)
        self.assertEqual(progress["job_id"], job["id"])
        self.assertFalse(progress["running"])

    def test_retry_resumes_an_accepted_turn_without_duplicating_the_user_message(self):
        queued = self.queued()
        error = APIConnectionError(request=httpx.Request("POST", "https://test.invalid"))
        self.agent.side_effect = [error, AgentTurnResult(intent="explore", reply="Recovered")]
        asyncio.run(self.worker.run(jobs.claim(self.worker.owner)))
        self.assertEqual(self.get(queued["id"])["status"], "queued")
        self.assertEqual(len(storage.get_session(self.creation.id).messages), 1)
        self.change(queued["id"], available_at=0)
        asyncio.run(self.worker.run(jobs.claim(self.worker.owner)))
        self.assertEqual(self.get(queued["id"])["status"], "succeeded")
        self.assertEqual(self.agent.call_count, 2)
        self.assertEqual(
            [message.role for message in storage.get_session(self.creation.id).messages],
            ["user", "assistant"],
        )

    def test_retired_task_cannot_overwrite_progress_for_the_next_task(self):
        old = self.queued()
        claimed = self.context(jobs.claim(self.worker.owner))
        api._start_agent_progress(self.owner["id"], self.creation.id)
        jobs.finish(claimed, result={"success": True})
        new = self.queued()
        self.assertNotEqual(old["id"], new["id"])
        api._finish_agent_progress(self.owner["id"], self.creation.id)
        progress = jobs.get_progress(self.owner["id"], self.creation.id)
        self.assertEqual(progress["job_id"], new["id"])
        self.assertEqual(progress["status"], "queued")
        self.assertTrue(progress["running"])

    def test_queued_tasks_survive_new_worker_and_cancel_without_model_calls(self):
        queued = self.queued()
        response = self.client.post(self.path + f"/agent-jobs/{queued['id']}/cancel", headers=self.headers())
        self.assertEqual(response.json()["data"]["status"], "cancelled")
        self.assertIsNone(jobs.claim(jobs.AgentJobWorker().owner))
        self.agent.assert_not_called()
        self.assertFalse(jobs.get_progress(self.owner["id"], self.creation.id)["running"])
        another = self.queued()
        self.assertEqual(jobs.claim(jobs.AgentJobWorker().owner)["id"], another["id"])

    def test_cancel_and_timeout_fence_late_results_without_altering_work(self):
        self.queued()
        job = self.context(jobs.claim(self.worker.owner))
        session = storage.get_session(self.creation.id)
        jobs.cancel(job["id"], self.owner["id"], self.creation.id)
        with self.assertRaisesRegex(jobs.JobStopped, "cancelled"):
            storage.commit_agent_result(session, AgentTurnResult(intent="explore", reply="Late reply"))
        self.assertEqual(storage.get_session(self.creation.id).messages, [])
        jobs.finish(job, jobs.JobStopped("Agent task cancelled"))
        self.assertEqual(self.get(job["id"])["status"], "cancelled")

    def test_expired_deadline_is_terminal_and_cleans_only_registered_new_media(self):
        self.queued()
        job = self.context(jobs.claim(self.worker.owner))
        jobs.register_media("content-generator/org/project/new.png")
        self.change(job["id"], deadline=time.time() - 1)
        with patch.object(jobs, "delete_media") as delete:
            jobs.heartbeat(job["id"], job["owner"])
        delete.assert_called_once_with("content-generator/org/project/new.png")
        self.assertEqual(self.get(job["id"])["status"], "timed_out")
        with self.assertRaisesRegex(jobs.JobStopped, "timed out"):
            storage.commit_agent_result(storage.get_session(self.creation.id), AgentTurnResult(intent="explore", reply="Late"))
        self.assertEqual(storage.get_session(self.creation.id).messages, [])

    def test_stale_execution_is_interrupted_not_automatically_replayed(self):
        self.queued()
        old = self.context(jobs.claim(self.worker.owner))
        jobs.register_media("content-generator/org/project/interrupted.png")
        self.change(old["id"], lease_until=0)
        with patch.object(jobs, "delete_media") as delete:
            self.assertIsNone(jobs.claim("other-worker"))
        delete.assert_called_once_with("content-generator/org/project/interrupted.png")
        self.assertEqual(self.get(old["id"])["status"], "interrupted")
        with self.assertRaises(jobs.JobStopped):
            storage.commit_agent_result(storage.get_session(self.creation.id), AgentTurnResult(intent="explore", reply="Stale"))
        self.agent.assert_not_called()

    def test_transient_failures_are_bounded_and_generation_failures_are_not_replayed(self):
        self.queued()
        first = self.context(jobs.claim(self.worker.owner))
        api._start_agent_progress(self.owner["id"], self.creation.id)
        error = APIConnectionError(request=httpx.Request("POST", "https://test.invalid"))
        jobs.finish(first, error)
        self.assertEqual(self.get(first["id"])["status"], "queued")
        self.change(first["id"], available_at=0)
        second = jobs.claim(self.worker.owner)
        jobs.finish(second, error)
        self.assertEqual(self.get(first["id"])["status"], "failed")
        self.assertEqual(self.get(first["id"])["attempts"], 2)

    def test_image_generation_stage_disables_automatic_retry(self):
        self.queued()
        job = self.context(jobs.claim(self.worker.owner))
        api._start_agent_progress(self.owner["id"], self.creation.id)
        api._advance_agent_progress(self.owner["id"], self.creation.id, "generating_image")
        error = APIConnectionError(request=httpx.Request("POST", "https://test.invalid"))
        jobs.finish(job, error)
        self.assertEqual(self.get(job["id"])["status"], "failed")
        self.assertEqual(self.get(job["id"])["attempts"], 1)

    def test_progress_is_persistent_and_legacy_mutations_cannot_bypass_active_jobs(self):
        job = self.queued()
        self.assertEqual(self.client.delete(self.path, headers=self.headers()).status_code, 409)
        response = self.client.post(self.path + "/chat", headers=self.headers(), json={"message": "Bypass"})
        self.assertEqual(response.status_code, 409)
        claimed = self.context(jobs.claim(self.worker.owner))
        api._start_agent_progress(self.owner["id"], self.creation.id)
        api._advance_agent_progress(self.owner["id"], self.creation.id, "reading_context", "Context read")
        conn = storage._get_conn()
        try:
            persisted = json.loads(conn.execute(
                "SELECT state FROM creation_agent_progress WHERE session_id = ?", (self.creation.id,),
            ).fetchone()["state"])
        finally:
            conn.close()
        self.assertEqual(persisted["job_id"], job["id"])
        self.assertEqual(persisted["events"][-1]["content"], "Context read")
        jobs.finish(claimed, jobs.JobStopped("Agent task interrupted; retry to continue"))

    def test_cleanup_failure_is_recorded_and_retried_without_claiming_a_dirty_retry(self):
        self.queued()
        job = self.context(jobs.claim(self.worker.owner))
        api._start_agent_progress(self.owner["id"], self.creation.id)
        key = "content-generator/org/project/pending-cleanup.png"
        jobs.register_media(key)
        error = APIConnectionError(request=httpx.Request("POST", "https://test.invalid"))
        with patch.object(jobs, "delete_media", side_effect=OSError("Storage unavailable")):
            jobs.finish(job, error)
        self.change(job["id"], available_at=0)
        self.assertIsNone(jobs.claim("another-worker"))
        conn = storage._get_conn()
        try:
            keys = json.loads(conn.execute(
                "SELECT owned_keys FROM creation_agent_jobs WHERE id = ?", (job["id"],),
            ).fetchone()["owned_keys"])
        finally:
            conn.close()
        self.assertEqual(keys, [key])
        with patch.object(jobs, "delete_media") as delete:
            jobs.retry_cleanup()
        delete.assert_called_once_with(key)
        self.assertEqual(jobs.claim("another-worker")["id"], job["id"])

    def test_polling_does_not_run_schema_migrations_and_session_load_includes_active_job(self):
        queued = self.queued()
        loaded = self.client.get(self.path, headers=self.headers())
        self.assertEqual(loaded.json()["data"]["agent_job"]["id"], queued["id"])
        with patch.object(storage, "init_db") as initialize:
            for suffix in ("/agent-jobs/active", f"/agent-jobs/{queued['id']}", "/agent-progress"):
                response = self.client.get(self.path + suffix, headers=self.headers())
                self.assertEqual(response.status_code, 200)
            initialize.assert_not_called()

    def test_queued_prompt_and_inline_references_survive_refresh_before_worker_acceptance(self):
        payload = {
            "message": "Use this copy", "client_message_id": str(uuid4()),
            "material_ids": [self.copy.id],
            "reference_positions": [{"offset": 0, "id": self.copy.id, "kind": "material"}],
        }
        response = self.submit(payload)
        self.assertEqual(response.status_code, 202, response.text)
        submitted = response.json()["data"]["job"]["submitted_message"]
        self.assertEqual(submitted["content"], "Use this copy")
        self.assertEqual(submitted["references"][0]["title"], "Product")
        self.assertEqual(submitted["reference_positions"], payload["reference_positions"])
        loaded = self.client.get(self.path, headers=self.headers()).json()["data"]
        self.assertEqual(loaded["messages"], [])
        self.assertEqual(loaded["agent_job"]["submitted_message"], submitted)

    def test_completed_submission_replay_does_not_revalidate_deleted_references(self):
        payload = {"message": "Use this copy", "client_message_id": str(uuid4()), "material_ids": [self.copy.id]}
        first = self.submit(payload).json()["data"]["job"]
        asyncio.run(self.worker.run(jobs.claim(self.worker.owner)))
        self.assertEqual(self.get(first["id"])["status"], "succeeded")
        with patch.object(api, "_validate_chat_references", side_effect=HTTPException(404, "Reference removed")):
            replay = self.submit(payload)
        self.assertEqual(replay.status_code, 202, replay.text)
        self.assertEqual(replay.json()["data"]["job"]["id"], first["id"])
        self.assertEqual(self.agent.call_count, 1)
