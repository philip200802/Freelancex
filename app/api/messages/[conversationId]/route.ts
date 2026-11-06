import mongoose from "mongoose";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { connectToDatabase } from "@/lib/mongodb";
import { deleteProjectDeliverable, uploadMessageImage, validateMessageImage, type UploadedMessageImage } from "@/lib/cloudinary";
import Conversation from "@/models/Conversation";
import Message from "@/models/Message";
import type { IConversation } from "@/models/Conversation";
import type { IMessage } from "@/models/Message";
import Notification from "@/models/Notification";
import Task from "@/models/Task";
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
    if (user.role === "admin") return jsonNoStore({ error: "Participant messages are only available to conversation participants." }, { status: 403 });
    const { conversationId } = await context.params;
    if (!mongoose.Types.ObjectId.isValid(conversationId)) return jsonNoStore({ error: "Conversation not found." }, { status: 404 });

    try {
        await connectToDatabase();
        const conversation = await Conversation.findOne({ _id: conversationId, participants: user.userId })
            .populate("participants", "name role")
            .lean();
        if (!conversation) return jsonNoStore({ error: "Conversation not found." }, { status: 404 });

        const [task, messages] = await Promise.all([
            Task.findById(conversation.task).select("title status").lean(),
            Message.find({ conversation: conversationId }).populate("sender", "name role").sort({ createdAt: 1 }).lean(),
        ]);
        await Message.updateMany(
            { conversation: conversationId, sender: { $ne: user.userId }, readBy: { $ne: user.userId } },
            { $addToSet: { readBy: user.userId } },
        );
        try {
            await Notification.updateMany(
                {
                    recipient: user.userId,
                    type: "message",
                    relatedTask: conversation.task,
                    $or: [{ readAt: { $exists: false } }, { readAt: null }],
                },
                { $set: { readAt: new Date() } },
            );
        } catch (notificationError) {
            console.error("Read message notifications could not be updated.", {
                errorName: notificationError instanceof Error ? notificationError.name : "UnknownError",
            });
        }
        const participants = conversation.participants.map((participant: { _id: { toString(): string }; name: string; role: string }) => {
            const snapshot = (conversation.participantSnapshots ?? []).find(
                (item: IConversation["participantSnapshots"][number]) =>
                    item.archivedUserId === participant._id.toString(),
            );
            return snapshot ? { ...participant, name: snapshot.name, role: snapshot.role } : participant;
        });
        return jsonNoStore({
            conversation: { ...conversation, task, participants },
            messages:                                     messages.map((message: { _id: mongoose.Types.ObjectId; attachments?: Array<{ fileName: string; publicId: string; fileType: string; fileSize: number }>; senderNameSnapshot?: string; sender?: { _id?: unknown; name?: string; role?: string }; senderRoleSnapshot?: string }) => ({
                ...message,
                attachments: (message.attachments || []).map((attachment) => ({
                    fileName: attachment.fileName,
                    url: `/api/messages/${conversationId}/images/${encodeURIComponent(attachment.publicId)}`,
                    fileType: attachment.fileType,
                    fileSize: attachment.fileSize,
                })),
                ...(message.senderNameSnapshot
                    ? { sender: { _id: message.sender?._id, name: message.senderNameSnapshot, role: message.senderRoleSnapshot || message.sender?.role } }
                    : {}),
            })),
        });
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

    const contentLength = Number(request.headers.get("content-length") || 0);
    if (contentLength > 6 * 1024 * 1024) return jsonNoStore({ error: "Message image must be 5 MB or smaller." }, { status: 413 });

    let text: string;
    let image: File | undefined;
    try {
        if (request.headers.get("content-type")?.includes("multipart/form-data")) {
            const formData = await request.formData();
            const rawText = formData.get("message");
            text = typeof rawText === "string" ? rawText.trim() : "";
            const images = formData.getAll("image").filter((entry): entry is File => entry instanceof File && entry.size > 0);
            if (images.length > 1) return jsonNoStore({ error: "Send one image per message." }, { status: 400 });
            image = images[0];
        } else {
            const body = await request.json() as { message?: unknown };
            text = typeof body.message === "string" ? body.message.trim() : "";
        }
    } catch {
        return jsonNoStore({ error: "Message details are invalid." }, { status: 400 });
    }
    if ((!text && !image) || text.length > 5000) return jsonNoStore({ error: "Add a message of up to 5000 characters or attach an image." }, { status: 400 });
    if (image) {
        const validationError = await validateMessageImage(image);
        if (validationError) return jsonNoStore({ error: validationError }, { status: 400 });
    }

    const uploadedImages: UploadedMessageImage[] = [];
    try {
        await connectToDatabase();
        const conversation = await Conversation.findOne({ _id: conversationId, participants: user.userId });
        if (!conversation) return jsonNoStore({ error: "Conversation not found." }, { status: 404 });

        if (image) uploadedImages.push(await uploadMessageImage(conversationId, image));
        const sentAt = new Date();
        const messages: IMessage[] = [];
        const session = await mongoose.startSession();
        try {
            await session.withTransaction(async () => {
                const [createdMessage] = await Message.create([{
                    conversation: conversation._id,
                    sender: user.userId,
                    body: text,
                    attachments: uploadedImages,
                    readBy: [user.userId],
                    createdAt: sentAt,
                }], { session });
                const update = await Conversation.updateOne(
                    { _id: conversation._id, participants: user.userId },
                    { $set: { updatedAt: sentAt } },
                    { session },
                );
                if (update.matchedCount !== 1) throw new Error("CONVERSATION_CHANGED");
                messages[0] = createdMessage;
            });
        } finally {
            await session.endSession();
        }
        const message = messages[0];
        if (!message) throw new Error("MESSAGE_TRANSACTION_INCOMPLETE");

        const recipient = conversation.participants.find((participant: { toString(): string }) => participant.toString() !== user.userId);
        if (recipient) {
            try {
                const [preference, recipientUser] = await Promise.all([
                    UserPreference.findOne({ user: recipient }).select("inAppNotifications").lean(),
                    User.findById(recipient).select("role").lean(),
                ]);
                if (preference?.inAppNotifications !== false) {
                    await Notification.create({
                        recipient,
                        recipientRole: recipientUser?.role === "employer" ? "employer" : "freelancer",
                        actor: user.userId,
                        type: "message",
                        title: "New message",
                        body: "You have a new project message.",
                        relatedTask: conversation.task,
                        eventKey: `message:${message._id}`,
                        href: recipientUser?.role === "employer" ? "/client/dashboard/messages" : "/freelancer/dashboard/messages",
                    });
                }
            } catch (notificationError) {
                console.error("Message notification could not be created.", {
                    errorName: notificationError instanceof Error ? notificationError.name : "UnknownError",
                });
            }
        }

        return jsonNoStore({
            message: {
                id: message._id.toString(),
                body: message.body,
                attachments: message.attachments.map(({ fileName, publicId, fileType, fileSize }) => ({
                    fileName,
                    url: `/api/messages/${conversationId}/images/${encodeURIComponent(publicId)}`,
                    fileType,
                    fileSize,
                })),
                createdAt: message.createdAt,
            },
        }, { status: 201 });
    } catch (error) {
        const cleanupResults = await Promise.allSettled(uploadedImages.map((file) => deleteProjectDeliverable(file.publicId, file.resourceType)));
        for (const result of cleanupResults) {
            if (result.status === "rejected") console.error("Message image cleanup failed.", { errorName: result.reason instanceof Error ? result.reason.name : "UnknownError" });
        }
        if (error instanceof Error && error.message === "CONVERSATION_CHANGED") {
            return jsonNoStore({ error: "This conversation is no longer available. Refresh and try again." }, { status: 409 });
        }
        console.error("Message creation error.", { errorName: error instanceof Error ? error.name : "UnknownError" });
        return jsonNoStore({ error: "Message could not be sent. Please try again." }, { status: 500 });
    }
}
