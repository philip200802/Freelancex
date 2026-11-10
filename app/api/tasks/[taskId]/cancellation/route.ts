import mongoose from "mongoose";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { connectToDatabase } from "@/lib/mongodb";
import CancellationRequest, { cancellationReasons, type CancellationReason } from "@/models/CancellationRequest";
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

function isActiveProjectStatus(status: string) {
    return ["awaiting_funding", "funded", "in_progress", "submitted", "revision_requested"].includes(status);
}

function validEvidenceLinks(value: unknown): string[] | null {
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.length > 10 || value.some((entry) => typeof entry !== "string")) return null;
    const links = value.map((entry) => entry.trim());
    try {
        if (links.some((link) => {
            const parsed = new URL(link);
            return parsed.protocol !== "https:";
        })) return null;
    } catch {
        return null;
    }
    return links;
}

async function assertCancellationEligible(taskId: string, session: mongoose.ClientSession) {
    const task = await Task.findById(taskId).select("_id employer freelancer title status").session(session).lean();
    if (!task || !task.employer || !task.freelancer || !isActiveProjectStatus(task.status)) {
        throw new Error("CANCELLATION_NOT_ELIGIBLE");
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
    return task;
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
        const requests = await CancellationRequest.find({ task: taskId }).sort({ createdAt: -1 }).lean();
        return jsonNoStore({
            requests: requests.map((request) => ({
                id: request._id.toString(),
                requestedBy: request.requestedBy.toString(),
                requestedTo: request.requestedTo.toString(),
                requesterRole: request.requesterRole,
                reason: request.reason,
                description: request.description,
                evidenceLinks: request.evidenceLinks,
                status: request.status,
                resolvedAt: request.resolvedAt,
                disputedBy: request.disputedBy?.toString(),
                disputedAt: request.disputedAt,
                dispute: request.dispute?.toString(),
                createdAt: request.createdAt,
            })),
        });
    } catch (error) {
        console.error("Project cancellation history error:", { errorName: error instanceof Error ? error.name : "UnknownError" });
        return jsonNoStore({ error: "Cancellation history is temporarily unavailable." }, { status: 503 });
    }
}

