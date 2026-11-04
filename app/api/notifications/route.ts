import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { connectToDatabase } from "@/lib/mongodb";
import Notification from "@/models/Notification";

export const dynamic = "force-dynamic";

function jsonNoStore(body: unknown, init?: ResponseInit) {
    const response = NextResponse.json(body, init);
    response.headers.set("Cache-Control", "no-store");
    return response;
}

export async function GET() {
    const user = await getCurrentUser();
    if (!user) return jsonNoStore({ error: "Authentication required." }, { status: 401 });

    try {
        await connectToDatabase();
        const notifications = await Notification.find({ recipient: user.userId })
            .populate("actor", "name")
            .sort({ createdAt: -1 })
            .limit(50)
            .lean();
        return jsonNoStore({ notifications, unreadCount: notifications.filter((item) => !item.readAt).length });
    } catch (error) {
        console.error("Notification listing error:", error);
        return jsonNoStore({ error: "Notifications are temporarily unavailable." }, { status: 503 });
    }
}
