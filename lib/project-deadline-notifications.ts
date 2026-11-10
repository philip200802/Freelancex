import mongoose from "mongoose";
import { queueWorkflowEmail } from "@/lib/workflow-email";
import CancellationRequest from "@/models/CancellationRequest";
import DeadlineExtensionRequest from "@/models/DeadlineExtensionRequest";
import Notification from "@/models/Notification";
import ProjectSubmission from "@/models/ProjectSubmission";
import Task from "@/models/Task";
import User from "@/models/User";
import UserPreference from "@/models/UserPreference";
import { formatProjectDeadlineDateTime } from "@/lib/project-deadline";

async function createParticipantNotifications({
    taskId,
    employerId,
    freelancerId,
    eventKey,
    type,
    title,
    body,
}: {
    taskId: string;
    employerId: string;
    freelancerId: string;
    eventKey: string;
    type: "revision_overdue" | "deadline_approaching" | "project_overdue";
    title: string;
    body: string;
}) {
    const participants = [
        { id: employerId, role: "employer" as const, href: `/client/dashboard/projects/${taskId}` },
        { id: freelancerId, role: "freelancer" as const, href: `/freelancer/dashboard/projects/${taskId}` },
    ];
    const preferences = await UserPreference.find({ user: { $in: participants.map(({ id }) => id) } })
        .select("user inAppNotifications")
        .lean();
    const disabled = new Set(preferences.filter((preference) => preference.inAppNotifications === false).map((preference) => preference.user.toString()));
    let created = 0;
    for (const participant of participants) {
        if (disabled.has(participant.id)) continue;
        const result = await Notification.updateOne(
            { recipient: participant.id, eventKey: `${eventKey}:${participant.role}` },
            { $setOnInsert: {
                recipient: participant.id,
                recipientRole: participant.role,
                type,
                title,
                body,
                relatedTask: taskId,
                eventKey: `${eventKey}:${participant.role}`,
                href: participant.href,
            } },
            { upsert: true },
        );
        created += result.upsertedCount;
    }
    return created;
}

export async function notifyOverdueProjectRevisions(limit = 100) {
    const now = new Date();
    const submissions = await ProjectSubmission.find({
        status: "revision_requested",
        revisionDeadline: { $lte: now },
    })
        .select("_id task employer freelancer revisionDeadline")
        .sort({ revisionDeadline: 1 })
        .limit(limit)
        .lean();
    if (!submissions.length) return 0;

    const tasks = await Task.find({
        _id: { $in: submissions.map((submission) => submission.task) },
        status: "revision_requested",
    }).select("_id title employer freelancer").lean();
    const taskById = new Map(tasks.map((task) => [task._id.toString(), task]));
    let created = 0;
    for (const submission of submissions) {
        const task = taskById.get(submission.task.toString());
        if (!task?.employer || !task.freelancer) continue;
        created += await createParticipantNotifications({
            taskId: task._id.toString(),
            employerId: task.employer.toString(),
            freelancerId: task.freelancer.toString(),
            eventKey: `revision:${submission._id}:overdue`,
            type: "revision_overdue",
            title: "Revision deadline passed",
            body: `The revision deadline for "${task.title}" has passed.`,
        });
    }
    return created;
}

export async function notifyApproachingProjectDeadlines(limit = 100) {
    const now = new Date();
    const in24Hours = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const in48Hours = new Date(now.getTime() + 48 * 60 * 60 * 1000);
    let created = 0;
    for (const reminder of [
        { key: "48h", title: "Project deadline in 48 hours", body: "is due within 48 hours.", min: in24Hours, max: in48Hours },
        { key: "24h", title: "Project deadline in 24 hours", body: "is due within 24 hours.", min: now, max: in24Hours },
    ]) {
        const tasks = await Task.find({
            status: { $in: ["funded", "in_progress", "revision_requested"] },
            deadlineAt: { $gt: reminder.min, $lte: reminder.max },
            freelancer: { $exists: true, $ne: null },
            employer: { $exists: true, $ne: null },
        })
            .select("_id title employer freelancer deadlineAt")
            .sort({ deadlineAt: 1 })
            .limit(limit)
            .lean();
        for (const task of tasks) {
            if (!task.employer || !task.freelancer || !task.deadlineAt) continue;
            const [pendingCancellation, pendingExtension] = await Promise.all([
                CancellationRequest.exists({ task: task._id, status: "pending" }),
                DeadlineExtensionRequest.exists({ task: task._id, status: "pending" }),
            ]);
            if (pendingCancellation || pendingExtension) continue;
            created += await createParticipantNotifications({
                taskId: task._id.toString(),
                employerId: task.employer.toString(),
                freelancerId: task.freelancer.toString(),
                eventKey: `task:${task._id}:deadline-${reminder.key}:${task.deadlineAt.getTime()}`,
                type: "deadline_approaching",
                title: reminder.title,
                body: `"${task.title}" ${reminder.body}`,
            });
        }
    }
    return created;
}

