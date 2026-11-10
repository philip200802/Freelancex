import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { processAccountRemovalEmails } from "@/lib/admin-email-outbox";
import { connectToDatabase } from "@/lib/mongodb";
import { processProfileImageCleanup } from "@/lib/profile-image-cleanup";
import { processWorkflowEmailOutbox } from "@/lib/workflow-email";
import { queueOverdueManualPayoutEmails } from "@/lib/payout-email-outbox";
import { notifyApproachingProjectDeadlines, notifyOverdueProjectRevisions } from "@/lib/project-deadline-notifications";

export const dynamic = "force-dynamic";

async function processOutbox(request: Request) {
    const secret = process.env.CRON_SECRET;
    const authorization = request.headers.get("authorization") || "";
    const expected = secret ? `Bearer ${secret}` : "";
    const suppliedBuffer = Buffer.from(authorization);
    const expectedBuffer = Buffer.from(expected);
    if (!secret || suppliedBuffer.length !== expectedBuffer.length || !timingSafeEqual(suppliedBuffer, expectedBuffer)) {
        return NextResponse.json({ error: "Unauthorized." }, { status: secret ? 401 : 503 });
    }
    try {
        await connectToDatabase();
        const overduePayoutEmails = await queueOverdueManualPayoutEmails(50);
        const [emails, workflowEmails, profileImages, overdueRevisionNotifications, approachingDeadlineNotifications] = await Promise.all([
            processAccountRemovalEmails(50),
            processWorkflowEmailOutbox(50),
            processProfileImageCleanup(50),
            notifyOverdueProjectRevisions(50),
            notifyApproachingProjectDeadlines(100),
        ]);
        return NextResponse.json({ success: true, emails, workflowEmails, overduePayoutEmailsQueued: overduePayoutEmails.length, overdueRevisionNotifications, approachingDeadlineNotifications, profileImages }, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
        console.error("Email outbox processing failed:", error);
        return NextResponse.json({ error: "Email outbox could not be processed." }, { status: 503 });
    }
}

export async function GET(request: Request) {
    return processOutbox(request);
}

export async function POST(request: Request) {
    return processOutbox(request);
}
