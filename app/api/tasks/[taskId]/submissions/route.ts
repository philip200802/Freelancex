import mongoose from "mongoose";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { connectToDatabase } from "@/lib/mongodb";
import { deleteProjectDeliverable, uploadProjectDeliverable, validateProjectDeliverable, type UploadedProjectDeliverable } from "@/lib/cloudinary";
import Notification from "@/models/Notification";
import BankAccount from "@/models/BankAccount";
import ProjectSubmission from "@/models/ProjectSubmission";
import Task from "@/models/Task";
import UserPreference from "@/models/UserPreference";
import User from "@/models/User";
import {
    processWorkflowEmailOutbox,
    queueWorkflowEmail,
    queueWorkflowEmailToAdmins,
} from "@/lib/workflow-email";
import { resolveCommission } from "@/lib/commission";

export const dynamic = "force-dynamic";

function jsonNoStore(body: unknown, init?: ResponseInit) {
    const response = NextResponse.json(body, init);
    response.headers.set("Cache-Control", "no-store");
    return response;
}

function publicSubmission(submission: {
    _id: mongoose.Types.ObjectId;
    submissionNumber: number;
    message: string;
    attachments: UploadedProjectDeliverable[];
    links: string[];
    status: string;
    feedback?: string;
    reviewedAt?: Date;
    submittedAt: Date;
    createdAt: Date;
}) {
    return {
        id: submission._id.toString(),
        submissionNumber: submission.submissionNumber,
        message: submission.message,
        attachments: submission.attachments.map(({ fileName, url, fileType, fileSize }) => ({ fileName, url, fileType, fileSize })),
        links: submission.links,
        status: submission.status,
        feedback: submission.feedback,
        reviewedAt: submission.reviewedAt,
        submittedAt: submission.submittedAt,
        createdAt: submission.createdAt,
    };
}

function validateLinks(value: unknown): string[] | null {
    if (!Array.isArray(value) || value.length > 10 || !value.every((link) => typeof link === "string")) return null;
    const links: string[] = [];
    for (const rawLink of value) {
        const link = rawLink.trim();
        if (!link || link.length > 2048) return null;
        try {
            const url = new URL(link);
            if (url.protocol !== "https:" || !url.hostname || url.username || url.password) return null;
            links.push(url.toString());
        } catch {
            return null;
        }
    }
    return links;
}

function mongoErrorCode(error: unknown) {
    if (!error || typeof error !== "object" || !("code" in error)) return undefined;
    return typeof error.code === "number" ? error.code : undefined;
}

function validationErrorDetails(error: unknown) {
    if (!(error instanceof mongoose.Error.ValidationError)) return null;
    return {
        message: error.message,
        fields: Object.entries(error.errors).map(([path, fieldError]) => ({
            path,
            message: fieldError.message,
            expectedSchemaType: "instance" in fieldError ? fieldError.instance : undefined,
            actualValueType: "value" in fieldError
                ? fieldError.value === null ? "null" : Array.isArray(fieldError.value) ? "array" : typeof fieldError.value
                : "unknown",
        })),
    };
}

async function cleanupUploadedFiles(files: UploadedProjectDeliverable[]) {
    const results = await Promise.allSettled(files.map((file) => deleteProjectDeliverable(file.publicId, file.resourceType)));
    for (const result of results) {
        if (result.status === "rejected") {
            console.error("Project deliverable cleanup failed", { errorName: result.reason instanceof Error ? result.reason.name : "UnknownError" });
        }
    }
}

