export function publicationLocalTime(value: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("Scheduled time is invalid");
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function publicationSchedule(value: string, original: string): string {
  if (!value) return "";
  if (original && value === publicationLocalTime(original)) return original;
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || publicationLocalTime(date.toISOString()) !== value) {
    throw new Error("Scheduled time is invalid");
  }
  return date.toISOString();
}

export function publicationScheduleInput(date: string, time: string): string {
  return date || time ? `${date}T${time}` : "";
}

export function publicationDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function publicationDateAfterToday(value: string, now = new Date()): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00`);
  return !Number.isNaN(date.getTime()) && publicationDateKey(date) === value
    && value > publicationDateKey(now);
}

export function publicationScheduleReady(value: string, now = new Date()): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && publicationLocalTime(date.toISOString()) === value
    && publicationDateAfterToday(value.slice(0, 10), now);
}

export function validatePublicationScheduleSelection(value: string, now = new Date()): void {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) {
    throw new Error("Choose publication date and time");
  }
  publicationSchedule(value, "");
  if (!publicationDateAfterToday(value.slice(0, 10), now)) {
    throw new Error("Publication date must be after today");
  }
}

export function publicationCalendarDays(month: Date): Date[] {
  const start = new Date(month.getFullYear(), month.getMonth(), 1, 12);
  start.setDate(start.getDate() - (start.getDay() + 6) % 7);
  return Array.from({ length: 42 }, (_, index) => {
    const day = new Date(start);
    day.setDate(start.getDate() + index);
    return day;
  });
}
