import mongoose from "mongoose";
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

export async function GET(_request: Request, context: { params: Promise<{ conversationId: string; imageId: string }> }) {
    const user = await getCurrentUser();
    if (!user) return jsonNoStore({ error: "Authentication required." }, { status: 401 });
    if (user.role === "admin") return jsonNoStore({ error: "Participant messages are only available to conversation participants." }, { status: 403 });

    const { conversationId, imageId } = await context.params;
    if (!mongoose.Types.ObjectId.isValid(conversationId)) {
        return jsonNoStore({ error: "Image not found." }, { status: 404 });
    }
    const validImageId = new RegExp(`^(?:freelancex/messages/${conversationId}/)?message-[a-f0-9]{24}$`).test(imageId);
    if (!validImageId) {
        return jsonNoStore({ error: "Image not found." }, { status: 404 });
    }

    try {
        await connectToDatabase();
        const conversation = await Conversation.exists({ _id: conversationId, participants: user.userId });
        if (!conversation) return jsonNoStore({ error: "Image not found." }, { status: 404 });
        const message = await Message.findOne({
            conversation: conversationId,
            "attachments.publicId": imageId,
        }).select("attachments").lean();
        const image = (message?.attachments || []).find((attachment: { publicId: string; url: string; fileType: string }) => attachment.publicId === imageId);
        if (!image || !["image/jpeg", "image/png", "image/webp"].includes(image.fileType)) {
            return jsonNoStore({ error: "Image not found." }, { status: 404 });
        }

        const imageUrl = new URL(image.url);
        if (imageUrl.protocol !== "https:" || imageUrl.hostname !== "res.cloudinary.com") {
            return jsonNoStore({ error: "Image is temporarily unavailable." }, { status: 502 });
        }
        const upstream = await fetch(imageUrl, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10_000) });
        if (!upstream.ok || !upstream.body) return jsonNoStore({ error: "Image is temporarily unavailable." }, { status: 502 });

        const headers = new Headers({
            "Cache-Control": "private, no-store",
            "Content-Security-Policy": "default-src 'none'; sandbox",
            "Content-Type": image.fileType,
            "X-Content-Type-Options": "nosniff",
        });
        const contentLength = upstream.headers.get("content-length");
        if (contentLength) headers.set("Content-Length", contentLength);
        return new NextResponse(upstream.body, { headers });
    } catch (error) {
        console.error("Private message image retrieval failed.", { errorName: error instanceof Error ? error.name : "UnknownError" });
        return jsonNoStore({ error: "Image is temporarily unavailable." }, { status: 503 });
    }
}