export async function GET(_request: Request, context: { params: Promise<{ taskId: string }> }) {
    const user = await getCurrentUser();
    if (!user) return jsonNoStore({ error: "Authentication required." }, { status: 401 });

    const { taskId } = await context.params;
    if (!mongoose.Types.ObjectId.isValid(taskId)) return jsonNoStore({ error: "Project not found." }, { status: 404 });

    try {
        await connectToDatabase();
        const task = await Task.findById(taskId)
            .select("employer freelancer amount grossAmountKobo commissionRatePercent commissionAmountKobo freelancerNetAmountKobo")
            .lean();
        if (!task) return jsonNoStore({ error: "Project not found." }, { status: 404 });
        const isFreelancer = user.role === "freelancer" && task.freelancer?.toString() === user.userId;
        const isEmployer = user.role === "employer" && task.employer?.toString() === user.userId;
        if (!isFreelancer && !isEmployer && user.role !== "admin") return jsonNoStore({ error: "Project not found." }, { status: 404 });

        const submissions = await ProjectSubmission.find({ task: taskId })
            .sort({ submissionNumber: 1 })
            .lean();
        let payoutBreakdown: ReturnType<typeof resolveCommission> | undefined;
        let bankAccountVerified: boolean | undefined;
        if (user.role === "freelancer" && isFreelancer) {
            payoutBreakdown = resolveCommission(task.amount, {
                grossAmountKobo: task.grossAmountKobo,
                commissionRatePercent: task.commissionRatePercent,
                commissionAmountKobo: task.commissionAmountKobo,
                freelancerNetAmountKobo: task.freelancerNetAmountKobo,
            });
            const [bank, freelancer] = await Promise.all([
                BankAccount.findOne({ user: user.userId }).select("verificationStatus verifiedAt").lean(),
                User.findById(user.userId).select("+paystackRecipientCode").lean(),
            ]);
            bankAccountVerified = bank?.verificationStatus === "verified" && Boolean(bank.verifiedAt && freelancer?.paystackRecipientCode);
        }
        return jsonNoStore({
            submissions: submissions.map((submission) => publicSubmission(submission)),
            ...(payoutBreakdown ? {
                payoutBreakdown,
                bankAccountVerified,
            } : {}),
        });
    } catch (error) {
        console.error("Project submission listing error:", error);
        return jsonNoStore({ error: "Submission history is temporarily unavailable." }, { status: 503 });
    }
}

