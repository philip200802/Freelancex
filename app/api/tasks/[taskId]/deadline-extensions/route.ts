import mongoose from "mongoose";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { connectToDatabase } from "@/lib/mongodb";
import CancellationRequest from "@/models/CancellationRequest";
import DeadlineExtensionRequest from "@/models/DeadlineExtensionRequest";
import Dispute from "@/models/Dispute";
import Notification from "@/models/Notification";
import Task from "@/models/Task";
import User from "@/models/User";
import { queueWorkflowEmailsAfterCommit } from "@/lib/workflow-email";
import { calculateExtendedDeadline } from "@/lib/project-deadline";

export const dynamic = "force-dynamic";
const millisecondsPerDay = 24 * 60 * 60 * 1000;

function jsonNoStore(body: unknown, init?: ResponseInit) {
    const response = NextResponse.json(body, init);
    response.headers.set("Cache-Control", "no-store");
    return response;
}

async function hasActiveDispute(taskId: string, session: mongoose.ClientSession) {
    return Dispute.exists({ task: taskId, status: { $nin: ["resolved", "closed"] } }).session(session);
}

export async function GET(_request: Request, context: { params: Promise<{ taskId: string }> }) {
    const user = await getCurrentUser();
    if (!user) return jsonNoStore({ error: "Authentication required." }, { status: 401 });
    const { taskId } = await context.params;
    if (!mongoose.Types.ObjectId.isValid(taskId)) return jsonNoStore({ error: "Project not found." }, { status: 404 });

    try {
        await connectToDatabase();
        const task = await Task.findById(taskId).select("employer freelancer").lean();
        if (!task) return jsonNoStore({ error: "Project not found." }, { status: 404 });
        const participant = task.employer?.toString() === user.userId || task.freelancer?.toString() === user.userId;
        if (!participant && user.role !== "admin") return jsonNoStore({ error: "Project not found." }, { status: 404 });
        const requests = await DeadlineExtensionRequest.find({ task: taskId }).sort({ createdAt: -1 }).lean();
        return jsonNoStore({
            requests: requests.map((extension) => ({
                id: extension._id.toString(),
                freelancer: extension.freelancer.toString(),
                employer: extension.employer.toString(),
                currentDeadline: extension.currentDeadline,
                duration: extension.duration,
                durationUnit: extension.durationUnit,
                proposedDeadline: extension.proposedDeadline,
                reason: extension.reason,
                status: extension.status,
                decidedAt: extension.decidedAt,
                createdAt: extension.createdAt,
            })),
        });
    } catch (error) {
        console.error("Project deadline extension history error:", { errorName: error instanceof Error ? error.name : "UnknownError" });
        return jsonNoStore({ error: "Deadline extension history is temporarily unavailable." }, { status: 503 });
    }
}

