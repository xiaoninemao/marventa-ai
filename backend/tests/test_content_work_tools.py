import unittest
from types import SimpleNamespace
from unittest.mock import patch

from app.engines.content_generator.models import CreativeDeliverable, ImageReference
from app.engines.content_generator.work_tools import (
    ComposeWork,
    WorkToolbox,
    work_tool_definitions,
)


def work():
    return CreativeDeliverable(
        id="original", media_kind="image", title="Title", publication_copy="Copy", tags=["tag"],
        image_url="https://test/one.png", additional_image_urls=["https://test/two.png"],
        created_at="2026-10-08T00:00:00+00:00",
    )


class WorkToolsTests(unittest.TestCase):
    def toolbox(self, kind="image", current=None, selected=None):
        return WorkToolbox(
            kind=kind, user_id="user", project_id="project", base_url="https://test",
            current=current, image_reference=selected,
        )

    def test_media_only_and_copy_only_snapshots_are_valid_but_empty_work_is_rejected(self):
        for kind in ("image", "video"):
            with self.subTest(kind=kind):
                toolbox = self.toolbox(kind=kind)
                toolbox.media = {"media:0": (f"https://test/work.{'png' if kind == 'image' else 'mp4'}", "")}
                result = toolbox.compose({"media_ids": ["media:0"]})
                self.assertEqual(result.title, "")
                self.assertEqual(result.publication_copy, "")
                self.assertTrue(result.image_url if kind == "image" else result.video_url)
                text = self.toolbox(kind=kind).compose({"publication_copy": "Only the copy"})
                self.assertEqual(text.title, "")
                self.assertEqual(text.publication_copy, "Only the copy")
                self.assertEqual(text.image_url, "")
                self.assertEqual(text.video_url, "")
                with self.assertRaisesRegex(ValueError, "requires media or text"):
                    self.toolbox(kind=kind).compose({})
                with self.assertRaisesRegex(ValueError, "requires media or text"):
                    CreativeDeliverable(id="empty", media_kind=kind, created_at="2026-10-10T00:00:00Z")

    def test_partial_edits_preserve_unrequested_media_and_text_across_snapshots(self):
        toolbox = self.toolbox(current=work())
        copy_changed = toolbox.compose({"publication_copy": "New copy"})
        self.assertEqual(copy_changed.title, "Title")
        self.assertEqual(copy_changed.image_url, work().image_url)
        self.assertEqual(copy_changed.additional_image_urls, work().additional_image_urls)
        self.assertEqual(copy_changed.tags, ["tag"])
        handle = toolbox.add_generated_image("https://test/replacement.png")
        media_changed = toolbox.compose({"media_ids": [handle]})
        self.assertEqual(media_changed.publication_copy, "New copy")
        media_only = toolbox.compose({"title": "", "publication_copy": ""})
        self.assertEqual(media_only.image_url, "https://test/replacement.png")
        self.assertEqual(media_only.title, "")
        self.assertEqual(media_only.publication_copy, "")
        copy_only = toolbox.compose({"media_ids": [], "publication_copy": "Only copy"})
        self.assertEqual(copy_only.image_url, "")
        self.assertEqual(copy_only.publication_copy, "Only copy")

    def test_partial_edits_keep_distinct_handles_when_media_urls_repeat(self):
        original = work().model_copy(update={"additional_image_urls": [work().image_url]})
        toolbox = self.toolbox(current=original)
        self.assertEqual(toolbox.describe()["media_handles"], ["current:0", "current:1"])
        changed = toolbox.compose({"publication_copy": "Updated copy"})
        self.assertEqual(changed.additional_image_urls, [original.image_url])
        self.assertEqual(toolbox.describe()["media_handles"], ["current:0", "current:1"])

    def test_each_change_is_a_snapshot_and_noop_creates_no_revision(self):
        toolbox = self.toolbox(current=work())
        args = {"title": "Title", "publication_copy": "Copy", "tags": ["tag"],
                "media_ids": ["current:0", "current:1"]}
        toolbox.compose(args)
        self.assertEqual(toolbox.revisions, [])
        first = toolbox.compose({**args, "title": "New title"})
        second = toolbox.compose({**args, "title": "Newest title"})
        self.assertEqual(len(toolbox.revisions), 2)
        self.assertNotEqual(first.id, second.id)
        self.assertEqual(first.title, "New title")
        self.assertEqual(second.additional_image_urls, ["https://test/two.png"])

    def test_image_composition_and_serialization_preserve_more_than_four_images(self):
        for count in (5, 9, 17):
            with self.subTest(count=count):
                toolbox = self.toolbox()
                urls = [f"https://test/image-{index}.png" for index in range(count)]
                material_ids = [f"material-{index}" for index in range(count)]
                toolbox.media = {
                    f"media:{index}": (url, material_ids[index])
                    for index, url in enumerate(urls)
                }
                result = toolbox.compose({
                    "title": "Many images", "publication_copy": "Copy",
                    "media_ids": list(toolbox.media),
                })
                self.assertEqual([result.image_url, *result.additional_image_urls], urls)
                self.assertEqual(
                    [result.image_material_id, *result.additional_image_material_ids], material_ids,
                )
                reloaded = CreativeDeliverable.model_validate_json(result.model_dump_json())
                self.assertEqual(reloaded, result)
                self.assertEqual(len(toolbox.describe()["media_handles"]), count)

    def test_late_image_reference_replaces_only_its_selected_slot(self):
        original = work().model_copy(update={
            "additional_image_urls": [f"https://test/image-{index}.png" for index in range(1, 9)],
        })
        selected = ImageReference(deliverable_id=original.id, index=8)
        toolbox = self.toolbox(current=original, selected=selected)
        handle = toolbox.add_generated_image("https://test/replacement.png")
        media_ids = [*toolbox.initial_media[:-1], handle]
        updated = toolbox.compose({
            "title": "Title", "publication_copy": "Copy", "media_ids": media_ids,
        })
        self.assertEqual(updated.image_url, original.image_url)
        self.assertEqual(updated.additional_image_urls[:-1], original.additional_image_urls[:-1])
        self.assertEqual(updated.additional_image_urls[-1], "https://test/replacement.png")
        other_handle = toolbox.add_generated_image("https://test/unrelated.png")
        with self.assertRaisesRegex(ValueError, "Only the referenced"):
            toolbox.compose({
                "title": "Title", "publication_copy": "Copy",
                "media_ids": [other_handle, *media_ids[1:]],
            })

    def test_image_count_schemas_do_not_expose_a_fixed_limit(self):
        self.assertNotIn("maxItems", ComposeWork.model_json_schema()["properties"]["media_ids"])
        for name in ("additional_image_urls", "additional_image_material_ids"):
            self.assertNotIn("maxItems", CreativeDeliverable.model_json_schema()["properties"][name])
        index = ImageReference.model_json_schema()["properties"]["index"]
        self.assertNotIn("maximum", index)
        self.assertEqual(index["minimum"], 0)

    def test_reference_replaces_only_selected_slot(self):
        toolbox = self.toolbox(current=work(), selected=ImageReference(deliverable_id="original", index=1))
        handle = toolbox.add_generated_image("https://test/new.png")
        changed = toolbox.compose({
            "title": "Title", "publication_copy": "Copy", "tags": ["tag"],
            "media_ids": ["current:0", handle],
        })
        self.assertEqual(changed.image_url, "https://test/one.png")
        self.assertEqual(changed.additional_image_urls, ["https://test/new.png"])
        with self.assertRaisesRegex(ValueError, "Only the referenced"):
            toolbox.compose({"title": "Title", "publication_copy": "Copy", "media_ids": [handle, "current:1"]})
        with self.assertRaisesRegex(ValueError, "Only the referenced"):
            toolbox.compose({"title": "Title", "publication_copy": "Copy", "media_ids": [handle]})

    def test_stale_or_invalid_reference_is_rejected(self):
        for ref in (ImageReference(deliverable_id="old", index=0), ImageReference(deliverable_id="original", index=3)):
            with self.assertRaisesRegex(ValueError, "no longer"):
                self.toolbox(current=work(), selected=ref)

    def test_unknown_media_and_arbitrary_urls_cannot_enter_canvas(self):
        toolbox = self.toolbox()
        with self.assertRaisesRegex(ValueError, "unknown media"):
            toolbox.compose({"title": "Title", "publication_copy": "Copy", "media_ids": ["https://malicious.example/img"]})
        with self.assertRaises(ValueError):
            toolbox.compose({"title": "Title", "publication_copy": "Copy", "image_url": "https://test"})

    def test_video_toolbox_rejects_images_and_multiple_videos(self):
        toolbox = self.toolbox("video")
        with self.assertRaisesRegex(ValueError, "unavailable"):
            toolbox.add_generated_image("https://test/image.png")
        toolbox.media = {"one": ("https://test/a.mp4", "a"), "two": ("https://test/b.mp4", "b")}
        with self.assertRaisesRegex(ValueError, "only one video"):
            toolbox.compose({"title": "Video", "publication_copy": "Copy", "media_ids": ["one", "two"]})
        result = toolbox.compose({"title": "Video", "publication_copy": "Copy", "media_ids": ["one"]})
        self.assertEqual(result.video_url, "https://test/a.mp4")
        self.assertEqual(result.image_url, "")

    def test_material_import_is_scoped_and_never_mutates_originals(self):
        toolbox = self.toolbox()
        image = SimpleNamespace(id="file", name="Photo", media_type="image", object_key="project/photo.png", mime_type="image/png")
        with (
            patch("app.engines.content_generator.work_tools.get_project_material", return_value=image) as get,
            patch("app.engines.content_generator.work_tools.ensure_material_content_available"),
            patch("app.engines.content_generator.work_tools.ensure_project_material_access", return_value="org"),
            patch("app.engines.content_generator.work_tools.read_media_bytes", return_value=b"image"),
            patch("app.engines.content_generator.work_tools.put_media_bytes") as put,
        ):
            imported = toolbox.import_material("file")
        get.assert_called_once_with("user", "project", "file")
        result = toolbox.compose({"title": "Imported", "publication_copy": "Copy", "media_ids": [imported["media_id"]]})
        self.assertEqual(result.image_material_id, "file")
        self.assertTrue(result.image_url.startswith("https://test/media/content-generator/org/project/"))
        self.assertEqual(put.call_args.args[1], b"image")
        self.assertEqual(image.object_key, "project/photo.png")

    def test_material_type_and_access_fail_closed(self):
        toolbox = self.toolbox("video")
        image = SimpleNamespace(id="file", name="Photo", media_type="image", object_key="project/photo.png")
        with patch("app.engines.content_generator.work_tools.get_project_material", return_value=image):
            with self.assertRaisesRegex(ValueError, "does not match"):
                toolbox.import_material("file")
        with patch("app.engines.content_generator.work_tools.get_project_material", side_effect=LookupError("Not authorized")):
            with self.assertRaises(LookupError):
                toolbox.import_material("private")

    def test_missing_material_file_is_not_written_to_canvas(self):
        toolbox = self.toolbox()
        image = SimpleNamespace(id="missing", name="Missing", media_type="image", object_key="")
        with patch("app.engines.content_generator.work_tools.get_project_material", return_value=image):
            with self.assertRaises(LookupError):
                toolbox.import_material("missing")
        self.assertEqual(toolbox.media, {})
        self.assertEqual(toolbox.revisions, [])

    def test_copy_material_returns_text_without_media(self):
        toolbox = self.toolbox()
        document = SimpleNamespace(
            id="copy", name="Copy", media_type="document",
            content_html="<p>Original copy</p>", object_key="", mime_type="text/html",
        )
        with patch("app.engines.content_generator.work_tools.get_project_material", return_value=document):
            imported = toolbox.import_material("copy")
        result = toolbox.compose({"title": "Copy", "publication_copy": imported["copy"]})
        self.assertIn("Original copy", result.publication_copy)
        self.assertEqual(result.image_url, "")

    def test_toolbox_has_explicit_canvas_capability(self):
        self.assertEqual(
            {tool["function"]["name"] for tool in work_tool_definitions()},
            {"list_materials", "import_material", "compose_work"},
        )

    def test_write_normalizes_tags_and_rejects_whitespace_only_text(self):
        toolbox = self.toolbox()
        result = toolbox.compose({"title": "Title", "publication_copy": "Copy", "tags": ["#team", "team", "##", " tools "]})
        self.assertEqual(result.tags, ["team", "tools"])
        partial = toolbox.compose({"title": " ", "publication_copy": "Copy"})
        self.assertEqual(partial.title, "")
        self.assertEqual(partial.publication_copy, "Copy")
        with self.assertRaises(ValueError):
            toolbox.compose({"title": " ", "publication_copy": " "})

    def test_only_unreferenced_new_files_are_cleaned_up(self):
        toolbox = self.toolbox()
        used = toolbox.add_generated_image("https://test/media/content-generator/org/project/used.png")
        toolbox.add_generated_image("https://test/media/content-generator/org/project/unused.png")
        toolbox.compose({"title": "Work", "publication_copy": "Copy", "media_ids": [used]})
        with patch("app.engines.content_generator.work_tools.delete_media") as delete:
            toolbox.discard_unused()
            delete.assert_called_once_with("content-generator/org/project/unused.png")
        self.assertEqual(toolbox.owned_keys, ["content-generator/org/project/used.png"])
        with patch("app.engines.content_generator.work_tools.delete_media") as delete:
            toolbox.discard()
            delete.assert_called_once_with("content-generator/org/project/used.png")
