import mongoose from "mongoose";
import { sendAccountRemovedEmail } from "@/lib/email";
import EmailOutbox from "@/models/EmailOutbox";

const staleLock = () => new Date(Date.now() - 5 * 60 * 1000);

export async function processAccountRemovalEmails(limit = 20, outboxId?: string) {
    let sent = 0;
    let queued = 0;
    const processedIds: string[] = [];

    for (let index = 0; index < limit; index += 1) {
        const filter: Record<string, unknown> = {
            type: "account_removed",
            $or: [
                { status: "pending", $or: [{ nextAttemptAt: { $exists: false } }, { nextAttemptAt: { $lte: new Date() } }] },
                { status: "processing", processingAt: { $lt: staleLock() } },
            ],
        };
        if (outboxId) filter._id = new mongoose.Types.ObjectId(outboxId);
        if (processedIds.length) filter.$and = [{ _id: { $nin: processedIds } }];
        const item = await EmailOutbox.findOneAndUpdate(
            filter,
            { $set: { status: "processing", processingAt: new Date() } },
            { sort: { createdAt: 1 }, returnDocument: "after" },
        );
        if (!item) break;
        processedIds.push(item._id.toString());

        try {
            if (!item.to || !item.recipientName) throw new Error("OutboxRecipientMissing");
            await sendAccountRemovedEmail({ email: item.to, name: item.recipientName, reason: item.reason });
            await EmailOutbox.updateOne(
                { _id: item._id, status: "processing" },
                {
                    $set: { status: "sent", sentAt: new Date() },
                    $unset: { processingAt: 1, nextAttemptAt: 1, lastError: 1, to: 1, recipientName: 1, reason: 1 },
                    $inc: { attempts: 1 },
                },
            );
            sent += 1;
        } catch (error) {
            await EmailOutbox.updateOne(
                { _id: item._id, status: "processing" },
                {
                    $set: {
                        status: "pending",
                        lastError: error instanceof Error ? error.name : "EmailDeliveryError",
                        nextAttemptAt: new Date(Date.now() + Math.min(6 * 60 * 60 * 1000, 60 * 1000 * (2 ** Math.min(item.attempts, 8)))),
                    },
                    $unset: { processingAt: 1 },
                    $inc: { attempts: 1 },
                },
            );
            console.error("Account removal email delivery failed; queued for retry.", {
                outboxId: item._id.toString(),
                errorName: error instanceof Error ? error.name : "UnknownError",
            });
            queued += 1;
        }
    }

    return { sent, queued };
}
