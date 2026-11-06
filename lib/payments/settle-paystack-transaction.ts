import mongoose from "mongoose";
import PaymentTransaction from "@/models/PaymentTransaction";
import Task from "@/models/Task";
import { verifyPaystackTransaction } from "@/lib/payments/paystack";
import Notification from "@/models/Notification";
import User from "@/models/User";
import { sendWorkflowEmailSafely } from "@/lib/workflow-email";

const fundedProjectStatuses = ["funded", "in_progress", "submitted", "revision_requested", "completed", "disputed"];

function isFundedProjectStatus(status: string) {
    return fundedProjectStatuses.includes(status);
}

export async function settlePaystackTransaction(reference: string) {
    console.info("Paystack settlement started.", { reference });
    const payment = await PaymentTransaction.findOne({ provider: "paystack", reference });
    if (!payment) {
        console.warn("Paystack settlement has no matching payment record.", { reference });
        throw new Error("PAYMENT_NOT_FOUND");
    }

    let providerTransaction: Awaited<ReturnType<typeof verifyPaystackTransaction>> | null = null;
    if (payment.status !== "success") {
        providerTransaction = await verifyPaystackTransaction(reference);
        const referenceMatches = providerTransaction.reference === reference;
        const currencyMatches = providerTransaction.currency === payment.currency && payment.currency === "NGN";
        const amountMatches = providerTransaction.amount === payment.amountSubunit;
        console.info("Paystack verification completed.", {
            reference,
            status: providerTransaction.status,
            referenceMatches,
            amountMatches,
            currencyMatches,
        });
        if (!referenceMatches || !currencyMatches || !amountMatches) {
            console.error("Paystack verification details did not match the stored payment.", {
                reference,
                referenceMatches,
                amountMatches,
                currencyMatches,
            });
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
                console.info("Paystack payment verified as unsuccessful.", { reference, status: providerTransaction.status });
                return { status: "failed" as const, taskId: payment.task.toString(), taskStatus: "awaiting_funding", projectActivated: false };
            }
            console.info("Paystack payment remains pending.", { reference, status: providerTransaction.status });
            return { status: "pending" as const, taskId: payment.task.toString(), taskStatus: "awaiting_funding", projectActivated: false };
        }
    } else {
        console.info("Paystack payment is already persisted as successful; reconciling its project.", { reference });
    }

    const session = await mongoose.startSession();
    let finalTaskStatus = "unknown";
    let newlySettled = false;
    let createdNotifications = 0;
    let projectStatusUpdated = false;
    try {
        await session.withTransaction(async () => {
            newlySettled = false;
            createdNotifications = 0;
            projectStatusUpdated = false;
            finalTaskStatus = "unknown";
            const currentPayment = await PaymentTransaction.findById(payment._id).session(session);
            if (!currentPayment) throw new Error("PAYMENT_NOT_FOUND");

            const task = await Task.findById(currentPayment.task)
                .select("title amount status employer freelancer paystackReference")
                .session(session)
                .lean();
            if (!task) throw new Error("TASK_NOT_FOUND");
            const expectedAmountSubunit = Math.round(task.amount * 100);
            if (
                task.employer?.toString() !== currentPayment.employer.toString() ||
                task.freelancer?.toString() !== currentPayment.freelancer.toString() ||
                task.paystackReference !== reference ||
                currentPayment.currency !== "NGN" ||
                !Number.isSafeInteger(expectedAmountSubunit) ||
                expectedAmountSubunit !== currentPayment.amountSubunit ||
                Math.round(currentPayment.amount * 100) !== expectedAmountSubunit
            ) {
                throw new Error("PROJECT_PAYMENT_DETAILS_MISMATCH");
            }
            if (!["awaiting_funding", ...fundedProjectStatuses].includes(task.status)) {
                throw new Error("PROJECT_NOT_ELIGIBLE_FOR_FUNDING");
            }

            if (currentPayment.status !== "success") {
                if (!providerTransaction || providerTransaction.status !== "success") throw new Error("PAYMENT_NOT_VERIFIED");
                if (!["initializing", "pending", "failed"].includes(currentPayment.status)) throw new Error("PAYMENT_NOT_PENDING");
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
                newlySettled = true;
            }

            finalTaskStatus = task.status;
            if (task.status === "awaiting_funding") {
                const activated = await Task.updateOne(
                    { _id: currentPayment.task, employer: currentPayment.employer, status: "awaiting_funding", paystackReference: reference },
                    { $set: { status: "funded" } },
                    { session },
                );
                if (activated.modifiedCount !== 1) throw new Error("PROJECT_FUNDING_STATE_CHANGED");
                finalTaskStatus = "funded";
                projectStatusUpdated = true;
            }

            const eventKey = `payment:${reference}:funded`;
            for (const notification of [
                {
                    recipient: currentPayment.employer,
                    recipientRole: "employer" as const,
                    title: "Project funded successfully",
                    body: `Funding for "${task.title}" was verified.`,
                    href: `/client/dashboard/projects/${currentPayment.task.toString()}`,
                },
                {
                    recipient: currentPayment.freelancer,
                    recipientRole: "freelancer" as const,
                    title: "Project Funded",
                    body: `The client has successfully funded "${task.title}". You can now begin working on the project.`,
                    href: `/freelancer/dashboard/projects/${currentPayment.task.toString()}`,
                },
            ]) {
                const result = await Notification.updateOne(
                    { recipient: notification.recipient, eventKey },
                    {
                        $setOnInsert: {
                            ...notification,
                            type: "payment_funded",
                            relatedTask: currentPayment.task,
                            relatedPayment: currentPayment._id,
                            eventKey,
                        },
                    },
                    { upsert: true, session },
                );
                createdNotifications += result.upsertedCount;
            }
        });
    } finally {
        await session.endSession();
    }

    if (newlySettled) console.info("Paystack payment record saved as successful.", { reference });
    if (projectStatusUpdated) console.info("Project funding status updated.", { reference, projectId: payment.task.toString(), status: finalTaskStatus });
    if (createdNotifications > 0) {
        console.info("Project funding notification created.", { reference, count: createdNotifications });
    }

    if (newlySettled && isFundedProjectStatus(finalTaskStatus)) {
        try {
            const [task, client, freelancer] = await Promise.all([
                Task.findById(payment.task).select("title").lean(),
                User.findById(payment.employer).select("name").lean(),
                User.findById(payment.freelancer).select("name email isVerified").lean(),
            ]);
            if (task) {
                const emailResult = await sendWorkflowEmailSafely("project_funded_freelancer", freelancer, {
                    subject: "A project has been funded — you can begin work.",
                    heading: "Project Funded — Work Can Begin",
                    message: `The client has successfully funded ${task.title}. You can now begin working on the project. Review the brief and coordinate next steps with the client in your project workspace.`,
                    details: [
                        { label: "Project title", value: task.title },
                        { label: "Client", value: client?.name || "Client" },
                        { label: "Funded amount", value: new Intl.NumberFormat("en-NG", { style: "currency", currency: payment.currency, maximumFractionDigits: 2 }).format(payment.amount) },
                        { label: "Funding", value: "Payment verified and completed" },
                        { label: "Project reference", value: payment.task.toString() },
                    ],
                    actionPath: `/freelancer/dashboard/projects/${payment.task.toString()}`,
                    actionLabel: "Open project workspace",
                });
                console.info("Project funding email delivery result.", { reference, result: emailResult });
            }
        } catch (emailError) {
            console.error("Project funding email could not be prepared.", {
                reference,
                errorName: emailError instanceof Error ? emailError.name : "UnknownError",
            });
        }
    }

    return {
        status: "success" as const,
        taskId: payment.task.toString(),
        taskStatus: finalTaskStatus,
        projectActivated: isFundedProjectStatus(finalTaskStatus),
    };
}
