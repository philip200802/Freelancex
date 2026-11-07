import mongoose from "mongoose";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { connectToDatabase } from "@/lib/mongodb";
import { processWorkflowEmailOutbox } from "@/lib/workflow-email";
import EmailOutbox from "@/models/EmailOutbox";
import Task from "@/models/Task";

export const dynamic = "force-dynamic";

function jsonNoStore(body: unknown, init?: ResponseInit) {
    const response = NextResponse.json(body, init);
    response.headers.set("Cache-Control", "no-store");
    return response;
}

function escapeRegex(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function GET(request: Request) {
    const admin = await getCurrentUser();
    if (!admin) return jsonNoStore({ error: "Authentication required." }, { status: 401 });
    if (admin.role !== "admin") return jsonNoStore({ error: "Admin access required." }, { status: 403 });

    try {
        await connectToDatabase();
        const { searchParams } = new URL(request.url);
        const status = searchParams.get("status") || "all";
        const query = (searchParams.get("q") || "").trim().slice(0, 120);
        const page = Number(searchParams.get("page") || "1");
        const limit = Number(searchParams.get("limit") || "20");
        if (!["all", "pending", "processing", "sent"].includes(status)) {
            return jsonNoStore({ error: "Choose a valid email status filter." }, { status: 400 });
        }
        if (!Number.isInteger(page) || page < 1 || ![20, 50, 100].includes(limit)) {
            return jsonNoStore({ error: "Page or page size is invalid." }, { status: 400 });
        }

        const filter: Record<string, unknown> = { type: "workflow_email" };
        if (status !== "all") filter.status = status;
        if (query) {
            const expression = new RegExp(escapeRegex(query), "i");
            filter.$or = [{ to: expression }, { workflowEvent: expression }, { subject: expression }, { lastError: expression }];
        }
        const [total, items] = await Promise.all([
            EmailOutbox.countDocuments(filter),
            EmailOutbox.find(filter)
                .sort({ createdAt: -1 })
                .skip((page - 1) * limit)
                .limit(limit)
                .select("to workflowEvent relatedTask subject status attempts lastError createdAt updatedAt processingAt sentAt providerMessageId")
                .lean(),
        ]);
        const taskIds = [...new Set(items.flatMap((item) => item.relatedTask ? [item.relatedTask.toString()] : []))]
            .map((id) => new mongoose.Types.ObjectId(id));
        const tasks = taskIds.length ? await Task.find({ _id: { $in: taskIds } }).select("title").lean() : [];
        const taskById = new Map(tasks.map((task) => [task._id.toString(), task.title]));

        return jsonNoStore({
            emails: items.map((item) => ({
                id: item._id.toString(),
                recipient: item.to || "Unavailable",
                event: item.workflowEvent || "Unknown event",
                subject: item.subject || "Unavailable",
                relatedProject: item.relatedTask ? taskById.get(item.relatedTask.toString()) || "Project unavailable" : null,
                status: item.status,
                attempts: item.attempts,
                failureReason: item.lastError || null,
                createdAt: item.createdAt,
                lastAttemptAt: item.processingAt || item.sentAt || (item.attempts > 0 ? item.updatedAt : null),
                providerMessageId: item.providerMessageId || null,
            })),
            pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
        });
    } catch (error) {
        console.error("Admin email outbox listing failed.", {
            errorName: error instanceof Error ? error.name : "UnknownError",
            message: error instanceof Error ? error.message.slice(0, 300) : "Unknown failure",
        });
        return jsonNoStore({ error: "Email delivery records are temporarily unavailable." }, { status: 503 });
    }
}

export async function POST(request: Request) {
    const admin = await getCurrentUser();
    if (!admin) return jsonNoStore({ error: "Authentication required." }, { status: 401 });
    if (admin.role !== "admin") return jsonNoStore({ error: "Admin access required." }, { status: 403 });
    let body: { emailId?: unknown };
    try {
        body = await request.json() as typeof body;
    } catch {
        return jsonNoStore({ error: "An email record is required." }, { status: 400 });
    }
    const emailId = typeof body.emailId === "string" ? body.emailId : "";
    if (!mongoose.Types.ObjectId.isValid(emailId)) return jsonNoStore({ error: "Email record not found." }, { status: 404 });

    try {
        await connectToDatabase();
        const queued = await EmailOutbox.findOneAndUpdate(
            { _id: emailId, type: "workflow_email", status: "pending", attempts: { $gt: 0 } },
            { $set: { nextAttemptAt: new Date() }, $unset: { lastError: 1 } },
            { returnDocument: "after" },
        ).select("_id");
        if (!queued) {
            return jsonNoStore({ error: "Only a failed email awaiting retry can be retried. Accepted emails cannot be resent here." }, { status: 409 });
        }
        await processWorkflowEmailOutbox(1, [queued._id]);
        const current = await EmailOutbox.findById(queued._id).select("status attempts lastError sentAt providerMessageId").lean();
        return jsonNoStore({
            message: current?.status === "sent" ? "Email accepted by the provider; inbox delivery is not confirmed." : "Email retry queued.",
            email: current ? {
                status: current.status,
                attempts: current.attempts,
                failureReason: current.lastError || null,
                providerAcceptedAt: current.sentAt || null,
                providerMessageId: current.providerMessageId || null,
            } : null,
        });
    } catch (error) {
        console.error("Admin email retry failed.", {
            errorName: error instanceof Error ? error.name : "UnknownError",
            message: error instanceof Error ? error.message.slice(0, 300) : "Unknown failure",
        });
        return jsonNoStore({ error: "The email could not be retried." }, { status: 503 });
    }
}
