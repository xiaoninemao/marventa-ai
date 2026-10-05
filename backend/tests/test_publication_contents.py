import io
import json
import sqlite3
import unittest
from contextlib import redirect_stdout
from unittest.mock import patch

from app import config, media_storage
from app.auth import storage as auth_storage
from app.engines.portfolio import storage as portfolio_storage
from app.engines.publishing import material_copy, publication_contents, storage
from scripts import migrate_sqlite_to_postgres
from tests import test_material_copy as material_tests


class PublicationContentTests(unittest.TestCase):
    headers = material_tests.MaterialCopyTests.headers
    create_copy = material_tests.MaterialCopyTests.create_copy
    upload = material_tests.MaterialCopyTests.upload
    legacy = material_tests.MaterialCopyTests.legacy

    def setUp(self):
        material_tests.MaterialCopyTests.setUp(self)
        self.enterContext(patch.object(portfolio_storage, "DB_PATH", self.db_path))
        portfolio_storage.init_db()
        self.plans = "/api/v1/publishing/publications"
        response = self.client.post(self.plans, headers=self.headers(), json={
            "project_id": self.project.id, "name": "Release",
        })
        self.assertEqual(response.status_code, 200, response.text)
        self.plan = response.json()["data"]
        self.path = f"{self.plans}/{self.plan['id']}"
        self.contents = self.path + "/contents"

    def own_upload(self, filename="image.png", data=b"image", user=None):
        return self.client.post(self.contents, headers=self.headers(user), files={
            "file": (filename, data, "application/octet-stream"),
        })

    def pick(self, *ids, user=None):
        return self.client.post(
            self.contents + "/from-materials", headers=self.headers(user),
            json={"material_ids": list(ids)},
        )

    def items(self):
        return self.client.get(self.contents, headers=self.headers()).json()["data"]

    def document(self, item, user=None):
        return self.client.get(
            self.contents + f"/{item['id']}/content", headers=self.headers(user),
        )

    def delete_item(self, item, user=None):
        return self.client.delete(
            self.contents + f"/{item['id']}", headers=self.headers(user),
        )

    def save_copy(self, title="Copy title", content="Saved body", user=None):
        return self.client.patch(
            self.path + "/copy", headers=self.headers(user),
            json={"title": title, "content": content},
        )

    def load_copy(self, user=None):
        return self.client.get(self.path + "/copy", headers=self.headers(user))

    def save_tags(self, tags, user=None, content="Saved body"):
        return self.client.patch(
            self.path + "/copy", headers=self.headers(user),
            json={"title": "Copy title", "content": content, "tags": tags},
        )

    def test_copy_tags_normalize_deduplicate_and_preserve_for_old_clients(self):
        deduplicated = self.save_tags([" #Launch ", "Launch", "## ＃新品", "＃新品"])
        self.assertEqual(deduplicated.status_code, 200, deduplicated.text)
        self.assertEqual(deduplicated.json()["data"]["tags"], ["Launch", "新品"])
        response = self.save_tags([" #Launch ", "launch", "## ＃新品", "👩🏽‍💻", "two words"])
        self.assertEqual(response.status_code, 200, response.text)
        tags = ["Launch", "launch", "新品", "👩🏽‍💻", "two words"]
        self.assertEqual(response.json()["data"]["tags"], tags)
        storage.init_db()
        self.assertEqual(self.load_copy().json()["data"]["tags"], tags)
        self.assertEqual(self.save_copy(title="Other", content="New body").json()["data"], {
            "title": "Other", "content": "New body", "tags": tags,
        })
        self.assertEqual(self.save_tags([]).json()["data"]["tags"], [])
        self.assertEqual(self.load_copy().json()["data"]["tags"], [])
        self.assertEqual(self.client.get(self.path, headers=self.headers()).json()["data"]["name"], self.plan["name"])

    def test_copy_tags_malformed_input_is_rejected_without_mutation(self):
        before = self.save_tags(["kept"]).json()["data"]
        for tags in (
            None, "tag", {"tag": "value"}, [1], [None], [""], [" "], ["#"], ["## #"],
            ["line\nbreak"], ["line\rbreak"], ["tab\tvalue"], ["control\x00"],
            ["control\x7f"], ["control\x85"], ["line\u2028break"], ["line\u2029break"],
            ["x" * 51], [" " * 201], [f"tag{index}" for index in range(6)],
        ):
            with self.subTest(tags=repr(tags)):
                response = self.save_tags(tags)
                self.assertEqual(response.status_code, 422, response.text)
                self.assertEqual(self.load_copy().json()["data"], before)
        valid = ["😀" * 50] + [f"tag{index}" for index in range(4)]
        self.assertEqual(self.save_tags(valid).json()["data"]["tags"], valid)
        self.assertEqual(self.save_tags([" " * 149 + "#" + "x" * 50]).json()["data"]["tags"], ["x" * 50])
        for tags, message in (
            (["#"], "Publication tag contains invalid characters"),
            (["new\nline"], "Publication tag contains invalid characters"),
            (["x" * 51], "Publication tags must be at most 50 characters"),
            (["tag"] * 6, "At most 5 publication tags are allowed"),
        ):
            response = self.save_tags(tags)
            self.assertEqual(response.status_code, 422)
            self.assertEqual(response.json()["detail"][0]["msg"], "Value error, " + message)

    def test_tags_alone_do_not_count_schedule_or_prevent_clearing_after_cancellation(self):
        response = self.save_tags(["Launch"], content="")
        self.assertEqual(response.status_code, 200)
        plan = self.client.get(self.path, headers=self.headers()).json()["data"]
        self.assertEqual((plan["has_copy"], plan["content_count"], plan["document_count"]), (False, 0, 0))
        self.account()
        self.assertEqual(self.schedule().status_code, 400)
        self.save_copy()
        self.assertEqual(self.schedule().status_code, 200)
        self.cancel()
        self.assertEqual(self.save_copy(content="").json()["data"]["tags"], ["Launch"])
        plan = self.client.get(self.path, headers=self.headers()).json()["data"]
        self.assertEqual(plan["status"], "cancelled")
        self.assertEqual(self.load_copy().json()["data"]["tags"], ["Launch"])

    def test_copy_tags_use_same_permissions_scope_and_published_guards(self):
        self.save_tags(["Original"])
        self.assertEqual(self.load_copy(self.member).json()["data"]["tags"], ["Original"])
        self.assertEqual(self.save_tags(["Denied"], self.member).status_code, 403)
        self.assertEqual(self.save_tags(["Admin"], self.admin).status_code, 200)
        self.assertEqual(self.save_tags(["Denied"], self.outsider).status_code, 404)
        organization = auth_storage.get_current_organization(self.owner["id"])
        other = auth_storage.create_organization(self.owner["id"], "Tags organization")
        auth_storage.switch_organization(self.owner["id"], other["id"])
        self.assertEqual(self.save_tags(["Wrong organization"]).status_code, 404)
        auth_storage.switch_organization(self.owner["id"], organization["id"])
        with sqlite3.connect(self.db_path) as conn:
            conn.execute("UPDATE project_publications SET status = 'published' WHERE id = ?", (self.plan["id"],))
        self.assertEqual(self.save_tags([]).status_code, 400)
        self.assertEqual(self.load_copy().json()["data"]["tags"], ["Admin"])

    def test_copy_tags_schema_upgrade_and_sqlite_postgres_transfer(self):
        target = self.migrate_to_memory(legacy_tags=True)
        self.assertEqual(target.execute(
            "SELECT copy_tags FROM project_publications WHERE id = ?", (self.plan["id"],),
        ).fetchone()["copy_tags"], "[]")
        storage.init_db()
        self.assertEqual(self.load_copy().json()["data"]["tags"], [])
        saved = self.save_tags(["新品", "👩‍💻"]).json()["data"]
        storage.init_db()
        self.assertEqual(self.load_copy().json()["data"], saved)
        target = self.migrate_to_memory()
        self.assertEqual(json.loads(target.execute(
            "SELECT copy_tags FROM project_publications WHERE id = ?", (self.plan["id"],),
        ).fetchone()["copy_tags"]), saved["tags"])

    def test_copy_persistence_counts_and_independent_plan_name(self):
        self.assertEqual(self.load_copy().json()["data"], {"title": "", "content": "", "tags": []})
        self.assertFalse(self.plan["has_copy"])
        saved = self.save_copy(title="  Campaign title  ")
        self.assertEqual(saved.status_code, 200, saved.text)
        self.assertEqual(saved.json()["data"], {
            "title": "Campaign title", "content": "Saved body", "tags": [],
        })
        storage.init_db()
        self.assertEqual(self.load_copy(self.member).json()["data"], saved.json()["data"])
        self.assertEqual(self.items(), [])
        for plan in (
            self.client.get(self.path, headers=self.headers()).json()["data"],
            self.client.get(self.plans, headers=self.headers()).json()["data"][0],
            self.client.patch(self.path, headers=self.headers(), json={"note": "Settings"}).json()["data"],
        ):
            self.assertEqual(plan["name"], self.plan["name"])
            self.assertTrue(plan["has_copy"])
            self.assertEqual((plan["content_count"], plan["document_count"]), (1, 1))
            self.assertNotIn("content", plan)
            self.assertNotIn("copy_content_html", plan)
            self.assertNotIn("copy_text", plan)
            self.assertNotIn("copy_title", plan)
        self.client.patch(self.path, headers=self.headers(), json={"name": "Plan renamed"})
        self.assertEqual(self.load_copy().json()["data"], saved.json()["data"])

    def test_copy_clear_whitespace_and_title_only_do_not_count(self):
        self.account()
        for empty in ("", " \n\t ", "\r\n", "\u00a0", "\u2003"):
            self.save_copy()
            self.assertEqual(self.schedule().status_code, 200)
            self.cancel()
            response = self.save_copy(title="Incomplete title", content=empty)
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(response.json()["data"], {"title": "Incomplete title", "content": "", "tags": []})
            plan = self.client.get(self.path, headers=self.headers()).json()["data"]
            self.assertFalse(plan["has_copy"])
            self.assertEqual((plan["content_count"], plan["document_count"]), (0, 0))
            self.assertEqual(plan["status"], "cancelled")
            self.assertEqual(self.schedule().status_code, 400)
        self.assertEqual(self.save_copy(title="", content="").json()["data"], {"title": "", "content": "", "tags": []})

    def test_copy_only_scheduling_and_attachment_removal_preserve_saved_body(self):
        self.account()
        self.save_copy(title="", content="<p>Text without title</p>")
        self.assertEqual(self.schedule().status_code, 200)
        self.cancel()
        image = self.own_upload().json()["data"]
        document = self.own_upload("document.txt", b"Document snapshot").json()["data"]
        plan = self.client.get(self.path, headers=self.headers()).json()["data"]
        self.assertEqual((plan["content_count"], plan["document_count"], plan["image_count"]), (3, 2, 1))
        self.assertEqual(self.delete_item(image).status_code, 200)
        self.assertEqual(self.delete_item(document).status_code, 200)
        plan = self.client.get(self.path, headers=self.headers()).json()["data"]
        self.assertEqual((plan["status"], plan["content_count"]), ("cancelled", 1))
        self.assertEqual(self.save_copy(content="").status_code, 200)
        self.assertEqual(self.client.get(self.path, headers=self.headers()).json()["data"]["status"], "cancelled")

    def test_copy_changes_never_overwrite_document_attachments_or_sources(self):
        source = self.create_copy().json()["data"]
        snapshot = self.pick(source["id"]).json()["data"][0]
        original = self.document(snapshot).json()["data"]
        self.save_copy(content="<p>Independent text</p>")
        self.account()
        self.assertEqual(self.schedule().status_code, 200)
        self.cancel()
        self.assertEqual(self.save_copy(title="", content="").status_code, 200)
        self.assertEqual(self.document(snapshot).json()["data"], original)
        self.assertEqual(len(self.items()), 1)
        plan = self.client.get(self.path, headers=self.headers()).json()["data"]
        self.assertEqual((plan["status"], plan["content_count"], plan["has_copy"]), ("cancelled", 1, False))
        self.assertEqual(self.client.get(
            self.base + f"/materials/{source['id']}/content", headers=self.headers(),
        ).json()["data"], original)
        self.save_copy()
        second = self.own_upload("other.txt", b"Other document").json()["data"]
        self.assertIn("Other document", self.document(second).text)
        self.assertEqual(self.load_copy().json()["data"]["content"], "Saved body")

    def test_copy_permissions_current_organization_and_published_immutability(self):
        self.save_copy()
        self.assertEqual(self.load_copy(self.member).status_code, 200)
        self.assertEqual(self.save_copy(user=self.member).status_code, 403)
        self.assertEqual(self.save_copy(user=self.admin).status_code, 200)
        self.assertEqual(self.load_copy(self.outsider).status_code, 404)
        self.assertEqual(self.save_copy(user=self.outsider).status_code, 404)
        self.assertEqual(self.client.get(self.path + "/copy").status_code, 401)
        self.assertEqual(self.client.patch(self.path + "/copy", json={"title": "", "content": ""}).status_code, 401)
        organization = auth_storage.get_current_organization(self.owner["id"])
        other = auth_storage.create_organization(self.owner["id"], "Copy organization")
        auth_storage.switch_organization(self.owner["id"], other["id"])
        self.assertEqual(self.load_copy().status_code, 404)
        self.assertEqual(self.save_copy().status_code, 404)
        auth_storage.switch_organization(self.owner["id"], organization["id"])
        with sqlite3.connect(self.db_path) as conn:
            conn.execute("UPDATE project_publications SET status = 'published' WHERE id = ?", (self.plan["id"],))
        self.assertEqual(self.load_copy().status_code, 200)
        self.assertEqual(self.save_copy().status_code, 400)
        self.assertEqual(self.save_copy(title="", content="", user=self.admin).status_code, 400)
        own_plan = self.client.post(self.plans, headers=self.headers(self.member), json={
            "project_id": self.project.id, "name": "Member copy plan",
        }).json()["data"]
        self.path = f"{self.plans}/{own_plan['id']}"
        self.assertEqual(self.save_copy(user=self.member).status_code, 200)
        self.assertEqual(self.save_copy(user=self.owner).status_code, 200)
        self.path = self.plans + "/missing"
        self.assertEqual(self.load_copy().status_code, 404)
        self.assertEqual(self.save_copy().status_code, 404)

    def test_copy_plaintext_limits_and_rejected_changes_preserve_saved_state(self):
        html = (
            '<p onclick="bad()">Body<script>bad()</script>'
            '<a href="javascript:bad()">link</a><strong>bold</strong></p>'
        )
        safe = self.save_copy(content=html)
        self.assertEqual(safe.json()["data"]["content"], html)
        for payload, code in (
            ({}, 422), ({"title": "only title"}, 422),
            ({"title": None, "content": ""}, 422), ({"title": "", "content": None}, 422),
            ({"title": "x" * 256, "content": ""}, 422),
            ({"title": "", "content": "x" * (1024 * 1024 + 1)}, 422),
            ({"title": "", "content": "界" * 400000}, 400),
            ({"title": "", "content": "<p>\x00body</p>"}, 400),
            ({"title": "", "content": "unsafe\x7f"}, 400),
            ({"title": "", "content": "unsafe\x85"}, 400),
            ({"title": "", "content": "", "name": "Not plan name"}, 422),
        ):
            response = self.client.patch(self.path + "/copy", headers=self.headers(), json=payload)
            self.assertEqual(response.status_code, code, response.text)
            self.assertEqual(self.load_copy().json()["data"], safe.json()["data"])
        exact = "x" * (1024 * 1024)
        self.assertEqual(self.save_copy(title="x" * 255, content=exact).status_code, 200)
        self.assertEqual(len(self.load_copy().json()["data"]["content"].encode()), 1024 * 1024)
        for literal in ("&" * 300000, "<p>" * 129 + "body"):
            self.assertEqual(self.save_copy(content=literal).json()["data"]["content"], literal)
        with self.assertRaisesRegex(ValueError, "invalid Unicode"):
            material_copy.validate_copy_text("unsafe\ud800")

    def test_copy_database_failure_rolls_back_body_title_and_tags_after_cancellation(self):
        self.save_tags(["Original"])
        self.account()
        self.schedule()
        self.cancel()
        before = self.load_copy().json()["data"]
        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                "CREATE TRIGGER reject_copy_update BEFORE UPDATE OF copy_text ON project_publications "
                "WHEN NEW.copy_text = '' BEGIN SELECT RAISE(ABORT, 'reject copy'); END",
            )
        with self.assertRaises(sqlite3.IntegrityError):
            self.save_tags([], content="")
        self.assertEqual(self.load_copy().json()["data"], before)
        plan = self.client.get(self.path, headers=self.headers()).json()["data"]
        self.assertEqual(plan["status"], "cancelled")
        self.assertTrue(plan["has_copy"])

    def test_copy_schema_upgrade_is_idempotent_and_preserves_plan_metadata(self):
        self.account()
        self.own_upload()
        self.schedule()
        with sqlite3.connect(self.db_path) as conn:
            conn.execute("ALTER TABLE project_publications DROP COLUMN copy_title")
            conn.execute("ALTER TABLE project_publications DROP COLUMN copy_content_html")
            conn.execute("ALTER TABLE project_publications DROP COLUMN copy_text")
        storage.init_db()
        storage.init_db()
        self.assertEqual(self.load_copy().json()["data"], {"title": "", "content": "", "tags": []})
        plan = self.client.get(self.path, headers=self.headers()).json()["data"]
        self.assertEqual((plan["name"], plan["status"], plan["content_count"]), (self.plan["name"], "scheduled", 1))
        self.cancel()
        saved = self.save_copy().json()["data"]
        storage.init_db()
        self.assertEqual(self.load_copy().json()["data"], saved)

    def test_new_plaintext_is_never_parsed_as_html_and_preserves_whitespace_emoji(self):
        text = "  <b>hello</b>\n<3 & &amp; &#128512;\n\n👩🏽‍💻 ❤️ 🏳️‍🌈\tend\r\n "
        saved = self.save_copy(title="Literal copy", content=text)
        self.assertEqual(saved.status_code, 200, saved.text)
        self.assertEqual(saved.json()["data"], {"title": "Literal copy", "content": text, "tags": []})
        storage.init_db()
        self.assertEqual(self.load_copy().json()["data"], saved.json()["data"])
        for literal in ("<p><br></p>", "<script>literal()</script>", "<3", "&"):
            self.assertEqual(self.save_copy(content=literal).json()["data"]["content"], literal)
            plan = self.client.get(self.path, headers=self.headers()).json()["data"]
            self.assertTrue(plan["has_copy"])
            self.assertEqual((plan["content_count"], plan["document_count"]), (1, 1))
        self.account()
        self.assertEqual(self.schedule().status_code, 200)
        self.cancel()
        self.assertEqual(self.save_copy(content=" \n\t ").json()["data"]["content"], "")
        self.assertEqual(self.client.get(self.path, headers=self.headers()).json()["data"]["status"], "cancelled")

    def test_legacy_copy_migration_decodes_once_and_preserves_original_html_and_metadata(self):
        html = (
            "<h2>Heading 👩‍💻</h2><p>First <strong>bold</strong> &amp; &lt;3"
            "<br>Second &amp;lt;b&amp;gt;</p>"
            "<ul><li>One</li><li>Two</li></ul><p>Literal &lt;b&gt;text&lt;/b&gt;</p>"
            "<script>discard()</script><style>discard{}</style>"
        )
        expected = (
            "Heading 👩‍💻\n\nFirst bold & <3\nSecond &lt;b&gt;"
            "\n\nOne\nTwo\n\nLiteral <b>text</b>"
        )
        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                "UPDATE project_publications SET copy_title = 'Legacy title', copy_content_html = ?, "
                "updated_at = 'legacy-time' WHERE id = ?", (html, self.plan["id"]),
            )
            conn.execute("ALTER TABLE project_publications DROP COLUMN copy_text")
        loaded = self.load_copy()
        self.assertEqual(loaded.status_code, 200, loaded.text)
        self.assertEqual(loaded.json()["data"], {"title": "Legacy title", "content": expected, "tags": []})
        storage.init_db()
        with sqlite3.connect(self.db_path) as conn:
            row = conn.execute(
                "SELECT copy_text, copy_content_html, updated_at, name FROM project_publications WHERE id = ?",
                (self.plan["id"],),
            ).fetchone()
        self.assertEqual(row, (expected, html, "legacy-time", self.plan["name"]))
        self.assertEqual(self.save_copy(content="<b>new literal</b>").json()["data"]["content"], "<b>new literal</b>")
        self.save_copy(content="")
        storage.init_db()
        self.assertEqual(self.load_copy().json()["data"]["content"], "")
        self.assertFalse(self.client.get(self.path, headers=self.headers()).json()["data"]["has_copy"])
        with sqlite3.connect(self.db_path) as conn:
            self.assertEqual(conn.execute(
                "SELECT copy_content_html FROM project_publications WHERE id = ?", (self.plan["id"],),
            ).fetchone()[0], html)

    def test_legacy_empty_html_does_not_count_as_copy(self):
        for html in ("<p><br></p>", "<p>&nbsp;</p>", "<script>hidden</script>"):
            with sqlite3.connect(self.db_path) as conn:
                conn.execute(
                    "UPDATE project_publications SET copy_content_html = ?, copy_text = NULL WHERE id = ?",
                    (html, self.plan["id"]),
                )
            self.assertEqual(self.load_copy().json()["data"]["content"], "")
            plan = self.client.get(self.path, headers=self.headers()).json()["data"]
            self.assertEqual((plan["has_copy"], plan["content_count"], plan["document_count"]), (False, 0, 0))

    def test_document_text_format_conversion_is_opt_in_scoped_and_nonmutating(self):
        source = self.create_copy(content="<h2>Title</h2><p>&lt;b&gt;literal&lt;/b&gt; &amp; 👩‍💻<br>Line</p>").json()["data"]
        item = self.pick(source["id"]).json()["data"][0]
        endpoint = self.contents + f"/{item['id']}/content"
        html_before = self.client.get(endpoint, headers=self.headers()).json()["data"]
        self.assertEqual(html_before["format"], "html")
        response = self.client.get(endpoint, params={"format": "text"}, headers=self.headers(self.member))
        self.assertEqual(response.status_code, 200, response.text)
        text = "Title\n\n<b>literal</b> & 👩‍💻\nLine"
        self.assertEqual(response.json()["data"], {"content": text, "format": "text"})
        self.assertEqual(self.save_copy(content=text).json()["data"]["content"], text)
        self.assertEqual(self.load_copy().json()["data"]["content"], text)
        self.assertEqual(self.client.get(endpoint, headers=self.headers()).json()["data"], html_before)
        self.assertEqual(self.client.get(
            self.base + f"/materials/{source['id']}/content", headers=self.headers(),
        ).json()["data"], html_before)
        self.assertEqual(self.client.get(endpoint, params={"format": "bad"}, headers=self.headers()).status_code, 422)
        self.assertEqual(self.client.get(endpoint, params={"format": "text"}, headers=self.headers(self.outsider)).status_code, 404)
        self.assertEqual(self.client.get(endpoint, params={"format": "text"}).status_code, 401)
        image = self.own_upload().json()["data"]
        self.assertEqual(self.client.get(
            self.contents + f"/{image['id']}/content?format=text", headers=self.headers(),
        ).status_code, 400)

    def test_plaintext_conversion_boundaries_entities_and_emoji(self):
        for html, expected in (
            ("<p>First</p>\n<p>Second</p>", "First\n\nSecond"),
            ("<div>A<br><br>B</div><div>C</div>", "A\n\nB\nC"),
            ("<h1>Heading</h1><ul><li>One</li><li>Two</li></ul>", "Heading\n\nOne\nTwo"),
            ("<p>  indent\tline<br> next  </p>", "  indent\tline\n next  "),
            ("<p>&amp;lt;b&amp;gt; &lt;3 &#128512; 👩🏽‍💻 ❤️</p>", "&lt;b&gt; <3 😀 👩🏽‍💻 ❤️"),
            ("<p>A<script>x()</script><style>p{}</style>B</p>", "AB"),
        ):
            with self.subTest(html=html):
                self.assertEqual(material_copy.copy_html_to_text(html), expected)

    def test_uploaded_text_document_fill_preserves_literals_and_newlines(self):
        text = "  <b>hello</b> <3 & &amp;\n\n👩🏽‍💻 ❤️\tlast\n"
        item = self.own_upload("literal.txt", text.encode()).json()["data"]
        response = self.client.get(
            self.contents + f"/{item['id']}/content?format=text", headers=self.headers(),
        )
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["data"], {"content": text, "format": "text"})
        self.assertEqual(self.save_copy(content=response.json()["data"]["content"]).json()["data"]["content"], text)
        self.assertIn("&lt;b&gt;", self.document(item).json()["data"]["content"])

    def test_preupgrade_sqlite_transfer_converts_legacy_copy_without_reparsing_new_text(self):
        html = "<p>Legacy &lt;b&gt;literal&lt;/b&gt;</p><p>Next</p>"
        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                "UPDATE project_publications SET copy_content_html = ? WHERE id = ?", (html, self.plan["id"]),
            )
        target = self.migrate_to_memory(legacy_copy=True)
        row = target.execute(
            "SELECT copy_text, copy_content_html FROM project_publications WHERE id = ?", (self.plan["id"],),
        ).fetchone()
        self.assertEqual(tuple(row), ("Legacy <b>literal</b>\n\nNext", html))
        storage.init_db()
        literal = "<b>not parsed</b> &amp;\n👩‍💻"
        self.save_copy(content=literal)
        target = self.migrate_to_memory()
        row = target.execute(
            "SELECT copy_text, copy_content_html FROM project_publications WHERE id = ?", (self.plan["id"],),
        ).fetchone()
        self.assertEqual(tuple(row), (literal, html))

    def account(self):
        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                "INSERT INTO project_channel_accounts "
                "(id, project_id, platform, account_name, platform_user_id, created_by_user_id, "
                "authorization_status, scopes, created_at, updated_at) "
                "VALUES ('account', ?, 'douyin', 'Account', 'user', ?, 'active', "
                "'[\"video.create.bind\"]', '2026-01-01', '2026-01-01')",
                (self.project.id, self.owner["id"]),
            )
        return "account"

    def schedule(self):
        return self.client.patch(self.path, headers=self.headers(), json={
            "channel_account_id": "account", "scheduled_for": "2026-10-01T10:00:00Z",
            "status": "scheduled",
        })

    def cancel(self):
        response = self.client.patch(self.path, headers=self.headers(), json={"status": "cancelled"})
        self.assertEqual(response.status_code, 200, response.text)
        return response

    def test_own_uploads_persist_images_copy_and_counts_without_html_in_lists(self):
        for filename, data in (("photo.png", b"image"), ("second.jpg", b"image"), ("copy.md", b"**Text**")):
            response = self.own_upload(filename, data)
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(response.json()["data"]["source_material_id"], "")
        storage.init_db()
        items = self.items()
        self.assertEqual(len(items), 3)
        for item in items:
            self.assertNotIn("content_html", item)
            self.assertNotIn("object_key", item)
            self.assertNotIn("content", item)
            self.assertEqual(bool(item["file_url"]), item["media_type"] != "document")
        document = next(item for item in items if item["media_type"] == "document")
        self.assertEqual(self.document(document).json()["data"], {
            "content": "<p><strong>Text</strong></p>\n", "format": "html",
        })
        responses = [
            self.client.get(self.path, headers=self.headers()).json()["data"],
            self.client.get(self.plans, headers=self.headers()).json()["data"][0],
            self.client.patch(self.path, headers=self.headers(), json={"note": "new"}).json()["data"],
        ]
        for plan in responses:
            self.assertEqual(
                [plan[key] for key in ("content_count", "image_count", "video_count", "document_count")],
                [3, 2, 0, 1],
            )
        self.assertEqual(self.plan["content_count"], 0)
        self.assertEqual(self.document(next(i for i in items if i["media_type"] == "image")).status_code, 400)

    def test_uploaded_and_imported_image_video_urls_are_publicly_served(self):
        @self.client.app.get("/media/{key:path}")
        def public_media(key: str):
            return media_storage.media_response(key, public=True)

        for filename, data, mime in (
            ("photo.gif", b"GIF89a-image", "image/gif"),
            ("clip.mp4", b"video", "video/mp4"),
        ):
            self.client.patch(self.path, headers=self.headers(), json={
                "media_mode": "video" if mime.startswith("video/") else "image_text",
            })
            own = self.own_upload(filename, data).json()["data"]
            source = self.upload(filename, data).json()["data"]
            for get_item in (
                lambda own=own: own,
                lambda source=source: self.pick(source["id"]).json()["data"][0],
            ):
                item = get_item()
                response = self.client.get(item["file_url"])
                self.assertEqual(response.status_code, 200, response.text)
                self.assertEqual(response.content, data)
                self.assertEqual(response.headers["content-type"], mime)
                self.assertEqual(self.delete_item(item).status_code, 200)
        for key in (
            "publishing/org/project/tasks/task/image.png",
            "publishing/org/project/publications/plan/state.json",
            "publishing/org/project/publications/plan/original.docx",
            "publishing/org/project/publications/plan/private/image.png",
            "publishing/org/project/publications/image.png",
        ):
            media_storage.put_media_bytes(key, b"private")
            self.assertEqual(self.client.get("/media/" + key).status_code, 404)

    def test_document_upload_uses_bounded_parser_no_original_file(self):
        for filename, data in (
            ("copy.txt", b"<script>literal</script>"), ("copy.markdown", b"# Title"),
            ("copy.pdf", material_tests.MaterialCopyTests.pdf_bytes()),
            ("copy.docx", material_tests.MaterialCopyTests.docx_bytes()),
        ):
            with self.subTest(filename=filename), patch.object(publication_contents, "put_media_bytes") as put:
                response = self.own_upload(filename, data)
                self.assertEqual(response.status_code, 200, response.text)
                put.assert_not_called()
                item = response.json()["data"]
                self.assertEqual(item["mime_type"], "text/html")
                self.assertEqual(self.document(item).status_code, 200)
        for filename, data, code in (("bad.html", b"html", 400), ("empty.txt", b"", 400), ("bad.pdf", b"bad", 400)):
            self.assertEqual(self.own_upload(filename, data).status_code, code)
        with patch("app.api.publishing.MAX_IMAGE_SIZE_BYTES", 2):
            self.assertEqual(self.own_upload().status_code, 413)

    def test_picked_snapshots_survive_source_edit_delete_and_plan_delete_preserves_source(self):
        image = self.upload("photo.png", b"source image").json()["data"]
        doc = self.create_copy().json()["data"]
        imported = self.pick(image["id"], doc["id"])
        self.assertEqual(imported.status_code, 200, imported.text)
        items = imported.json()["data"]
        self.assertEqual({i["source_material_id"] for i in items}, {image["id"], doc["id"]})
        owned = next(i for i in items if i["media_type"] == "image")
        key = media_storage.media_key_from_url(owned["file_url"])
        self.assertNotEqual(key, image["object_key"])
        self.client.patch(
            self.base + f"/materials/{doc['id']}/content", headers=self.headers(),
            json={"content": "<p>Changed</p>"},
        )
        for source in (doc, image):
            self.assertEqual(self.client.delete(
                self.base + f"/materials/{source['id']}", headers=self.headers(),
            ).status_code, 200)
        self.assertEqual(media_storage.read_media_bytes(key), b"source image")
        self.assertIn("Hello", self.document(next(i for i in items if i["media_type"] == "document")).text)
        fresh = self.upload("untouched.png", b"keep").json()["data"]
        self.assertEqual(self.pick(fresh["id"]).status_code, 200)
        self.assertEqual(self.client.delete(self.path, headers=self.headers()).status_code, 200)
        self.assertFalse(media_storage.media_exists(key))
        self.assertEqual(media_storage.read_media_bytes(fresh["object_key"]), b"keep")
        with sqlite3.connect(self.db_path) as conn:
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM publication_contents").fetchone()[0], 0)

    def test_legacy_document_snapshot_sanitized_and_no_mutation(self):
        for extension, data, mime in (
            (".html", b"<p>Original</p><script>bad()</script>", "text/html"),
            (".md", b"**Original**", "text/markdown"),
            (".pdf", material_tests.MaterialCopyTests.pdf_bytes("Original"), "application/pdf"),
        ):
            source = self.legacy(extension, data, mime)
            imported = self.pick(source["id"])
            self.assertEqual(imported.status_code, 200, imported.text)
            item = imported.json()["data"][0]
            self.assertIn("Original", self.document(item).text)
            self.assertNotIn("<script>", self.document(item).text)
            self.assertEqual(media_storage.read_media_bytes(source["object_key"]), data)
            self.assertEqual(self.delete_item(item).status_code, 200)
            self.assertTrue(media_storage.media_exists(source["object_key"]))

    def test_batch_validation_atomicity_duplicates_collections_project_scope(self):
        source = self.upload("photo.png", b"source").json()["data"]
        for ids, status in (
            ([source["id"], "missing"], 404), ([self.material_set.id], 400),
            ([source["id"], source["id"]], 400), ([], 422), (["x"] * 11, 422),
        ):
            self.assertEqual(self.pick(*ids).status_code, status)
            self.assertEqual(self.items(), [])
        other = storage.create_manual_project(self.owner["id"], title="Other")
        with sqlite3.connect(self.db_path) as conn:
            conn.execute("UPDATE project_materials SET project_id = ? WHERE id = ?", (other.id, source["id"]))
        self.assertEqual(self.pick(source["id"]).status_code, 404)
        with sqlite3.connect(self.db_path) as conn:
            conn.execute("UPDATE project_materials SET project_id = ? WHERE id = ?", (self.project.id, source["id"]))
        self.assertEqual(self.pick(source["id"]).status_code, 200)
        duplicate = self.pick(source["id"])
        self.assertEqual(duplicate.status_code, 400)
        self.assertEqual(duplicate.json()["detail"], "Material already added to this plan")
        self.assertEqual(len(self.items()), 1)

    def test_upload_and_batch_rollback_cleanup_on_database_or_storage_failure(self):
        source = self.upload("photo.png", b"source").json()["data"]
        before = set(media_storage.list_media_keys("publishing"))
        with patch.object(publication_contents, "_insert_content", side_effect=sqlite3.OperationalError("failed")):
            with self.assertRaises(sqlite3.OperationalError):
                self.own_upload()
            with self.assertRaises(sqlite3.OperationalError):
                self.pick(source["id"])
        self.assertEqual(self.items(), [])
        self.assertEqual(set(media_storage.list_media_keys("publishing")), before)
        missing = self.legacy(".md", b"missing", "text/markdown")
        media_storage.delete_media(missing["object_key"])
        self.assertEqual(self.pick(source["id"], missing["id"]).status_code, 404)
        self.assertEqual(self.items(), [])
        self.assertEqual(set(media_storage.list_media_keys("publishing")), before)
        self.assertTrue(media_storage.media_exists(source["object_key"]))
        second = self.upload("second.jpg", b"image").json()["data"]
        insert = publication_contents._insert_content
        calls = 0

        def fail_second(*args, **kwargs):
            nonlocal calls
            calls += 1
            if calls == 2:
                raise sqlite3.OperationalError("second insert failed")
            return insert(*args, **kwargs)

        with (
            patch.object(publication_contents, "_insert_content", side_effect=fail_second),
            self.assertRaises(sqlite3.OperationalError),
        ):
            self.pick(source["id"], second["id"])
        self.assertEqual(self.items(), [])
        self.assertEqual(set(media_storage.list_media_keys("publishing")), before)
        put = publication_contents.put_media_bytes

        def write_then_fail(*args, **kwargs):
            put(*args, **kwargs)
            raise OSError("storage failed")

        with (
            patch.object(publication_contents, "put_media_bytes", side_effect=write_then_fail),
            self.assertRaises(OSError),
        ):
            self.own_upload()
        self.assertEqual(set(media_storage.list_media_keys("publishing")), before)

    def test_failed_deletion_keeps_owned_media_and_database_rows(self):
        item = self.own_upload().json()["data"]
        key = media_storage.media_key_from_url(item["file_url"])
        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                "CREATE TRIGGER reject_content_delete BEFORE DELETE ON publication_contents "
                "BEGIN SELECT RAISE(ABORT, 'reject deletion'); END",
            )
        for action in (
            lambda: self.delete_item(item),
            lambda: self.client.delete(self.path, headers=self.headers()),
        ):
            with self.assertRaises(sqlite3.IntegrityError):
                action()
            self.assertTrue(media_storage.media_exists(key))
            self.assertEqual(len(self.items()), 1)

    def test_permissions_scopes_and_published_immutability(self):
        doc = self.own_upload("copy.txt", b"Text").json()["data"]
        source = self.create_copy().json()["data"]
        for user in (self.member, self.admin):
            self.assertEqual(self.client.get(self.contents, headers=self.headers(user)).status_code, 200)
            self.assertEqual(self.document(doc, user).status_code, 200)
        self.assertEqual(self.own_upload(user=self.member).status_code, 403)
        self.assertEqual(self.pick(source["id"], user=self.member).status_code, 403)
        self.assertEqual(self.delete_item(doc, self.member).status_code, 403)
        self.assertEqual(self.own_upload(user=self.admin).status_code, 200)
        self.assertEqual(self.pick(source["id"], user=self.admin).status_code, 200)
        for action in (
            lambda: self.client.get(self.contents, headers=self.headers(self.outsider)),
            lambda: self.own_upload(user=self.outsider),
            lambda: self.pick(source["id"], user=self.outsider),
            lambda: self.document(doc, self.outsider),
            lambda: self.delete_item(doc, self.outsider),
        ):
            self.assertEqual(action().status_code, 404)
        organization = auth_storage.get_current_organization(self.owner["id"])
        other = auth_storage.create_organization(self.owner["id"], "Other org")
        auth_storage.switch_organization(self.owner["id"], other["id"])
        self.assertEqual(self.client.get(self.contents, headers=self.headers()).status_code, 404)
        self.assertEqual(self.own_upload().status_code, 404)
        auth_storage.switch_organization(self.owner["id"], organization["id"])
        with sqlite3.connect(self.db_path) as conn:
            conn.execute("UPDATE project_publications SET status = 'published' WHERE id = ?", (self.plan["id"],))
        self.assertEqual(self.client.get(self.contents, headers=self.headers()).status_code, 200)
        self.assertEqual(self.own_upload().status_code, 400)
        self.assertEqual(self.pick(source["id"]).status_code, 400)
        self.assertEqual(self.delete_item(doc).status_code, 400)
        self.assertEqual(self.client.delete(self.path, headers=self.headers()).status_code, 400)

    def test_scheduling_requires_contents_account_time_and_cancellation_before_removal(self):
        self.account()
        self.assertEqual(self.schedule().status_code, 400)
        item = self.own_upload().json()["data"]
        other = self.own_upload("copy.txt", b"Text").json()["data"]
        scheduled = self.schedule()
        self.assertEqual(scheduled.status_code, 200, scheduled.text)
        self.assertEqual(scheduled.json()["data"]["portfolio_id"], "")
        self.assertEqual(scheduled.json()["data"]["status"], "scheduled")
        self.cancel()
        other_project = storage.create_manual_project(self.owner["id"], title="Account project")
        with sqlite3.connect(self.db_path) as conn:
            conn.execute("UPDATE project_channel_accounts SET project_id = ? WHERE id = 'account'", (other_project.id,))
        self.assertEqual(self.schedule().status_code, 404)
        with sqlite3.connect(self.db_path) as conn:
            conn.execute("UPDATE project_channel_accounts SET project_id = ? WHERE id = 'account'", (self.project.id,))
        for field in ("channel_account_id", "scheduled_for"):
            self.assertEqual(self.client.patch(
                self.path, headers=self.headers(), json={field: "", "status": "scheduled"},
            ).status_code, 400)
        with sqlite3.connect(self.db_path) as conn:
            conn.execute("UPDATE project_channel_accounts SET authorization_status = 'revoked' WHERE id = 'account'")
        self.assertEqual(self.schedule().status_code, 404)
        with sqlite3.connect(self.db_path) as conn:
            conn.execute("UPDATE project_channel_accounts SET authorization_status = 'active' WHERE id = 'account'")
        self.assertEqual(self.delete_item(item).status_code, 200)
        self.assertEqual(self.client.get(self.path, headers=self.headers()).json()["data"]["status"], "cancelled")
        self.assertEqual(self.delete_item(other).status_code, 200)
        plan = self.client.get(self.path, headers=self.headers()).json()["data"]
        self.assertEqual((plan["status"], plan["content_count"]), ("cancelled", 0))
        self.assertEqual(self.client.post(self.plans, headers=self.headers(), json={
            "project_id": self.project.id, "name": "Cannot schedule empty", "channel_account_id": "account",
            "scheduled_for": "2026-10-01",
        }).status_code, 400)

    def test_member_creator_can_manage_own_plan_and_uploads_need_authentication(self):
        created = self.client.post(self.plans, headers=self.headers(self.member), json={
            "project_id": self.project.id, "name": "Member plan",
        }).json()["data"]
        self.contents = f"{self.plans}/{created['id']}/contents"
        item = self.own_upload(user=self.member).json()["data"]
        self.assertEqual(self.delete_item(item, self.member).status_code, 200)
        for method, path, kwargs in (
            ("GET", self.contents, {}),
            ("POST", self.contents, {"files": {"file": ("image.png", b"image")}}),
            ("POST", self.contents + "/from-materials", {"json": {"material_ids": ["source"]}}),
            ("GET", self.contents + "/missing/content", {}),
            ("DELETE", self.contents + "/missing", {}),
        ):
            self.assertEqual(self.client.request(method, path, **kwargs).status_code, 401)

    def test_batch_limit_is_not_a_total_content_limit(self):
        sources = [self.create_copy(title=f"Copy {index}").json()["data"]["id"] for index in range(11)]
        self.assertEqual(self.pick(*sources[:10]).status_code, 200)
        self.assertEqual(self.pick(sources[10]).status_code, 200)
        self.assertEqual(len(self.items()), 11)

    def test_content_id_is_bound_to_plan_and_not_found(self):
        item = self.own_upload("copy.txt", b"Text").json()["data"]
        other = self.client.post(self.plans, headers=self.headers(), json={
            "project_id": self.project.id, "name": "Other",
        }).json()["data"]
        foreign = f"{self.plans}/{other['id']}/contents/{item['id']}"
        self.assertEqual(self.client.get(foreign + "/content", headers=self.headers()).status_code, 404)
        self.assertEqual(self.client.delete(foreign, headers=self.headers()).status_code, 404)
        self.assertEqual(self.client.get(self.plans + "/missing/contents", headers=self.headers()).status_code, 404)
        self.assertEqual(self.document({"id": "missing"}).status_code, 404)
        self.assertEqual(self.delete_item({"id": "missing"}).status_code, 404)

    def test_project_deletion_removes_owned_media_and_rows(self):
        item = self.own_upload().json()["data"]
        key = media_storage.media_key_from_url(item["file_url"])
        response = self.client.delete(self.base, headers=self.headers())
        self.assertEqual(response.status_code, 200, response.text)
        self.assertFalse(media_storage.media_exists(key))
        with sqlite3.connect(self.db_path) as conn:
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM publication_contents").fetchone()[0], 0)

    def test_sqlite_upgrade_and_migration_order_preserve_legacy_plans(self):
        with sqlite3.connect(self.db_path) as conn:
            conn.execute("DROP TABLE publication_contents")
            conn.execute(
                "UPDATE project_publications SET portfolio_id = 'legacy', status = 'scheduled', "
                "scheduled_for = '2026-10-01' WHERE id = ?", (self.plan["id"],),
            )
        storage.init_db()
        plan = self.client.get(self.path, headers=self.headers()).json()["data"]
        self.assertEqual((plan["portfolio_id"], plan["status"], plan["content_count"]), ("legacy", "scheduled", 0))
        self.assertEqual(self.client.patch(self.path, headers=self.headers(), json={"note": "edit"}).status_code, 400)
        self.cancel()
        self.assertEqual(self.client.patch(self.path, headers=self.headers(), json={"status": "draft"}).status_code, 200)
        self.own_upload()
        self.assertLess(
            migrate_sqlite_to_postgres._TABLE_ORDER.index("project_publications"),
            migrate_sqlite_to_postgres._TABLE_ORDER.index("publication_contents"),
        )
        output = io.StringIO()
        with patch("sys.argv", ["migrate", "--sqlite-path", self.db_path, "--database-url", "postgresql://unused", "--dry-run"]), redirect_stdout(output):
            self.assertEqual(migrate_sqlite_to_postgres.main(), 0)
        self.assertIn("publication_contents: 1", output.getvalue())

    def test_migration_transfers_snapshot_columns_and_owned_keys(self):
        source = self.create_copy().json()["data"]
        self.pick(source["id"])
        self.own_upload()
        saved_copy = self.save_copy().json()["data"]
        with sqlite3.connect(self.db_path) as conn:
            expected = conn.execute("SELECT * FROM publication_contents ORDER BY id").fetchall()
        target = self.migrate_to_memory()
        actual = [tuple(row) for row in target.execute("SELECT * FROM publication_contents ORDER BY id")]
        self.assertEqual(actual, expected)
        migrated_copy = target.execute(
            "SELECT copy_title, copy_text, media_mode FROM project_publications WHERE id = ?", (self.plan["id"],),
        ).fetchone()
        self.assertEqual(tuple(migrated_copy), (saved_copy["title"], saved_copy["content"], "image_text"))

    def migrate_to_memory(self, *, legacy_media=False, legacy_copy=False, legacy_tags=False):
        class MigrationTarget(sqlite3.Connection):
            def execute(self, sql, parameters=()):
                if "information_schema.columns" in sql:
                    return super().execute("SELECT 1 WHERE 0")
                return super().execute(sql, parameters)

            def close(self):
                pass

        target = sqlite3.connect(":memory:", factory=MigrationTarget)
        target.row_factory = sqlite3.Row
        self.addCleanup(sqlite3.Connection.close, target)
        with sqlite3.connect(self.db_path) as conn:
            schemas = conn.execute(
                "SELECT sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
            ).fetchall()
        for (sql,) in schemas:
            target.execute(sql)
        target.execute("PRAGMA foreign_keys = ON")
        if legacy_media:
            with sqlite3.connect(self.db_path) as conn:
                conn.execute("DROP INDEX idx_publication_contents_position")
                conn.execute("ALTER TABLE publication_contents DROP COLUMN position")
                conn.execute("ALTER TABLE project_publications DROP COLUMN media_mode")
        if legacy_copy:
            with sqlite3.connect(self.db_path) as conn:
                conn.execute("ALTER TABLE project_publications DROP COLUMN copy_text")
        if legacy_tags:
            with sqlite3.connect(self.db_path) as conn:
                conn.execute("ALTER TABLE project_publications DROP COLUMN copy_tags")
        with (
            patch.object(config, "DATABASE_URL", ""),
            patch.object(migrate_sqlite_to_postgres, "_initialize_postgres"),
            patch("app.database.connect_database", return_value=target),
            patch("sys.argv", ["migrate", "--sqlite-path", self.db_path, "--database-url", "postgresql://not-used"]),
            redirect_stdout(io.StringIO()),
        ):
            self.assertEqual(migrate_sqlite_to_postgres.main(), 0)
        return target
