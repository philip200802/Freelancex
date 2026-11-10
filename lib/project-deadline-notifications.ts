import CancellationRequest from "@/models/CancellationRequest";
import DeadlineExtensionRequest from "@/models/DeadlineExtensionRequest";
import Notification from "@/models/Notification";
import ProjectSubmission from "@/models/ProjectSubmission";
import Task from "@/models/Task";
import UserPreference from "@/models/UserPreference";

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
    type: "revision_overdue" | "deadline_approaching";
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
    const soon = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const tasks = await Task.find({
        status: { $in: ["funded", "in_progress", "revision_requested"] },
        deadlineAt: { $gt: now, $lte: soon },
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
        const pendingCancellation = await CancellationRequest.exists({ task: task._id, status: "pending" });
        const pendingExtension = await DeadlineExtensionRequest.exists({ task: task._id, status: "pending" });
        if (pendingCancellation || pendingExtension) continue;
        created += await createParticipantNotifications({
            taskId: task._id.toString(),
            employerId: task.employer.toString(),
            freelancerId: task.freelancer.toString(),
            eventKey: `task:${task._id}:deadline-approaching:${task.deadlineAt.getTime()}`,
            type: "deadline_approaching",
            title: "Project deadline approaching",
            body: `"${task.title}" is due within 24 hours.`,
        });
    }
    return created;
}
