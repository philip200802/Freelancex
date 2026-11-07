import { createHash } from "node:crypto";
import mongoose from "mongoose";
import { sendWorkflowEmail } from "@/lib/email";
import EmailOutbox from "@/models/EmailOutbox";
import User from "@/models/User";
import UserPreference from "@/models/UserPreference";

export type WorkflowRecipient = { email: string; name: string; isVerified: boolean; _id?: mongoose.Types.ObjectId | string };
export type WorkflowEmail = {
    subject: string;
    heading: string;
    message: string;
    details: Array<{ label: string; value: string }>;
    actionPath: string;
    actionLabel: string;
    relatedTask?: mongoose.Types.ObjectId;
};
export type WorkflowEmailQueueItem = {
    workflowEvent: string;
    dedupeKey: string;
    recipient?: WorkflowRecipient | null;
    email: WorkflowEmail;
    allowUnverified?: boolean;
    toAdmins?: boolean;
};

function emailActionUrl(path: string) {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    const parsedBaseUrl = new URL(baseUrl);
    if (!["http:", "https:"].includes(parsedBaseUrl.protocol)) throw new Error("Workflow email URL must use HTTP or HTTPS.");
    return new URL(path, parsedBaseUrl).toString();
}

function applicationUrl(path: string) {
    return emailActionUrl(path);
}

export async function queueWorkflowEmail(
    workflowEvent: string,
    dedupeKey: string,
    recipient: WorkflowRecipient | null | undefined,
    email: WorkflowEmail,
    session: mongoose.ClientSession,
    allowUnverified = false,
) {
    if (!recipient?.email || (!recipient.isVerified && !allowUnverified)) {
        console.info("Workflow email was not queued.", { event: workflowEvent, reason: "recipient_unavailable_or_unverified" });
        return null;
    }
    if (recipient._id) {
        const preference = await UserPreference.findOne({ user: recipient._id })
            .select("emailNotifications")
            .session(session)
            .lean();
        if (preference?.emailNotifications === false) {
            console.info("Workflow email was not queued.", { event: workflowEvent, reason: "recipient_disabled_email_notifications" });
            return null;
        }
    }

    const recipientKey = createHash("sha256").update(recipient.email.trim().toLowerCase()).digest("hex").slice(0, 24);
    const eventKey = `${dedupeKey}:${recipientKey}`;
    await EmailOutbox.updateOne(
        { eventKey },
        { $setOnInsert: {
            type: "workflow_email",
            to: recipient.email.trim(),
            recipientName: recipient.name || "FreelanceX user",
            eventKey,
            workflowEvent,
            ...(email.relatedTask ? { relatedTask: email.relatedTask } : {}),
            subject: email.subject,
            heading: email.heading,
            message: email.message,
            details: email.details,
            actionUrl: emailActionUrl(email.actionPath),
            actionLabel: email.actionLabel,
            status: "pending",
            attempts: 0,
        } },
        { upsert: true, session, runValidators: true },
    );
    const queuedEmail = await EmailOutbox.findOne({ eventKey }).select("_id").session(session).lean();
    if (!queuedEmail) throw new Error("WORKFLOW_EMAIL_OUTBOX_MISSING");
    return queuedEmail._id;
}

export async function queueWorkflowEmailToAdmins(
    workflowEvent: string,
    dedupeKey: string,
    email: WorkflowEmail,
    session: mongoose.ClientSession,
) {
    const admins = await User.find({ role: "admin", isVerified: true, isActive: true })
        .select("name email isVerified")
        .session(session)
        .lean();
    const recipients = new Map<string, WorkflowRecipient>();
    for (const admin of admins) {
        if (admin.email) recipients.set(admin.email.toLowerCase(), admin);
    }
    const configuredAddresses = (process.env.ADMIN_EMAIL || "").split(",").map((address) => address.trim()).filter(Boolean);
    for (const address of configuredAddresses) {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
            console.error("Configured administrator workflow email address is invalid.", { event: workflowEvent });
            continue;
        }
        recipients.set(address.toLowerCase(), { email: address, name: "FreelanceX Admin", isVerified: true });
    }
    if (!recipients.size) {
        console.error("No verified administrator recipient is configured for workflow email.", { event: workflowEvent });
    }

    const outboxIds = [];
    for (const recipient of recipients.values()) {
        const outboxId = await queueWorkflowEmail(workflowEvent, dedupeKey, recipient, email, session);
        if (outboxId) outboxIds.push(outboxId);
    }
    return outboxIds;
}

