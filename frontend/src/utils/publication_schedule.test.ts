import assert from "node:assert/strict";
import test from "node:test";
import {
  publicationCalendarDays, publicationDateAfterToday, publicationDateKey, publicationLocalTime,
  publicationSchedule, publicationScheduleInput, publicationScheduleReady, validatePublicationScheduleSelection,
} from "./publication_schedule.ts";

test("empty schedules stay empty", () => {
  assert.equal(publicationLocalTime(""), "");
  assert.equal(publicationSchedule("", "2026-09-28T06:00:00Z"), "");
});

test("unchanged schedules preserve the original offset and seconds", () => {
  const original = "2026-09-28T14:23:45+08:00";
  assert.equal(publicationSchedule(publicationLocalTime(original), original), original);
});

test("new local times round-trip through UTC", () => {
  const local = "2026-09-29T16:30";
  const utc = publicationSchedule(local, "");
  assert.equal(publicationLocalTime(utc), local);
  assert.equal(new Date(utc).getTime(), new Date(local).getTime());
});

test("malformed and normalized impossible dates are rejected", () => {
  assert.throws(() => publicationLocalTime("bad date"), /Scheduled time is invalid/);
  for (const value of ["bad date", "2026-02-30T12:00", "2026-09-29T25:00"]) {
    assert.throws(() => publicationSchedule(value, ""), /Scheduled time is invalid/);
  }
});

test("separate date and time inputs preserve either selection until both are filled", () => {
  assert.equal(publicationScheduleInput("", ""), "");
  assert.equal(publicationScheduleInput("2026-10-01", ""), "2026-10-01T");
  assert.equal(publicationScheduleInput("", "16:30"), "T16:30");
  const value = publicationScheduleInput("2026-10-01", "16:30");
  assert.equal(publicationLocalTime(publicationSchedule(value, "")), value);
  assert.throws(() => publicationSchedule(publicationScheduleInput("2026-10-01", ""), ""), /Scheduled time is invalid/);
  assert.throws(() => publicationSchedule(publicationScheduleInput("", "16:30"), ""), /Scheduled time is invalid/);
});

test("clearing both date and time removes a saved schedule", () => {
  assert.equal(publicationSchedule(publicationScheduleInput("", ""), "2026-10-01T08:30:00Z"), "");
});

test("calendar includes six Monday-first weeks, leap days, and adjacent month dates", () => {
  const days = publicationCalendarDays(new Date(2028, 1, 1, 12));
  assert.equal(days.length, 42);
  assert.equal(days[0].getDay(), 1);
  assert.equal(days[41].getDay(), 0);
  assert.equal(publicationDateKey(days[0]), "2028-01-31");
  assert.equal(publicationDateKey(days[41]), "2028-03-12");
  assert.ok(days.some((day) => publicationDateKey(day) === "2028-02-29"));
  for (let index = 1; index < days.length; index++) {
    const expected = new Date(days[index - 1]);
    expected.setDate(expected.getDate() + 1);
    assert.equal(publicationDateKey(days[index]), publicationDateKey(expected));
  }
});

test("calendar date keys stay local across year and daylight-saving boundaries", () => {
  assert.equal(publicationDateKey(new Date(2026, 0, 1, 0, 1)), "2026-01-01");
  for (const month of [2, 10, 11]) {
    const days = publicationCalendarDays(new Date(2026, month, 1, 12));
    assert.equal(new Set(days.map(publicationDateKey)).size, 42);
    assert.equal(days[0].getDay(), 1);
  }
});

test("publication settings require both date and time and never accept today or earlier", () => {
  const now = new Date(2026, 8, 30, 23, 59);
  for (const value of ["", "2026-10-01T", "T09:00"]) {
    assert.equal(publicationScheduleReady(value, now), false);
    assert.throws(() => validatePublicationScheduleSelection(value, now), /Choose publication date and time/);
  }
  for (const value of ["2026-09-29T10:00", "2026-09-30T23:59"]) {
    assert.equal(publicationScheduleReady(value, now), false);
    assert.throws(() => validatePublicationScheduleSelection(value, now), /Publication date must be after today/);
  }
  assert.equal(publicationScheduleReady("2026-10-01T00:00", now), true);
  assert.doesNotThrow(() => validatePublicationScheduleSelection("2026-10-01T00:00", now));
  assert.equal(publicationDateAfterToday("2026-09-30", now), false);
  assert.equal(publicationDateAfterToday("2026-10-01", now), true);
});

test("date and time validation rejects malformed selections and follows local day boundaries", () => {
  const now = new Date(2026, 8, 30, 23, 59);
  for (const value of ["2026-02-30T10:00", "2026-10-01T25:00", "2026-10-01T12:60"]) {
    assert.equal(publicationScheduleReady(value, now), false);
    assert.throws(() => validatePublicationScheduleSelection(value, now), /Scheduled time is invalid/);
  }
  for (const value of ["bad", "2026-13-01", "2026-10-32"]) {
    assert.equal(publicationDateAfterToday(value, now), false);
  }
  assert.equal(publicationScheduleReady("2026-10-01T12:00", new Date(2026, 9, 1, 0, 0)), false);
  assert.equal(publicationDateAfterToday("2027-01-01", new Date(2026, 11, 31, 23, 59)), true);
});
