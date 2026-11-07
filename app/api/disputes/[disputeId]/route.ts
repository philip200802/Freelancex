import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import { NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/mongodb";
import { getCurrentUser } from "@/lib/current-user";
import Dispute, { disputeStatuses, type DisputeStatus, type IDispute } from "@/models/Dispute";
import Task from "@/models/Task";
import User from "@/models/User";
import Notification from "@/models/Notification";
import type { NotificationType } from "@/models/Notification";
import { processWorkflowEmailOutbox, queueWorkflowEmail, queueWorkflowEmailToAdmins } from "@/lib/workflow-email";

export const dynamic = "force-dynamic";
const activeStatuses = ["open", "under_review", "awaiting_client_response", "awaiting_freelancer_response"];

function jsonNoStore(body: unknown, init?: ResponseInit) {
    const response = NextResponse.json(body, init);
    response.headers.set("Cache-Control", "no-store");
    return response;
}

function validateEvidenceLinks(value: unknown): string[] | null {
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.length > 10 || !value.every((item) => typeof item === "string")) return null;
    const links: string[] = [];
    for (const rawLink of value) {
        if (!rawLink.trim() || rawLink.trim().length > 2048) return null;
        try {
            const link = new URL(rawLink.trim());
            if (link.protocol !== "https:" || !link.hostname || link.username || link.password) return null;
            links.push(link.toString());
        } catch {
            return null;
        }
    }
    return links;
}