export async function POST(request: Request, context: { params: Promise<{ taskId: string }> }) {
    const user = await getCurrentUser();
    if (!user) return jsonNoStore({ error: "Authentication required." }, { status: 401 });
    if (user.role !== "freelancer") return jsonNoStore({ error: "Only freelancers can submit project work." }, { status: 403 });

    const { taskId } = await context.params;
    if (!mongoose.Types.ObjectId.isValid(taskId)) return jsonNoStore({ error: "Project not found." }, { status: 404 });
    const contentLength = Number(request.headers.get("content-length") || 0);
    if (contentLength > 55 * 1024 * 1024) return jsonNoStore({ error: "The submission is too large. Reduce the attachment size and try again." }, { status: 413 });

    let message: string;
    let links: string[];
    let files: File[];
    let commissionAcknowledged = false;
    try {
        if (request.headers.get("content-type")?.includes("multipart/form-data")) {
            const formData = await request.formData();
            message = String(formData.get("message") || "").trim();
            commissionAcknowledged = formData.get("commissionAcknowledged") === "true";
            const rawLinks = formData.get("links");
            let parsedLinks: unknown = [];
            if (typeof rawLinks === "string" && rawLinks) parsedLinks = JSON.parse(rawLinks);
            const validatedLinks = validateLinks(parsedLinks);
            if (!validatedLinks) return jsonNoStore({ error: "Provide up to ten valid HTTPS links." }, { status: 400 });
            links = validatedLinks;
            files = formData.getAll("files").filter((entry): entry is File => entry instanceof File && entry.size > 0);
        } else {
            const body = await request.json() as { message?: unknown; links?: unknown; commissionAcknowledged?: unknown };
            message = typeof body.message === "string" ? body.message.trim() : "";
            commissionAcknowledged = body.commissionAcknowledged === true;
            const validatedLinks = validateLinks(body.links ?? []);
            if (!validatedLinks) return jsonNoStore({ error: "Provide up to ten valid HTTPS links." }, { status: 400 });
            links = validatedLinks;
            files = [];
        }
    } catch {
        return jsonNoStore({ error: "Submission details are invalid." }, { status: 400 });
    }

    if (!message || message.length > 5000) return jsonNoStore({ error: "A submission message of 1 to 5000 characters is required." }, { status: 400 });
    if (!commissionAcknowledged) return jsonNoStore({ error: "Acknowledge the commission and payout terms before submitting work." }, { status: 400 });
    if (files.length > 5) return jsonNoStore({ error: "A submission can include at most five attachments." }, { status: 400 });
    for (const file of files) {
        const validationError = await validateProjectDeliverable(file);
        if (validationError) return jsonNoStore({ error: validationError }, { status: 400 });
    }

    const uploadedFiles: UploadedProjectDeliverable[] = [];
    let failureStage: "database" | "upload" | "transaction" = "database";
    let transactionOperation = "starting";
    try {
        await connectToDatabase();
        const task = await Task.findOne({ _id: taskId, freelancer: user.userId })
            .select("title amount employer freelancer freelancerNameSnapshot status grossAmountKobo commissionRatePercent commissionAmountKobo freelancerNetAmountKobo")
            .lean();
        if (!task) return jsonNoStore({ error: "Project not found." }, { status: 404 });
        if (!task.employer) return jsonNoStore({ error: "This project has no employer available to review a submission." }, { status: 409 });
        const commission = resolveCommission(task.amount, {
            grossAmountKobo: task.grossAmountKobo,
            commissionRatePercent: task.commissionRatePercent,
            commissionAmountKobo: task.commissionAmountKobo,
            freelancerNetAmountKobo: task.freelancerNetAmountKobo,
        });
        const freelancerName = task.freelancerNameSnapshot
            || (await User.findById(user.userId).select("name").lean())?.name
            || "Freelancer";

        if (task.status === "revision_requested") {
            const latestSubmission = await ProjectSubmission.findOne({ task: taskId }).sort({ submissionNumber: -1 }).select("status").lean();
            if (latestSubmission?.status !== "revision_requested") {
                return jsonNoStore({ error: "This project is not ready for a revised submission." }, { status: 409 });
            }
        } else if (!["funded", "in_progress"].includes(task.status)) {
            return jsonNoStore({ error: "Work can only be submitted while the project is in progress." }, { status: 409 });
        }

        failureStage = "upload";
        for (const file of files) uploadedFiles.push(await uploadProjectDeliverable(taskId, file));

        failureStage = "transaction";
        const session = await mongoose.startSession();
        let submissionId = "";
        let submissionNumber = 0;
        const workflowEmailIds: mongoose.Types.ObjectId[] = [];
        const submittedAt = new Date();
        try {
            await session.withTransaction(async () => {
                transactionOperation = "Task.findOneAndUpdate";
                const updatedTask = await Task.findOneAndUpdate(
                    { _id: taskId, freelancer: user.userId, status: task.status },
                    { $set: {
                        status: "submitted",
                        grossAmountKobo: commission.grossAmountKobo,
                        commissionRatePercent: commission.commissionRatePercent,
                        commissionAmountKobo: commission.commissionAmountKobo,
                        freelancerNetAmountKobo: commission.freelancerNetAmountKobo,
                    } },
                    { returnDocument: "after", session },
                );
                if (!updatedTask) throw new Error("PROJECT_STATE_CHANGED");

                transactionOperation = "ProjectSubmission.countDocuments";
                submissionNumber = await ProjectSubmission.countDocuments({ task: taskId }).session(session) + 1;
                transactionOperation = "ProjectSubmission.create";
                const [submission] = await ProjectSubmission.create([{
                    task: taskId,
                    freelancer: user.userId,
                    employer: task.employer,
                    submissionNumber,
                    message,
                    attachments: uploadedFiles,
                    links,
                    status: "submitted",
                    submittedAt,
                    commissionAcknowledged: true,
                    commissionAcknowledgedAt: submittedAt,
                    grossAmountKobo: commission.grossAmountKobo,
                    commissionRatePercent: commission.commissionRatePercent,
                    commissionAmountKobo: commission.commissionAmountKobo,
                    freelancerNetAmountKobo: commission.freelancerNetAmountKobo,
                }], { session });
                submissionId = submission.id;

                transactionOperation = "UserPreference.findOne";
                const preference = await UserPreference.findOne({ user: task.employer }).select("inAppNotifications").session(session).lean();
                if (preference?.inAppNotifications !== false) {
                    transactionOperation = "Notification.create";
                    await Notification.create([{
                        recipient: task.employer,
                        recipientRole: "employer",
                        actor: user.userId,
                        type: "submission",
                        title: "Work submitted for review",
                        body: `${freelancerName} has submitted work for "${task.title}". Review the submission.`,
                        relatedTask: taskId,
                        relatedSubmission: submission._id,
                        eventKey: `submission:${submission._id}:submitted:client`,
                        href: `/client/dashboard/projects/${taskId}`,
                    }], { session });
                }

                transactionOperation = "queue client submission email";
                const client = await User.findById(updatedTask.employer)
                    .select("name email isVerified")
                    .session(session)
                    .lean();
                const clientSubmissionEmailId = await queueWorkflowEmail(
                    "project_submitted_client",
                    `project-submitted:${submission._id}:client`,
                    client,
                    {
                        subject: "FreelanceX – Your Freelancer Has Submitted Work",
                        heading: "Your freelancer submitted work",
                        message: `${freelancerName} has completed and submitted work for your project. Review the submitted deliverables in your dashboard.`,
                        details: [
                            { label: "Client", value: client?.name || "Client" },
                            { label: "Project", value: task.title },
                            { label: "Freelancer", value: freelancerName },
                            { label: "Submission date", value: submittedAt.toLocaleString("en-GB", { timeZone: "UTC", dateStyle: "medium", timeStyle: "short" }) + " UTC" },
                        ],
                        actionPath: `/client/dashboard/projects/${taskId}`,
                        actionLabel: "Review submitted work",
                    },
                    session,
                ) || undefined;
                if (clientSubmissionEmailId) workflowEmailIds.push(clientSubmissionEmailId);

                const admins = await User.find({ role: "admin", isActive: { $ne: false } }).select("_id").session(session).lean();
                if (admins.length) {
                    await Notification.create(admins.map((admin) => ({
                        recipient: admin._id,
                        recipientRole: "admin" as const,
                        actor: user.userId,
                        type: "admin_submission" as const,
                        title: "Project submitted for review",
                        body: `A freelancer has submitted work for ${task.title}. Prepare for payout processing.`,
                        relatedTask: taskId,
                        relatedSubmission: submission._id,
                        eventKey: `submission:${submission._id}:submitted:admin`,
                        href: `/admin/dashboard/jobs/${taskId}`,
                    })), { session, ordered: true });
                }
                const adminEmailIds = await queueWorkflowEmailToAdmins(
                    "project_submitted_admin",
                    `project-submitted:${submission._id}:admin`,
                    {
                        subject: "Freelancer submission received",
                        heading: "Project work submitted",
                        message: "The freelancer submitted work for client review. Payout preparation may begin after the client approves it.",
                        details: [
                            { label: "Freelancer", value: freelancerName },
                            { label: "Project", value: task.title },
                            { label: "Project reference", value: taskId },
                            { label: "Submission date", value: submittedAt.toLocaleString("en-GB", { timeZone: "UTC", dateStyle: "medium", timeStyle: "short" }) + " UTC" },
                        ],
                        actionPath: `/admin/dashboard/jobs/${taskId}`,
                        actionLabel: "Review project",
                        relatedTask: submission.task,
                    },
                    session,
                );
                workflowEmailIds.push(...adminEmailIds);
            });
        } finally {
            await session.endSession();
        }

        if (workflowEmailIds.length) {
            try {
                await processWorkflowEmailOutbox(workflowEmailIds.length, workflowEmailIds);
            } catch (emailError) {
                console.error("Client submission email dispatch failed after the submission was saved.", {
                    errorName: emailError instanceof Error ? emailError.name : "UnknownError",
                    submissionId,
                });
            }
        }

        return jsonNoStore({
            message: "Your work was submitted for employer review.",
            task: { id: taskId, status: "submitted" },
            submission: {
                id: submissionId,
                submissionNumber,
                message,
                attachments: uploadedFiles.map(({ fileName, url, fileType, fileSize }) => ({ fileName, url, fileType, fileSize })),
                links,
                status: "submitted",
                submittedAt,
            },
        }, { status: 201 });
    } catch (error) {
        await cleanupUploadedFiles(uploadedFiles);
        if (error instanceof Error && error.message === "PROJECT_STATE_CHANGED") {
            return jsonNoStore({ error: "The project changed while you were submitting. Refresh the project and try again." }, { status: 409 });
        }
        const code = mongoErrorCode(error);
        if (code === 11000) {
            return jsonNoStore({ error: "A submission is already pending review. Refresh the project to see its current status." }, { status: 409 });
        }
        const validationDetails = validationErrorDetails(error);
        console.error("Project submission creation failed.", {
            stage: failureStage,
            operation: transactionOperation,
            model: failureStage === "transaction"
                ? transactionOperation.startsWith("Task.") ? "Task"
                    : transactionOperation.startsWith("ProjectSubmission.") ? "ProjectSubmission"
                        : transactionOperation.startsWith("Notification.") ? "Notification"
                            : transactionOperation.startsWith("UserPreference.") ? "UserPreference"
                                : "unknown"
                : "unknown",
            errorName: error instanceof Error ? error.name : "UnknownError",
            ...(code !== undefined ? { code } : {}),
            ...(validationDetails ? { validation: validationDetails } : {}),
        });
        if (error instanceof mongoose.Error.ValidationError) {
            return jsonNoStore({ error: "The submission could not be saved because its data failed validation. Please contact support." }, { status: 500 });
        }
        if (failureStage === "upload") {
            return jsonNoStore({ error: "One or more deliverables could not be uploaded. Check your connection and try again." }, { status: 503 });
        }
        if (failureStage === "transaction" && (code === 20 || code === 251)) {
            return jsonNoStore({ error: "Submission storage is temporarily unavailable. Please try again later." }, { status: 503 });
        }
        return jsonNoStore({ error: "The submission could not be saved. Please try again." }, { status: 500 });
    }
}
