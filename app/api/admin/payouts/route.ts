import mongoose from "mongoose";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { connectToDatabase } from "@/lib/mongodb";
import { calculateCommission, resolveCommission, toKobo } from "@/lib/commission";
import AdminActivityLog from "@/models/AdminActivityLog";
import BankAccount from "@/models/BankAccount";
import ManualPayout from "@/models/ManualPayout";
import Notification from "@/models/Notification";
import PaymentTransaction from "@/models/PaymentTransaction";
import ProjectSubmission from "@/models/ProjectSubmission";
import Task from "@/models/Task";
import User from "@/models/User";
import { processWorkflowEmailOutbox, queueWorkflowEmail, queueWorkflowEmailToAdmins } from "@/lib/workflow-email";

export const dynamic = "force-dynamic";

function jsonNoStore(body: unknown, init?: ResponseInit) {
    const response = NextResponse.json(body, init);
    response.headers.set("Cache-Control", "no-store");
    return response;
}

function escapeRegex(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

export async function GET(request: Request) {
    const admin = await getCurrentUser();
    if (!admin) return jsonNoStore({ error: "Authentication required." }, { status: 401 });
    if (admin.role !== "admin") return jsonNoStore({ error: "Admin access required." }, { status: 403 });

    let operation = "connect to database";
    try {
        await connectToDatabase();
        const { searchParams } = new URL(request.url);
        const query = (searchParams.get("q") || "").trim().slice(0, 120);
        const page = Number(searchParams.get("page") || "1");
        const limit = Number(searchParams.get("limit") || "20");
        const status = searchParams.get("status") || "all";
        const dateFrom = searchParams.get("dateFrom");
        const dateTo = searchParams.get("dateTo");
        const minAmount = searchParams.get("minAmount") ? Number(searchParams.get("minAmount")) : undefined;
        const maxAmount = searchParams.get("maxAmount") ? Number(searchParams.get("maxAmount")) : undefined;
        if (!Number.isInteger(page) || page < 1 || ![20, 50, 100].includes(limit)) {
            return jsonNoStore({ error: "Page or page size is invalid." }, { status: 400 });
        }
        if (!["all", "pending", "failed", "rejected", "completed"].includes(status)) {
            return jsonNoStore({ error: "Choose a valid payout status filter." }, { status: 400 });
        }
        if ((minAmount !== undefined && (!Number.isFinite(minAmount) || minAmount < 0))
            || (maxAmount !== undefined && (!Number.isFinite(maxAmount) || maxAmount < 0))
            || (minAmount !== undefined && maxAmount !== undefined && minAmount > maxAmount)) {
            return jsonNoStore({ error: "Enter a valid payout amount range." }, { status: 400 });
        }

        const payoutFilter: Record<string, unknown> = {};
        if (status !== "all") payoutFilter.status = status;
        if (dateFrom || dateTo) {
            const dateFilter: Record<string, Date> = {};
            if (dateFrom) {
                const start = new Date(dateFrom);
                if (Number.isNaN(start.getTime())) return jsonNoStore({ error: "Choose a valid start date." }, { status: 400 });
                dateFilter.$gte = start;
            }
            if (dateTo) {
                const end = new Date(dateTo);
                if (Number.isNaN(end.getTime())) return jsonNoStore({ error: "Choose a valid end date." }, { status: 400 });
                end.setHours(23, 59, 59, 999);
                dateFilter.$lte = end;
            }
            payoutFilter.createdAt = dateFilter;
        }
        if (minAmount !== undefined || maxAmount !== undefined) {
            const amountFilter: Record<string, number> = {};
            if (minAmount !== undefined) amountFilter.$gte = Math.round(minAmount * 100);
            if (maxAmount !== undefined) amountFilter.$lte = Math.round(maxAmount * 100);
            payoutFilter.amountKobo = amountFilter;
        }
        if (query) {
            const expression = new RegExp(escapeRegex(query), "i");
            const matchingTasks = await Task.find({ title: expression }).select("_id").limit(1000).lean();
            payoutFilter.$or = [
                { freelancerNameSnapshot: expression },
                { transferReference: expression },
                { bankName: expression },
                { accountName: expression },
                ...(matchingTasks.length ? [{ task: { $in: matchingTasks.map((task) => task._id) } }] : []),
            ];
        }
        operation = "list payout records";
        const [total, payouts, summaryRows] = await Promise.all([
            ManualPayout.countDocuments(payoutFilter),
            ManualPayout.find(payoutFilter)
                .sort({ dueAt: 1, transferredAt: -1, _id: -1 })
                .skip((page - 1) * limit)
                .limit(limit)
                .lean(),
            ManualPayout.aggregate([{
                $group: {
                    _id: null,
                    pendingCount: { $sum: { $cond: [{ $eq: ["$status", "pending"] }, 1, 0] } },
                    overdueCount: { $sum: { $cond: [{ $and: [{ $eq: ["$status", "pending"] }, { $lte: ["$dueAt", new Date()] }] }, 1, 0] } },
                    blockedCount: { $sum: { $cond: [{ $and: [{ $in: ["$status", ["pending", "failed", "rejected"]] }, { $ne: ["$bankAccountStatus", "verified"] }] }, 1, 0] } },
                    failedCount: { $sum: { $cond: [{ $in: ["$status", ["failed", "rejected"]] }, 1, 0] } },
                    completedCount: { $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] } },
                    outstandingKobo: { $sum: { $cond: [{ $in: ["$status", ["pending", "failed", "rejected"]] }, "$amountKobo", 0] } },
                    completedKobo: { $sum: { $cond: [{ $eq: ["$status", "completed"] }, "$amountKobo", 0] } },
                },
            }]),
        ]);
        const payoutSummary = summaryRows[0] || {
            pendingCount: 0,
            overdueCount: 0,
            blockedCount: 0,
            failedCount: 0,
            completedCount: 0,
            outstandingKobo: 0,
            completedKobo: 0,
        };

        operation = "load payout project and verification data";
        const pendingPayouts = await ManualPayout.find({ status: { $in: ["pending", "failed", "rejected"] } })
            .sort({ dueAt: 1, _id: 1 })
            .limit(500)
            .lean();
        const taskIds = [...new Set([...payouts, ...pendingPayouts].map((payout) => payout.task.toString()))]
            .map((id) => new mongoose.Types.ObjectId(id));
        const freelancerIds = [...new Set([...payouts, ...pendingPayouts].map((payout) => payout.freelancer.toString()))]
            .map((id) => new mongoose.Types.ObjectId(id));
        const paymentIds = [...new Set([...payouts, ...pendingPayouts].map((payout) => payout.paymentTransaction.toString()))]
            .map((id) => new mongoose.Types.ObjectId(id));
        const [tasks, banks, payments, submissions] = taskIds.length
            ? await Promise.all([
                Task.find({ _id: { $in: taskIds } }).select("title status amount employer employerNameSnapshot freelancer grossAmountKobo commissionRatePercent commissionAmountKobo freelancerNetAmountKobo").lean(),
                BankAccount.find({ user: { $in: freelancerIds } }).select("user bankName bankCode accountName accountNumberLast4 verificationStatus verifiedAt").lean(),
                PaymentTransaction.find({ _id: { $in: paymentIds }, status: "success", currency: "NGN" }).select("_id task amount amountSubunit verifiedAt").lean(),
                ProjectSubmission.find({ task: { $in: taskIds }, status: "approved" }).select("task freelancer reviewedAt message links attachments").lean(),
            ])
            : [[], [], [], []];
        const payoutUserIds = [...new Set([
            ...freelancerIds.map((id) => id.toString()),
            ...tasks.flatMap((task) => task.employer ? [task.employer.toString()] : []),
        ])].map((id) => new mongoose.Types.ObjectId(id));
        const users = payoutUserIds.length
            ? await User.find({ _id: { $in: payoutUserIds } }).select("name +paystackRecipientCode").lean()
            : [];

        const taskById = new Map(tasks.map((task) => [task._id.toString(), task]));
        const bankByUser = new Map(banks.map((bank) => [bank.user.toString(), bank]));
        const userById = new Map(users.map((user) => [user._id.toString(), user]));
        const paymentById = new Map(payments.map((payment) => [payment._id.toString(), payment]));
        const submissionByTask = new Map(submissions.map((submission) => [submission.task.toString(), submission]));

        const eligibleProjects = pendingPayouts.flatMap((payout) => {
            const task = taskById.get(payout.task.toString());
            const freelancer = userById.get(payout.freelancer.toString());
            const bank = bankByUser.get(payout.freelancer.toString());
            const payment = paymentById.get(payout.paymentTransaction.toString());
            const submission = submissionByTask.get(payout.task.toString());
            if (!task) return [];
            const bankAccountStatus = bank?.verificationStatus === "verified" && bank.verifiedAt && freelancer?.paystackRecipientCode
                ? "verified" as const
                : bank ? "unverified" as const : "missing" as const;
            const blockReason = task.status === "disputed"
                ? "Project is on dispute hold."
                : task.status !== "completed"
                    ? "Project is not currently approved for payout."
                    : bankAccountStatus !== "verified"
                        ? bankAccountStatus === "missing" ? "Freelancer bank account is missing." : "Freelancer bank account is not verified."
                        : !payment ? "Verified project payment is unavailable."
                            : null;
            return [{
                payoutId: payout._id.toString(),
                taskId: task._id.toString(),
                taskTitle: task.title,
                clientName: task.employerNameSnapshot || (task.employer ? userById.get(task.employer.toString())?.name : null) || "Client",
                projectStatus: task.status,
                freelancerName: payout.freelancerNameSnapshot || freelancer?.name || "Former user",
                payoutStatus: payout.status,
                dueAt: payout.dueAt,
                dueStatus: new Date(payout.dueAt).getTime() < Date.now() ? "overdue" : "due_within_24_hours",
                approvedAt: payout.approvedAt,
                grossAmountKobo: payout.grossAmountKobo,
                commissionRatePercent: payout.commissionRatePercent,
                commissionAmountKobo: payout.commissionAmountKobo,
                amountKobo: payout.amountKobo,
                currency: payout.currency,
                bankAccountStatus,
                bankName: bankAccountStatus === "verified" ? bank?.bankName : null,
                accountName: bankAccountStatus === "verified" ? bank?.accountName : null,
                maskedAccountNumber: bankAccountStatus === "verified" && bank?.accountNumberLast4 ? `••••••${bank.accountNumberLast4}` : null,
                paymentVerifiedAt: payment?.verifiedAt || null,
                blockReason,
                failureReason: payout.failureReason || null,
                approvedDeliverables: submission ? {
                    message: submission.message,
                    links: submission.links,
                    attachments: submission.attachments.map((attachment: { fileName: string; url: string; fileType: string; fileSize: number }) => ({
                        fileName: attachment.fileName,
                        url: attachment.url,
                        fileType: attachment.fileType,
                        fileSize: attachment.fileSize,
                    })),
                    reviewedAt: submission.reviewedAt || null,
                } : null,
            }];
        });

        return jsonNoStore({
            payouts: payouts.map((payout) => ({
                id: payout._id.toString(),
                taskId: payout.task.toString(),
                taskTitle: taskById.get(payout.task.toString())?.title || "Project unavailable",
                freelancerName: payout.freelancerNameSnapshot,
                bankName: payout.bankName || null,
                accountName: payout.accountName || null,
                maskedAccountNumber: payout.accountNumberLast4 ? `••••••${payout.accountNumberLast4}` : null,
                grossAmountKobo: payout.grossAmountKobo ?? null,
                commissionRatePercent: payout.commissionRatePercent ?? null,
                commissionAmountKobo: payout.commissionAmountKobo ?? null,
                amountKobo: payout.amountKobo ?? Math.round(payout.amount * 100),
                currency: payout.currency,
                transferReference: payout.transferReference || null,
                transferredAt: payout.transferredAt || null,
                dueAt: payout.dueAt || null,
                approvedAt: payout.approvedAt || null,
                failureReason: payout.failureReason || null,
                receiptUrl: payout.receiptUrl || null,
                adminName: payout.adminNameSnapshot || null,
                status: payout.status || "completed",
            })),
            eligibleProjects,
            summary: payoutSummary,
            pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
        });
    } catch (error) {
        console.error("Admin payout listing failed.", sanitizedDatabaseError(error, operation));
        return jsonNoStore({ error: "Payout records are temporarily unavailable." }, { status: 503 });
    }
}

