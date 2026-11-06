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

function safeDestination(href: string | undefined, role: "employer" | "freelancer" | "admin") {
    const fallback = role === "employer" ? "/client/dashboard/notifications" : `/${role}/dashboard/notifications`;
    if (!href || !href.startsWith("/") || href.startsWith("//")) return fallback;
    try {
        const url = new URL(href, "https://freelancex.invalid");
        const prefix = role === "employer" ? "/client/dashboard/" : `/${role}/dashboard/`;
        return url.origin === "https://freelancex.invalid" && url.pathname.startsWith(prefix)
            ? `${url.pathname}${url.search}${url.hash}`
            : fallback;
    } catch {
        return fallback;
    }
}

export async function GET() {
    const user = await getCurrentUser();
    if (!user) return jsonNoStore({ error: "Authentication required." }, { status: 401 });

    try {
        await connectToDatabase();
        const [notifications, unreadCount] = await Promise.all([
            Notification.find({ recipient: user.userId, $or: [{ recipientRole: user.role }, { recipientRole: { $exists: false } }] }).populate("actor", "name").sort({ createdAt: -1 }).limit(50).lean(),
            Notification.countDocuments({ recipient: user.userId, $or: [{ recipientRole: user.role }, { recipientRole: { $exists: false } }], $and: [{ $or: [{ readAt: { $exists: false } }, { readAt: null }] }] }),
        ]);
        const withActorSnapshots = notifications.map((item) => ({
            ...item,
            href: safeDestination(item.href, user.role),
            ...(item.actorNameSnapshot ? { actor: { _id: item.actor?._id, name: item.actorNameSnapshot } } : {}),
        }));
        return jsonNoStore({ notifications: withActorSnapshots, unreadCount });
    } catch (error) {
        console.error("Notification listing error:", error);
        return jsonNoStore({ error: "Notifications are temporarily unavailable." }, { status: 503 });
    }
}

export async function PATCH() {
    const user = await getCurrentUser();
    if (!user) return jsonNoStore({ error: "Authentication required." }, { status: 401 });

    try {
        await connectToDatabase();
        const result = await Notification.updateMany(
            {
                recipient: user.userId,
                $or: [{ recipientRole: user.role }, { recipientRole: { $exists: false } }],
                $and: [{ $or: [{ readAt: { $exists: false } }, { readAt: null }] }],
            },
            { $set: { readAt: new Date() } },
        );
        return jsonNoStore({ updatedCount: result.modifiedCount, unreadCount: 0 });
    } catch (error) {
        console.error("Mark all notifications read error:", error);
        return jsonNoStore({ error: "Notifications could not be updated." }, { status: 503 });
    }
}
