import mongoose from "mongoose";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { connectToDatabase } from "@/lib/mongodb";
import Conversation from "@/models/Conversation";
import Message from "@/models/Message";
import type { IConversation } from "@/models/Conversation";

export const dynamic = "force-dynamic";

function jsonNoStore(body: unknown, init?: ResponseInit) {
    const response = NextResponse.json(body, init);
    response.headers.set("Cache-Control", "no-store");
    return response;
}

export async function GET() {
    const user = await getCurrentUser();
    if (!user) return jsonNoStore({ error: "Authentication required." }, { status: 401 });
    if (user.role === "admin") return jsonNoStore({ error: "Participant messages are only available to conversation participants." }, { status: 403 });

    try {
        await connectToDatabase();
        const conversations = await Conversation.find({ participants: user.userId })
            .populate("participants", "name role")
            .populate("task", "title status")
            .sort({ updatedAt: -1 })
            .lean();
        const conversationIds = conversations.map((conversation) => conversation._id);
        const currentUserId = new mongoose.Types.ObjectId(user.userId);
        const [latestMessages, unreadMessages] = conversationIds.length
            ? await Promise.all([
                Message.aggregate([
                    { $match: { conversation: { $in: conversationIds } } },
                    { $sort: { createdAt: -1 } },
                    { $group: { _id: "$conversation", message: { $first: "$$ROOT" } } },
                ]),
                Message.aggregate([
                    { $match: { conversation: { $in: conversationIds }, sender: { $ne: currentUserId }, readBy: { $ne: currentUserId } } },
                    { $group: { _id: "$conversation", count: { $sum: 1 } } },
                ]),
            ])
            : [[], []];
        const latestByConversation = new Map<string, (typeof latestMessages)[number]["message"]>(
            latestMessages.map((entry: { _id: { toString(): string }; message: (typeof latestMessages)[number]["message"] }) => [entry._id.toString(), entry.message]),
        );
        const unreadByConversation = new Map<string, number>(
            unreadMessages.map((entry: { _id: { toString(): string }; count: number }) => [entry._id.toString(), entry.count]),
        );

        return jsonNoStore({
            conversations: conversations.map((conversation) => ({
                id: conversation._id.toString(),
                task: conversation.task,
                participants: conversation.participants.map((participant: { _id: { toString(): string }; name: string; role: string }) => {
                    const snapshot = (conversation.participantSnapshots ?? []).find(
                        (item: IConversation["participantSnapshots"][number]) =>
                            item.archivedUserId === participant._id.toString(),
                    );
                    return snapshot ? { ...participant, name: snapshot.name, role: snapshot.role } : participant;
                }),
                updatedAt: conversation.updatedAt,
                latestMessage: (() => {
                    const latest = latestByConversation.get(conversation._id.toString());
                    return latest ? { body: latest.body || (latest.attachments?.length ? "Image" : ""), createdAt: latest.createdAt } : null;
                })(),
                unreadCount: unreadByConversation.get(conversation._id.toString()) || 0,
            })),
        });
    } catch (error) {
        console.error("Conversation listing error:", error);
        return jsonNoStore({ error: "Conversations are temporarily unavailable." }, { status: 503 });
    }
}
