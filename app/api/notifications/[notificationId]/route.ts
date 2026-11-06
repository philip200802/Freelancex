import mongoose from "mongoose";
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

export async function PATCH(_request: Request, context: { params: Promise<{ notificationId: string }> }) {
    const user = await getCurrentUser();
    if (!user) return jsonNoStore({ error: "Authentication required." }, { status: 401 });

    const { notificationId } = await context.params;
    if (!mongoose.Types.ObjectId.isValid(notificationId)) {
        return jsonNoStore({ error: "Notification not found." }, { status: 404 });
    }

    try {
        await connectToDatabase();
        const notification = await Notification.findOneAndUpdate(
            { _id: notificationId, recipient: user.userId, $or: [{ recipientRole: user.role }, { recipientRole: { $exists: false } }] },
            { readAt: new Date() },
            { returnDocument: "after" },
        ).select("_id readAt");
        if (!notification) return jsonNoStore({ error: "Notification not found." }, { status: 404 });
        return jsonNoStore({ notification: { id: notification.id, readAt: notification.readAt } });
    } catch (error) {
        console.error("Notification update error:", error);
        return jsonNoStore({ error: "Notification could not be updated." }, { status: 503 });
    }
}
