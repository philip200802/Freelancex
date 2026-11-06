import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { connectToDatabase } from "@/lib/mongodb";
import Notification from "@/models/Notification";

export const dynamic = "force-dynamic";

export async function GET() {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401, headers: { "Cache-Control": "no-store" } });

    try {
        await connectToDatabase();
        const unreadCount = await Notification.countDocuments({
            recipient: user.userId,
            $or: [{ recipientRole: user.role }, { recipientRole: { $exists: false } }],
            $and: [{ $or: [{ readAt: { $exists: false } }, { readAt: null }] }],
        });
        return NextResponse.json({ unreadCount }, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
        console.error("Unread notification count error:", error);
        return NextResponse.json({ error: "Notifications are temporarily unavailable." }, { status: 503, headers: { "Cache-Control": "no-store" } });
    }
}
