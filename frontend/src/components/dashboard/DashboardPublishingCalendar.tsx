"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useI18n } from "@/contexts/i18n_context";
import InlineIcon from "@/components/redesign/InlineIcon";
import type { PublicationPlan } from "@/types/publishing";
import {
  publicationCalendarDays,
  publicationDateKey,
  publicationLocalTime,
} from "@/utils/publication_schedule";

type CalendarPlan = Pick<PublicationPlan, "id" | "name" | "scheduled_for" | "status">;

export function groupPublicationPlansByDate(plans: CalendarPlan[]) {
  const grouped = new Map<string, CalendarPlan[]>();
  for (const plan of plans) {
    if (!plan.scheduled_for || plan.status === "cancelled") continue;
    const date = publicationLocalTime(plan.scheduled_for).slice(0, 10);
    grouped.set(date, [...(grouped.get(date) || []), plan]);
  }
  return grouped;
}

export default function DashboardPublishingCalendar({ plans }: { plans: CalendarPlan[] }) {
  const { t, locale } = useI18n();
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1, 12);
  });
  const days = useMemo(() => publicationCalendarDays(month), [month]);
  const plansByDate = useMemo(() => groupPublicationPlansByDate(plans), [plans]);
  const today = publicationDateKey(new Date());
  const monthLabel = new Intl.DateTimeFormat(locale === "en" ? "en-US" : "zh-CN", {
    month: "long",
    year: "numeric",
  }).format(month);
  const weekdays = locale === "en"
    ? ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
    : ["一", "二", "三", "四", "五", "六", "日"];

  const shiftMonth = (offset: number) => {
    setMonth((current) => new Date(
      current.getFullYear(),
      current.getMonth() + offset,
      1,
      12,
    ));
  };

  return (
    <div className="amp-dashboard-calendar">
      <header className="amp-dashboard-calendar-header">
        <div>
          <span>{t("发布日历", "Publishing calendar")}</span>
          <strong>{monthLabel}</strong>
        </div>
        <nav aria-label={t("切换日历月份", "Change calendar month")}>
          <button type="button" onClick={() => shiftMonth(-1)}
            aria-label={t("上个月", "Previous month")}>
            <InlineIcon name="chevronRight" />
          </button>
          <button type="button" onClick={() => shiftMonth(1)}
            aria-label={t("下个月", "Next month")}>
            <InlineIcon name="chevronRight" />
          </button>
        </nav>
      </header>
      <div className="amp-dashboard-calendar-weekdays" aria-hidden="true">
        {weekdays.map((weekday) => <span key={weekday}>{weekday}</span>)}
      </div>
      <div className="amp-dashboard-calendar-grid">
        {days.map((day) => {
          const dateKey = publicationDateKey(day);
          const dayPlans = plansByDate.get(dateKey) || [];
          const outsideMonth = day.getMonth() !== month.getMonth();
          const className = [
            outsideMonth ? "is-outside" : "",
            dateKey === today ? "is-today" : "",
            dayPlans.length > 0 ? "has-plans" : "",
          ].filter(Boolean).join(" ");
          const content = (
            <>
              <span>{day.getDate()}</span>
              {dayPlans.length > 0 && (
                <small>{dayPlans.length > 9 ? "9+" : dayPlans.length}</small>
              )}
            </>
          );
          return dayPlans.length > 0 ? (
            <Link key={dateKey} href="/publishing" className={className}
              aria-label={t(
                "{date} 有 {count} 个发布计划",
                "{count} publication plans on {date}",
                { date: dateKey, count: dayPlans.length },
              )}>
              {content}
            </Link>
          ) : (
            <span key={dateKey} className={className} aria-label={dateKey}>
              {content}
            </span>
          );
        })}
      </div>
    </div>
  );
}
