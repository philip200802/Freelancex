import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { connectToDatabase } from "@/lib/mongodb";
import Notification from "@/models/Notification";

export const dynamic = "force-dynamic";

export async function GET() {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401, headers: { "Cache-Control": "no-store" } });

    const requestStartedAt = performance.now();
    let connectionDurationMs: number | null = null;
    let countDurationMs: number | null = null;
    try {
        const connectionStartedAt = performance.now();
        await connectToDatabase();
        connectionDurationMs = Math.round(performance.now() - connectionStartedAt);
        const countStartedAt = performance.now();
        let unreadCount: number;
        try {
            unreadCount = await Notification.countDocuments({
                recipient: user.userId,
                $or: [{ recipientRole: user.role }, { recipientRole: { $exists: false } }],
                readAt: null,
            });
        } finally {
            countDurationMs = Math.round(performance.now() - countStartedAt);
        }
        console.info("Unread notification count timing.", {
            connectionDurationMs,
            countDurationMs,
            totalDurationMs: Math.round(performance.now() - requestStartedAt),
        });
        return NextResponse.json({ unreadCount }, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
        console.error("Unread notification count failed.", {
            connectionDurationMs,
            countDurationMs,
            totalDurationMs: Math.round(performance.now() - requestStartedAt),
            errorName: error instanceof Error ? error.name : "UnknownError",
        });
        return NextResponse.json({ error: "Notifications are temporarily unavailable." }, { status: 503, headers: { "Cache-Control": "no-store" } });
    }
}
