export type ProjectDurationUnit = "days" | "weeks";

export type ProjectDeadlineFields = {
    projectStartedAt: Date;
    deadlineAt: Date;
};

type AcceptedProject = {
    status: string;
    duration: number;
    durationUnit: ProjectDurationUnit;
    projectStartedAt?: Date | null;
    deadlineAt?: Date | null;
};

const millisecondsPerDay = 24 * 60 * 60 * 1000;
const maximumProjectDurationDays = 3650;

export type ProjectDeadlineCountdownParts = {
    days: number;
    hours: number;
    minutes: number;
    seconds: number;
    isUrgent: boolean;
    isOverdue: boolean;
};

export function getProjectDeadlineCountdownParts(
    deadline: Date | string,
    now = Date.now(),
): ProjectDeadlineCountdownParts | null {
    const deadlineTime = new Date(deadline).getTime();
    if (!Number.isFinite(deadlineTime)) return null;

    const difference = deadlineTime - now;
    const totalSeconds = Math.max(0, Math.floor(difference / 1000));
    return {
        days: Math.floor(totalSeconds / 86_400),
        hours: Math.floor((totalSeconds % 86_400) / 3_600),
        minutes: Math.floor((totalSeconds % 3_600) / 60),
        seconds: totalSeconds % 60,
        isUrgent: difference > 0 && difference < millisecondsPerDay,
        isOverdue: difference <= 0,
    };
}

export function formatProjectDeadlineDateTime(deadline: Date | string): string {
    const date = new Date(deadline);
    if (!Number.isFinite(date.getTime())) return "Deadline unavailable";
    return `${date.toLocaleString("en-GB", {
        timeZone: "UTC",
        dateStyle: "long",
        timeStyle: "short",
    })} UTC`;
}

export function createAcceptedProjectDeadline(
    task: AcceptedProject,
    acceptedAt: Date,
): ProjectDeadlineFields | null {
    if (!["open", "pending_approval"].includes(task.status) || task.projectStartedAt || task.deadlineAt) {
        return null;
    }
    if (!Number.isSafeInteger(task.duration) || task.duration <= 0 || !["days", "weeks"].includes(task.durationUnit)) {
        throw new Error("The project duration is invalid.");
    }

    const durationDays = task.duration * (task.durationUnit === "weeks" ? 7 : 1);
    if (durationDays > maximumProjectDurationDays || !Number.isFinite(acceptedAt.getTime())) {
        throw new Error("The project duration or acceptance date is invalid.");
    }

    const projectStartedAt = new Date(acceptedAt.getTime());
    return {
        projectStartedAt,
        deadlineAt: new Date(projectStartedAt.getTime() + durationDays * millisecondsPerDay),
    };
}

export function formatProjectDuration(duration: number, unit: ProjectDurationUnit): string {
    return `${duration} ${unit === "weeks" ? "week" : "day"}${duration === 1 ? "" : "s"}`;
}

export function getProjectDeadlineCountdown(deadline: Date | string, now = new Date()): string {
    const deadlineTime = new Date(deadline).getTime();
    if (!Number.isFinite(deadlineTime)) return "Deadline unavailable";

    const difference = deadlineTime - now.getTime();
    if (difference < 0) {
        const overdueDays = Math.ceil(Math.abs(difference) / millisecondsPerDay);
        return `Overdue by ${overdueDays} day${overdueDays === 1 ? "" : "s"}`;
    }

    if (difference < millisecondsPerDay) return "Due today";

    const remainingDays = Math.ceil(difference / millisecondsPerDay);
    return `${remainingDays} day${remainingDays === 1 ? "" : "s"} remaining`;
}

export function getProjectDeadlineStatus(deadline: Date | string, status: string, now = new Date()): string {
    if (status === "completed") return "Completed";
    if (status === "cancelled") return "Stopped — project cancelled";
    if (status === "disputed") return "Paused — dispute active";
    return getProjectDeadlineCountdown(deadline, now);
}

export function calculateExtendedDeadline(
    currentDeadline: Date,
    duration: number,
    unit: ProjectDurationUnit,
): Date {
    if (!Number.isFinite(currentDeadline.getTime()) || !Number.isSafeInteger(duration) || duration <= 0 || !["days", "weeks"].includes(unit)) {
        throw new Error("The requested deadline extension is invalid.");
    }
    const durationDays = duration * (unit === "weeks" ? 7 : 1);
    if (durationDays > maximumProjectDurationDays) throw new Error("The requested deadline extension is too long.");
    return new Date(currentDeadline.getTime() + durationDays * millisecondsPerDay);
}
