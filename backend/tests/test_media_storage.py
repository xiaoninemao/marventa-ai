import io
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.testclient import TestClient

from app import media_storage


class _FakePaginator:
    def paginate(self, **kwargs):
        prefix = kwargs["Prefix"]
        return [{
            "Contents": [
                {"Key": key}
                for key in _FakeS3Client.objects
                if key.startswith(prefix)
            ],
        }]


class _FakeS3Client:
    objects: dict[str, bytes] = {}

    def put_object(self, *, Bucket, Key, Body, ContentType):
        del Bucket, ContentType
        self.objects[Key] = Body

    def get_object(self, *, Bucket, Key):
        del Bucket
        return {"Body": io.BytesIO(self.objects[Key])}

    def head_object(self, *, Bucket, Key):
        del Bucket
        if Key not in self.objects:
            from botocore.exceptions import ClientError
            raise ClientError(
                {"Error": {"Code": "404", "Message": "Not found"}},
                "HeadObject",
            )
        return {}

    def delete_object(self, *, Bucket, Key):
        del Bucket
        self.objects.pop(Key, None)

    def get_paginator(self, name):
        assert name == "list_objects_v2"
        return _FakePaginator()

    def delete_objects(self, *, Bucket, Delete):
        del Bucket
        for item in Delete["Objects"]:
            self.objects.pop(item["Key"], None)

    def generate_presigned_url(self, operation, *, Params, ExpiresIn):
        assert operation == "get_object"
        return (
            f"https://objects.example/{Params['Key']}"
            f"?expires={ExpiresIn}"
        )


