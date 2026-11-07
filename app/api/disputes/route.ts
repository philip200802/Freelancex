import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import { NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/mongodb";
import { getCurrentUser } from "@/lib/current-user";
import Dispute, { buildDisputeOpeningDocument, disputeReasons, type DisputeReason, type IDispute } from "@/models/Dispute";
import PaymentTransaction from "@/models/PaymentTransaction";
import Task from "@/models/Task";
import User from "@/models/User";
import Notification from "@/models/Notification";
import { processWorkflowEmailOutbox, queueWorkflowEmail, queueWorkflowEmailToAdmins } from "@/lib/workflow-email";

export const dynamic = "force-dynamic";
const activeStatuses = [
    "open",
    "awaiting_administrator_review",
    "under_review",
    "awaiting_client_response",
    "awaiting_freelancer_response",
    "awaiting_additional_evidence",
    "resolution_proposed",
    "escalated",
    "reopened",
];
const eligibleProjectStatuses = ["funded", "in_progress", "submitted", "revision_requested", "completed"];
const reasonLabels: Record<DisputeReason, string> = {
    work_quality: "Work quality",
    missed_deadline: "Missed deadline",
    scope_mismatch: "Scope mismatch",
    communication: "Communication",
    payment: "Payment concern",
    other: "Other",
};

function jsonNoStore(body: unknown, init?: ResponseInit) {
    const response = NextResponse.json(body, init);
    response.headers.set("Cache-Control", "no-store");
    return response;
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
        task: dispute.task,
        reason: dispute.reason,
        description: dispute.description,
        evidenceLinks: dispute.evidenceLinks,
        status: dispute.status,
        history: dispute.history.map((entry) => ({
            entryId: entry.entryId,
            authorId: getAuthorId(entry.author),
            authorName: entry.authorRole === "admin"
                ? "FreelanceX Support Team"
                : getAuthorName(entry.author) || entry.authorName || "",
            authorRole: entry.authorRole,
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

function getAuthorId(author: unknown): string {
    if (author && typeof author === "object" && "_id" in author) return String(author._id);
    return String(author);
}

function getAuthorName(author: unknown): string {
    if (author && typeof author === "object" && "name" in author && typeof author.name === "string") return author.name;
    return "";
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

function diagnosticValue(value: string) {
    return value
        .replace(/mongodb(?:\+srv)?:\/\/[^\s"'`]+/gi, "[database-url]")
        .replace(/(password|passwd|secret|token|apikey)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
        .slice(0, 500);
}

function disputeErrorDetails(
    error: unknown,
    operation: string,
    sessionContext?: { inTransaction: boolean; hasEnded: boolean },
) {
    const errorObject = error && typeof error === "object" ? error : undefined;
    const mongooseErrorType = error instanceof mongoose.Error
        ? error.constructor.name
        : errorObject && "name" in errorObject && typeof errorObject.name === "string"
            ? errorObject.name
            : "UnknownError";
    return {
        operation,
        errorName: error instanceof Error ? error.name : "UnknownError",
        message: error instanceof Error ? diagnosticValue(error.message) : "Unknown failure",
        mongooseErrorType,
        ...(errorObject && "code" in errorObject ? { mongoCode: errorObject.code } : {}),
        connectionReadyState: mongoose.connection.readyState,
        ...(sessionContext ? { session: sessionContext } : {}),
        ...(process.env.NODE_ENV === "development" && error instanceof Error && error.stack
            ? { stack: diagnosticValue(error.stack) }
            : {}),
    };
}

export async function GET(request: Request) {
    const currentUser = await getCurrentUser();
    if (!currentUser) return jsonNoStore({ error: "Authentication required." }, { status: 401 });

    try {
        await connectToDatabase();
        if (currentUser.role === "admin" && !new URL(request.url).searchParams.has("projectId")) {
            const disputes = await Dispute.find().sort({ updatedAt: -1 }).limit(200)
                .populate("task", "title amount status")
                .populate("employer", "name email")
                .populate("freelancer", "name email")
                .populate("history.author", "name")
                .lean();
            const taskIds = disputes.map((dispute) => String(dispute.task && typeof dispute.task === "object" && "_id" in dispute.task ? dispute.task._id : dispute.task));
            const payments = taskIds.length ? await PaymentTransaction.find({ task: { $in: taskIds } }).select("task status").sort({ createdAt: -1 }).lean() : [];
            const paymentByTask = new Map<string, string>();
            for (const payment of payments) {
                const taskId = payment.task.toString();
                if (!paymentByTask.has(taskId)) paymentByTask.set(taskId, payment.status);
            }
            if (disputes.length) {
                await Dispute.updateMany(
                    { _id: { $in: disputes.map((dispute) => dispute._id) } },
                    { $addToSet: { "history.$[message].readBy": currentUser.userId } },
                    { arrayFilters: [{ "message.author": { $ne: currentUser.userId }, "message.readBy": { $ne: currentUser.userId } }] },
                );
            }
            return jsonNoStore({
                disputes: disputes.map((dispute) => {
                    const task = dispute.task;
                    const taskId = String(task && typeof task === "object" && "_id" in task ? task._id : task);
                    return {
                        ...serializeDispute(dispute),
                        task,
                        employer: dispute.employer,
                        freelancer: dispute.freelancer,
                        paymentStatus: paymentByTask.get(taskId) || "not_recorded",
                        unreadCount: dispute.history.filter((entry: IDispute["history"][number]) => getAuthorId(entry.author) !== currentUser.userId && !entry.readBy?.some((reader: mongoose.Types.ObjectId) => reader.toString() === currentUser.userId)).length,
                    };
                }),
            });
        }

        if (currentUser.role !== "admin" && !new URL(request.url).searchParams.has("projectId")) {
            const disputeFilter = currentUser.role === "employer" ? { employer: currentUser.userId } : { freelancer: currentUser.userId };
            const [disputes, projectIds] = await Promise.all([
                Dispute.find(disputeFilter).sort({ updatedAt: -1 }).limit(100)
                    .populate("task", "title amount status")
                    .populate("employer", "name")
                    .populate("freelancer", "name")
                    .populate("history.author", "name")
                    .lean(),
                Dispute.find({ ...disputeFilter, status: { $in: activeStatuses } }).distinct("task"),
            ]);
            const unreadCounts = new Map<string, number>();
            for (const dispute of disputes) {
                unreadCounts.set(dispute._id.toString(), dispute.history.filter((entry: IDispute["history"][number]) =>
                    getAuthorId(entry.author) !== currentUser.userId && !entry.readBy?.some((reader: mongoose.Types.ObjectId) => reader.toString() === currentUser.userId),
                ).length);
            }
            if (disputes.length) {
                await Dispute.updateMany(
                    { _id: { $in: disputes.map((dispute) => dispute._id) } },
                    { $addToSet: { "history.$[message].readBy": currentUser.userId } },
                    { arrayFilters: [{ "message.author": { $ne: currentUser.userId }, "message.readBy": { $ne: currentUser.userId } }] },
                );
            }
            const eligibleProjects = currentUser.role === "employer"
                ? await Task.find({
                    employer: currentUser.userId,
                    freelancer: { $exists: true, $ne: null },
                    status: { $in: eligibleProjectStatuses },
                    isDeleted: { $ne: true },
                    _id: { $nin: projectIds },
                }).select("_id title status").sort({ updatedAt: -1 }).limit(100).lean()
                : [];
            return jsonNoStore({
                disputes: disputes.map((dispute) => ({
                    ...serializeDispute(dispute),
                    task: dispute.task,
                    employer: dispute.employer,
                    freelancer: dispute.freelancer,
                    unreadCount: unreadCounts.get(dispute._id.toString()) || 0,
                })),
                eligibleProjects: eligibleProjects.map((task) => ({ id: task._id.toString(), title: task.title, status: task.status })),
            });
        }

        const projectId = new URL(request.url).searchParams.get("projectId") || "";
        if (!mongoose.Types.ObjectId.isValid(projectId)) return jsonNoStore({ error: "Project not found." }, { status: 404 });
        const task = await Task.findById(projectId).select("employer freelancer").lean();
        if (!task) return jsonNoStore({ error: "Project not found." }, { status: 404 });
        const isClient = currentUser.role === "employer" && task.employer?.toString() === currentUser.userId;
        const isFreelancer = currentUser.role === "freelancer" && task.freelancer?.toString() === currentUser.userId;
        if (!isClient && !isFreelancer && currentUser.role !== "admin") return jsonNoStore({ error: "Project not found." }, { status: 404 });
        const dispute = await Dispute.findOne({ task: projectId }).sort({ createdAt: -1 }).populate("history.author", "name").lean();
        if (!dispute) return jsonNoStore({ dispute: null, unreadCount: 0 });
        const unreadCount = dispute.history.filter((entry: IDispute["history"][number]) =>
            getAuthorId(entry.author) !== currentUser.userId && !entry.readBy?.some((reader: mongoose.Types.ObjectId) => reader.toString() === currentUser.userId),
        ).length;
        await Dispute.updateOne(
            { _id: dispute._id },
            { $addToSet: { "history.$[message].readBy": currentUser.userId } },
            { arrayFilters: [{ "message.author": { $ne: currentUser.userId }, "message.readBy": { $ne: currentUser.userId } }] },
        );
        return jsonNoStore({ dispute: serializeDispute(dispute), unreadCount });
    } catch (error) {
        console.error("Dispute retrieval error.", { errorName: error instanceof Error ? error.name : "UnknownError" });
        return jsonNoStore({ error: "Disputes are temporarily unavailable." }, { status: 503 });
    }
}

export async function POST(request: Request) {
    const currentUser = await getCurrentUser();
    if (!currentUser) return jsonNoStore({ error: "Authentication required." }, { status: 401 });
    if (currentUser.role !== "employer") return jsonNoStore({ error: "Only the project client can open a dispute." }, { status: 403 });

    let parsedBody: unknown;
    try {
        parsedBody = await request.json();
    } catch {
        return jsonNoStore({ error: "Dispute details are invalid." }, { status: 400 });
    }
    if (!parsedBody || typeof parsedBody !== "object" || Array.isArray(parsedBody)) return jsonNoStore({ error: "Dispute details are invalid." }, { status: 400 });
    const body = parsedBody as { projectId?: unknown; reason?: unknown; description?: unknown; evidenceLinks?: unknown };
    const projectId = typeof body.projectId === "string" ? body.projectId : "";
    const reason = body.reason;
    const description = typeof body.description === "string" ? body.description.trim() : "";
    const evidenceLinks = validateEvidenceLinks(body.evidenceLinks);
    if (!mongoose.Types.ObjectId.isValid(projectId)) return jsonNoStore({ error: "Project not found." }, { status: 404 });
    if (typeof reason !== "string" || !disputeReasons.includes(reason as DisputeReason)) return jsonNoStore({ error: "Choose a valid dispute reason." }, { status: 400 });
    if (!description || description.length > 5000) return jsonNoStore({ error: "Explain the issue in 1 to 5000 characters." }, { status: 400 });
    if (!evidenceLinks) return jsonNoStore({ error: "Provide up to ten valid HTTPS evidence links." }, { status: 400 });

    let operation = "connect to database";
    let transactionFailureContext: { inTransaction: boolean; hasEnded: boolean } | undefined;
    try {
        await connectToDatabase();
        operation = "load eligible project";
        const task = await Task.findOne({
            _id: projectId,
            employer: currentUser.userId,
            isDeleted: { $ne: true },
        }).select("_id title employer freelancer status").lean();
        if (!task) return jsonNoStore({ error: "Project not found." }, { status: 404 });
        if (!task.freelancer || !eligibleProjectStatuses.includes(task.status)) {
            return jsonNoStore({ error: "A dispute can only be opened for an assigned project with work in progress, submitted or completed." }, { status: 409 });
        }
        operation = "check for active dispute";
        if (await Dispute.exists({ task: projectId, status: { $in: activeStatuses } })) {
            return jsonNoStore({ error: "This project already has an active dispute." }, { status: 409 });
        }

        operation = "load dispute opener";
        const opener = await User.findById(currentUser.userId).select("name").lean();
        operation = "start dispute transaction session";
        const session = await mongoose.connection.startSession();
        let disputeId = "";
        let createdDispute: InstanceType<typeof Dispute> | undefined;
        const workflowEmailIds: mongoose.Types.ObjectId[] = [];
        try {
            await session.withTransaction(async () => {
                operation = "claim project for dispute";
                const updatedTask = await Task.findOneAndUpdate(
                    {
                        _id: projectId,
                        employer: currentUser.userId,
                        freelancer: task.freelancer,
                        status: task.status,
                        isDeleted: { $ne: true },
                    },
                    { $set: { status: "disputed" } },
                    { returnDocument: "after", session },
                );
                if (!updatedTask || !updatedTask.employer || !updatedTask.freelancer) {
                    throw new Error("DISPUTE_PROJECT_STATE_CHANGED");
                }
                operation = "create dispute document";
                const [dispute] = await Dispute.create([buildDisputeOpeningDocument({
                    task: updatedTask._id,
                    employer: updatedTask.employer,
                    freelancer: updatedTask.freelancer,
                    reason: reason as DisputeReason,
                    description,
                    evidenceLinks,
                    projectStatusBeforeDispute: task.status,
                    entryId: randomUUID(),
                    authorName: opener?.name || "Client",
                    createdAt: new Date(),
                })], { session });
                disputeId = dispute.id;
                createdDispute = dispute;
                operation = "create participant dispute notifications";
                await Notification.create([
                    {
                        recipient: task.employer,
                        recipientRole: "employer",
                        actor: currentUser.userId,
                        type: "dispute_opened",
                        title: "Project dispute opened",
                        body: `A dispute was opened for "${task.title}".`,
                        relatedTask: projectId,
                        relatedDispute: dispute._id,
                        eventKey: `dispute:${dispute._id}:opened`,
                        href: `/client/dashboard/disputes?disputeId=${dispute._id}`,
                    },
                    {
                        recipient: task.freelancer,
                        recipientRole: "freelancer",
                        actor: currentUser.userId,
                        type: "dispute_opened",
                        title: "Project dispute opened",
                        body: `A dispute was opened for "${task.title}". Sign in to review the details.`,
                        relatedTask: projectId,
                        relatedDispute: dispute._id,
                        eventKey: `dispute:${dispute._id}:opened`,
                        href: `/freelancer/dashboard/disputes?disputeId=${dispute._id}`,
                    },
                ], { session, ordered: true });
                operation = "load dispute notification administrators";
                const admins = await User.find({ role: "admin" }).select("_id").session(session).lean();
                if (admins.length) {
                    operation = "create administrator dispute notifications";
                    await Notification.create(admins.map((admin) => ({
                        recipient: admin._id,
                        recipientRole: "admin" as const,
                        actor: currentUser.userId,
                        type: "admin_dispute" as const,
                        title: "Dispute requires review",
                        body: `A dispute was opened for "${task.title}".`,
                        relatedTask: projectId,
                        relatedDispute: dispute._id,
                        eventKey: `dispute:${dispute._id}:opened`,
                        href: `/admin/dashboard/disputes#${dispute._id}`,
                    })), { session, ordered: true });
                }
                const [client, freelancer] = await Promise.all([
                    User.findById(updatedTask.employer).select("name email isVerified").session(session).lean(),
                    User.findById(updatedTask.freelancer).select("name email isVerified").session(session).lean(),
                ]);
                const emailDetails = [
                    { label: "Project", value: task.title },
                    { label: "Reason", value: reasonLabels[reason as DisputeReason] },
                ];
                const clientEmailId = await queueWorkflowEmail(
                    "dispute_opened",
                    `dispute:${dispute._id}:opened:client`,
                    client,
                    {
                        subject: "A FreelanceX project dispute has been opened",
                        heading: "Project dispute opened",
                        message: "A dispute has been opened for a project you are involved in. Sign in to review the details and respond.",
                        details: emailDetails,
                        actionPath: `/client/dashboard/disputes?disputeId=${dispute._id}`,
                        actionLabel: "View dispute",
                        relatedTask: updatedTask._id,
                    },
                    session,
                );
                const freelancerEmailId = await queueWorkflowEmail(
                    "dispute_opened",
                    `dispute:${dispute._id}:opened:freelancer`,
                    freelancer,
                    {
                        subject: "A FreelanceX project dispute has been opened",
                        heading: "Project dispute opened",
                        message: "A dispute has been opened for a project you are involved in. Sign in to review the details and respond.",
                        details: emailDetails,
                        actionPath: `/freelancer/dashboard/disputes?disputeId=${dispute._id}`,
                        actionLabel: "View dispute",
                        relatedTask: updatedTask._id,
                    },
                    session,
                );
                if (clientEmailId) workflowEmailIds.push(clientEmailId);
                if (freelancerEmailId) workflowEmailIds.push(freelancerEmailId);
                const adminEmailIds = await queueWorkflowEmailToAdmins(
                    "dispute_opened_admin",
                    `dispute:${dispute._id}:opened:admin`,
                    {
                        subject: "New project dispute requires review",
                        heading: "Project dispute opened",
                        message: "A project participant opened a dispute. Review the case in the admin dashboard. Evidence and sensitive account details are not included in this email.",
                        details: emailDetails,
                        actionPath: `/admin/dashboard/disputes#${dispute._id}`,
                        actionLabel: "Review dispute",
                        relatedTask: updatedTask._id,
                    },
                    session,
                );
                workflowEmailIds.push(...adminEmailIds);
            });
        } catch (error) {
            transactionFailureContext = {
                inTransaction: session.inTransaction(),
                hasEnded: session.hasEnded,
            };
            if (error instanceof Error && error.message === "DISPUTE_PROJECT_STATE_CHANGED") {
                return jsonNoStore({ error: "The project changed before the dispute could be opened. Refresh and try again." }, { status: 409 });
            }
            if (error && typeof error === "object" && "code" in error && error.code === 11000) {
                return jsonNoStore({ error: "This project already has an active dispute." }, { status: 409 });
            }
            throw error;
        } finally {
            await session.endSession();
        }

        try {
            operation = "dispatch dispute emails";
            await processWorkflowEmailOutbox(workflowEmailIds.length, workflowEmailIds);
        } catch (error) {
            console.error("Dispute notification could not be prepared.", disputeErrorDetails(error, operation));
        }

        return jsonNoStore({ dispute: createdDispute ? serializeDispute(createdDispute.toObject()) : { id: disputeId } }, { status: 201 });
    } catch (error) {
        console.error("Dispute creation error.", disputeErrorDetails(error, operation, transactionFailureContext));
        return jsonNoStore({ error: "The dispute could not be saved." }, { status: 503 });
    }
}
