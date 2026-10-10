import sqlite3
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api import content_generator as content_api
from app.auth import storage as auth_storage
from app.auth.security import create_access_token
from app.engines.content_generator import presence, storage as content_storage
from app.engines.content_generator.models import AgentTurnResult, ChatMessage, CreativeDeliverable
from app.engines.portfolio import storage as portfolio_storage
from app.engines.publishing import storage as publishing_storage


class CreationPresenceTests(unittest.TestCase):
    def setUp(self):
        with tempfile.NamedTemporaryFile(
            dir=".", prefix=".presence-test-", suffix=".db", delete=False,
        ) as database:
            self.db_path = database.name
        self.addCleanup(self.cleanup_database)
        for module in (auth_storage, content_storage, portfolio_storage, publishing_storage):
            self.enterContext(patch.object(module, "DB_PATH", self.db_path))
        for name in ("run_creation_agent",
                     "build_reference_context"):
            self.enterContext(patch.object(
                content_api, name, side_effect=AssertionError("Unexpected AI call"),
            ))
        self.clock = self.enterContext(patch.object(presence.time, "time", return_value=1000.0))
        self.owner = auth_storage.create_user("owner", "owner@example.com", "hash")
        self.member = auth_storage.create_user("member", "member@example.com", "hash", "Writer")
        self.admin = auth_storage.create_user("admin", "admin@example.com", "hash")
        self.projectless_member = auth_storage.create_user(
            "projectless", "projectless@example.com", "hash",
        )
        self.outsider = auth_storage.create_user("outsider", "outsider@example.com", "hash")
        self.member_default = auth_storage.get_current_organization(self.member["id"])["id"]
        self.organization = auth_storage.create_organization(self.owner["id"], "Team")
        auth_storage.switch_organization(self.owner["id"], self.organization["id"])
        with sqlite3.connect(self.db_path) as conn:
            for user, role in (
                (self.member, "member"),
                (self.admin, "admin"),
                (self.projectless_member, "member"),
            ):
                conn.execute(
                    "INSERT INTO organization_memberships VALUES (?, ?, ?, '2026-01-01')",
                    (self.organization["id"], user["id"], role),
                )
                conn.execute(
                    "UPDATE user_organization_preferences SET organization_id = ? WHERE user_id = ?",
                    (self.organization["id"], user["id"]),
                )
            conn.execute("UPDATE users SET avatar_url = '/avatars/writer.png' WHERE id = ?", (self.member["id"],))
        self.project = publishing_storage.create_manual_project(self.owner["id"], title="Project")
        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                "INSERT INTO project_memberships VALUES (?, ?, 'member', '2026-01-01')",
                (self.project.id, self.member["id"]),
            )
        self.creation = content_storage.create_session(self.member["id"], self.project.id, "Creation")
        self.other_creation = content_storage.create_session(self.owner["id"], self.project.id, "Other creation")
        other_project = publishing_storage.create_manual_project(self.owner["id"], title="Other project")
        self.other_project_creation = content_storage.create_session(self.owner["id"], other_project.id, "Private")
        foreign_project = publishing_storage.create_manual_project(self.outsider["id"], title="Foreign")
        self.foreign_creation = content_storage.create_session(self.outsider["id"], foreign_project.id, "Foreign")
        app = FastAPI()
        app.include_router(content_api.router)
        self.client = self.enterContext(TestClient(app))
        self.visit = str(uuid4())

    def cleanup_database(self):
        for suffix in ("", "-wal", "-shm"):
            Path(self.db_path + suffix).unlink(missing_ok=True)

    @staticmethod
    def headers(user):
        return {"Authorization": "Bearer " + create_access_token(user["id"])}

    def path(self, creation=None):
        return f"/api/v1/content_generator/sessions/{(creation or self.creation).id}/presence"

    def heartbeat(self, user=None, visit=None, creation=None):
        return self.client.put(
            self.path(creation), headers=self.headers(user or self.member),
            json={"client_id": visit or self.visit},
        )

    def read(self, user=None, creation=None):
        return self.client.get(self.path(creation), headers=self.headers(user or self.owner))

    def leave(self, user=None, visit=None, creation=None):
        return self.client.delete(
            self.path(creation) + "/" + (visit or self.visit),
            headers=self.headers(user or self.member),
        )

    def member_ids(self, response):
        self.assertEqual(response.status_code, 200, response.text)
        return {member["id"] for member in response.json()["data"]["members"]}

    def lease_count(self):
        with sqlite3.connect(self.db_path) as conn:
            return conn.execute("SELECT COUNT(*) FROM creation_presence_leases").fetchone()[0]

    def test_all_presence_routes_require_authentication(self):
        for headers in ({}, {"Authorization": "Bearer invalid"}):
            with self.subTest(headers=headers):
                self.assertEqual(self.client.get(self.path(), headers=headers).status_code, 401)
                self.assertEqual(self.client.put(
                    self.path(), headers=headers, json={"client_id": self.visit},
                ).status_code, 401)
                self.assertEqual(self.client.delete(
                    self.path() + "/" + self.visit, headers=headers,
                ).status_code, 401)
        self.assertEqual(self.lease_count(), 0)

    def test_reads_do_not_mark_all_project_members_present(self):
        self.assertEqual(self.member_ids(self.read()), set())
        self.assertEqual(self.lease_count(), 0)
        self.assertEqual(self.member_ids(self.heartbeat()), {self.member["id"]})
        self.assertEqual(self.member_ids(self.read()), {self.member["id"]})

    def test_presence_is_scoped_to_creation_not_project(self):
        self.heartbeat()
        self.assertEqual(self.member_ids(self.read(creation=self.other_creation)), set())
        self.heartbeat(self.owner, creation=self.other_creation)
        self.assertEqual(self.member_ids(self.read()), {self.member["id"]})
        self.assertEqual(self.member_ids(self.read(creation=self.other_creation)), {self.owner["id"]})

    def test_project_and_organization_isolation(self):
        for user, creation in (
            (self.member, self.other_project_creation),
            (self.outsider, self.creation),
            (self.owner, self.foreign_creation),
        ):
            with self.subTest(user=user["username"], creation=creation.id):
                self.assertEqual(self.read(user, creation).status_code, 404)
                self.assertEqual(self.heartbeat(user, creation=creation).status_code, 404)
        self.assertEqual(self.lease_count(), 0)

    def test_organization_roles_do_not_bypass_project_membership(self):
        for user in (self.admin, self.projectless_member):
            with self.subTest(user=user["username"]):
                self.assertEqual(self.read(user).status_code, 404)
                self.assertEqual(self.heartbeat(user).status_code, 404)
        self.assertEqual(self.lease_count(), 0)

    def test_organization_owner_does_not_bypass_project_membership(self):
        private_project = publishing_storage.create_manual_project(self.member["id"], title="Member project")
        private_creation = content_storage.create_session(self.member["id"], private_project.id, "Member creation")
        self.assertEqual(self.read(self.owner, private_creation).status_code, 404)
        self.assertEqual(self.heartbeat(self.owner, creation=private_creation).status_code, 404)
        self.assertEqual(self.lease_count(), 0)

    def test_creator_loses_presence_access_after_project_revocation(self):
        self.heartbeat()
        publishing_storage.project_memberships.remove_project_member(
            self.owner["id"], self.project.id, self.member["id"],
        )
        self.assertEqual(self.read(self.member).status_code, 404)
        self.assertEqual(self.heartbeat().status_code, 404)
        self.assertEqual(self.member_ids(self.read()), set())
        self.assertEqual(self.lease_count(), 0)

    def test_revoked_organization_members_are_not_advertised_even_with_stale_project_membership(self):
        self.heartbeat()
        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                "DELETE FROM organization_memberships WHERE organization_id = ? AND user_id = ?",
                (self.organization["id"], self.member["id"]),
            )
        self.assertEqual(self.member_ids(self.read()), set())
        self.assertEqual(self.read(self.member).status_code, 404)
        self.assertEqual(self.heartbeat().status_code, 404)

    def test_organization_switch_hides_presence_and_blocks_reads_and_heartbeats(self):
        self.heartbeat()
        auth_storage.switch_organization(self.member["id"], self.member_default)
        self.assertEqual(self.member_ids(self.read()), set())
        self.assertEqual(self.read(self.member).status_code, 404)
        self.assertEqual(self.heartbeat().status_code, 404)

    def test_delete_can_cleanup_after_organization_switch(self):
        self.heartbeat()
        auth_storage.switch_organization(self.member["id"], self.member_default)
        self.assertEqual(self.leave().status_code, 200)
        self.assertEqual(self.lease_count(), 0)

    def test_delete_can_cleanup_after_membership_revocation(self):
        self.heartbeat()
        auth_storage.remove_organization_member(
            self.owner["id"], self.organization["id"], self.member["id"],
        )
        self.assertEqual(self.leave().status_code, 200)
        self.assertEqual(self.lease_count(), 0)

    def test_client_id_and_actor_spoofing_are_rejected(self):
        for body in (
            {}, {"client_id": "not-a-uuid"}, {"client_id": 42},
            {"client_id": self.visit, "user_id": self.owner["id"]},
            {"client_id": self.visit, "organization_id": self.organization["id"]},
            {"client_id": self.visit, "members": [{"id": self.owner["id"]}]},
        ):
            with self.subTest(body=body):
                response = self.client.put(self.path(), headers=self.headers(self.member), json=body)
                self.assertEqual(response.status_code, 422)
        self.assertEqual(self.lease_count(), 0)
        self.assertEqual(self.member_ids(self.heartbeat()), {self.member["id"]})
        self.assertEqual(self.leave(visit="not-a-uuid").status_code, 422)

    def test_response_contains_only_public_member_fields(self):
        response = self.heartbeat()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["data"], {"members": [{
            "id": self.member["id"], "username": "member", "nickname": "Writer",
            "avatar_url": "/avatars/writer.png",
        }]})
        self.assertEqual(self.read().json()["data"], response.json()["data"])
        self.assertEqual(self.leave().json()["data"], None)

    def test_multi_tab_dedup_and_leave_preserve_other_lease(self):
        second_visit = str(uuid4())
        self.heartbeat()
        self.heartbeat(visit=second_visit)
        self.assertEqual(self.lease_count(), 2)
        self.assertEqual(len(self.read().json()["data"]["members"]), 1)
        self.leave()
        self.assertEqual(self.member_ids(self.read()), {self.member["id"]})
        self.assertEqual(self.lease_count(), 1)
        self.leave(visit=second_visit)
        self.assertEqual(self.member_ids(self.read()), set())

    def test_leave_is_idempotent_and_cannot_remove_another_users_lease(self):
        self.heartbeat()
        self.heartbeat(self.owner)
        self.assertEqual(self.lease_count(), 2)
        self.leave(self.outsider)
        self.assertEqual(self.lease_count(), 2)
        self.leave()
        self.leave()
        self.assertEqual(self.member_ids(self.read()), {self.owner["id"]})
        missing = "/api/v1/content_generator/sessions/missing/presence/" + self.visit
        response = self.client.delete(missing, headers=self.headers(self.member))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["data"], None)

    def test_uuid_forms_refer_to_same_lease(self):
        self.heartbeat(visit=self.visit.upper())
        self.heartbeat(visit=self.visit.replace("-", ""))
        self.assertEqual(self.lease_count(), 1)
        self.leave()
        self.assertEqual(self.lease_count(), 0)

    def test_exact_ttl_expiration_and_get_does_not_extend_lease(self):
        self.heartbeat()
        self.clock.return_value = 1029.999
        self.assertEqual(self.member_ids(self.read()), {self.member["id"]})
        self.clock.return_value = 1030.0
        self.assertEqual(self.member_ids(self.read()), set())
        self.assertEqual(self.lease_count(), 0)

    def test_heartbeat_renews_only_its_lease_and_prunes_other_expired_sessions(self):
        second_visit = str(uuid4())
        self.heartbeat()
        self.heartbeat(visit=second_visit)
        self.heartbeat(self.owner, creation=self.other_creation)
        self.clock.return_value = 1010
        self.heartbeat()
        self.assertEqual(self.lease_count(), 3)
        self.clock.return_value = 1030
        self.assertEqual(self.member_ids(self.read()), {self.member["id"]})
        self.assertEqual(self.lease_count(), 1)
        self.clock.return_value = 1040
        self.assertEqual(self.member_ids(self.read()), set())

    def test_session_deletion_cleans_leases_without_touching_other_sessions(self):
        self.heartbeat()
        self.heartbeat(self.owner, creation=self.other_creation)
        self.assertTrue(content_storage.delete_session(self.creation.id))
        self.assertEqual(self.lease_count(), 1)
        self.assertEqual(self.read().status_code, 404)
        self.assertEqual(self.heartbeat().status_code, 404)
        self.assertEqual(self.leave().status_code, 200)
        self.assertEqual(self.member_ids(self.read(creation=self.other_creation)), {self.owner["id"]})

    def test_user_deletion_cleans_leases_even_for_legacy_non_fk_connections(self):
        self.heartbeat()
        self.heartbeat(self.owner)
        with sqlite3.connect(self.db_path) as conn:
            conn.execute("DELETE FROM users WHERE id = ?", (self.member["id"],))
        self.assertEqual(self.lease_count(), 1)
        self.assertEqual(self.member_ids(self.read()), {self.owner["id"]})
        self.assertEqual(self.heartbeat().status_code, 401)

    def test_organization_deletion_cleans_only_its_leases(self):
        self.heartbeat()
        self.heartbeat(self.outsider, creation=self.foreign_creation)
        auth_storage.delete_organization(self.owner["id"], self.organization["id"])
        self.assertEqual(self.lease_count(), 1)
        self.assertEqual(
            self.member_ids(self.read(self.outsider, self.foreign_creation)), {self.outsider["id"]},
        )

    def test_presence_never_changes_creation_content_or_versions(self):
        content_storage.update_session(
            self.creation.id, messages=[ChatMessage(role="user", content="Keep this")],
            deliverables=[CreativeDeliverable(id="work", media_kind='image', title="Title", publication_copy="Content", created_at='2026-10-09T00:00:00Z')],
            insight_ids=["insight"], case_ids=["case"], status="completed",
        )
        def snapshot():
            with sqlite3.connect(self.db_path) as conn:
                return (
                    conn.execute("SELECT * FROM creation_sessions ORDER BY id").fetchall(),
                )
        before = snapshot()
        self.heartbeat()
        self.read()
        self.heartbeat(visit=str(uuid4()))
        self.leave()
        self.clock.return_value = 1031
        self.read()
        self.assertEqual(snapshot(), before)

    def test_concurrent_browser_visits_are_shared_and_independent(self):
        visits = [str(uuid4()) for _ in range(6)]
        with ThreadPoolExecutor(max_workers=6) as executor:
            responses = list(executor.map(lambda visit: self.heartbeat(visit=visit), visits))
        for response in responses:
            self.assertEqual(self.member_ids(response), {self.member["id"]})
        self.assertEqual(self.lease_count(), 6)
        with ThreadPoolExecutor(max_workers=6) as executor:
            list(executor.map(lambda visit: self.leave(visit=visit), visits))
        self.assertEqual(self.lease_count(), 0)

    def test_eligibility_rechecked_after_route_access_check(self):
        with patch.object(content_api, "get_session", return_value=self.creation):
            self.assertEqual(self.heartbeat(self.admin).status_code, 404)
        self.assertEqual(self.lease_count(), 0)

    def test_presence_schema_initialization_is_idempotent_and_non_destructive(self):
        self.heartbeat()
        with content_storage._get_conn() as conn:
            before = conn.execute("SELECT * FROM creation_sessions ORDER BY id").fetchall()
            presence.ensure_presence_schema(conn)
            presence.ensure_presence_schema(conn)
            after = conn.execute("SELECT * FROM creation_sessions ORDER BY id").fetchall()
        conn.close()
        self.assertEqual(before, after)
        self.assertEqual(self.lease_count(), 1)







    def test_latest_user_message_can_be_rewritten_and_regenerated_in_place(self):
        content_storage.update_session(
            self.creation.id,
            messages=[
                ChatMessage(role="user", content="写一段文案"),
                ChatMessage(role="assistant", content="原回复"),
            ],
        )
        path = f"/api/v1/content_generator/sessions/{self.creation.id}/chat"
        with (
            patch.object(
                content_api,
                "run_creation_agent",
                side_effect=[
                    AgentTurnResult(intent="explore", reply="重新生成的回复"),
                    AgentTurnResult(intent="explore", reply="改写后的回复"),
                ],
            ) as ai,
            patch.object(content_api, "build_reference_context", return_value=""),
        ):
            response = self.client.post(
                path + "/regenerate",
                headers=self.headers(self.member),
            )
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(
                [item["content"] for item in response.json()["data"]["session"]["messages"]],
                ["写一段文案", "重新生成的回复"],
            )

            response = self.client.post(
                path + "/rewrite",
                headers=self.headers(self.member),
                json={"message": "改写后的用户消息"},
            )
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(
                [item["content"] for item in response.json()["data"]["session"]["messages"]],
                ["改写后的用户消息", "改写后的回复"],
            )

        rewrite_messages = ai.call_args_list[1].args[0]
        self.assertEqual("改写后的用户消息", rewrite_messages[-1]["content"])
        self.assertEqual(rewrite_messages[-1]["role"], "user")


if __name__ == "__main__":
    unittest.main()