export async function POST(request: Request) {
    const admin = await getCurrentUser();
    if (!admin) return jsonNoStore({ error: "Authentication required." }, { status: 401 });
    if (admin.role !== "admin") return jsonNoStore({ error: "Admin access required." }, { status: 403 });

    let body: { taskId?: unknown; transferReference?: unknown; receiptUrl?: unknown; transferConfirmed?: unknown; action?: unknown; failureReason?: unknown };
    try {
        body = await request.json() as typeof body;
    } catch {
        return jsonNoStore({ error: "A valid payout record is required." }, { status: 400 });
    }
    const taskId = typeof body.taskId === "string" ? body.taskId : "";
    if (body.action !== undefined && body.action !== "record" && body.action !== "mark_failed") {
        return jsonNoStore({ error: "Choose a valid payout action." }, { status: 400 });
    }
    const action = body.action === "mark_failed" ? "mark_failed" : "record";
    const transferReference = typeof body.transferReference === "string" ? body.transferReference.trim() : "";
    const receiptUrl = typeof body.receiptUrl === "string" ? body.receiptUrl.trim() : "";
    const failureReason = typeof body.failureReason === "string" ? body.failureReason.trim() : "";
    if (!mongoose.Types.ObjectId.isValid(taskId)) return jsonNoStore({ error: "Project not found." }, { status: 404 });
    if (action === "record" && body.transferConfirmed !== true) return jsonNoStore({ error: "Confirm that the manual bank transfer has already been completed." }, { status: 400 });
    if (action === "record" && (!transferReference || transferReference.length > 160)) {
        return jsonNoStore({ error: "Enter a transfer reference of 1 to 160 characters." }, { status: 400 });
    }
    if (action === "mark_failed" && (!failureReason || failureReason.length > 1000)) {
        return jsonNoStore({ error: "Provide a reason of 1 to 1000 characters for the failed or rejected transfer." }, { status: 400 });
    }
    if (receiptUrl) {
        try {
            const parsed = new URL(receiptUrl);
            if (parsed.protocol !== "https:" || !parsed.hostname || parsed.username || parsed.password || receiptUrl.length > 2048) throw new Error("INVALID_RECEIPT_URL");
        } catch {
            return jsonNoStore({ error: "The optional transfer receipt must be a valid HTTPS URL." }, { status: 400 });
        }
    }

    let operation = "connect to database";
    try {
        await connectToDatabase();
        const session = await mongoose.startSession();
        let payoutResult: {
            kind: "completed" | "failed";
            payoutId: string;
            taskId: string;
            taskTitle: string;
            freelancerId: string;
            freelancerName: string;
            grossAmountKobo: number;
            commissionRatePercent: number;
            commissionAmountKobo: number;
            amountKobo: number;
            transferReference?: string;
            transferredAt?: Date;
            failureReason?: string;
        } | undefined;
        const workflowEmailIds: mongoose.Types.ObjectId[] = [];
        try {
            await session.withTransaction(async () => {
                operation = "load admin and payout project";
                const currentAdmin = await User.findOne({ _id: admin.userId, role: "admin", isActive: { $ne: false } })
                    .select("name")
                    .session(session)
                    .lean();
                const task = await Task.findOne({ _id: taskId, status: "completed", freelancer: { $ne: null } })
                    .select("_id title amount employer freelancer status grossAmountKobo commissionRatePercent commissionAmountKobo freelancerNetAmountKobo payoutStatus")
                    .session(session)
                    .lean();
                if (!currentAdmin) throw new Error("ADMIN_UNAUTHORIZED");
                if (!task?.freelancer) throw new Error("PROJECT_NOT_ELIGIBLE");

                operation = "load pending payout, verified payment, freelancer, and bank account";
                const payout = await ManualPayout.findOne({ task: task._id }).session(session).lean();
                const payment = await PaymentTransaction.findOne({ task: task._id, freelancer: task.freelancer, status: "success", currency: "NGN" })
                    .sort({ verifiedAt: -1 })
                    .session(session)
                    .lean();
                const submission = await ProjectSubmission.findOne({ task: task._id, freelancer: task.freelancer, status: "approved" })
                    .select("_id")
                    .session(session)
                    .lean();
                const bank = await BankAccount.findOne({ user: task.freelancer })
                    .select("bankName bankCode accountName accountNumberLast4 verificationStatus verifiedAt")
                    .session(session)
                    .lean();
                const freelancer = await User.findById(task.freelancer).select("name email isVerified +paystackRecipientCode").session(session).lean();
                if (!payout || !payment || !submission || !freelancer || payout.task.toString() !== task._id.toString()) {
                    throw new Error("PROJECT_NOT_ELIGIBLE");
                }
                if (!["pending", "failed"].includes(payout.status)) throw new Error("PAYOUT_ALREADY_RECORDED");

                const projectCommission = resolveCommission(task.amount, {
                    grossAmountKobo: task.grossAmountKobo,
                    commissionRatePercent: task.commissionRatePercent,
                    commissionAmountKobo: task.commissionAmountKobo,
                    freelancerNetAmountKobo: task.freelancerNetAmountKobo,
                });
                const payoutCommission = calculateCommission(payout.grossAmountKobo, payout.commissionRatePercent);
                if (
                    task.grossAmountKobo !== projectCommission.grossAmountKobo ||
                    payment.amountSubunit !== projectCommission.grossAmountKobo ||
                    toKobo(payment.amount) !== projectCommission.grossAmountKobo ||
                    payout.grossAmountKobo !== projectCommission.grossAmountKobo ||
                    payout.commissionAmountKobo !== payoutCommission.commissionAmountKobo ||
                    payout.amountKobo !== payoutCommission.freelancerNetAmountKobo ||
                    payout.amountKobo !== projectCommission.freelancerNetAmountKobo
                ) {
                    throw new Error("PAYOUT_AMOUNT_MISMATCH");
                }

                const operationAt = new Date();
                if (action === "mark_failed") {
                    operation = "mark payout failed";
                    const failed = await ManualPayout.updateOne(
                        { _id: payout._id, status: "pending" },
                        { $set: {
                            status: "failed",
                            failedAt: operationAt,
                            failureReason,
                            admin: admin.userId,
                            adminNameSnapshot: currentAdmin.name,
                        } },
                        { session, runValidators: true },
                    );
                    if (failed.modifiedCount !== 1) throw new Error("PAYOUT_STATE_CHANGED");
                    const failedTask = await Task.updateOne({ _id: task._id, status: "completed" }, { $set: { payoutStatus: "failed" } }, { session });
                    if (failedTask.modifiedCount !== 1) throw new Error("PAYOUT_STATE_CHANGED");
                    await Notification.updateOne(
                        { recipient: task.freelancer, eventKey: `manual-payout:${payout._id}:failed` },
                        { $set: {
                            recipient: task.freelancer,
                            recipientRole: "freelancer",
                            actor: admin.userId,
                            type: "payout_failed",
                            title: "Payout failed or was rejected",
                            body: `The payout for "${task.title}" failed or was rejected. Review the project for next steps.`,
                            relatedTask: task._id,
                            eventKey: `manual-payout:${payout._id}:failed`,
                            href: `/freelancer/dashboard/projects/${task._id}`,
                        } },
                        { upsert: true, session },
                    );
                    await new AdminActivityLog({
                        adminId: admin.userId,
                        adminNameSnapshot: currentAdmin.name,
                        action: "payout.manual_failed",
                        targetUserId: task.freelancer.toString(),
                        targetUserNameSnapshot: freelancer.name,
                        description: `Marked the manual payout for project "${task.title}" as failed or rejected.`,
                        metadata: {
                            taskId: task._id.toString(),
                            payoutId: payout._id.toString(),
                            amountKobo: payout.amountKobo,
                            failureReason,
                        },
                    }).save({ session });
                    const adminEmailIds = await queueWorkflowEmailToAdmins(
                        "manual_payout_failed_admin",
                        `manual-payout:${payout._id}:failed:admin`,
                        {
                            subject: "Manual project payout failed or was rejected",
                            heading: "Payout requires review",
                            message: "An administrator recorded a failed or rejected manual payout. No transfer completion is implied.",
                            details: [
                                { label: "Project", value: task.title },
                                { label: "Freelancer", value: freelancer.name },
                                { label: "Net payout", value: money(payout.amountKobo) },
                                { label: "Failure reason", value: failureReason },
                            ],
                            actionPath: "/admin/dashboard/payouts",
                            actionLabel: "Review payouts",
                            relatedTask: task._id,
                        },
                        session,
                    );
                    workflowEmailIds.push(...adminEmailIds);
                    const freelancerEmailId = await queueWorkflowEmail(
                        "manual_payout_failed",
                        `manual-payout:${payout._id}:failed:freelancer`,
                        freelancer,
                        {
                            subject: "Update about your FreelanceX payout",
                            heading: "Payout failed or was rejected",
                            message: "The attempted manual payout failed or was rejected. Your project is not marked paid; the platform administrator will review next steps.",
                            details: [
                                { label: "Project", value: task.title },
                                { label: "Gross project amount", value: money(payout.grossAmountKobo) },
                                { label: "FreelanceX commission", value: money(payout.commissionAmountKobo) },
                                { label: "Net payout pending", value: money(payout.amountKobo) },
                            ],
                            actionPath: `/freelancer/dashboard/projects/${task._id}`,
                            actionLabel: "View project",
                            relatedTask: task._id,
                        },
                        session,
                    );
                    if (freelancerEmailId) workflowEmailIds.push(freelancerEmailId);
                    payoutResult = {
                        kind: "failed",
                        payoutId: payout._id.toString(),
                        taskId: task._id.toString(),
                        taskTitle: task.title,
                        freelancerId: task.freelancer.toString(),
                        freelancerName: freelancer.name,
                        grossAmountKobo: payout.grossAmountKobo,
                        commissionRatePercent: payout.commissionRatePercent,
                        commissionAmountKobo: payout.commissionAmountKobo,
                        amountKobo: payout.amountKobo,
                        failureReason,
                    };
                    return;
                }

                const bankVerified = bank?.verificationStatus === "verified" && Boolean(bank.verifiedAt && freelancer.paystackRecipientCode);
                if (!bankVerified || !bank) throw new Error(bank ? "BANK_ACCOUNT_UNVERIFIED" : "BANK_ACCOUNT_MISSING");

                operation = "record completed manual transfer";
                const transferredAt = new Date();
                const updatedPayout = await ManualPayout.updateOne(
                    { _id: payout._id, status: { $in: ["pending", "failed"] }, amountKobo: payoutCommission.freelancerNetAmountKobo },
                    { $set: {
                        status: "completed",
                        bankAccountStatus: "verified",
                        bankName: bank.bankName,
                        bankCode: bank.bankCode,
                        accountName: bank.accountName,
                        accountNumberLast4: bank.accountNumberLast4,
                        admin: admin.userId,
                        adminNameSnapshot: currentAdmin.name,
                        transferReference,
                        transferredAt,
                        ...(receiptUrl ? { receiptUrl } : {}),
                    }, $unset: { failureReason: 1, failedAt: 1 } },
                    { session, runValidators: true },
                );
                if (updatedPayout.modifiedCount !== 1) throw new Error("PAYOUT_STATE_CHANGED");
                const updatedTask = await Task.updateOne(
                    { _id: task._id, status: "completed", payoutStatus: { $in: ["pending", "failed"] } },
                    { $set: { payoutStatus: "completed" } },
                    { session },
                );
                if (updatedTask.modifiedCount !== 1) throw new Error("PAYOUT_STATE_CHANGED");

                operation = "create payout completion notification";
                await Notification.updateOne(
                    { recipient: task.freelancer, eventKey: `manual-payout:${payout._id}:recorded` },
                    { $setOnInsert: {
                        recipient: task.freelancer,
                        recipientRole: "freelancer",
                        actor: admin.userId,
                        type: "payout_recorded",
                        title: "Freelancer payout recorded",
                        body: `A manual payout for "${task.title}" was recorded as completed.`,
                        relatedTask: task._id,
                        eventKey: `manual-payout:${payout._id}:recorded`,
                        href: `/freelancer/dashboard/projects/${task._id}`,
                    } },
                    { upsert: true, session },
                );
                await new AdminActivityLog({
                    adminId: admin.userId,
                    adminNameSnapshot: currentAdmin.name,
                    action: "payout.manual_recorded",
                    targetUserId: task.freelancer.toString(),
                    targetUserNameSnapshot: freelancer.name,
                    description: `Recorded a manual net payout for project "${task.title}".`,
                    metadata: {
                        taskId: task._id.toString(),
                        payoutId: payout._id.toString(),
                        grossAmountKobo: payout.grossAmountKobo,
                        commissionAmountKobo: payout.commissionAmountKobo,
                        netAmountKobo: payout.amountKobo,
                        currency: "NGN",
                        transferReference,
                    },
                }).save({ session });
                const payoutEmailId = await queueWorkflowEmail(
                    "manual_payout_recorded",
                    `manual-payout:${payout._id}:completed:freelancer`,
                    freelancer,
                    {
                        subject: "FreelanceX — Your project payout was recorded.",
                        heading: "Project payout recorded",
                        message: "The platform administrator recorded the completed manual transfer. FreelanceX commission was deducted once when your net payout was calculated.",
                        details: [
                            { label: "Project", value: task.title },
                            { label: "Gross project amount", value: money(payout.grossAmountKobo) },
                            { label: `FreelanceX commission (${payout.commissionRatePercent}%)`, value: money(payout.commissionAmountKobo) },
                            { label: "Net amount paid", value: money(payout.amountKobo) },
                            { label: "Payment date", value: transferredAt.toLocaleString("en-NG", { timeZone: "UTC" }) + " UTC" },
                            { label: "Transfer reference", value: transferReference },
                        ],
                        actionPath: `/freelancer/dashboard/projects/${task._id}`,
                        actionLabel: "View project",
                        relatedTask: task._id,
                    },
                    session,
                );
                if (payoutEmailId) workflowEmailIds.push(payoutEmailId);
                const adminEmailIds = await queueWorkflowEmailToAdmins(
                    "manual_payout_completed_admin",
                    `manual-payout:${payout._id}:completed:admin`,
                    {
                        subject: "Manual project payout recorded as completed",
                        heading: "Manual payout completed",
                        message: "An administrator confirmed that the manual bank transfer was completed and recorded its reference. Provider acceptance does not initiate a transfer.",
                        details: [
                            { label: "Project", value: task.title },
                            { label: "Freelancer", value: freelancer.name },
                            { label: "Gross amount", value: money(payout.grossAmountKobo) },
                            { label: "Platform commission", value: money(payout.commissionAmountKobo) },
                            { label: "Freelancer net payout", value: money(payout.amountKobo) },
                            { label: "Admin", value: currentAdmin.name },
                            { label: "Transfer reference", value: transferReference },
                            { label: "Completion date", value: transferredAt.toLocaleString("en-NG", { timeZone: "UTC" }) + " UTC" },
                        ],
                        actionPath: "/admin/dashboard/payouts",
                        actionLabel: "View payout history",
                        relatedTask: task._id,
                    },
                    session,
                );
                workflowEmailIds.push(...adminEmailIds);
                payoutResult = {
                    kind: "completed",
                    payoutId: payout._id.toString(),
                    taskId: task._id.toString(),
                    taskTitle: task.title,
                    freelancerId: task.freelancer.toString(),
                    freelancerName: freelancer.name,
                    grossAmountKobo: payout.grossAmountKobo,
                    commissionRatePercent: payout.commissionRatePercent,
                    commissionAmountKobo: payout.commissionAmountKobo,
                    amountKobo: payout.amountKobo,
                    transferReference,
                    transferredAt,
                };
            });
        } catch (error) {
            if (error instanceof Error && error.message === "ADMIN_UNAUTHORIZED") {
                return jsonNoStore({ error: "Admin access required." }, { status: 403 });
            }
            if (error instanceof Error && error.message === "PROJECT_NOT_ELIGIBLE") {
                return jsonNoStore({ error: "Payout requires an approved, completed project and its verified payment." }, { status: 409 });
            }
            if (error instanceof Error && error.message === "BANK_ACCOUNT_MISSING") {
                return jsonNoStore({ error: "Payout remains pending. The freelancer must add and verify a bank account first." }, { status: 409 });
            }
            if (error instanceof Error && error.message === "BANK_ACCOUNT_UNVERIFIED") {
                return jsonNoStore({ error: "Payout remains pending. The freelancer's bank account is not verified for payout." }, { status: 409 });
            }
            if (error instanceof Error && error.message === "PAYOUT_AMOUNT_MISMATCH") {
                return jsonNoStore({ error: "The saved project, commission, payment, and payout amounts do not match. Contact support before recording this transfer." }, { status: 409 });
            }
            if (error instanceof Error && (error.message === "PAYOUT_ALREADY_RECORDED" || error.message === "PAYOUT_STATE_CHANGED")) {
                return jsonNoStore({ error: "This payout has already been recorded or changed. Refresh the payout dashboard." }, { status: 409 });
            }
            if (error && typeof error === "object" && "code" in error && error.code === 11000) {
                console.error("Manual payout hit a unique database index.", sanitizedDatabaseError(error, operation));
                return jsonNoStore({ error: "A payout has already been recorded for this project or payment." }, { status: 409 });
            }
            console.error("Admin manual payout transaction failed.", sanitizedDatabaseError(error, operation));
            throw error;
        } finally {
            await session.endSession();
        }

        if (!payoutResult) throw new Error("PAYOUT_RESULT_MISSING");
        try {
            await processWorkflowEmailOutbox(workflowEmailIds.length, workflowEmailIds);
        } catch (emailError) {
            console.error("Freelancer payout email could not be prepared after the payout state was saved.", sanitizedDatabaseError(emailError, "prepare freelancer payout email"));
        }
        if (payoutResult.kind === "completed") {
            return jsonNoStore({
                message: "Manual net payout recorded as completed.",
                payout: {
                    id: payoutResult.payoutId,
                    taskId: payoutResult.taskId,
                    status: "completed",
                    grossAmountKobo: payoutResult.grossAmountKobo,
                    commissionAmountKobo: payoutResult.commissionAmountKobo,
                    amountKobo: payoutResult.amountKobo,
                    transferReference: payoutResult.transferReference,
                    transferredAt: payoutResult.transferredAt,
                },
            }, { status: 200 });
        }
        return jsonNoStore({ message: "Payout marked failed. The freelancer has not been marked paid." });
    } catch (error) {
        console.error("Admin manual payout request failed.", sanitizedDatabaseError(error, operation));
        return jsonNoStore({ error: "The manual payout could not be recorded." }, { status: 503 });
    }
}
