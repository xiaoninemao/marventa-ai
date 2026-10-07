import assert from "node:assert/strict";
import test from "node:test";
import {
  groupPublicationPlansByDate,
} from "./DashboardPublishingCalendar.tsx";

test("dashboard calendar groups scheduled plans in local calendar dates", () => {
  const grouped = groupPublicationPlansByDate([
    {
      id: "scheduled",
      name: "Launch",
      scheduled_for: "2026-10-08T02:30:00Z",
      status: "scheduled",
    },
    {
      id: "published",
      name: "Published",
      scheduled_for: "2026-10-08T02:30:00Z",
      status: "published",
    },
    {
      id: "cancelled",
      name: "Cancelled",
      scheduled_for: "2026-10-08T08:00:00Z",
      status: "cancelled",
    },
    {
      id: "draft",
      name: "Not scheduled",
      scheduled_for: "",
      status: "draft",
    },
  ]);

  assert.deepEqual(
    [...grouped.values()].flat().map((plan) => plan.id),
    ["scheduled", "published"],
  );
  assert.equal([...grouped.keys()].length, 1);
});

test("dashboard calendar rejects malformed scheduled timestamps", () => {
  assert.throws(() => groupPublicationPlansByDate([{
    id: "invalid",
    name: "Invalid",
    scheduled_for: "not-a-date",
    status: "scheduled",
  }]), /Scheduled time is invalid/);
});
