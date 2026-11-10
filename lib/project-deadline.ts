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
