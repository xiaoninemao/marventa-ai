"use client";

import { useLayoutEffect, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/contexts/i18n_context";
import { useDropdownMenu } from "@/hooks/use_dropdown_menu";
import InlineIcon from "@/components/redesign/InlineIcon";
import { publicationCalendarDays, publicationDateAfterToday, publicationDateKey } from "@/utils/publication_schedule";

export default function PublicationSchedulePicker({
  kind, value, disabled, onChange,
}: {
  kind: "date" | "time";
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const { t, locale } = useI18n();
  const [portalTarget, setPortalTarget] = useState<HTMLElement>();
  const [month, setMonth] = useState<Date | null>(null);
  const [focusedDate, setFocusedDate] = useState("");
  const [today, setToday] = useState("");
  const [earliestDate, setEarliestDate] = useState("");
  const [draftTime, setDraftTime] = useState("09:00");
  const {
    open, position, triggerRef, menuRef, menuId, toggleMenu, closeMenu, handleMenuKeyDown,
  } = useDropdownMenu(0, "start");
  const label = kind === "date" ? t("发布日期", "Publication date") : t("发布时刻", "Publication time");
  const days = month ? publicationCalendarDays(month) : [];
  const [hour, minute] = draftTime.split(":");

  const openPicker = () => {
    const now = new Date();
    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 12);
    const date = kind === "date" && publicationDateAfterToday(value, now)
      ? new Date(`${value}T12:00:00`) : tomorrow;
    setMonth(new Date(date.getFullYear(), date.getMonth(), 1, 12));
    setFocusedDate(publicationDateKey(date));
    setToday(publicationDateKey(now));
    setEarliestDate(publicationDateKey(tomorrow));
    setDraftTime(kind === "time" && value ? value : "09:00");
    setPortalTarget(triggerRef.current?.closest<HTMLDialogElement>("dialog[open]") ?? document.body);
    toggleMenu();
  };

  useLayoutEffect(() => {
    if (!open) return;
    if (kind === "date") {
      menuRef.current?.querySelector<HTMLButtonElement>(`[data-date="${focusedDate}"]`)?.focus();
    } else {
      const selected = menuRef.current?.querySelectorAll<HTMLButtonElement>('[aria-selected="true"]');
      selected?.forEach((option) => option.scrollIntoView({ block: "nearest" }));
      selected?.[0]?.focus();
    }
  }, [open, focusedDate, kind, menuRef]);

  const selectDate = (date: string) => {
    if (!publicationDateAfterToday(date)) return;
    onChange(date);
    closeMenu();
  };

  const changeMonth = (direction: -1 | 1) => {
    if (!month) return;
    const next = new Date(month.getFullYear(), month.getMonth() + direction, 1, 12);
    const end = new Date(next.getFullYear(), next.getMonth() + 1, 0, 12);
    if (publicationDateKey(end) < earliestDate) return;
    setMonth(next);
    setFocusedDate(publicationDateKey(next) < earliestDate ? earliestDate : publicationDateKey(next));
  };

  const handlePopoverKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") handleMenuKeyDown(event);
    else if (event.key === "Tab") {
      const controls = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>(
        'button:not(:disabled):not([tabindex="-1"])',
      ) ?? []);
      const edge = event.shiftKey ? controls[0] : controls[controls.length - 1];
      if (event.target === edge) handleMenuKeyDown(event);
    }
  };

  const handleCalendarKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement) || !target.dataset.date) {
      handlePopoverKey(event);
      return;
    }
    const date = new Date(`${target.dataset.date}T12:00:00`);
    const offsets: Partial<Record<string, number>> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    const offset = offsets[event.key];
    if (offset !== undefined || event.key === "Home" || event.key === "End") {
      event.preventDefault();
      const weekday = (date.getDay() + 6) % 7;
      date.setDate(date.getDate() + (offset ?? (event.key === "Home" ? -weekday : 6 - weekday)));
      if (publicationDateKey(date) < earliestDate) {
        date.setTime(new Date(`${earliestDate}T12:00:00`).getTime());
      }
      setFocusedDate(publicationDateKey(date));
      if (date.getMonth() !== month?.getMonth() || date.getFullYear() !== month?.getFullYear()) {
        setMonth(new Date(date.getFullYear(), date.getMonth(), 1, 12));
      }
    } else if (event.key === "PageUp" || event.key === "PageDown") {
      event.preventDefault();
      changeMonth(event.key === "PageUp" ? -1 : 1);
    } else {
      handlePopoverKey(event);
    }
  };

  const handleTimeKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const options = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="option"]'));
      const index = options.findIndex((option) => option === event.target);
      const next = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1
        : Math.max(0, Math.min(options.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)));
      options[next]?.focus();
      options[next]?.click();
      options[next]?.scrollIntoView({ block: "nearest" });
    }
  };

  return (
    <span className="amp-enterprise-select mt-2 w-full">
      <button ref={triggerRef} type="button" className="amp-enterprise-select-trigger amp-schedule-picker-trigger"
        disabled={disabled} aria-label={label} aria-haspopup="dialog" aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={openPicker}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            if (!open) openPicker();
          }
        }}>
        <InlineIcon name={kind === "date" ? "calendar" : "clock"} />
        <span className={value ? "" : "amp-enterprise-select-placeholder"}>
          {value || (kind === "date" ? t("选择日期", "Choose date") : t("选择时间", "Choose time"))}
        </span>
        <InlineIcon name="chevronRight" className="amp-enterprise-select-chevron" />
      </button>
      {open && portalTarget && createPortal(
        <div ref={menuRef} id={menuId} role="dialog" aria-label={label}
          className="amp-schedule-picker-popover" style={{ left: position.left, top: position.top }}
          onKeyDown={kind === "date" ? handleCalendarKey : handlePopoverKey}>
          {kind === "date" && month ? <>
            <div className="amp-schedule-calendar-heading">
              <button type="button" aria-label={t("上个月", "Previous month")}
                disabled={publicationDateKey(new Date(month.getFullYear(), month.getMonth(), 1, 12)).slice(0, 7) <= earliestDate.slice(0, 7)}
                onClick={() => changeMonth(-1)}>
                <InlineIcon name="arrowLeft" />
              </button>
              <strong aria-live="polite">{new Intl.DateTimeFormat(locale, { year: "numeric", month: "long" }).format(month)}</strong>
              <button type="button" aria-label={t("下个月", "Next month")} onClick={() => changeMonth(1)}>
                <InlineIcon name="chevronRight" />
              </button>
            </div>
            <div className="amp-schedule-calendar-weekdays" aria-hidden="true">
              {t("一,二,三,四,五,六,日", "Mo,Tu,We,Th,Fr,Sa,Su").split(",").map((day) => <span key={day}>{day}</span>)}
            </div>
            <div role="grid" aria-label={t("选择日期", "Choose date")} className="amp-schedule-calendar-grid">
              {Array.from({ length: 6 }, (_, row) => <div key={row} role="row">
                {days.slice(row * 7, row * 7 + 7).map((day) => {
                  const key = publicationDateKey(day);
                  return <button key={key} type="button" role="gridcell" data-date={key}
                    disabled={!publicationDateAfterToday(key)}
                    aria-label={key} aria-selected={value === key} aria-current={today === key ? "date" : undefined}
                    tabIndex={focusedDate === key ? 0 : -1}
                    className={day.getMonth() === month.getMonth() ? "" : "is-outside-month"}
                    onFocus={() => setFocusedDate(key)} onClick={() => selectDate(key)}>
                    {day.getDate()}
                  </button>;
                })}
              </div>)}
            </div>
            <div className="amp-schedule-picker-footer">
              <button type="button" onClick={() => selectDate(earliestDate)}>{t("明天", "Tomorrow")}</button>
            </div>
          </> : <>
            <div className="amp-schedule-time-columns">
              {[{ label: t("时", "Hour"), count: 24, value: hour }, { label: t("分", "Minute"), count: 60, value: minute }].map((column, index) => (
                <div key={index}>
                  <span>{column.label}</span>
                  <div role="listbox" aria-label={column.label} className="amp-schedule-time-list"
                    onKeyDown={(event) => {
                      if (["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) {
                        event.stopPropagation();
                        handleTimeKey(event);
                      }
                    }}>
                    {Array.from({ length: column.count }, (_, part) => {
                      const key = String(part).padStart(2, "0");
                      return <button key={key} type="button" role="option" aria-selected={column.value === key}
                        tabIndex={column.value === key ? 0 : -1}
                        onClick={() => setDraftTime(index === 0 ? `${key}:${minute}` : `${hour}:${key}`)}>
                        {key}
                      </button>;
                    })}
                  </div>
                </div>
              ))}
            </div>
            <div className="amp-schedule-picker-footer">
              <button type="button" className="amp-button amp-button-primary" onClick={() => {
                onChange(draftTime);
                closeMenu();
              }}>{t("确定", "Confirm")}</button>
            </div>
          </>}
        </div>,
        portalTarget,
      )}
    </span>
  );
}
