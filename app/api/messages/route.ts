import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { connectToDatabase } from "@/lib/mongodb";
import Conversation from "@/models/Conversation";
import Message from "@/models/Message";

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
        const filter = user.role === "admin" ? {} : { participants: user.userId };
        const conversations = await Conversation.find(filter)
            .populate("participants", "name role")
            .populate("task", "title status")
            .sort({ updatedAt: -1 })
            .lean();
        const conversationIds = conversations.map((conversation) => conversation._id);
        const messages = await Message.find({ conversation: { $in: conversationIds } })
            .sort({ createdAt: -1 })
            .lean();
        const latestByConversation = new Map<string, typeof messages[number]>();
        for (const message of messages) {
            const id = message.conversation.toString();
            if (!latestByConversation.has(id)) latestByConversation.set(id, message);
        }

        return jsonNoStore({
            conversations: conversations.map((conversation) => ({
                id: conversation._id.toString(),
                task: conversation.task,
                participants: conversation.participants,
                updatedAt: conversation.updatedAt,
                latestMessage: latestByConversation.get(conversation._id.toString()) || null,
            })),
        });
    } catch (error) {
        console.error("Conversation listing error:", error);
        return jsonNoStore({ error: "Conversations are temporarily unavailable." }, { status: 503 });
    }
}
