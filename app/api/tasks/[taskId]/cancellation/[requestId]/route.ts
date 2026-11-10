import mongoose from "mongoose";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { connectToDatabase } from "@/lib/mongodb";
import CancellationRequest from "@/models/CancellationRequest";
import DeadlineExtensionRequest from "@/models/DeadlineExtensionRequest";
import Dispute from "@/models/Dispute";
import ManualPayout from "@/models/ManualPayout";
import Notification from "@/models/Notification";
import PaymentTransaction from "@/models/PaymentTransaction";
import Task from "@/models/Task";
import User from "@/models/User";
import { queueWorkflowEmailsAfterCommit } from "@/lib/workflow-email";

export const dynamic = "force-dynamic";

function jsonNoStore(body: unknown, init?: ResponseInit) {
    const response = NextResponse.json(body, init);
    response.headers.set("Cache-Control", "no-store");
    return response;
}

export async function PATCH(request: Request, context: { params: Promise<{ taskId: string; requestId: string }> }) {
    const user = await getCurrentUser();
    if (!user) return jsonNoStore({ error: "Authentication required." }, { status: 401 });
    const { taskId, requestId } = await context.params;
    if (!mongoose.Types.ObjectId.isValid(taskId) || !mongoose.Types.ObjectId.isValid(requestId)) {
        return jsonNoStore({ error: "Cancellation request not found." }, { status: 404 });
    }

    let body: { action?: unknown };
    try {
        body = await request.json() as typeof body;
    } catch {
        return jsonNoStore({ error: "Choose whether to accept or reject the request." }, { status: 400 });
    }
    if (body.action !== "accept" && body.action !== "reject") {
        return jsonNoStore({ error: "Choose whether to accept or reject the request." }, { status: 400 });
    }
    if (user.role !== "employer" && user.role !== "freelancer") {
        return jsonNoStore({ error: "Only the other project participant can decide this request." }, { status: 403 });
    }

    try {
        await connectToDatabase();
    } catch (error) {
        console.error("Project cancellation database connection failed:", { errorName: error instanceof Error ? error.name : "UnknownError" });
        return jsonNoStore({ error: "The cancellation request could not be updated." }, { status: 503 });
    }
    const session = await mongoose.startSession();
    let requesterId = "";
    let requesterRole: "employer" | "freelancer" = "employer";
    let projectTitle = "";
    let funded = false;
    try {
        await session.withTransaction(async () => {
            const cancellation = await CancellationRequest.findOne({
                _id: requestId,
                task: taskId,
                requestedTo: user.userId,
                status: "pending",
            }).session(session).lean();
            if (!cancellation) throw new Error("CANCELLATION_REQUEST_UNAVAILABLE");
            const task = await Task.findById(taskId).select("employer freelancer title status").session(session).lean();
            if (!task || !task.employer || !task.freelancer || task.status === "completed" || task.status === "cancelled" || task.status === "disputed") {
                throw new Error("CANCELLATION_PROJECT_UNAVAILABLE");
            }
            const participantMatches = user.role === "employer"
                ? task.employer.toString() === user.userId
                : task.freelancer.toString() === user.userId;
            if (!participantMatches || cancellation.requestedBy.toString() === user.userId) {
                throw new Error("CANCELLATION_NOT_RECIPIENT");
            }
            const [activeDispute, pendingPayment, payout, pendingExtension] = await Promise.all([
                Dispute.exists({ task: taskId, status: { $nin: ["resolved", "closed"] } }).session(session),
                PaymentTransaction.exists({ task: taskId, status: { $in: ["initializing", "pending"] } }).session(session),
                ManualPayout.exists({ task: taskId, status: { $in: ["pending", "completed"] } }).session(session),
                DeadlineExtensionRequest.exists({ task: taskId, status: "pending" }).session(session),
            ]);
            if (activeDispute) throw new Error("ACTIVE_DISPUTE");
            if (pendingPayment || payout) throw new Error("FINANCIAL_OPERATION_PENDING");
            if (pendingExtension) throw new Error("PENDING_EXTENSION");

            const resolvedAt = new Date();
            const status = body.action === "accept" ? "accepted" : "rejected";
            if (body.action === "accept") {
                const updatedTask = await Task.findOneAndUpdate(
                    {
                        _id: taskId,
                        employer: task.employer,
                        freelancer: task.freelancer,
                        status: task.status,
                    },
                    { $set: { status: "cancelled" } },
                    { returnDocument: "after", session },
                );
                if (!updatedTask) throw new Error("CANCELLATION_PROJECT_UNAVAILABLE");
                funded = Boolean(await PaymentTransaction.exists({ task: taskId, status: "success" }).session(session));
            }
            const updatedRequest = await CancellationRequest.findOneAndUpdate(
                { _id: requestId, task: taskId, requestedTo: user.userId, status: "pending" },
                { $set: { status, resolvedBy: user.userId, resolvedAt } },
                { returnDocument: "after", session },
            );
            if (!updatedRequest) throw new Error("CANCELLATION_REQUEST_UNAVAILABLE");

            requesterId = cancellation.requestedBy.toString();
            requesterRole = cancellation.requesterRole;
            projectTitle = task.title;
            const recipients = [
                { id: cancellation.requestedBy, role: cancellation.requesterRole },
                { id: cancellation.requestedTo, role: cancellation.requesterRole === "employer" ? "freelancer" as const : "employer" as const },
            ];
            for (const recipient of recipients) {
                await Notification.updateOne(
                    { recipient: recipient.id, eventKey: `cancellation:${requestId}:${status}:${recipient.id}` },
                    { $setOnInsert: {
                        recipient: recipient.id,
                        recipientRole: recipient.role,
                        actor: user.userId,
                        type: "project_cancellation",
                        title: body.action === "accept" ? "Project cancellation accepted" : "Project cancellation rejected",
                        body: body.action === "accept"
                            ? `"${task.title}" was cancelled by mutual agreement. Project funds were not refunded or released.`
                            : `The cancellation request for "${task.title}" was rejected. The project remains active.`,
                        relatedTask: task._id,
                        eventKey: `cancellation:${requestId}:${status}:${recipient.id}`,
                        href: recipient.role === "employer" ? `/client/dashboard/projects/${taskId}` : `/freelancer/dashboard/projects/${taskId}`,
                    } },
                    { upsert: true, session },
                );
            }
            if (funded) {
                const admins = await User.find({ role: "admin", isActive: { $ne: false } }).select("_id").session(session).lean();
                for (const admin of admins) {
                    await Notification.updateOne(
                        { recipient: admin._id, eventKey: `cancellation:${requestId}:funded:admin:${admin._id}` },
                        { $setOnInsert: {
                            recipient: admin._id,
                            recipientRole: "admin",
                            actor: user.userId,
                            type: "project_cancellation",
                            title: "Funded project cancelled",
                            body: `"${task.title}" was cancelled by mutual agreement. Review its financial resolution; no funds were automatically moved.`,
                            relatedTask: task._id,
                            eventKey: `cancellation:${requestId}:funded:admin:${admin._id}`,
                            href: `/admin/dashboard/jobs/${taskId}`,
                        } },
                        { upsert: true, session },
                    );
                }
            }
        });
    } catch (error) {
        if (error instanceof Error && error.message === "CANCELLATION_REQUEST_UNAVAILABLE") return jsonNoStore({ error: "This cancellation request is no longer pending." }, { status: 409 });
        if (error instanceof Error && error.message === "CANCELLATION_PROJECT_UNAVAILABLE") return jsonNoStore({ error: "The project is no longer eligible for cancellation." }, { status: 409 });
        if (error instanceof Error && error.message === "CANCELLATION_NOT_RECIPIENT") return jsonNoStore({ error: "Only the other project participant can decide this request." }, { status: 403 });
        if (error instanceof Error && error.message === "ACTIVE_DISPUTE") return jsonNoStore({ error: "Cancellation is unavailable while an active dispute exists." }, { status: 409 });
        if (error instanceof Error && error.message === "FINANCIAL_OPERATION_PENDING") return jsonNoStore({ error: "Cancellation is blocked while a payment or payout operation is pending." }, { status: 409 });
        if (error instanceof Error && error.message === "PENDING_EXTENSION") return jsonNoStore({ error: "Resolve the pending deadline extension before deciding cancellation." }, { status: 409 });
        console.error("Project cancellation decision error:", { errorName: error instanceof Error ? error.name : "UnknownError" });
        return jsonNoStore({ error: "The cancellation request could not be updated." }, { status: 503 });
    } finally {
        await session.endSession();
    }

    try {
        const [requester, recipient] = await Promise.all([
            User.findById(requesterId).select("name email isVerified").lean(),
            User.findById(user.userId).select("name email isVerified").lean(),
        ]);
        const email = {
            subject: body.action === "accept" ? "Project cancellation decision" : "Cancellation request update",
            heading: body.action === "accept" ? "Project cancelled by mutual agreement" : "Cancellation request rejected",
            message: body.action === "accept"
                ? `The cancellation request for "${projectTitle}" was accepted. No funds were automatically refunded or released.`
                : `The cancellation request for "${projectTitle}" was rejected. The project remains active.`,
            details: [{ label: "Project", value: projectTitle }],
            actionPath: requesterRole === "employer" ? `/client/dashboard/projects/${taskId}` : `/freelancer/dashboard/projects/${taskId}`,
            actionLabel: "View project",
            relatedTask: new mongoose.Types.ObjectId(taskId),
        };
        await queueWorkflowEmailsAfterCommit([
            { workflowEvent: `project_cancellation_${body.action}`, dedupeKey: `cancellation:${requestId}:${body.action}:requester`, recipient: requester, email },
            { workflowEvent: `project_cancellation_${body.action}`, dedupeKey: `cancellation:${requestId}:${body.action}:recipient`, recipient, email },
        ]);
    } catch (error) {
        console.error("Cancellation decision emails could not be queued.", { errorName: error instanceof Error ? error.name : "UnknownError" });
    }
    return jsonNoStore({
        request: { id: requestId, status: body.action === "accept" ? "accepted" : "rejected" },
        ...(body.action === "accept" ? { task: { id: taskId, status: "cancelled" } } : {}),
    });
}
