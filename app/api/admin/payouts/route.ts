import mongoose from "mongoose";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { connectToDatabase } from "@/lib/mongodb";
import AdminActivityLog from "@/models/AdminActivityLog";
import BankAccount from "@/models/BankAccount";
import ManualPayout from "@/models/ManualPayout";
import Notification from "@/models/Notification";
import PaymentTransaction from "@/models/PaymentTransaction";
import ProjectSubmission from "@/models/ProjectSubmission";
import Task from "@/models/Task";
import User from "@/models/User";
import { sendWorkflowEmailSafely } from "@/lib/workflow-email";

export const dynamic = "force-dynamic";

function jsonNoStore(body: unknown, init?: ResponseInit) {
    const response = NextResponse.json(body, init);
    response.headers.set("Cache-Control", "no-store");
    return response;
}

function escapeRegex(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function GET(request: Request) {
    const admin = await getCurrentUser();
    if (!admin) return jsonNoStore({ error: "Authentication required." }, { status: 401 });
    if (admin.role !== "admin") return jsonNoStore({ error: "Admin access required." }, { status: 403 });

    try {
        await connectToDatabase();
        const { searchParams } = new URL(request.url);
        const query = (searchParams.get("q") || "").trim().slice(0, 120);
        const page = Number(searchParams.get("page") || "1");
        const limit = Number(searchParams.get("limit") || "20");
        if (!Number.isInteger(page) || page < 1 || ![20, 50, 100].includes(limit)) {
            return jsonNoStore({ error: "Page or page size is invalid." }, { status: 400 });
        }

        const payoutFilter: Record<string, unknown> = {};
        if (query) {
            const expression = new RegExp(escapeRegex(query), "i");
            payoutFilter.$or = [
                { freelancerNameSnapshot: expression },
                { transferReference: expression },
                { bankName: expression },
                { accountName: expression },
            ];
        }
        const [total, payouts] = await Promise.all([
            ManualPayout.countDocuments(payoutFilter),
            ManualPayout.find(payoutFilter)
                .sort({ transferredAt: -1, _id: -1 })
                .skip((page - 1) * limit)
                .limit(limit)
                .lean(),
        ]);

        const completedTasks = await Task.find({ status: "completed", freelancer: { $ne: null } })
            .select("title amount freelancer employer")
            .sort({ updatedAt: -1, _id: -1 })
            .limit(500)
            .lean();
        const completedTaskIds = completedTasks.map((task) => task._id);
        const [payments, approvedSubmissions, verifiedBankAccounts, existingPayouts, admins] = completedTaskIds.length
            ? await Promise.all([
                PaymentTransaction.find({ task: { $in: completedTaskIds }, status: "success" })
                    .select("task amount amountSubunit currency status verifiedAt")
                    .sort({ verifiedAt: -1 })
                    .lean(),
                ProjectSubmission.find({ task: { $in: completedTaskIds }, status: "approved" })
                    .select("task freelancer reviewedAt message links attachments")
                    .lean(),
                BankAccount.find({ user: { $in: completedTasks.map((task) => task.freelancer) }, verificationStatus: "verified", verifiedAt: { $exists: true } })
                    .select("user bankName bankCode accountName accountNumberLast4 verificationStatus")
                    .lean(),
                ManualPayout.find({ task: { $in: completedTaskIds } }).select("task").lean(),
                User.find({ _id: { $in: completedTasks.map((task) => task.freelancer) } }).select("name").lean(),
            ])
            : [[], [], [], [], []];

        const paymentByTask = new Map<string, typeof payments[number]>();
        for (const payment of payments) {
            if (!paymentByTask.has(payment.task.toString())) paymentByTask.set(payment.task.toString(), payment);
        }
        const approvedSubmissionsByAssignment = new Set(
            approvedSubmissions.map((submission) => `${submission.task.toString()}:${submission.freelancer.toString()}`),
        );
        const approvedSubmissionByAssignment = new Map(
            approvedSubmissions.map((submission) => [`${submission.task.toString()}:${submission.freelancer.toString()}`, submission]),
        );
        const bankByUser = new Map(verifiedBankAccounts.map((bank) => [bank.user.toString(), bank]));
        const paidTaskIds = new Set(existingPayouts.map((payout) => payout.task.toString()));
        const nameByUser = new Map(admins.map((user) => [user._id.toString(), user.name]));
        const eligibleProjects = completedTasks.flatMap((task) => {
            const taskId = task._id.toString();
            const payment = paymentByTask.get(taskId);
            const bank = task.freelancer ? bankByUser.get(task.freelancer.toString()) : undefined;
            const approvedSubmission = task.freelancer ? approvedSubmissionByAssignment.get(`${taskId}:${task.freelancer.toString()}`) : undefined;
            if (
                !task.freelancer ||
                !payment ||
                payment.currency !== "NGN" ||
                payment.amount !== task.amount ||
                payment.amountSubunit !== Math.round(task.amount * 100) ||
                !approvedSubmissionsByAssignment.has(`${taskId}:${task.freelancer.toString()}`) ||
                !approvedSubmission ||
                !bank ||
                paidTaskIds.has(taskId)
            ) return [];
            return [{
                taskId,
                taskTitle: task.title,
                freelancerName: nameByUser.get(task.freelancer.toString()) || "Former user",
                amount: task.amount,
                currency: "NGN",
                bankName: bank.bankName,
                bankCode: bank.bankCode,
                accountName: bank.accountName,
                maskedAccountNumber: `••••••${bank.accountNumberLast4}`,
                paymentVerifiedAt: payment.verifiedAt || null,
                approvedDeliverables: {
                    message: approvedSubmission.message,
                    links: approvedSubmission.links,
                    attachments: approvedSubmission.attachments.map((attachment: { fileName: string; url: string; fileType: string; fileSize: number }) => ({
                        fileName: attachment.fileName,
                        url: attachment.url,
                        fileType: attachment.fileType,
                        fileSize: attachment.fileSize,
                    })),
                    reviewedAt: approvedSubmission.reviewedAt || null,
                },
            }];
        });

        return jsonNoStore({
            payouts: payouts.map((payout) => ({
                id: payout._id.toString(),
                taskId: payout.task.toString(),
                paymentTransactionId: payout.paymentTransaction.toString(),
                freelancerName: payout.freelancerNameSnapshot,
                bankName: payout.bankName,
                accountName: payout.accountName,
                maskedAccountNumber: `••••••${payout.accountNumberLast4}`,
                amount: payout.amount,
                currency: payout.currency,
                transferReference: payout.transferReference,
                transferredAt: payout.transferredAt,
                receiptUrl: payout.receiptUrl || null,
                adminName: payout.adminNameSnapshot,
                status: payout.status,
            })),
            eligibleProjects,
            pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
        });
    } catch (error) {
        console.error("Admin payout listing error:", { errorName: error instanceof Error ? error.name : "UnknownError" });
        return jsonNoStore({ error: "Payout records are temporarily unavailable." }, { status: 503 });
    }
}

export async function POST(request: Request) {
    const admin = await getCurrentUser();
    if (!admin) return jsonNoStore({ error: "Authentication required." }, { status: 401 });
    if (admin.role !== "admin") return jsonNoStore({ error: "Admin access required." }, { status: 403 });

    let body: { taskId?: unknown; transferReference?: unknown; receiptUrl?: unknown; transferConfirmed?: unknown };
    try {
        body = await request.json() as typeof body;
    } catch {
        return jsonNoStore({ error: "A valid payout record is required." }, { status: 400 });
    }
    const taskId = typeof body.taskId === "string" ? body.taskId : "";
    const transferReference = typeof body.transferReference === "string" ? body.transferReference.trim() : "";
    const receiptUrl = typeof body.receiptUrl === "string" ? body.receiptUrl.trim() : "";
    if (!mongoose.Types.ObjectId.isValid(taskId)) return jsonNoStore({ error: "Project not found." }, { status: 404 });
    if (body.transferConfirmed !== true) return jsonNoStore({ error: "Confirm that the manual bank transfer has already been completed." }, { status: 400 });
    if (!transferReference || transferReference.length > 160) return jsonNoStore({ error: "Enter a transfer reference of 1 to 160 characters." }, { status: 400 });
    if (receiptUrl) {
        try {
            const parsed = new URL(receiptUrl);
            if (parsed.protocol !== "https:" || !parsed.hostname || parsed.username || parsed.password || receiptUrl.length > 2048) throw new Error("INVALID_RECEIPT_URL");
        } catch {
            return jsonNoStore({ error: "The optional transfer receipt must be a valid HTTPS URL." }, { status: 400 });
        }
    }

    try {
        await connectToDatabase();
        const session = await mongoose.startSession();
        let payout: Record<string, unknown> | undefined;
        try {
            await session.withTransaction(async () => {
                const [currentAdmin, task] = await Promise.all([
                    User.findOne({ _id: admin.userId, role: "admin", isActive: { $ne: false } }).select("name").session(session).lean(),
                    Task.findOne({ _id: taskId, status: "completed", freelancer: { $ne: null } })
                        .select("title amount freelancer")
                        .session(session)
                        .lean(),
                ]);
                if (!currentAdmin) throw new Error("ADMIN_UNAUTHORIZED");
                if (!task?.freelancer) throw new Error("PROJECT_NOT_ELIGIBLE");

                const [payment, approvedSubmission, bank, freelancer] = await Promise.all([
                    PaymentTransaction.findOne({
                        task: task._id,
                        freelancer: task.freelancer,
                        status: "success",
                        currency: "NGN",
                        amount: task.amount,
                        amountSubunit: Math.round(task.amount * 100),
                    }).sort({ verifiedAt: -1 }).session(session).lean(),
                    ProjectSubmission.findOne({ task: task._id, freelancer: task.freelancer, status: "approved" })
                        .select("_id")
                        .session(session)
                        .lean(),
                    BankAccount.findOne({ user: task.freelancer, verificationStatus: "verified", verifiedAt: { $exists: true } })
                        .select("bankName bankCode accountName accountNumberLast4 verificationStatus")
                        .session(session)
                        .lean(),
                    User.findById(task.freelancer).select("name").session(session).lean(),
                ]);
                if (!payment || !approvedSubmission || !bank || !freelancer) throw new Error("PROJECT_NOT_ELIGIBLE");

                const transferredAt = new Date();
                const [createdPayout] = await ManualPayout.create([{
                    task: task._id,
                    paymentTransaction: payment._id,
                    freelancer: task.freelancer,
                    freelancerNameSnapshot: freelancer.name,
                    bankName: bank.bankName,
                    bankCode: bank.bankCode,
                    accountName: bank.accountName,
                    accountNumberLast4: bank.accountNumberLast4,
                    amount: task.amount,
                    currency: "NGN",
                    admin: admin.userId,
                    adminNameSnapshot: currentAdmin.name,
                    transferReference,
                    transferredAt,
                    ...(receiptUrl ? { receiptUrl } : {}),
                    status: "completed",
                }], { session });

                await new AdminActivityLog({
                    adminId: admin.userId,
                    adminNameSnapshot: currentAdmin.name,
                    action: "payout.manual_recorded",
                    targetUserId: task.freelancer.toString(),
                    targetUserNameSnapshot: freelancer.name,
                    description: `Recorded a manual payout for project "${task.title}".`,
                    metadata: {
                        taskId: task._id.toString(),
                        payoutId: createdPayout._id.toString(),
                        amount: task.amount,
                        currency: "NGN",
                        transferReference,
                    },
                }).save({ session });
                payout = {
                    id: createdPayout._id.toString(),
                    taskId: task._id.toString(),
                    taskTitle: task.title,
                    freelancerId: task.freelancer.toString(),
                    freelancerName: freelancer.name,
                    bankName: bank.bankName,
                    accountName: bank.accountName,
                    maskedAccountNumber: `••••••${bank.accountNumberLast4}`,
                    amount: task.amount,
                    currency: "NGN",
                    transferReference,
                    transferredAt,
                    receiptUrl: receiptUrl || null,
                    status: "completed",
                };
            });
        } catch (error) {
            if (error instanceof Error && error.message === "ADMIN_UNAUTHORIZED") {
                return jsonNoStore({ error: "Admin access required." }, { status: 403 });
            }
            if (error instanceof Error && error.message === "PROJECT_NOT_ELIGIBLE") {
                return jsonNoStore({ error: "This project is not eligible for payout. It must be completed, approved, paid, and assigned to a freelancer with verified bank details." }, { status: 409 });
            }
            if (error && typeof error === "object" && "code" in error && error.code === 11000) {
                return jsonNoStore({ error: "A payout has already been recorded for this project or payment." }, { status: 409 });
            }
            throw error;
        } finally {
            await session.endSession();
        }
        if (payout) {
            try {
                const freelancer = await User.findById(payout.freelancerId).select("name email isVerified").lean();
                await Notification.updateOne(
                    { recipient: payout.freelancerId, eventKey: `manual-payout:${payout.id}:recorded` },
                    { $setOnInsert: {
                        recipient: payout.freelancerId,
                        recipientRole: "freelancer",
                        type: "payout_recorded",
                        title: "Freelancer payout recorded",
                        body: `A manual payout for "${payout.taskTitle}" has been recorded as completed.`,
                        relatedTask: payout.taskId,
                        eventKey: `manual-payout:${payout.id}:recorded`,
                        href: `/freelancer/dashboard/projects/${payout.taskId}`,
                    } },
                    { upsert: true },
                );
                await sendWorkflowEmailSafely("manual_payout_recorded", freelancer, {
                    subject: "FreelanceX — Your project payout was recorded.",
                    heading: "Project payout recorded",
                    message: "The platform administrator recorded a completed manual payout for your approved project.",
                    details: [
                        { label: "Project", value: String(payout.taskTitle) },
                        { label: "Amount", value: new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 2 }).format(Number(payout.amount)) },
                        { label: "Transfer reference", value: String(payout.transferReference) },
                        { label: "Transfer date", value: new Date(String(payout.transferredAt)).toLocaleString("en-NG", { timeZone: "UTC" }) + " UTC" },
                    ],
                    actionPath: `/freelancer/dashboard/projects/${payout.taskId}`,
                    actionLabel: "View project",
                });
            } catch (notificationError) {
                console.error("Manual payout was recorded, but freelancer notification could not be saved.", {
                    errorName: notificationError instanceof Error ? notificationError.name : "UnknownError",
                    message: notificationError instanceof Error ? notificationError.message.slice(0, 300) : "Unknown failure",
                });
            }
        }
        return jsonNoStore({ message: "Manual payout recorded as completed.", payout }, { status: 201 });
    } catch (error) {
        console.error("Admin manual payout recording failed:", { errorName: error instanceof Error ? error.name : "UnknownError" });
        return jsonNoStore({ error: "The manual payout could not be recorded." }, { status: 503 });
    }
}