export async function notifyOverdueProjectDeadlines(limit = 100) {
    const now = new Date();
    const tasks = await Task.find({
        status: { $in: ["funded", "in_progress", "revision_requested"] },
        deadlineAt: { $lte: now },
        freelancer: { $exists: true, $ne: null },
        employer: { $exists: true, $ne: null },
    })
        .select("_id title employer freelancer deadlineAt")
        .sort({ deadlineAt: 1 })
        .limit(limit)
        .lean();
    let created = 0;
    for (const task of tasks) {
        if (!task.employer || !task.freelancer || !task.deadlineAt) continue;
        created += await createParticipantNotifications({
            taskId: task._id.toString(),
            employerId: task.employer.toString(),
            freelancerId: task.freelancer.toString(),
            eventKey: `task:${task._id}:deadline-overdue:${task.deadlineAt.getTime()}`,
            type: "project_overdue",
            title: "Project deadline passed",
            body: `"${task.title}" is overdue.`,
        });
    }
    return created;
}

function formatRemainingTime(milliseconds: number) {
    const totalMinutes = Math.max(1, Math.ceil(milliseconds / 60_000));
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${hours} hour${hours === 1 ? "" : "s"} ${minutes} minute${minutes === 1 ? "" : "s"}`;
}

export async function queueUpcomingProjectDeadlineReminderEmails(limit = 100) {
    const now = new Date();
    const reminderWindowEnd = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const tasks = await Task.find({
        status: { $in: ["funded", "in_progress", "revision_requested"] },
        deadlineAt: { $gt: now, $lte: reminderWindowEnd },
        freelancer: { $exists: true, $ne: null },
        employer: { $exists: true, $ne: null },
    })
        .select("_id title employer freelancer status deadlineAt")
        .sort({ deadlineAt: 1 })
        .limit(limit)
        .lean();

    let queued = 0;
    for (const task of tasks) {
        if (!task.employer || !task.freelancer || !task.deadlineAt) continue;

        const session = await mongoose.startSession();
        let outboxId: mongoose.Types.ObjectId | null = null;
        try {
            await session.withTransaction(async () => {
                outboxId = null;
                const claimedTask = await Task.findOneAndUpdate(
                    {
                        _id: task._id,
                        employer: task.employer,
                        freelancer: task.freelancer,
                        status: { $in: ["funded", "in_progress", "revision_requested"] },
                        deadlineAt: task.deadlineAt,
                        deadlineReminderSentFor: { $ne: task.deadlineAt },
                    },
                    { $set: { deadlineReminderSentFor: task.deadlineAt } },
                    { returnDocument: "after", session },
                );
                if (!claimedTask) return;

                const submittedWork = await ProjectSubmission.exists({
                    task: claimedTask._id,
                    status: "submitted",
                }).session(session);
                if (submittedWork) return;

                const freelancer = await User.findById(claimedTask.freelancer)
                    .select("name email isVerified")
                    .session(session)
                    .lean();
                const client = await User.findById(claimedTask.employer)
                    .select("name")
                    .session(session)
                    .lean();
                outboxId = await queueWorkflowEmail(
                    "project_deadline_reminder",
                    `project-deadline:${claimedTask._id}:${claimedTask.deadlineAt!.getTime()}:24h`,
                    freelancer,
                    {
                        subject: "Reminder: Your FreelanceX project deadline is tomorrow",
                        heading: "Your project deadline is approaching",
                        message: `Please submit your work for "${claimedTask.title}" before the deadline.`,
                        details: [
                            { label: "Project", value: claimedTask.title },
                            { label: "Client", value: client?.name || "Your client" },
                            { label: "Deadline", value: formatProjectDeadlineDateTime(claimedTask.deadlineAt!) },
                            { label: "Remaining time", value: formatRemainingTime(claimedTask.deadlineAt!.getTime() - now.getTime()) },
                        ],
                        actionPath: `/freelancer/dashboard/projects/${claimedTask._id}`,
                        actionLabel: "Open project workspace",
                        relatedTask: claimedTask._id,
                    },
                    session,
                );
            });
        } finally {
            await session.endSession();
        }
        if (outboxId) queued += 1;
    }

    return queued;
}