export async function POST(request: Request, context: { params: Promise<{ taskId: string }> }) {
    const user = await getCurrentUser();
    if (!user) return jsonNoStore({ error: "Authentication required." }, { status: 401 });
    if (user.role !== "freelancer") return jsonNoStore({ error: "Only the assigned freelancer can request a deadline extension." }, { status: 403 });
    const { taskId } = await context.params;
    if (!mongoose.Types.ObjectId.isValid(taskId)) return jsonNoStore({ error: "Project not found." }, { status: 404 });

    let body: { duration?: unknown; durationUnit?: unknown; reason?: unknown };
    try {
        body = await request.json() as typeof body;
    } catch {
        return jsonNoStore({ error: "Extension request details are invalid." }, { status: 400 });
    }
    const duration = Number(body.duration);
    const durationUnit = body.durationUnit;
    const durationDays = duration * (durationUnit === "weeks" ? 7 : 1);
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (!Number.isSafeInteger(duration) || duration <= 0 || duration > 520 || (durationUnit !== "days" && durationUnit !== "weeks") || durationDays > 3650 || !reason || reason.length > 5000) {
        return jsonNoStore({ error: "Provide a positive extension of up to ten years and a reason of 1 to 5000 characters." }, { status: 400 });
    }

    try {
        await connectToDatabase();
    } catch (error) {
        console.error("Deadline extension database connection failed:", { errorName: error instanceof Error ? error.name : "UnknownError" });
        return jsonNoStore({ error: "The deadline extension request could not be saved." }, { status: 503 });
    }
    const session = await mongoose.startSession();
    let extensionId = "";
    let employerId = "";
    let projectTitle = "";
    let proposedDeadline: Date | undefined;
    try {
        await session.withTransaction(async () => {
            const task = await Task.findOne({ _id: taskId, freelancer: user.userId }).select("_id employer freelancer title status deadlineAt").session(session).lean();
            if (!task || !task.employer) throw new Error("NOT_ASSIGNED_FREELANCER");
            if (!["funded", "in_progress", "revision_requested"].includes(task.status) || !task.deadlineAt) throw new Error("EXTENSION_NOT_ELIGIBLE");
            if (await hasActiveDispute(taskId, session)) throw new Error("ACTIVE_DISPUTE");
            if (await CancellationRequest.exists({ task: taskId, status: "pending" }).session(session)) throw new Error("PENDING_CANCELLATION");

            const deadline = new Date(task.deadlineAt);
            const extensionDeadline = calculateExtendedDeadline(deadline, duration, durationUnit as "days" | "weeks");
            proposedDeadline = extensionDeadline;
            const [extension] = await DeadlineExtensionRequest.create([{
                task: task._id,
                freelancer: task.freelancer,
                employer: task.employer,
                currentDeadline: deadline,
                duration,
                durationUnit,
                proposedDeadline: extensionDeadline,
                reason,
            }], { session });
            extensionId = extension.id;
            employerId = task.employer.toString();
            projectTitle = task.title;
            await Notification.updateOne(
                { recipient: task.employer, eventKey: `deadline-extension:${extension._id}:requested` },
                { $setOnInsert: {
                    recipient: task.employer,
                    recipientRole: "employer",
                    actor: user.userId,
                    type: "deadline_extension",
                    title: "Deadline extension requested",
                    body: `The freelancer requested more time for "${task.title}". Review the proposed deadline.`,
                    relatedTask: task._id,
                    eventKey: `deadline-extension:${extension._id}:requested`,
                    href: `/client/dashboard/projects/${taskId}`,
                } },
                { upsert: true, session },
            );
        });
    } catch (error) {
        if (error && typeof error === "object" && "code" in error && error.code === 11000) {
            return jsonNoStore({ error: "A deadline extension request is already awaiting a decision." }, { status: 409 });
        }
        if (error instanceof Error && error.message === "NOT_ASSIGNED_FREELANCER") return jsonNoStore({ error: "Only the assigned freelancer can request an extension." }, { status: 403 });
        if (error instanceof Error && error.message === "EXTENSION_NOT_ELIGIBLE") return jsonNoStore({ error: "Extensions can only be requested for an in-progress project with a deadline." }, { status: 409 });
        if (error instanceof Error && error.message === "ACTIVE_DISPUTE") return jsonNoStore({ error: "Deadline extensions are unavailable while an active dispute exists." }, { status: 409 });
        if (error instanceof Error && error.message === "PENDING_CANCELLATION") return jsonNoStore({ error: "Resolve the pending cancellation request before requesting an extension." }, { status: 409 });
        console.error("Deadline extension request error:", { errorName: error instanceof Error ? error.name : "UnknownError" });
        return jsonNoStore({ error: "The deadline extension request could not be saved." }, { status: 503 });
    } finally {
        await session.endSession();
    }
    if (!proposedDeadline) return jsonNoStore({ error: "The proposed deadline could not be calculated." }, { status: 500 });

    try {
        const [client, freelancer] = await Promise.all([
            User.findById(employerId).select("name email isVerified").lean(),
            User.findById(user.userId).select("name email isVerified").lean(),
        ]);
        await queueWorkflowEmailsAfterCommit([{
            workflowEvent: "deadline_extension_requested",
            dedupeKey: `deadline-extension:${extensionId}:requested`,
            recipient: client,
            email: {
                subject: "Deadline extension requested for your FreelanceX project",
                heading: "Deadline extension requested",
                message: `${freelancer?.name || "Your freelancer"} requested additional time for "${projectTitle}".`,
                details: [
                    { label: "Current deadline", value: new Date(proposedDeadline.getTime() - durationDays * millisecondsPerDay).toLocaleDateString() },
                    { label: "Proposed deadline", value: proposedDeadline.toLocaleDateString() },
                    { label: "Reason", value: reason },
                ],
                actionPath: `/client/dashboard/projects/${taskId}`,
                actionLabel: "Review extension",
                relatedTask: new mongoose.Types.ObjectId(taskId),
            },
        }]);
    } catch (error) {
        console.error("Deadline extension request email could not be queued.", { errorName: error instanceof Error ? error.name : "UnknownError" });
    }
    return jsonNoStore({ request: { id: extensionId, status: "pending", proposedDeadline } }, { status: 201 });
}
