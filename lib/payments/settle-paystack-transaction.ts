import mongoose from "mongoose";
import PaymentTransaction from "@/models/PaymentTransaction";
import Task from "@/models/Task";
import { verifyPaystackTransaction } from "@/lib/payments/paystack";

export async function settlePaystackTransaction(reference: string) {
    const payment = await PaymentTransaction.findOne({ provider: "paystack", reference });
    if (!payment) throw new Error("PAYMENT_NOT_FOUND");
    if (payment.status === "success") {
        const task = await Task.findById(payment.task).select("status").lean();
        return {
            status: "success" as const,
            taskId: payment.task.toString(),
            taskStatus: task?.status || "not_found",
            projectActivated: ["funded", "in_progress", "submitted", "revision_requested", "completed"].includes(task?.status || ""),
        };
    }

    const providerTransaction = await verifyPaystackTransaction(reference);
    if (providerTransaction.reference !== reference || providerTransaction.currency !== payment.currency || providerTransaction.amount !== payment.amountSubunit) {
        throw new Error("PAYMENT_DETAILS_MISMATCH");
    }
    if (providerTransaction.status !== "success") {
        if (["failed", "abandoned", "reversed"].includes(providerTransaction.status)) {
            const failed = await PaymentTransaction.updateOne(
                { _id: payment._id, status: { $in: ["initializing", "pending"] } },
                { $set: { status: "failed" } },
            );
            if (failed.modifiedCount === 1) {
                await Task.updateOne(
                    { _id: payment.task, status: "awaiting_funding", paystackReference: reference },
                    { $unset: { paystackReference: 1 } },
                );
            }
            return { status: "failed" as const, taskId: payment.task.toString(), taskStatus: "awaiting_funding", projectActivated: false };
        }
        return { status: "pending" as const, taskId: payment.task.toString(), taskStatus: "awaiting_funding", projectActivated: false };
    }

    const session = await mongoose.startSession();
    let finalTaskStatus = "unknown";
    try {
        await session.withTransaction(async () => {
            const currentPayment = await PaymentTransaction.findOne({ _id: payment._id }).session(session);
            if (!currentPayment) throw new Error("PAYMENT_NOT_FOUND");
            if (currentPayment.status === "success") {
                const existingTask = await Task.findById(currentPayment.task).select("status").session(session).lean();
                finalTaskStatus = existingTask?.status || "not_found";
                return;
            }
            if (!["initializing", "pending", "failed"].includes(currentPayment.status)) throw new Error("PAYMENT_NOT_PENDING");

            const task = await Task.findById(currentPayment.task).select("status paystackReference").session(session).lean();
            if (!task) throw new Error("TASK_NOT_FOUND");
            finalTaskStatus = task.status;

            const updatedPayment = await PaymentTransaction.updateOne(
                { _id: currentPayment._id, status: { $in: ["initializing", "pending", "failed"] } },
                {
                    $set: {
                        status: "success",
                        providerTransactionId: providerTransaction.id,
                        verifiedAt: new Date(),
                    },
                },
                { session },
            );
            if (updatedPayment.modifiedCount !== 1) throw new Error("PAYMENT_ALREADY_SETTLED");

            if (task.status === "awaiting_funding" && task.paystackReference === reference) {
                const activated = await Task.updateOne(
                    { _id: currentPayment.task, status: "awaiting_funding", paystackReference: reference },
                    { $set: { status: "funded" } },
                    { session },
                );
                if (activated.modifiedCount === 1) finalTaskStatus = "funded";
            }
        });
    } finally {
        await session.endSession();
    }

    return {
        status: "success" as const,
        taskId: payment.task.toString(),
        taskStatus: finalTaskStatus,
        projectActivated: ["funded", "in_progress", "submitted", "revision_requested", "completed"].includes(finalTaskStatus),
    };
}