export async function POST(request: Request, context: { params: Promise<{ taskId: string }> }) {
    const user = await getCurrentUser();
    if (!user) return jsonNoStore({ error: "Authentication required." }, { status: 401 });
    if (user.role !== "employer" && user.role !== "freelancer") {
        return jsonNoStore({ error: "Only project participants can request cancellation." }, { status: 403 });
    }
    const { taskId } = await context.params;
    if (!mongoose.Types.ObjectId.isValid(taskId)) return jsonNoStore({ error: "Project not found." }, { status: 404 });

    let body: { reason?: unknown; description?: unknown; evidenceLinks?: unknown };
    try {
        body = await request.json() as typeof body;
    } catch {
        return jsonNoStore({ error: "Cancellation request details are invalid." }, { status: 400 });
    }
    const reason = typeof body.reason === "string" ? body.reason : "";
    const description = typeof body.description === "string" ? body.description.trim() : "";
    const evidenceLinks = validEvidenceLinks(body.evidenceLinks);
    if (!cancellationReasons.includes(reason as CancellationReason) || !description || description.length > 5000 || !evidenceLinks) {
        return jsonNoStore({ error: "Choose a valid reason, provide a description of up to 5000 characters, and include only valid HTTPS evidence links." }, { status: 400 });
    }

    try {
        await connectToDatabase();
    } catch (error) {
        console.error("Project cancellation database connection failed:", { errorName: error instanceof Error ? error.name : "UnknownError" });
        return jsonNoStore({ error: "The cancellation request could not be saved." }, { status: 503 });
    }
    const session = await mongoose.startSession();
    let requestId = "";
    let recipientId = "";
    let projectTitle = "";
    try {
        await session.withTransaction(async () => {
            const task = await assertCancellationEligible(taskId, session);
            const isEmployer = user.role === "employer" && task.employer.toString() === user.userId;
            const isFreelancer = user.role === "freelancer" && task.freelancer.toString() === user.userId;
            if (!isEmployer && !isFreelancer) throw new Error("NOT_PROJECT_PARTICIPANT");
            const recipient = isEmployer ? task.freelancer : task.employer;
            const [existing] = await CancellationRequest.find({ task: taskId, status: "pending" }).limit(1).session(session).lean();
            if (existing) throw new Error("CANCELLATION_ALREADY_PENDING");

            const [created] = await CancellationRequest.create([{
                task: task._id,
                requestedBy: user.userId,
                requestedTo: recipient,
                requesterRole: user.role,
                reason,
                description,
                evidenceLinks,
            }], { session });
            requestId = created.id;
            recipientId = recipient.toString();
            projectTitle = task.title;
            await Notification.updateOne(
                { recipient, eventKey: `cancellation:${created._id}:requested` },
                { $setOnInsert: {
                    recipient,
                    recipientRole: isEmployer ? "freelancer" : "employer",
                    actor: user.userId,
                    type: "project_cancellation",
                    title: "Project cancellation requested",
                    body: `A cancellation request was submitted for "${task.title}". Review the reason before deciding.`,
                    relatedTask: task._id,
                    eventKey: `cancellation:${created._id}:requested`,
                    href: isEmployer ? `/freelancer/dashboard/projects/${taskId}` : `/client/dashboard/projects/${taskId}`,
                } },
                { upsert: true, session },
            );
        });
    } catch (error) {
        if (error && typeof error === "object" && "code" in error && error.code === 11000) {
            return jsonNoStore({ error: "A cancellation request is already awaiting a decision." }, { status: 409 });
        }
        if (error instanceof Error && error.message === "NOT_PROJECT_PARTICIPANT") return jsonNoStore({ error: "Only the assigned project participants can request cancellation." }, { status: 403 });
        if (error instanceof Error && error.message === "CANCELLATION_NOT_ELIGIBLE") return jsonNoStore({ error: "This project is not eligible for cancellation." }, { status: 409 });
        if (error instanceof Error && error.message === "ACTIVE_DISPUTE") return jsonNoStore({ error: "Cancellation is unavailable while an active dispute exists." }, { status: 409 });
        if (error instanceof Error && error.message === "FINANCIAL_OPERATION_PENDING") return jsonNoStore({ error: "Cancellation is blocked while a payment or payout operation is pending." }, { status: 409 });
        if (error instanceof Error && error.message === "PENDING_EXTENSION") return jsonNoStore({ error: "Resolve the pending deadline extension before requesting cancellation." }, { status: 409 });
        if (error instanceof Error && error.message === "CANCELLATION_ALREADY_PENDING") return jsonNoStore({ error: "A cancellation request is already awaiting a decision." }, { status: 409 });
        console.error("Project cancellation request error:", { errorName: error instanceof Error ? error.name : "UnknownError" });
        return jsonNoStore({ error: "The cancellation request could not be saved." }, { status: 503 });
    } finally {
        await session.endSession();
    }

    try {
        const [recipient, requester] = await Promise.all([
            User.findById(recipientId).select("name email isVerified").lean(),
            User.findById(user.userId).select("name email isVerified").lean(),
        ]);
        await queueWorkflowEmailsAfterCommit([{
            workflowEvent: "project_cancellation_requested",
            dedupeKey: `cancellation:${requestId}:requested`,
            recipient,
            email: {
                subject: "Cancellation requested for your FreelanceX project",
                heading: "Project cancellation requested",
                message: `${requester?.name || "The other project participant"} requested cancellation of "${projectTitle}". Review the request in your dashboard.`,
                details: [{ label: "Project", value: projectTitle }],
                actionPath: user.role === "employer" ? `/freelancer/dashboard/projects/${taskId}` : `/client/dashboard/projects/${taskId}`,
                actionLabel: "Review cancellation request",
                relatedTask: new mongoose.Types.ObjectId(taskId),
            },
        }]);
    } catch (error) {
        console.error("Cancellation request email could not be queued.", { errorName: error instanceof Error ? error.name : "UnknownError" });
    }
    return jsonNoStore({ request: { id: requestId, status: "pending" } }, { status: 201 });
}
