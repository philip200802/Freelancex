import mongoose from "mongoose";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { connectToDatabase } from "@/lib/mongodb";
import Conversation from "@/models/Conversation";
import Message from "@/models/Message";
import Notification from "@/models/Notification";
import User from "@/models/User";
import UserPreference from "@/models/UserPreference";

export const dynamic = "force-dynamic";

function jsonNoStore(body: unknown, init?: ResponseInit) {
    const response = NextResponse.json(body, init);
    response.headers.set("Cache-Control", "no-store");
    return response;
}

export async function GET(_request: Request, context: { params: Promise<{ conversationId: string }> }) {
    const user = await getCurrentUser();
    if (!user) return jsonNoStore({ error: "Authentication required." }, { status: 401 });
    const { conversationId } = await context.params;
    if (!mongoose.Types.ObjectId.isValid(conversationId)) return jsonNoStore({ error: "Conversation not found." }, { status: 404 });

    try {
        await connectToDatabase();
        const filter = user.role === "admin" ? { _id: conversationId } : { _id: conversationId, participants: user.userId };
        const conversation = await Conversation.findOne(filter).populate("participants", "name role").populate("task", "title").lean();
        if (!conversation) return jsonNoStore({ error: "Conversation not found." }, { status: 404 });

        const messages = await Message.find({ conversation: conversationId })
            .populate("sender", "name role")
            .sort({ createdAt: 1 })
            .lean();
        await Message.updateMany(
            { conversation: conversationId, sender: { $ne: user.userId }, readBy: { $ne: user.userId } },
            { $addToSet: { readBy: user.userId } },
        );
        return jsonNoStore({ conversation, messages });
    } catch (error) {
        console.error("Conversation retrieval error:", error);
        return jsonNoStore({ error: "Conversation is temporarily unavailable." }, { status: 503 });
    }
}

export async function POST(request: Request, context: { params: Promise<{ conversationId: string }> }) {
    const user = await getCurrentUser();
    if (!user) return jsonNoStore({ error: "Authentication required." }, { status: 401 });
    if (user.role === "admin") return jsonNoStore({ error: "Admin accounts cannot send participant messages." }, { status: 403 });

    const { conversationId } = await context.params;
    if (!mongoose.Types.ObjectId.isValid(conversationId)) return jsonNoStore({ error: "Conversation not found." }, { status: 404 });

    let body: { message?: unknown };
    try {
        body = await request.json() as { message?: unknown };
    } catch {
        return jsonNoStore({ error: "A message is required." }, { status: 400 });
    }
    const text = typeof body.message === "string" ? body.message.trim() : "";
    if (!text || text.length > 5000) return jsonNoStore({ error: "Messages must be between 1 and 5000 characters." }, { status: 400 });

    try {
        await connectToDatabase();
        const conversation = await Conversation.findOne({ _id: conversationId, participants: user.userId });
        if (!conversation) return jsonNoStore({ error: "Conversation not found." }, { status: 404 });

        const message = await Message.create({ conversation: conversation._id, sender: user.userId, body: text, readBy: [user.userId] });
        conversation.updatedAt = new Date();
        await conversation.save();

        const recipient = conversation.participants.find((participant: { toString(): string }) => participant.toString() !== user.userId);
        if (recipient) {
            const [preference, recipientUser] = await Promise.all([
                UserPreference.findOne({ user: recipient }).select("inAppNotifications").lean(),
                User.findById(recipient).select("role").lean(),
            ]);
            if (preference?.inAppNotifications !== false) {
                await Notification.create({
                    recipient,
                    actor: user.userId,
                    type: "message",
                    title: "New message",
                    body: "You have a new project message.",
                    href: recipientUser?.role === "employer" ? "/client/dashboard/messages" : "/freelancer/dashboard/messages",
                });
            }
        }

        return jsonNoStore({ message: { id: message.id, body: message.body, createdAt: message.createdAt } }, { status: 201 });
    } catch (error) {
        console.error("Message creation error:", error);
        return jsonNoStore({ error: "Message could not be sent." }, { status: 503 });
    }
}
