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
import { formatProjectDeadlineDateTime } from "@/lib/project-deadline";

export const dynamic = "force-dynamic";

function jsonNoStore(body: unknown, init?: ResponseInit) {
    const response = NextResponse.json(body, init);
    response.headers.set("Cache-Control", "no-store");
    return response;
}

export async function PATCH(request: Request, context: { params: Promise<{ taskId: string; requestId: string }> }) {
    const user = await getCurrentUser();
    if (!user) return jsonNoStore({ error: "Authentication required." }, { status: 401 });
    if (user.role !== "employer") return jsonNoStore({ error: "Only the project owner can decide a deadline extension." }, { status: 403 });
    const { taskId, requestId } = await context.params;
    if (!mongoose.Types.ObjectId.isValid(taskId) || !mongoose.Types.ObjectId.isValid(requestId)) {
        return jsonNoStore({ error: "Deadline extension request not found." }, { status: 404 });
    }

    let body: { action?: unknown };
    try {
        body = await request.json() as typeof body;
    } catch {
        return jsonNoStore({ error: "Choose whether to approve or reject the extension." }, { status: 400 });
    }
    if (body.action !== "approve" && body.action !== "reject") {
        return jsonNoStore({ error: "Choose whether to approve or reject the extension." }, { status: 400 });
    }

    try {
        await connectToDatabase();
    } catch (error) {
        console.error("Deadline extension database connection failed:", { errorName: error instanceof Error ? error.name : "UnknownError" });
        return jsonNoStore({ error: "The deadline extension request could not be updated." }, { status: 503 });
    }
    const session = await mongoose.startSession();
    let freelancerId = "";
    let projectTitle = "";
    let currentDeadline: Date | undefined;
    let proposedDeadline: Date | undefined;
    try {
        await session.withTransaction(async () => {
            const extension = await DeadlineExtensionRequest.findOne({
                _id: requestId,
                task: taskId,
                employer: user.userId,
                status: "pending",
            }).session(session).lean();
            if (!extension) throw new Error("EXTENSION_UNAVAILABLE");
            const task = await Task.findOne({ _id: taskId, employer: user.userId }).select("_id employer freelancer title status deadlineAt").session(session).lean();
            if (!task || !task.freelancer || task.freelancer.toString() !== extension.freelancer.toString()) throw new Error("EXTENSION_UNAVAILABLE");
            if (!["funded", "in_progress", "revision_requested"].includes(task.status) || !task.deadlineAt || task.deadlineAt.getTime() !== extension.currentDeadline.getTime()) {
                throw new Error("DEADLINE_CHANGED");
            }
            if (await Dispute.exists({ task: taskId, status: { $nin: ["resolved", "closed"] } }).session(session)) {
                throw new Error("ACTIVE_DISPUTE");
            }
            if (await CancellationRequest.exists({ task: taskId, status: "pending" }).session(session)) {
                throw new Error("PENDING_CANCELLATION");
            }

            const decidedAt = new Date();
            if (body.action === "approve") {
                const updatedTask = await Task.findOneAndUpdate(
                    {
                        _id: taskId,
                        employer: user.userId,
                        freelancer: extension.freelancer,
                        status: task.status,
                        deadlineAt: extension.currentDeadline,
                    },
                    { $set: { deadlineAt: extension.proposedDeadline } },
                    { returnDocument: "after", session },
                );
                if (!updatedTask) throw new Error("DEADLINE_CHANGED");
            }
            const updatedRequest = await DeadlineExtensionRequest.findOneAndUpdate(
                { _id: extension._id, task: taskId, employer: user.userId, status: "pending" },
                { $set: { status: body.action === "approve" ? "approved" : "rejected", decidedBy: user.userId, decidedAt } },
                { returnDocument: "after", session },
            );
            if (!updatedRequest) throw new Error("EXTENSION_UNAVAILABLE");

            freelancerId = extension.freelancer.toString();
            projectTitle = task.title;
            currentDeadline = extension.currentDeadline;
            proposedDeadline = extension.proposedDeadline;
            await Notification.updateOne(
                { recipient: extension.freelancer, eventKey: `deadline-extension:${extension._id}:${body.action}` },
                { $setOnInsert: {
                    recipient: extension.freelancer,
                    recipientRole: "freelancer",
                    actor: user.userId,
                    type: "deadline_extension",
                    title: body.action === "approve" ? "Deadline extension approved" : "Deadline extension rejected",
                    body: body.action === "approve"
                        ? `Your deadline extension for "${task.title}" was approved. The new deadline is ${formatProjectDeadlineDateTime(extension.proposedDeadline)}.`
                        : `Your deadline extension for "${task.title}" was rejected; the original deadline remains unchanged.`,
                    relatedTask: task._id,
                    eventKey: `deadline-extension:${extension._id}:${body.action}`,
                    href: `/freelancer/dashboard/projects/${taskId}`,
                } },
                { upsert: true, session },
            );
        });
    } catch (error) {
        if (error instanceof Error && error.message === "EXTENSION_UNAVAILABLE") return jsonNoStore({ error: "This deadline extension request is no longer pending." }, { status: 409 });
        if (error instanceof Error && error.message === "DEADLINE_CHANGED") return jsonNoStore({ error: "The project deadline changed. Review the current deadline and submit a new request if needed." }, { status: 409 });
        if (error instanceof Error && error.message === "ACTIVE_DISPUTE") return jsonNoStore({ error: "Deadline extensions are unavailable while an active dispute exists." }, { status: 409 });
        if (error instanceof Error && error.message === "PENDING_CANCELLATION") return jsonNoStore({ error: "Resolve the pending cancellation request before deciding the extension." }, { status: 409 });
        console.error("Deadline extension decision error:", { errorName: error instanceof Error ? error.name : "UnknownError" });
        return jsonNoStore({ error: "The deadline extension request could not be updated." }, { status: 503 });
    } finally {
        await session.endSession();
    }

    try {
        const [freelancer, client] = await Promise.all([
            User.findById(freelancerId).select("name email isVerified").lean(),
            User.findById(user.userId).select("name email isVerified").lean(),
        ]);
        await queueWorkflowEmailsAfterCommit([{
            workflowEvent: `deadline_extension_${body.action}`,
            dedupeKey: `deadline-extension:${requestId}:${body.action}`,
            recipient: freelancer,
            email: {
                subject: body.action === "approve" ? "Your FreelanceX project deadline was extended" : "Deadline extension request update",
                heading: body.action === "approve" ? "Deadline extension approved" : "Deadline extension rejected",
                message: body.action === "approve"
                    ? `The client approved additional time for "${projectTitle}".`
                    : `The client rejected your extension request for "${projectTitle}". The original deadline remains unchanged.`,
                details: [
                    { label: "Previous deadline", value: currentDeadline ? formatProjectDeadlineDateTime(currentDeadline) : "" },
                    { label: "New deadline", value: proposedDeadline ? formatProjectDeadlineDateTime(proposedDeadline) : "" },
                    { label: "Client", value: client?.name || "Client" },
                ],
                actionPath: `/freelancer/dashboard/projects/${taskId}`,
                actionLabel: "View project",
                relatedTask: new mongoose.Types.ObjectId(taskId),
            },
        }]);
    } catch (error) {
        console.error("Deadline extension decision email could not be queued.", { errorName: error instanceof Error ? error.name : "UnknownError" });
    }
    return jsonNoStore({
        request: { id: requestId, status: body.action === "approve" ? "approved" : "rejected" },
        ...(body.action === "approve" ? { task: { id: taskId, deadlineAt: proposedDeadline } } : {}),
    });
}
