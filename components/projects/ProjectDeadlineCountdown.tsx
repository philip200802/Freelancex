"use client";

import { useEffect, useState } from "react";
import { getProjectDeadlineCountdownParts } from "@/lib/project-deadline";

type Props = {
    projectId: string;
    deadlineAt?: Date | string | null;
    projectStatus: string;
    compact?: boolean;
};

function localDeadline(deadline: string | Date) {
    const date = new Date(deadline);
    if (!Number.isFinite(date.getTime())) return "Deadline unavailable";
    return new Intl.DateTimeFormat(undefined, {
        day: "numeric",
        month: "long",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
    }).format(date);
}

export default function ProjectDeadlineCountdown({ projectId, deadlineAt, projectStatus, compact = false }: Props) {
    const [deadline, setDeadline] = useState<Date | string | null>(deadlineAt || null);
    const [status, setStatus] = useState(projectStatus);
    const [now, setNow] = useState<number | null>(null);

    useEffect(() => {
        let requestPending = false;
        const refreshProject = async () => {
            if (requestPending) return;
            requestPending = true;
            try {
                const response = await fetch(`/api/tasks/${projectId}`, { cache: "no-store" });
                if (!response.ok) return;
                const result = await response.json() as { task?: { deadlineAt?: string | null; status?: string } };
                if (result.task) {
                    setDeadline(result.task.deadlineAt || null);
                    if (result.task.status) setStatus(result.task.status);
                }
            } catch (error) {
                console.error("Project deadline refresh failed.", {
                    projectId,
                    errorName: error instanceof Error ? error.name : "UnknownError",
                });
            } finally {
                requestPending = false;
            }
        };
        const updateClock = () => setNow(Date.now());
        updateClock();
        const clockTimer = window.setInterval(updateClock, 1000);
        const refreshTimer = window.setInterval(() => void refreshProject(), 60_000);
        return () => {
            window.clearInterval(clockTimer);
            window.clearInterval(refreshTimer);
        };
    }, [projectId]);

    const parts = deadline && now !== null ? getProjectDeadlineCountdownParts(deadline, now) : null;
    const submitted = status === "submitted";
    const stopped = status === "cancelled";
    const paused = status === "disputed";
    const completed = status === "completed";
    const countdownActive = !submitted && !stopped && !paused && !completed;
    const content = !deadline
        ? "Deadline not set yet."
        : submitted
            ? "Work submitted — awaiting client review."
            : stopped
                ? "Countdown stopped — project cancelled."
                : paused
                    ? "Countdown paused — dispute active."
                    : completed
                        ? "Project completed."
                        : parts?.isOverdue
                            ? "Overdue"
                            : parts
                                ? `${parts.days} day${parts.days === 1 ? "" : "s"} ${String(parts.hours).padStart(2, "0")} hours ${String(parts.minutes).padStart(2, "0")} minutes ${String(parts.seconds).padStart(2, "0")} seconds remaining`
                                : "Calculating remaining time...";
    const className = [
        "project-deadline-countdown",
        compact ? "project-deadline-countdown-compact" : "",
        parts?.isUrgent && countdownActive ? "project-deadline-countdown-urgent" : "",
        parts?.isOverdue && countdownActive ? "project-deadline-countdown-overdue" : "",
    ].filter(Boolean).join(" ");

    return <div aria-live="polite" className={className}>
        {!compact && <strong>Project deadline</strong>}
        <span>{content}</span>
        {deadline && <small>Deadline: {localDeadline(deadline)}</small>}
    </div>;
}
