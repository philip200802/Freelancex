import mongoose from "mongoose";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { connectToDatabase } from "@/lib/mongodb";
import { resolveCommission, toKobo, type CommissionBreakdown } from "@/lib/commission";
import BankAccount from "@/models/BankAccount";
import ManualPayout, { createPendingManualPayout } from "@/models/ManualPayout";
import Notification from "@/models/Notification";
import PaymentTransaction from "@/models/PaymentTransaction";
import ProjectSubmission from "@/models/ProjectSubmission";
import Task from "@/models/Task";
import User from "@/models/User";
import {
    processWorkflowEmailOutbox,
    queueWorkflowEmail,
    queueWorkflowEmailToAdmins,
} from "@/lib/workflow-email";

export const dynamic = "force-dynamic";

const PAYOUT_TARGET_HOURS = 24;

function jsonNoStore(body: unknown, init?: ResponseInit) {
    const response = NextResponse.json(body, init);
    response.headers.set("Cache-Control", "no-store");
    return response;
}

function money(kobo: number) {
    return new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 2 }).format(kobo / 100);
}

function sanitizedDatabaseError(error: unknown, operation: string) {
    const errorRecord = error && typeof error === "object" ? error as Record<string, unknown> : {};
    const message = error instanceof Error ? error.message : "Unknown database failure";
    return {
        operation,
        errorName: error instanceof Error ? error.name : "UnknownError",
        message: message
            .replace(/mongodb(?:\+srv)?:\/\/[^\s]+/gi, "[redacted-database-uri]")
            .replace(/\b\d{10,}\b/g, "[redacted-number]"),
        ...(typeof errorRecord.code === "number" || typeof errorRecord.code === "string" ? { code: errorRecord.code } : {}),
        ...(typeof errorRecord.codeName === "string" ? { codeName: errorRecord.codeName } : {}),
        ...(errorRecord.keyPattern && typeof errorRecord.keyPattern === "object" ? { keyPattern: errorRecord.keyPattern } : {}),
    };
}

function commissionForProject(
    amount: number,
    taskSnapshot: Partial<CommissionBreakdown>,
    submissionSnapshot: Partial<CommissionBreakdown>,
) {
    const taskHasSnapshot = taskSnapshot.grossAmountKobo !== undefined;
    return resolveCommission(amount, taskHasSnapshot ? taskSnapshot : submissionSnapshot);
}

async function alreadyApprovedResponse(taskId: string, submissionId: string, employerId: string) {
    const [task, submission, payout] = await Promise.all([
        Task.findOne({ _id: taskId, employer: employerId }).select("_id status").lean(),
        ProjectSubmission.findOne({ _id: submissionId, task: taskId, employer: employerId })
            .select("_id status reviewedAt")
            .lean(),
        ManualPayout.findOne({ task: taskId })
            .select("status grossAmountKobo commissionAmountKobo amountKobo dueAt bankAccountStatus")
            .lean(),
    ]);
    if (task?.status !== "completed" || submission?.status !== "approved" || !payout) return null;

    return jsonNoStore({
        message: "Submission was already approved. The existing payout remains unchanged.",
        task: { id: taskId, status: task.status },
        submission: { id: submissionId, status: submission.status, reviewedAt: submission.reviewedAt },
        payout: {
            status: payout.status,
            grossAmountKobo: payout.grossAmountKobo,
            commissionAmountKobo: payout.commissionAmountKobo,
            freelancerNetAmountKobo: payout.amountKobo,
            dueAt: payout.dueAt,
            bankAccountStatus: payout.bankAccountStatus,
        },
    });
}

