import asyncio
import unittest
from unittest.mock import patch

from app import main


class PublicationSchedulerLifespanTests(unittest.IsolatedAsyncioTestCase):
    async def test_disabled_scheduler_does_not_construct_executor(self):
        with patch.object(main, "PUBLISHING_SCHEDULER_ENABLED", False), patch.object(main, "PublicationExecutor") as factory:
            async with main.lifespan(main.app):
                await asyncio.sleep(0)
            factory.assert_not_called()

    async def test_enabled_scheduler_starts_and_stops_with_backend_lifespan(self):
        started = asyncio.Event()
        stopped = asyncio.Event()
        intervals = []

        class Executor:
            def __init__(self, _publisher):
                pass

            async def serve(self, stop, *, interval):
                intervals.append(interval)
                started.set()
                await stop.wait()
                stopped.set()

        with patch.object(main, "PUBLISHING_SCHEDULER_ENABLED", True), patch.object(main, "PublicationExecutor", Executor):
            async with main.lifespan(main.app):
                await asyncio.wait_for(started.wait(), timeout=1)
            self.assertTrue(stopped.is_set())
            self.assertEqual(intervals, [main.PUBLISHING_POLL_SECONDS])

    async def test_lead_tracking_scheduler_has_independent_lifecycle(self):
        started = asyncio.Event()
        stopped = asyncio.Event()

        class Scheduler:
            async def serve(self, stop):
                started.set()
                await stop.wait()
                stopped.set()

        with (
            patch.object(main, "PUBLISHING_SCHEDULER_ENABLED", False),
            patch.object(main, "LEAD_TRACKING_SYNC_ENABLED", True),
            patch.object(main, "LeadTrackingCommentScheduler", Scheduler),
        ):
            async with main.lifespan(main.app):
                await asyncio.wait_for(started.wait(), timeout=1)
                self.assertTrue(
                    main.app.state.lead_tracking_scheduler_task
                    and not main.app.state.lead_tracking_scheduler_task.done(),
                )
            self.assertTrue(stopped.is_set())


if __name__ == "__main__":
    unittest.main()