class MediaStorageTests(unittest.TestCase):
    def test_agent_work_media_urls_are_loadable_by_the_browser(self):
        app = FastAPI()

        @app.get("/media/{key:path}")
        def serve_media(key: str):
            return media_storage.media_response(key, public=True)

        with (
            tempfile.TemporaryDirectory() as directory,
            patch.object(media_storage, "MEDIA_ROOT", directory),
            patch.object(media_storage, "MEDIA_STORAGE_BACKEND", "local"),
            TestClient(app) as client,
        ):
            for filename, content_type, data in (
                ("imported.png", "image/png", b"\x89PNG\r\n\x1a\nimage"),
                ("generated.webp", "image/webp", b"RIFFimageWEBP"),
                ("imported.mp4", "video/mp4", b"video"),
            ):
                with self.subTest(filename=filename):
                    key = f"content-generator/org/project/{filename}"
                    media_storage.put_media_bytes(key, data, content_type=content_type)
                    response = client.get(media_storage.media_url(key, "http://testserver"))
                    self.assertEqual(response.status_code, 200)
                    self.assertEqual(response.content, data)
                    self.assertEqual(response.headers["content-type"], content_type)
            self.assertEqual(client.get("/media/content-generator/org/project/missing.png").status_code, 404)

    def test_s3_agent_work_media_returns_a_presigned_response(self):
        fake = _FakeS3Client()
        fake.objects = {}
        with (
            patch.object(media_storage, "MEDIA_STORAGE_BACKEND", "s3"),
            patch.object(media_storage, "MEDIA_S3_BUCKET", "media-bucket"),
            patch.object(media_storage, "MEDIA_S3_PREFIX", "marventa"),
            patch.object(media_storage, "MEDIA_S3_PUBLIC_BASE_URL", ""),
            patch.object(media_storage, "_s3_client", return_value=fake),
        ):
            key = "content-generator/org/project/imported.png"
            media_storage.put_media_bytes(key, b"image", content_type="image/png")
            response = media_storage.media_response(key, public=True)
            self.assertEqual(response.status_code, 307)
            self.assertIn(f"/marventa/{key}?expires=", response.headers["location"])

    def test_s3_publication_media_redirect_keeps_historical_files_private(self):
        fake = _FakeS3Client()
        fake.objects = {}
        with (
            patch.object(media_storage, "MEDIA_STORAGE_BACKEND", "s3"),
            patch.object(media_storage, "MEDIA_S3_BUCKET", "media-bucket"),
            patch.object(media_storage, "MEDIA_S3_PREFIX", "marventa"),
            patch.object(media_storage, "MEDIA_S3_PUBLIC_BASE_URL", ""),
            patch.object(media_storage, "_s3_client", return_value=fake),
        ):
            for filename in ("image.gif", "video.mp4"):
                key = f"publishing/org/project/publications/plan/{filename}"
                media_storage.put_media_bytes(key, b"media")
                response = media_storage.media_response(key, public=True)
                self.assertEqual(response.status_code, 307)
                self.assertIn(f"/marventa/{key}?expires=", response.headers["location"])
            historical = "publishing/org/project/tasks/task/image.gif"
            media_storage.put_media_bytes(historical, b"private")
            with self.assertRaises(HTTPException) as raised:
                media_storage.media_response(historical, public=True)
            self.assertEqual(raised.exception.status_code, 404)

    def test_local_round_trip_and_public_media_response(self):
        with (
            tempfile.TemporaryDirectory() as directory,
            patch.object(media_storage, "MEDIA_ROOT", directory),
            patch.object(media_storage, "MEDIA_STORAGE_BACKEND", "local"),
        ):
            key = media_storage.put_media_bytes(
                "users/user-1/images/example.png",
                b"\x89PNG\r\n\x1a\nexample",
                content_type="image/png",
            )
            self.assertEqual(
                Path(directory, key).read_bytes(),
                b"\x89PNG\r\n\x1a\nexample",
            )
            self.assertEqual(
                media_storage.read_media_bytes(key),
                b"\x89PNG\r\n\x1a\nexample",
            )
            self.assertTrue(media_storage.media_exists(key))
            response = media_storage.media_response(key, public=True)
            self.assertIsInstance(response, FileResponse)
            media_storage.delete_media_prefix("users/user-1")
            self.assertFalse(media_storage.media_exists(key))

    def test_private_and_invalid_media_keys_are_not_public(self):
        with (
            tempfile.TemporaryDirectory() as directory,
            patch.object(media_storage, "MEDIA_ROOT", directory),
            patch.object(media_storage, "MEDIA_STORAGE_BACKEND", "local"),
        ):
            media_storage.put_media_bytes(
                "market_insight_sources/record/source.pdf",
                b"%PDF",
            )
            with self.assertRaises(HTTPException):
                media_storage.media_response(
                    "market_insight_sources/record/source.pdf",
                    public=True,
                )
            with self.assertRaises(ValueError):
                media_storage.put_media_bytes("../secret", b"secret")

    def test_s3_round_trip_prefix_deletion_and_presigned_response(self):
        fake = _FakeS3Client()
        fake.objects = {}
        _FakeS3Client.objects = fake.objects
        with (
            patch.object(media_storage, "MEDIA_STORAGE_BACKEND", "s3"),
            patch.object(media_storage, "MEDIA_S3_BUCKET", "media-bucket"),
            patch.object(media_storage, "MEDIA_S3_PREFIX", "marventa"),
            patch.object(media_storage, "MEDIA_S3_PUBLIC_BASE_URL", ""),
            patch.object(media_storage, "_s3_client", return_value=fake),
        ):
            first = media_storage.put_media_bytes(
                "users/user-1/images/first.jpg",
                b"first",
                content_type="image/jpeg",
            )
            second = media_storage.put_media_bytes(
                "users/user-1/images/second.jpg",
                b"second",
                content_type="image/jpeg",
            )
            self.assertEqual(media_storage.read_media_bytes(first), b"first")
            self.assertIn(
                "marventa/users/user-1/images/first.jpg",
                fake.objects,
            )
            self.assertEqual(
                sorted(media_storage.list_media_keys("users/user-1")),
                sorted([first, second]),
            )
            response = media_storage.media_response(first, public=True)
            self.assertIsInstance(response, RedirectResponse)
            self.assertIn(
                "https://objects.example/marventa/users/user-1/images/first.jpg",
                response.headers["location"],
            )
            media_storage.delete_media_prefix("users/user-1")
            self.assertEqual(fake.objects, {})
