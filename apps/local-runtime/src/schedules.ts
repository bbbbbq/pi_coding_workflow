import {
  DAYS_OF_WEEK,
  MONTHS,
  type CalendarSpec,
  type ScheduleSpec,
} from "@temporalio/client";
import type { WorkflowSchedule } from "@pi-workflow/contracts";

export function temporalScheduleId(schedule: Pick<WorkflowSchedule, "id" | "temporalScheduleId">): string {
  return schedule.temporalScheduleId ?? `pi-${schedule.id}`;
}

export function buildScheduleSpec(schedule: WorkflowSchedule): ScheduleSpec {
  const scheduledAt = new Date(schedule.scheduledAt);
  if (Number.isNaN(scheduledAt.getTime())) {
    throw new Error(`Invalid schedule time: ${schedule.scheduledAt}`);
  }

  const local = datePartsInTimeZone(scheduledAt, schedule.timeZone);
  const clock: CalendarSpec = {
    second: local.second,
    minute: local.minute,
    hour: local.hour,
  };

  if (schedule.frequency === "daily") {
    return { calendars: [clock], timezone: schedule.timeZone, startAt: scheduledAt };
  }

  if (schedule.frequency === "weekly") {
    return {
      calendars: [{ ...clock, dayOfWeek: DAYS_OF_WEEK[local.dayOfWeek] }],
      timezone: schedule.timeZone,
      startAt: scheduledAt,
    };
  }

  return {
    calendars: [{
      ...clock,
      dayOfMonth: local.day,
      month: MONTHS[local.month - 1],
      year: local.year,
    }],
    timezone: schedule.timeZone,
    startAt: scheduledAt,
    endAt: new Date(scheduledAt.getTime() + 1_000),
  };
}

interface LocalDateParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  dayOfWeek: number;
}

function datePartsInTimeZone(date: Date, timeZone: string): LocalDateParts {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    weekday: "long",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(date).map((part) => [part.type, part.value]),
  );
  const dayOfWeek = DAYS_OF_WEEK.findIndex((day) => day === parts.weekday?.toUpperCase());
  if (dayOfWeek < 0) throw new Error(`Could not resolve weekday in ${timeZone}`);

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
    dayOfWeek,
  };
}