function diagnosticDetails(error: unknown, operation: string) {
    const message = error instanceof Error ? error.message : "Unknown failure";
    const stack = error instanceof Error && error.stack
        ? error.stack.split("\n").slice(1, 9).map((line) => line.replace(/mongodb(?:\+srv)?:\/\/[^\s"'`]+/gi, "[database-url]").trim())
        : [];
    return {
        operation,
        errorName: error instanceof Error ? error.name : "UnknownError",
        message: message
            .replace(/mongodb(?:\+srv)?:\/\/[^\s"'`]+/gi, "[database-url]")
            .replace(/(password|passwd|secret|token|apikey)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
            .slice(0, 500),
        stack,
        ...(error && typeof error === "object" && "code" in error && typeof error.code === "number" ? { code: error.code } : {}),
    };
}

function serializeDispute(dispute: {
    _id: mongoose.Types.ObjectId;
    task: unknown;
    reason: string;
    description: string;
    evidenceLinks: string[];
    status: string;
    history: Array<{ entryId: string; author: unknown; authorRole: string; authorName?: string; message: string; attachments?: string[]; readBy?: unknown[]; createdAt: Date }>;
    resolution?: string;
    createdAt: Date;
    updatedAt: Date;
}) {
    return {
        id: dispute._id.toString(),
        task: String(dispute.task),
        reason: dispute.reason,
        description: dispute.description,
        evidenceLinks: dispute.evidenceLinks,
        status: dispute.status,
        history: dispute.history.map((entry) => ({
            entryId: entry.entryId,
            authorId: entry.author && typeof entry.author === "object" && "_id" in entry.author ? String(entry.author._id) : String(entry.author),
            authorRole: entry.authorRole,
            authorName: entry.authorRole === "admin" ? "FreelanceX Support Team" : entry.authorName || "",
            message: entry.message,
            attachments: entry.attachments || [],
            readBy: (entry.readBy || []).map((reader) => String(reader)),
            createdAt: entry.createdAt,
        })),
        resolution: dispute.resolution || "",
        createdAt: dispute.createdAt,
        updatedAt: dispute.updatedAt,
    };
}

export async function PATCH(request: Request, context: { params: Promise<{ disputeId: string }> }) {
    const user = await getCurrentUser();
    if (!user) return jsonNoStore({ error: "Authentication required." }, { status: 401 });
    const { disputeId } = await context.params;
    if (!mongoose.Types.ObjectId.isValid(disputeId)) return jsonNoStore({ error: "Dispute not found." }, { status: 404 });

    let parsedBody: unknown;
    try {
        parsedBody = await request.json();
    } catch {
        return jsonNoStore({ error: "Dispute update is invalid." }, { status: 400 });
    }
    if (!parsedBody || typeof parsedBody !== "object" || Array.isArray(parsedBody)) return jsonNoStore({ error: "Dispute update is invalid." }, { status: 400 });
    const body = parsedBody as { action?: unknown; requestId?: unknown; message?: unknown; status?: unknown; resolution?: unknown; evidenceLinks?: unknown };

    const action = body.action;
    const requestId = typeof body.requestId === "string" ? body.requestId : "";
    const message = typeof body.message === "string" ? body.message.trim() : "";
    const resolution = typeof body.resolution === "string" ? body.resolution.trim() : "";
    const evidenceLinks = validateEvidenceLinks(body.evidenceLinks);
    if (!evidenceLinks) return jsonNoStore({ error: "Provide up to ten valid HTTPS evidence links." }, { status: 400 });
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
        return jsonNoStore({ error: "A valid request identifier is required." }, { status: 400 });
    }
    if (typeof action !== "string" || !["reply", "request_response", "set_status", "resolve", "close"].includes(action)) {
        return jsonNoStore({ error: "Choose a valid dispute action." }, { status: 400 });
    }
    if (message.length > 5000 || resolution.length > 5000) return jsonNoStore({ error: "Dispute messages must be 5000 characters or fewer." }, { status: 400 });
    if (user.role !== "admin" && action !== "reply") return jsonNoStore({ error: "Only administrators can change dispute status or resolution." }, { status: 403 });
    if (action === "reply" && !message) return jsonNoStore({ error: "Write a response before submitting." }, { status: 400 });
    if (action === "request_response" && (!message || (body.status !== "awaiting_client_response" && body.status !== "awaiting_freelancer_response"))) {
        return jsonNoStore({ error: "Choose which party should respond and include a message." }, { status: 400 });
    }
    if (action === "set_status" && (typeof body.status !== "string" || !disputeStatuses.includes(body.status as DisputeStatus))) {
        return jsonNoStore({ error: "Choose a valid dispute status." }, { status: 400 });
    }
    if (action === "resolve" && !resolution) return jsonNoStore({ error: "Enter the dispute resolution before saving." }, { status: 400 });
    if (user.role === "admin" && action !== "reply" && !message && action !== "resolve") {
        return jsonNoStore({ error: "Add an update message for the dispute history." }, { status: 400 });
    }

    let operation = "database connection";
    try {
        await connectToDatabase();
        operation = "load dispute";
        const dispute = await Dispute.findById(disputeId).lean();
        if (!dispute) return jsonNoStore({ error: "Dispute not found." }, { status: 404 });
        const isClient = user.role === "employer" && dispute.employer.toString() === user.userId;
        const isFreelancer = user.role === "freelancer" && dispute.freelancer.toString() === user.userId;
        if (!isClient && !isFreelancer && user.role !== "admin") return jsonNoStore({ error: "Dispute not found." }, { status: 404 });
        if (dispute.history.some((entry: IDispute["history"][number]) => entry.entryId === requestId)) {
            return jsonNoStore({ dispute: serializeDispute(dispute), duplicate: true });
        }
        if (user.role === "admin" && dispute.status === "closed") {
            return jsonNoStore({ error: "This dispute is closed and cannot be changed." }, { status: 409 });
        }
        if (user.role === "admin" && dispute.status === "resolved" && action !== "close") {
            return jsonNoStore({ error: "This dispute is resolved. Close it to finish the record." }, { status: 409 });
        }
        if (action === "reply" && dispute.status === "awaiting_client_response" && !isClient && user.role !== "admin") {
            return jsonNoStore({ error: "The administrator requested a response from the client." }, { status: 409 });
        }
        if (action === "reply" && dispute.status === "awaiting_freelancer_response" && !isFreelancer && user.role !== "admin") {
            return jsonNoStore({ error: "The administrator requested a response from the freelancer." }, { status: 409 });
        }
        if (user.role !== "admin" && !activeStatuses.includes(dispute.status)) {
            return jsonNoStore({ error: "This dispute is closed and can no longer receive responses." }, { status: 409 });
        }
        if (user.role === "admin" && action === "set_status" && body.status === "resolved" && !resolution) {
            return jsonNoStore({ error: "Enter the dispute resolution before setting the status to resolved." }, { status: 400 });
        }

        const entryMessage = action === "resolve" ? message || `Resolution: ${resolution}` : message;
        operation = "load message author";
        const actor = await User.findById(user.userId).select("name").lean();
        const historyEntry = {
            entryId: requestId || randomUUID(),
            author: user.userId,
            authorRole: user.role,
            authorName: user.role === "admin" ? "FreelanceX Support Team" : actor?.name || (user.role === "employer" ? "Client" : "Freelancer"),
            message: entryMessage,
            attachments: evidenceLinks,
            readBy: [user.userId],
            createdAt: new Date(),
        };
        let nextStatus = dispute.status as DisputeStatus;
        const updates: Record<string, unknown> = {};
        const unsets: Record<string, number> = {};
        if (action === "reply") nextStatus = "under_review";
        else if (action === "request_response") nextStatus = body.status as DisputeStatus;
        else if (action === "set_status") nextStatus = body.status as DisputeStatus;
        else if (action === "resolve") nextStatus = "resolved";
        else if (action === "close") nextStatus = "closed";
        if (nextStatus !== dispute.status) updates.status = nextStatus;
        if (action === "resolve" || (action === "set_status" && nextStatus === "resolved")) {
            updates.resolution = resolution;
            updates.resolvedBy = user.userId;
            updates.resolvedAt = new Date();
        }
        if (action === "set_status" && nextStatus !== "resolved") {
            unsets.resolution = 1;
            unsets.resolvedBy = 1;
            unsets.resolvedAt = 1;
        }

        operation = "persist dispute status and message";
        const updatedDispute = await Dispute.findOneAndUpdate(
            { _id: disputeId, status: dispute.status, "history.entryId": { $ne: requestId } },
            { ...(Object.keys(updates).length ? { $set: updates } : {}), ...(Object.keys(unsets).length ? { $unset: unsets } : {}), $push: { history: historyEntry } },
            { returnDocument: "after", runValidators: true },
        );
        if (!updatedDispute) {
            const duplicate = await Dispute.findOne({ _id: disputeId, "history.entryId": requestId }).lean();
            if (duplicate) return jsonNoStore({ dispute: serializeDispute(duplicate), duplicate: true });
            return jsonNoStore({ error: "The dispute changed while you were updating it. Refresh and try again." }, { status: 409 });
        }

        const shouldRestoreTask = nextStatus === "resolved" || (nextStatus === "closed" && dispute.status !== "resolved");
        if (shouldRestoreTask) {
            operation = "restore project status";
            const restoredTask = await Task.updateOne(
                { _id: dispute.task, status: "disputed" },
                { $set: { status: dispute.projectStatusBeforeDispute } },
            );
            if (restoredTask.matchedCount !== 1) {
                operation = "roll back dispute after project status conflict";
                const rollback = await Dispute.updateOne(
                    { _id: disputeId, status: nextStatus, "history.entryId": requestId },
                    {
                        $set: { status: dispute.status },
                        ...(action === "resolve" || (action === "set_status" && nextStatus === "resolved")
                            ? { $unset: { resolution: 1, resolvedBy: 1, resolvedAt: 1 } }
                            : {}),
                        $pull: { history: { entryId: requestId } },
                    },
                );
                if (rollback.modifiedCount !== 1) {
                    console.error("Dispute status rollback failed.", diagnosticDetails(new Error("Dispute was updated but project restoration conflicted."), operation));
                    return jsonNoStore({ error: "The dispute update could not be completed safely. Contact support." }, { status: 503 });
                }
                return jsonNoStore({ error: "The project changed while the dispute was being updated. Refresh and try again." }, { status: 409 });
            }
        }

        const notificationType: NotificationType = action === "reply" ? "dispute_message" : nextStatus === "resolved" ? "dispute_resolved" : "dispute_updated";
        const updateNotice = action === "reply"
            ? "A new message was added to a project dispute."
            : nextStatus === "resolved"
                ? "A project dispute was resolved."
                : "There is a new update on a project dispute.";
        const recipients: Array<{ recipient: mongoose.Types.ObjectId; recipientRole: "employer" | "freelancer" | "admin"; href: string }> = [];
        if (user.role !== "employer") recipients.push({
            recipient: dispute.employer,
            recipientRole: "employer",
            href: `/client/dashboard/disputes?disputeId=${dispute._id}`,
        });
        if (user.role !== "freelancer") recipients.push({
            recipient: dispute.freelancer,
            recipientRole: "freelancer",
            href: `/freelancer/dashboard/disputes?disputeId=${dispute._id}`,
        });
        operation = "save dispute notifications";
        try {
            const admins = user.role === "admin" ? [] : await User.find({ role: "admin" }).select("_id").lean();
            recipients.push(...admins.map((admin) => ({
                recipient: admin._id,
                recipientRole: "admin" as const,
                href: `/admin/dashboard/disputes#${dispute._id}`,
            })));
            for (const recipient of recipients) {
                await Notification.updateOne(
                    { recipient: recipient.recipient, eventKey: `dispute:${dispute._id}:update:${requestId}` },
                    { $setOnInsert: {
                        ...recipient,
                        actor: user.userId,
                        ...(user.role === "admin" ? { actorNameSnapshot: "FreelanceX Support Team" } : {}),
                        type: recipient.recipientRole === "admin" ? "admin_dispute" : notificationType,
                        title: recipient.recipientRole === "admin" ? "Dispute requires attention" : action === "reply" ? "New dispute message" : nextStatus === "resolved" ? "Dispute resolved" : "Dispute updated",
                        body: updateNotice,
                        relatedTask: dispute.task,
                        relatedDispute: dispute._id,
                        eventKey: `dispute:${dispute._id}:update:${requestId}`,
                    } },
                    { upsert: true },
                );
            }
        } catch (notificationError) {
            console.error("Dispute message was saved, but notifications could not be saved.", diagnosticDetails(notificationError, operation));
        }

        try {
            const emailSession = await mongoose.connection.startSession();
            const workflowEmailIds: mongoose.Types.ObjectId[] = [];
            try {
                await emailSession.withTransaction(async () => {
                    const [client, freelancer] = await Promise.all([
                        User.findById(dispute.employer).select("name email isVerified").session(emailSession).lean(),
                        User.findById(dispute.freelancer).select("name email isVerified").session(emailSession).lean(),
                    ]);
            const updateText = nextStatus === "resolved"
                ? `The dispute has been resolved. ${resolution}`
                : action === "request_response" ? message : `There is a new update on your project dispute. ${message}`;
                    const event = action === "reply" ? "dispute_message" : nextStatus === "resolved" ? "dispute_resolved" : "dispute_updated";
                    const email = {
                        subject: action === "reply" ? "New message on your FreelanceX dispute" : nextStatus === "resolved" ? "FreelanceX dispute resolution recorded" : "FreelanceX dispute update",
                        heading: action === "reply" ? "New dispute message" : nextStatus === "resolved" ? "Dispute resolution recorded" : "Project dispute update",
                        message: user.role === "admin" ? `FreelanceX Support Team: ${updateText}` : updateText,
                        details: [{ label: "Dispute status", value: nextStatus.replace(/_/g, " ") }, { label: "Project reference", value: dispute.task.toString() }],
                        actionLabel: "View dispute",
                        relatedTask: dispute.task,
                    };
                    if (user.role !== "employer") {
                        const clientEmailId = await queueWorkflowEmail(
                            event,
                            `dispute:${dispute._id}:update:${requestId}:client`,
                            client,
                            { ...email, actionPath: `/client/dashboard/disputes?disputeId=${dispute._id}` },
                            emailSession,
                        );
                        if (clientEmailId) workflowEmailIds.push(clientEmailId);
                    }
                    if (user.role !== "freelancer") {
                        const freelancerEmailId = await queueWorkflowEmail(
                            event,
                            `dispute:${dispute._id}:update:${requestId}:freelancer`,
                            freelancer,
                            { ...email, actionPath: `/freelancer/dashboard/disputes?disputeId=${dispute._id}` },
                            emailSession,
                        );
                        if (freelancerEmailId) workflowEmailIds.push(freelancerEmailId);
                    }
                    if (nextStatus === "resolved" || nextStatus === "under_review") {
                        const adminEmailIds = await queueWorkflowEmailToAdmins(
                            nextStatus === "resolved" ? "dispute_resolved_admin" : "dispute_escalated_admin",
                            `dispute:${dispute._id}:status:${nextStatus}:${requestId}:admin`,
                            {
                                subject: nextStatus === "resolved" ? "Project dispute resolved" : "Project dispute escalated for review",
                                heading: nextStatus === "resolved" ? "Dispute resolved" : "Dispute escalated",
                                message: nextStatus === "resolved" ? "An administrator recorded a resolution for a project dispute." : "A project dispute was escalated for administrator review.",
                                details: [{ label: "Project reference", value: dispute.task.toString() }, { label: "Dispute status", value: nextStatus.replace(/_/g, " ") }],
                                actionPath: `/admin/dashboard/disputes#${dispute._id}`,
                                actionLabel: "Review dispute",
                                relatedTask: dispute.task,
                            },
                            emailSession,
                        );
                        workflowEmailIds.push(...adminEmailIds);
                    }
                });
            } finally {
                await emailSession.endSession();
            }
            await processWorkflowEmailOutbox(workflowEmailIds.length, workflowEmailIds);
        } catch (emailError) {
            console.error("Dispute update notification could not be prepared.", {
                errorName: emailError instanceof Error ? emailError.name : "UnknownError",
            });
        }
        return jsonNoStore({ dispute: serializeDispute(updatedDispute.toObject()) });
    } catch (error) {
        console.error("Dispute update error.", diagnosticDetails(error, operation));
        if (error instanceof mongoose.Error.ValidationError) return jsonNoStore({ error: "The dispute update contains invalid fields." }, { status: 422 });
        if (error instanceof mongoose.Error.CastError) return jsonNoStore({ error: "The dispute update contains an invalid value." }, { status: 400 });
        if (error && typeof error === "object" && "code" in error && error.code === 11000) return jsonNoStore({ error: "This dispute update has already been processed." }, { status: 409 });
        return jsonNoStore({ error: "The dispute update could not be saved." }, { status: 503 });
    }
}