export async function processWorkflowEmailOutbox(limit = 50, outboxIds?: mongoose.Types.ObjectId[]) {
    let sent = 0;
    let queued = 0;
    const processedIds: mongoose.Types.ObjectId[] = [];

    for (let index = 0; index < limit; index += 1) {
        const filter: Record<string, unknown> = {
            type: "workflow_email",
            $or: [
                { status: "pending", $or: [{ nextAttemptAt: { $exists: false } }, { nextAttemptAt: { $lte: new Date() } }] },
                { status: "processing", processingAt: { $lt: new Date(Date.now() - 5 * 60 * 1000) } },
            ],
        };
        if (outboxIds) filter._id = { $in: outboxIds };
        if (processedIds.length) filter.$and = [{ _id: { $nin: processedIds } }];
        const item = await EmailOutbox.findOneAndUpdate(
            filter,
            { $set: { status: "processing", processingAt: new Date() } },
            { sort: { createdAt: 1 }, returnDocument: "after" },
        );
        if (!item) break;
        processedIds.push(item._id);

        try {
            if (!item.to || !item.recipientName || !item.subject || !item.heading || !item.message || !item.actionUrl || !item.actionLabel) {
                throw new Error("WorkflowEmailOutboxPayloadMissing");
            }
            const providerMessageId = await sendWorkflowEmail({
                to: item.to,
                subject: item.subject,
                heading: item.heading,
                recipientName: item.recipientName,
                message: item.message,
                details: item.details || [],
                actionUrl: item.actionUrl,
                actionLabel: item.actionLabel,
            });
            await EmailOutbox.updateOne(
                { _id: item._id, status: "processing" },
                {
                    $set: {
                        status: "sent",
                        sentAt: new Date(),
                        ...(providerMessageId ? { providerMessageId } : {}),
                    },
                    $unset: {
                        processingAt: 1,
                        nextAttemptAt: 1,
                        lastError: 1,
                        recipientName: 1,
                        heading: 1,
                        message: 1,
                        details: 1,
                        actionUrl: 1,
                        actionLabel: 1,
                    },
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
                        lastError: sanitizeEmailError(error),
                        nextAttemptAt: new Date(Date.now() + Math.min(6 * 60 * 60 * 1000, 60 * 1000 * (2 ** Math.min(item.attempts, 8)))),
                    },
                    $unset: { processingAt: 1 },
                    $inc: { attempts: 1 },
                },
            );
            console.error("Workflow email delivery failed; queued for retry.", {
                event: item.workflowEvent || "unknown",
                outboxId: item._id.toString(),
                errorName: error instanceof Error ? error.name : "UnknownError",
                message: sanitizeEmailError(error),
            });
            queued += 1;
        }
    }

    function sanitizeEmailError(error: unknown) {
        const message = error instanceof Error ? error.message : "EmailDeliveryError";
        return message
            .replace(/mongodb(?:\+srv)?:\/\/[^\s"'`]+/gi, "[database-url]")
            .replace(/(password|passwd|secret|token|apikey)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
            .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[email]")
            .slice(0, 500);
    }

    return { sent, queued };
}

export async function queueWorkflowEmailsAfterCommit(items: WorkflowEmailQueueItem[], { dispatch = true }: { dispatch?: boolean } = {}) {
    if (!items.length) return { sent: 0, queued: 0 };

    const session = await mongoose.startSession();
    const outboxIds: mongoose.Types.ObjectId[] = [];
    try {
        await session.withTransaction(async () => {
            outboxIds.length = 0;
            for (const item of items) {
                if (item.toAdmins) {
                    outboxIds.push(...await queueWorkflowEmailToAdmins(
                        item.workflowEvent,
                        item.dedupeKey,
                        item.email,
                        session,
                    ));
                } else {
                    const outboxId = await queueWorkflowEmail(
                        item.workflowEvent,
                        item.dedupeKey,
                        item.recipient,
                        item.email,
                        session,
                        item.allowUnverified,
                    );
                    if (outboxId) outboxIds.push(outboxId);
                }
            }
        });
    } finally {
        await session.endSession();
    }

    if (!dispatch) return { sent: 0, queued: outboxIds.length };
    return outboxIds.length ? processWorkflowEmailOutbox(outboxIds.length, outboxIds) : { sent: 0, queued: 0 };
}

export async function sendWorkflowEmailSafely(event: string, recipient: WorkflowRecipient | null | undefined, email: WorkflowEmail) {
    if (!recipient?.isVerified || !recipient.email) {
        console.info("Workflow email delivery skipped.", { event, reason: "recipient_unavailable_or_unverified" });
        return "skipped" as const;
    }
    try {
        await sendWorkflowEmail({
            to: recipient.email,
            subject: email.subject,
            heading: email.heading,
            recipientName: recipient.name,
            message: email.message,
            details: email.details,
            actionUrl: applicationUrl(email.actionPath),
            actionLabel: email.actionLabel,
        });
        console.info("Workflow email delivery completed.", { event, result: "sent" });
        return "sent" as const;
    } catch (error) {
        console.error("Workflow email delivery failed.", {
            event,
            errorName: error instanceof Error ? error.name : "UnknownError",
        });
        return "failed" as const;
    }
}

export async function sendWorkflowEmailToAdminsSafely(event: string, email: WorkflowEmail) {
    try {
        const admins = await User.find({ role: "admin", isVerified: true, isActive: true }).select("name email isVerified").lean();
        await Promise.all(admins.map((admin) => sendWorkflowEmailSafely(event, admin, email)));
    } catch (error) {
        console.error("Administrator workflow emails could not be prepared.", {
            event,
            errorName: error instanceof Error ? error.name : "UnknownError",
        });
    }
}
