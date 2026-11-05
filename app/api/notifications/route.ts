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
        const [notifications, unreadCount] = await Promise.all([
            Notification.find({ recipient: user.userId }).populate("actor", "name").sort({ createdAt: -1 }).limit(50).lean(),
            Notification.countDocuments({ recipient: user.userId, $or: [{ readAt: { $exists: false } }, { readAt: null }] }),
        ]);
        const withActorSnapshots = notifications.map((item) => item.actorNameSnapshot
            ? { ...item, actor: { _id: item.actor?._id, name: item.actorNameSnapshot } }
            : item);
        return jsonNoStore({ notifications: withActorSnapshots, unreadCount });
    } catch (error) {
        console.error("Notification listing error:", error);
        return jsonNoStore({ error: "Notifications are temporarily unavailable." }, { status: 503 });
    }
}