export async function PATCH(request: Request, context: { params: Promise<{ taskId: string; submissionId: string }> }) {
    const user = await getCurrentUser();
    if (!user) return jsonNoStore({ error: "Authentication required." }, { status: 401 });
    if (user.role !== "employer") return jsonNoStore({ error: "Only employers can review project submissions." }, { status: 403 });

    const { taskId, submissionId } = await context.params;
    if (!mongoose.Types.ObjectId.isValid(taskId) || !mongoose.Types.ObjectId.isValid(submissionId)) {
        return jsonNoStore({ error: "Submission not found." }, { status: 404 });
    }

    let body: { action?: unknown; feedback?: unknown; feedbackLinks?: unknown; revisionDeadline?: unknown };
    try {
        body = await request.json() as typeof body;
    } catch {
        return jsonNoStore({ error: "A valid review action is required." }, { status: 400 });
    }

    if (body.action !== "approve" && body.action !== "request_revision") {
        return jsonNoStore({ error: "Choose whether to approve the submission or request a revision." }, { status: 400 });
    }
    const approved = body.action === "approve";
    const feedback = typeof body.feedback === "string" ? body.feedback.trim() : "";
    let feedbackLinks: string[] = [];
    if (body.feedbackLinks !== undefined) {
        if (!Array.isArray(body.feedbackLinks) || body.feedbackLinks.length > 10 || body.feedbackLinks.some((link) => typeof link !== "string")) {
            return jsonNoStore({ error: "Provide up to ten valid HTTPS revision evidence links." }, { status: 400 });
        }
        feedbackLinks = body.feedbackLinks.map((link) => link.trim());
        try {
            if (feedbackLinks.some((link) => new URL(link).protocol !== "https:")) throw new Error("INVALID_LINK");
        } catch {
            return jsonNoStore({ error: "Provide up to ten valid HTTPS revision evidence links." }, { status: 400 });
        }
    }
    let revisionDeadline: Date | undefined;
    if (body.revisionDeadline !== undefined && body.revisionDeadline !== "") {
        if (typeof body.revisionDeadline !== "string" || !Number.isFinite(Date.parse(body.revisionDeadline))) {
            return jsonNoStore({ error: "Choose a valid revision deadline." }, { status: 400 });
        }
        revisionDeadline = new Date(body.revisionDeadline);
        if (revisionDeadline.getTime() <= Date.now() || revisionDeadline.getTime() > Date.now() + 365 * 24 * 60 * 60 * 1000) {
            return jsonNoStore({ error: "The revision deadline must be within the next year." }, { status: 400 });
        }
    }
    if (!approved && (!feedback || feedback.length > 5000)) {
        return jsonNoStore({ error: "Revision feedback of 1 to 5000 characters is required." }, { status: 400 });
    }
    if (approved && feedback.length > 5000) {
        return jsonNoStore({ error: "Feedback must be 5000 characters or fewer." }, { status: 400 });
    }

    let operation = "connect to database";
    try {
        await connectToDatabase();
        const [task, submission] = await Promise.all([
            Task.findOne({ _id: taskId, employer: user.userId }).select("_id title amount employer freelancer status grossAmountKobo commissionRatePercent commissionAmountKobo freelancerNetAmountKobo").lean(),
            ProjectSubmission.findOne({ _id: submissionId, task: taskId, employer: user.userId }).select("_id freelancer status grossAmountKobo commissionRatePercent commissionAmountKobo freelancerNetAmountKobo").lean(),
        ]);
        if (!task || !submission) return jsonNoStore({ error: "Submission not found." }, { status: 404 });
        if (task.status !== "submitted" || submission.status !== "submitted") {
            if (approved) {
                const previousApproval = await alreadyApprovedResponse(taskId, submissionId, user.userId);
                if (previousApproval) return previousApproval;
            }
            return jsonNoStore({ error: "This submission has already been reviewed or is no longer current." }, { status: 409 });
        }
        if (submission.freelancer.toString() !== task.freelancer?.toString()) {
            return jsonNoStore({ error: "This submission is not from the freelancer assigned to the project." }, { status: 409 });
        }

        const nextStatus = approved ? "completed" : "revision_requested";
        const submissionStatus = approved ? "approved" : "revision_requested";
        const reviewedAt = new Date();
        const dueAt = new Date(reviewedAt.getTime() + PAYOUT_TARGET_HOURS * 60 * 60 * 1000);
        const session = await mongoose.startSession();
        let commission: CommissionBreakdown | undefined;
        let bankAccountStatus: "verified" | "missing" | "unverified" | undefined;
        let freelancerName = "Freelancer";
        let clientName = "Client";
        const workflowEmailIds: mongoose.Types.ObjectId[] = [];
        try {
            await session.withTransaction(async () => {
                operation = "read project and submission";
                const currentTask = await Task.findOne({ _id: taskId, employer: user.userId, status: "submitted" })
                    .select("_id title amount employer freelancer grossAmountKobo commissionRatePercent commissionAmountKobo freelancerNetAmountKobo")
                    .session(session)
                    .lean();
                const currentSubmission = await ProjectSubmission.findOne({ _id: submissionId, task: taskId, employer: user.userId, status: "submitted" })
                    .select("_id freelancer grossAmountKobo commissionRatePercent commissionAmountKobo freelancerNetAmountKobo")
                    .session(session)
                    .lean();
                if (!currentTask || !currentSubmission || currentSubmission.freelancer.toString() !== currentTask.freelancer?.toString()) {
                    throw new Error("REVIEW_STATE_CHANGED");
                }
                if (!approved && await ProjectSubmission.countDocuments({ task: taskId, status: "revision_requested" }).session(session) >= 2) {
                    throw new Error("REVISION_LIMIT_REACHED");
                }

                commission = commissionForProject(
                    currentTask.amount,
                    {
                        grossAmountKobo: currentTask.grossAmountKobo,
                        commissionRatePercent: currentTask.commissionRatePercent,
                        commissionAmountKobo: currentTask.commissionAmountKobo,
                        freelancerNetAmountKobo: currentTask.freelancerNetAmountKobo,
                    },
                    {
                        grossAmountKobo: currentSubmission.grossAmountKobo,
                        commissionRatePercent: currentSubmission.commissionRatePercent,
                        commissionAmountKobo: currentSubmission.commissionAmountKobo,
                        freelancerNetAmountKobo: currentSubmission.freelancerNetAmountKobo,
                    },
                );

                let payment: { _id: mongoose.Types.ObjectId; amount: number; amountSubunit: number; verifiedAt?: Date } | null = null;
                let bank: { bankName: string; bankCode: string; accountName: string; accountNumberLast4: string; verificationStatus: string; verifiedAt?: Date } | null = null;
                let freelancer: { _id: mongoose.Types.ObjectId; name: string; email: string; isVerified: boolean; paystackRecipientCode?: string } | null = null;
                let admins: Array<{ _id: mongoose.Types.ObjectId }> = [];
                if (approved) {
                    operation = "read verified payment and payout eligibility";
                    payment = await PaymentTransaction.findOne({
                            task: currentTask._id,
                            employer: currentTask.employer,
                            freelancer: currentTask.freelancer,
                            status: "success",
                            currency: "NGN",
                            amountSubunit: commission.grossAmountKobo,
                        }).select("_id amount amountSubunit verifiedAt").session(session).lean();
                    bank = await BankAccount.findOne({ user: currentTask.freelancer }).select("bankName bankCode accountName accountNumberLast4 verificationStatus verifiedAt").session(session).lean();
                    freelancer = await User.findById(currentTask.freelancer).select("name email isVerified +paystackRecipientCode").session(session).lean();
                    admins = await User.find({ role: "admin", isActive: { $ne: false } }).select("_id").session(session).lean();
                    if (!payment || toKobo(payment.amount) !== commission.grossAmountKobo || !freelancer) {
                        throw new Error("PAYOUT_PAYMENT_MISSING");
                    }
                    freelancerName = freelancer.name || "Freelancer";
                    bankAccountStatus = bank?.verificationStatus === "verified" && bank.verifiedAt && freelancer.paystackRecipientCode
                        ? "verified"
                        : bank ? "unverified" : "missing";
                }

                operation = "update project status";
                const updatedTask = await Task.findOneAndUpdate(
                    { _id: taskId, employer: user.userId, status: "submitted" },
                    { $set: {
                        status: nextStatus,
                        grossAmountKobo: commission.grossAmountKobo,
                        commissionRatePercent: commission.commissionRatePercent,
                        commissionAmountKobo: commission.commissionAmountKobo,
                        freelancerNetAmountKobo: commission.freelancerNetAmountKobo,
                        ...(approved ? { payoutStatus: "pending" } : {}),
                    } },
                    { returnDocument: "after", session, runValidators: true },
                );
                if (!updatedTask) throw new Error("REVIEW_STATE_CHANGED");

                operation = "update submission status";
                const updatedSubmission = await ProjectSubmission.findOneAndUpdate(
                    { _id: submissionId, task: taskId, employer: user.userId, status: "submitted" },
                    { $set: {
                        status: submissionStatus,
                        ...(approved ? {} : { feedback }),
                        ...(approved ? {} : { feedbackLinks, ...(revisionDeadline ? { revisionDeadline } : {}) }),
                        ...(approved && feedback ? { feedback } : {}),
                        reviewedBy: user.userId,
                        reviewedAt,
                        grossAmountKobo: commission.grossAmountKobo,
                        commissionRatePercent: commission.commissionRatePercent,
                        commissionAmountKobo: commission.commissionAmountKobo,
                        freelancerNetAmountKobo: commission.freelancerNetAmountKobo,
                    } },
                    { returnDocument: "after", session, runValidators: true },
                );
                if (!updatedSubmission) throw new Error("REVIEW_STATE_CHANGED");

                operation = "load client identity";
                const client = await User.findById(currentTask.employer).select("name").session(session).lean();
                clientName = client?.name || "Client";

                if (approved && payment && bankAccountStatus) {
                    operation = "create pending manual payout";
                    const existingPayout = await ManualPayout.findOne({ task: currentTask._id }).session(session).lean();
                    if (existingPayout) throw new Error("PAYOUT_ALREADY_EXISTS");
                    await createPendingManualPayout({
                        task: currentTask._id,
                        paymentTransaction: payment._id,
                        freelancer: currentTask.freelancer,
                        freelancerNameSnapshot: freelancerName,
                        grossAmountKobo: commission.grossAmountKobo,
                        commissionRatePercent: commission.commissionRatePercent,
                        commissionAmountKobo: commission.commissionAmountKobo,
                        amountKobo: commission.freelancerNetAmountKobo,
                        amount: commission.freelancerNetAmountKobo / 100,
                        currency: "NGN",
                        approvedAt: reviewedAt,
                        dueAt,
                        bankAccountStatus,
                        ...(bankAccountStatus === "verified" && bank ? {
                            bankName: bank.bankName,
                            bankCode: bank.bankCode,
                            accountName: bank.accountName,
                            accountNumberLast4: bank.accountNumberLast4,
                        } : {}),
                    }).save({ session });

                    operation = "create payout notifications";
                    const payoutType = bankAccountStatus === "verified" ? "payout_pending" : "payout_blocked";
                    const payoutTitle = bankAccountStatus === "verified" ? "Payout pending" : "Bank account required for payout";
                    const payoutBody = bankAccountStatus === "verified"
                        ? `Your payout for "${currentTask.title}" is pending. Processing is targeted within 24 hours after approval.`
                        : `Your payout for "${currentTask.title}" is pending. Add and verify a bank account before it can be processed.`;
                    await Notification.updateOne(
                        { recipient: currentTask.freelancer, eventKey: `payout:${currentTask._id}:pending` },
                        { $setOnInsert: {
                            recipient: currentTask.freelancer,
                            recipientRole: "freelancer",
                            actor: user.userId,
                            type: payoutType,
                            title: payoutTitle,
                            body: payoutBody,
                            relatedTask: currentTask._id,
                            relatedSubmission: currentSubmission._id,
                            eventKey: `payout:${currentTask._id}:pending`,
                            href: bankAccountStatus === "verified" ? `/freelancer/dashboard/projects/${taskId}` : "/freelancer/dashboard/profile",
                        } },
                        { upsert: true, session },
                    );
                    await Notification.updateOne(
                        { recipient: currentTask.freelancer, eventKey: `submission:${currentSubmission._id}:approved` },
                        { $setOnInsert: {
                            recipient: currentTask.freelancer,
                            recipientRole: "freelancer",
                            actor: user.userId,
                            type: "submission_approved",
                            title: "Submission approved",
                            body: `Your work on "${currentTask.title}" was approved. Your payout is pending manual admin processing.`,
                            relatedTask: currentTask._id,
                            relatedSubmission: currentSubmission._id,
                            eventKey: `submission:${currentSubmission._id}:approved`,
                            href: `/freelancer/dashboard/projects/${taskId}`,
                        } },
                        { upsert: true, session },
                    );
                    for (const admin of admins) {
                        await Notification.updateOne(
                            { recipient: admin._id, eventKey: `task:${taskId}:approved:payout-required` },
                            { $setOnInsert: {
                                recipient: admin._id,
                                recipientRole: "admin",
                                actor: user.userId,
                                type: "project_completed",
                                title: "Project Approved – Freelancer Payout Required",
                                body: `Client approved ${currentTask.title}. Freelancer payout is due within 24 hours.`,
                                relatedTask: currentTask._id,
                                relatedSubmission: currentSubmission._id,
                                eventKey: `task:${taskId}:approved:payout-required`,
                                href: "/admin/dashboard/payouts",
                            } },
                            { upsert: true, session },
                        );
                    }

                    const approvalDetails = [
                        { label: "Project", value: currentTask.title },
                        { label: "Project ID", value: currentTask._id.toString() },
                        { label: "Client", value: clientName },
                        { label: "Freelancer", value: freelancerName },
                        { label: "Project amount", value: money(commission.grossAmountKobo) },
                        { label: `FreelanceX commission (${commission.commissionRatePercent}%)`, value: money(commission.commissionAmountKobo) },
                        { label: "Freelancer net payout", value: money(commission.freelancerNetAmountKobo) },
                        { label: "Payout status", value: "Pending manual processing; no transfer has been initiated" },
                        { label: "Bank verification", value: bankAccountStatus === "verified" ? "Verified" : bankAccountStatus },
                        { label: "Client approval date", value: reviewedAt.toLocaleString("en-NG", { timeZone: "UTC" }) + " UTC" },
                        { label: "Payout deadline", value: dueAt.toLocaleString("en-NG", { timeZone: "UTC" }) + " UTC" },
                    ];
                    const adminEmailIds = await queueWorkflowEmailToAdmins(
                        "project_approved_payout_required",
                        `project-approved-payout:${currentTask._id}:admin`,
                        {
                            subject: "Project Approved – Freelancer Payout Required",
                            heading: "Project Approved – Freelancer Payout Required",
                            message: "The client approved the work. The freelancer is awaiting payout; processing is targeted within 24 hours, but external bank transfer completion is not guaranteed.",
                            details: approvalDetails,
                            actionPath: "/admin/dashboard/payouts",
                            actionLabel: "Review payout",
                            relatedTask: currentTask._id,
                        },
                        session,
                    );
                    workflowEmailIds.push(...adminEmailIds);
                    const freelancerEmailId = await queueWorkflowEmail(
                        "project_approved_payout_pending",
                        `project-approved-payout:${currentTask._id}:freelancer`,
                        freelancer,
                        {
                            subject: "Your project work was approved — payout pending",
                            heading: "Project work approved",
                            message: bankAccountStatus === "verified"
                                ? "Your payout is pending manual admin processing. Processing is targeted within 24 hours after approval; external bank transfer completion is not guaranteed."
                                : "Your payout is pending, but you must add and verify a bank account before it can be processed.",
                            details: approvalDetails,
                            actionPath: bankAccountStatus === "verified" ? `/freelancer/dashboard/projects/${taskId}` : "/freelancer/dashboard/profile",
                            actionLabel: bankAccountStatus === "verified" ? "View project" : "Add or verify bank account",
                            relatedTask: currentTask._id,
                        },
                        session,
                    );
                    if (freelancerEmailId) workflowEmailIds.push(freelancerEmailId);
                } else if (!approved) {
                    operation = "notify freelancer of revision";
                    await Notification.updateOne(
                        { recipient: currentSubmission.freelancer, eventKey: `submission:${submissionId}:revision_requested` },
                        { $setOnInsert: {
                            recipient: currentSubmission.freelancer,
                            recipientRole: "freelancer",
                            actor: user.userId,
                            type: "revision_requested",
                            title: "Revision requested",
                            body: `The employer requested changes to your submission for "${currentTask.title}".${revisionDeadline ? ` Please resubmit by ${revisionDeadline.toLocaleDateString()}.` : ""}`,
                            relatedTask: currentTask._id,
                            relatedSubmission: currentSubmission._id,
                            eventKey: `submission:${submissionId}:revision_requested`,
                            href: `/freelancer/dashboard/projects/${taskId}`,
                        } },
                        { upsert: true, session },
                    );
                    const freelancer = await User.findById(currentSubmission.freelancer)
                        .select("name email isVerified")
                        .session(session)
                        .lean();
                    const revisionEmailId = await queueWorkflowEmail(
                        "project_revision_requested",
                        `submission:${currentSubmission._id}:revision-requested:freelancer`,
                        freelancer,
                        {
                            subject: "Revision requested for your FreelanceX project",
                            heading: "A revision was requested",
                            message: "The client requested a revision. Review the feedback and submit updated work.",
                            details: [
                                { label: "Project", value: currentTask.title },
                                ...(revisionDeadline ? [{ label: "Revision deadline", value: revisionDeadline.toLocaleDateString() }] : []),
                                { label: "Feedback", value: feedback },
                            ],
                            actionPath: `/freelancer/dashboard/projects/${taskId}`,
                            actionLabel: "Review project",
                            relatedTask: currentTask._id,
                        },
                        session,
                    );
                    if (revisionEmailId) workflowEmailIds.push(revisionEmailId);
                    const adminEmailIds = await queueWorkflowEmailToAdmins(
                        "project_revision_requested_admin",
                        `submission:${currentSubmission._id}:revision-requested:admin`,
                        {
                            subject: "Client requested project revisions",
                            heading: "Revision requested",
                            message: "A client reported an issue and requested revised work from the freelancer.",
                            details: [
                                { label: "Project", value: currentTask.title },
                                { label: "Project reference", value: currentTask._id.toString() },
                            ],
                            actionPath: `/admin/dashboard/jobs/${taskId}`,
                            actionLabel: "Review project",
                            relatedTask: currentTask._id,
                        },
                        session,
                    );
                    workflowEmailIds.push(...adminEmailIds);
                }
            });
        } catch (error) {
            if (error instanceof Error && error.message === "REVIEW_STATE_CHANGED") {
                if (approved) {
                    const previousApproval = await alreadyApprovedResponse(taskId, submissionId, user.userId);
                    if (previousApproval) return previousApproval;
                }
                return jsonNoStore({ error: "This submission was reviewed by another request. Refresh the project to see its current status." }, { status: 409 });
            }
            if (error instanceof Error && error.message === "REVISION_LIMIT_REACHED") {
                return jsonNoStore({ error: "The included two revision rounds have been used. Agree on any additional work before continuing." }, { status: 409 });
            }
            if (error instanceof Error && error.message === "PAYOUT_PAYMENT_MISSING") {
                return jsonNoStore({ error: "The project has no matching verified Paystack payment, so it cannot be approved for payout." }, { status: 409 });
            }
            if (error instanceof Error && error.message === "COMMISSION_SNAPSHOT_INVALID") {
                return jsonNoStore({ error: "The project's saved commission details are inconsistent. Contact support before approving this submission." }, { status: 409 });
            }
            if (error instanceof Error && error.message === "PAYOUT_ALREADY_EXISTS") {
                return jsonNoStore({ error: "A payout record already exists for this project. Refresh the payout dashboard." }, { status: 409 });
            }
            if (error && typeof error === "object" && "code" in error && error.code === 11000) {
                if (approved) {
                    const previousApproval = await alreadyApprovedResponse(taskId, submissionId, user.userId);
                    if (previousApproval) return previousApproval;
                }
                console.error("Project approval encountered a duplicate payout or notification index.", sanitizedDatabaseError(error, operation));
                return jsonNoStore({ error: "This project already has a payout or approval notification. Refresh the project." }, { status: 409 });
            }
            console.error("Project approval transaction failed.", sanitizedDatabaseError(error, operation));
            throw error;
        } finally {
            await session.endSession();
        }

        try {
            await processWorkflowEmailOutbox(workflowEmailIds.length, workflowEmailIds);
        } catch (emailError) {
            console.error("Project review email dispatch failed after the status was saved.", sanitizedDatabaseError(emailError, "dispatch review emails"));
        }

        return jsonNoStore({
            message: approved
                ? "Submission approved and project completed. Freelancer payout is pending manual processing."
                : "Revision request sent to the freelancer.",
            task: { id: taskId, status: nextStatus },
            submission: { id: submissionId, status: submissionStatus, feedback: feedback || undefined, feedbackLinks, revisionDeadline, reviewedAt },
            ...(approved && commission ? {
                payout: {
                    status: "pending",
                    grossAmountKobo: commission.grossAmountKobo,
                    commissionAmountKobo: commission.commissionAmountKobo,
                    freelancerNetAmountKobo: commission.freelancerNetAmountKobo,
                    dueAt,
                    bankAccountStatus,
                },
            } : {}),
        });
    } catch (error) {
        console.error("Project submission review failed.", sanitizedDatabaseError(error, operation));
        return jsonNoStore({ error: "The submission review could not be saved." }, { status: 503 });
    }
}
