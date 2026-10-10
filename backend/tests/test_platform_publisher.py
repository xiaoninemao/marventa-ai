import unittest
from dataclasses import replace
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import httpx
from cryptography.fernet import Fernet

from app.engines.publishing import channel_credentials, platform_publisher
from app.engines.publishing.platform_publisher import PlatformPublisher
from app.engines.publishing.publication_executor import (
    PublicationAsset,
    PublicationExecutionError,
    PublicationJob,
)


class PlatformPublisherTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.enterContext(patch.object(
            channel_credentials, "CHANNEL_CREDENTIAL_ENCRYPTION_KEY",
            Fernet.generate_key().decode("ascii"),
        ))
        self.job = PublicationJob(
            plan_id="plan", attempt_id="attempt", account_id="account",
            platform="douyin", platform_user_id="open-id",
            credential_blob=channel_credentials.encrypt_channel_credentials({"access_token": "test-token"}),
            authorization_status="active", token_expires_at="",
            scopes=("video.create.bind",), media_mode="video",
            title="Title", content="Body", tags=(),
            assets=(PublicationAsset("clip.mp4", "video", "video/mp4", "test/clip.mp4"),),
        )

    async def test_media_only_requests_omit_text_instead_of_sending_empty_or_generated_copy(self):
        import json

        for mode in ("video", "image_text"):
            bodies = []

            async def transport(request, recorded=bodies):
                if request.url.path.endswith("/upload_video/"):
                    return self.response({"video": {"video_id": "video-upload"}})
                if request.url.path.endswith("/upload_image/"):
                    return self.response({"image": {"image_id": "image-upload"}})
                recorded.append(json.loads(await request.aread()))
                return self.response({"item_id": "media-only-post"})

            asset = self.job.assets[0] if mode == "video" else PublicationAsset("image.png", "image", "image/png", "test/image.png")
            with patch.object(platform_publisher, "read_media_bytes", return_value=b"media"):
                async with httpx.AsyncClient(transport=httpx.MockTransport(transport)) as client:
                    await PlatformPublisher(client=client).publish(
                        replace(self.job, media_mode=mode, title="", content="", tags=(), assets=(asset,)), lambda: None,
                    )
            self.assertNotIn("text", bodies[0])
            self.assertIn("video_id" if mode == "video" else "image_list", bodies[0])

    async def test_virtual_expired_and_invalid_accounts_fail_before_any_http_request(self):
        requests = []

        async def transport(request):
            requests.append(request)
            raise AssertionError("Invalid accounts must never be sent to the platform")

        async with httpx.AsyncClient(transport=httpx.MockTransport(transport)) as client:
            publisher = PlatformPublisher(client=client)
            for job in (
                replace(self.job, credential_blob=""),
                replace(self.job, platform_user_id="local-test-project"),
                replace(self.job, authorization_status="expired"),
                replace(self.job, credential_blob="not-encrypted"),
                replace(self.job, platform_user_id=""),
                replace(self.job, token_expires_at=(datetime.now(timezone.utc) - timedelta(seconds=1)).isoformat()),
                replace(self.job, token_expires_at="bad-time"),
            ):
                with self.subTest(account=job.platform_user_id), self.assertRaises(PublicationExecutionError):
                    await publisher.publish(job, lambda: self.fail("Must not submit"))
        self.assertEqual(requests, [])

    async def test_incompatible_or_missing_media_are_rejected(self):
        publisher = PlatformPublisher()
        for job in (
            replace(self.job, assets=()),
            replace(self.job, assets=self.job.assets * 2),
            replace(self.job, media_mode="image_text"),
            replace(self.job, media_mode="image_text", assets=()),
        ):
            with self.subTest(mode=job.media_mode), self.assertRaises(PublicationExecutionError):
                publisher.credentials(job)

    async def test_credentials_do_not_appear_in_job_repr_or_validation_error(self):
        self.assertNotIn("test-token", repr(self.job))
        invalid = replace(self.job, credential_blob="secret-marker-not-encrypted")
        with self.assertRaises(PublicationExecutionError) as error:
            PlatformPublisher().credentials(invalid)
        self.assertNotIn("secret-marker", str(error.exception))

    @staticmethod
    def response(data, code=0):
        return httpx.Response(200, json={"data": {"error_code": code, **data}, "extra": {"error_code": code}})

    async def test_douyin_video_upload_then_create_uses_verified_official_contract(self):
        requests = []
        submissions = []

        async def transport(request):
            requests.append(request)
            self.assertEqual(request.headers["access-token"], "test-token")
            self.assertEqual(request.url.params["open_id"], "open-id")
            if request.url.path.endswith("/upload_video/"):
                self.assertIn(b'name="video"', await request.aread())
                self.assertEqual(submissions, [])
                return self.response({"video": {"video_id": "encrypted-upload-id"}})
            self.assertTrue(request.url.path.endswith("/create_video/"))
            self.assertEqual(submissions, ["submitting"])
            import json
            self.assertEqual(json.loads(await request.aread()), {
                "video_id": "encrypted-upload-id", "text": "Title\nBody\n#tag",
            })
            return self.response({"item_id": "post-id", "video_id": "created-video-id"})

        with patch.object(platform_publisher, "read_media_bytes", return_value=b"video"):
            async with httpx.AsyncClient(transport=httpx.MockTransport(transport)) as client:
                result = await PlatformPublisher(client=client).publish(
                    replace(self.job, tags=("tag",)), lambda: submissions.append("submitting"),
                )
        self.assertEqual(result.platform_post_id, "post-id")
        self.assertEqual(result.platform_video_id, "created-video-id")
        self.assertEqual(len(requests), 2)

    async def test_douyin_image_uploads_preserve_order_and_create_uses_image_ids(self):
        requests = []
        assets = tuple(PublicationAsset(f"{index}.png", "image", "image/png", f"test/{index}.png") for index in range(3))

        async def transport(request):
            requests.append(request)
            if request.url.path.endswith("/upload_image/"):
                self.assertIn(b'name="image"', await request.aread())
                return self.response({"image": {"image_id": f"image-{len(requests)}"}})
            self.assertTrue(request.url.path.endswith("/create_image_text/"))
            import json
            payload = json.loads(await request.aread())
            self.assertEqual(payload["image_list"], ["image-1", "image-2", "image-3"])
            return self.response({"item_id": "image-post-id", "video_id": "image-work-id"})

        with patch.object(platform_publisher, "read_media_bytes", return_value=b"image"):
            async with httpx.AsyncClient(transport=httpx.MockTransport(transport)) as client:
                result = await PlatformPublisher(client=client).publish(
                    replace(self.job, media_mode="image_text", assets=assets), lambda: None,
                )
        self.assertEqual(result.platform_post_id, "image-post-id")
        self.assertEqual(len(requests), 4)

    async def test_business_error_with_http_200_is_not_success_and_stops_upload_chain(self):
        requests = []

        async def transport(request):
            requests.append(request)
            return self.response({}, code=28001018)

        with patch.object(platform_publisher, "read_media_bytes", return_value=b"video"):
            async with httpx.AsyncClient(transport=httpx.MockTransport(transport)) as client:
                with self.assertRaises(PublicationExecutionError) as error:
                    await PlatformPublisher(client=client).publish(self.job, lambda: self.fail("Must not create"))
        self.assertIn("28001018", str(error.exception))
        self.assertFalse(error.exception.outcome_unknown)
        self.assertEqual(len(requests), 1)

    async def test_create_timeout_is_ambiguous_and_is_not_retried(self):
        requests = []

        async def transport(request):
            requests.append(request)
            if request.url.path.endswith("/upload_video/"):
                return self.response({"video": {"video_id": "uploaded"}})
            raise httpx.ReadTimeout("Token must not leak test-token", request=request)

        with patch.object(platform_publisher, "read_media_bytes", return_value=b"video"):
            async with httpx.AsyncClient(transport=httpx.MockTransport(transport)) as client:
                with self.assertRaises(PublicationExecutionError) as error:
                    await PlatformPublisher(client=client).publish(self.job, lambda: None)
        self.assertTrue(error.exception.outcome_unknown)
        self.assertNotIn("test-token", str(error.exception))
        self.assertEqual(len(requests), 2)

    async def test_missing_creation_post_id_is_an_uncertain_outcome(self):
        async def transport(request):
            return self.response({"video": {"video_id": "uploaded"}} if request.url.path.endswith("/upload_video/") else {})

        with patch.object(platform_publisher, "read_media_bytes", return_value=b"video"):
            async with httpx.AsyncClient(transport=httpx.MockTransport(transport)) as client:
                with self.assertRaises(PublicationExecutionError) as error:
                    await PlatformPublisher(client=client).publish(self.job, lambda: None)
        self.assertTrue(error.exception.outcome_unknown)

    async def test_unavailable_xiaohongshu_contract_and_platform_limits_fail_before_network(self):
        requests = []

        async def transport(request):
            requests.append(request)
            raise AssertionError("Preflight must stop unsupported requests")

        async with httpx.AsyncClient(transport=httpx.MockTransport(transport)) as client:
            publisher = PlatformPublisher(client=client)
            for job in (
                replace(self.job, platform="xiaohongshu", scopes=("write_notes",)),
                replace(self.job, scopes=()),
                replace(self.job, title="x" * 1001),
                replace(self.job, media_mode="image_text", assets=(
                    PublicationAsset("image.png", "image", "image/png", "test/image.png"),
                ) * 31),
            ):
                with self.assertRaises(PublicationExecutionError):
                    await publisher.publish(job, lambda: self.fail("Must not submit"))
        self.assertEqual(requests, [])

    async def test_invalid_success_envelope_is_not_treated_as_uploaded_media(self):
        async def transport(_request):
            return httpx.Response(200, json={"data": {"video": {"video_id": "uploaded"}}})

        with patch.object(platform_publisher, "read_media_bytes", return_value=b"video"):
            async with httpx.AsyncClient(transport=httpx.MockTransport(transport)) as client:
                with self.assertRaises(PublicationExecutionError):
                    await PlatformPublisher(client=client).publish(self.job, lambda: self.fail("Must not create"))


if __name__ == "__main__":
    unittest.main()
