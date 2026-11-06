import { sendWorkflowEmail } from "@/lib/email";
import User from "@/models/User";

type WorkflowRecipient = { email: string; name: string; isVerified: boolean };
type WorkflowEmail = {
    subject: string;
    heading: string;
    message: string;
    details: Array<{ label: string; value: string }>;
    actionPath: string;
    actionLabel: string;
};

function applicationUrl(path: string) {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    const parsedBaseUrl = new URL(baseUrl);
    if (!["http:", "https:"].includes(parsedBaseUrl.protocol)) throw new Error("Workflow email URL must use HTTP or HTTPS.");
    return new URL(path, parsedBaseUrl).toString();
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
