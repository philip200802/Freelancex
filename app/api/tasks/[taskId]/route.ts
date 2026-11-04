import mongoose from "mongoose";
import { NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/mongodb";
import { getCurrentUser } from "@/lib/current-user";
import Application from "@/models/Application";
import Conversation from "@/models/Conversation";
import Notification from "@/models/Notification";
import UserPreference from "@/models/UserPreference";
import Task from "@/models/Task";
import User from "@/models/User";

export const dynamic = "force-dynamic";

function jsonNoStore(body: unknown, init?: ResponseInit) {
    const response = NextResponse.json(body, init);
    response.headers.set("Cache-Control", "no-store");
    return response;
}

export async function GET(_request: Request, context: { params: Promise<{ taskId: string }> }) {
    const { taskId } = await context.params;
    if (!mongoose.Types.ObjectId.isValid(taskId)) {
        return jsonNoStore({ error: "Project not found." }, { status: 404 });
    }

    try {
        await connectToDatabase();
        const task = await Task.findById(taskId)
            .select("_id title description amount category status createdAt employer freelancer")
            .lean();
        if (!task) {
            return jsonNoStore({ error: "Project not found." }, { status: 404 });
        }

        const currentUser = await getCurrentUser();
        const isEmployer = currentUser?.role === "employer" && task.employer.toString() === currentUser.userId;
        const isAssignedFreelancer = currentUser?.role === "freelancer" && task.freelancer?.toString() === currentUser.userId;
        const isAdmin = currentUser?.role === "admin";
        const isPubliclyAvailable = task.status === "open" && !task.freelancer;
        if (!isPubliclyAvailable && !isEmployer && !isAssignedFreelancer && !isAdmin) {
            return jsonNoStore({ error: "Project not found." }, { status: 404 });
        }

        const employer = await User.findById(task.employer).select("name").lean();
        const application = currentUser?.role === "freelancer"
            ? await Application.findOne({ task: task._id, freelancer: currentUser.userId }).select("status").lean()
            : null;
        const responseTask = {
            id: task._id.toString(),
            title: task.title,
            description: task.description,
            amount: task.amount,
            category: task.category,
            status: task.status,
            createdAt: task.createdAt,
            employer: employer ? { name: employer.name } : null,
        };
        return jsonNoStore({
            task: responseTask,
            applicationStatus: application?.status || (isAssignedFreelancer && task.status === "pending_approval" ? "pending" : null),
        });
    } catch (error) {
        console.error("Task detail error:", error);
        return jsonNoStore({ error: "Project details are temporarily unavailable." }, { status: 503 });
    }
}

export async function POST(request: Request, context: { params: Promise<{ taskId: string }> }) {
    const { taskId } = await context.params;
    const currentUser = await getCurrentUser();
    if (!currentUser || currentUser.role !== "freelancer") {
        return jsonNoStore({ error: "Only authenticated freelancers can apply to projects." }, { status: 403 });
    }
    if (!mongoose.Types.ObjectId.isValid(taskId)) {
        return jsonNoStore({ error: "Project not found." }, { status: 404 });
    }

    try {
        let body: { message?: unknown } = {};
        try {
            body = await request.json() as { message?: unknown };
        } catch {
            body = {};
        }
        const message = typeof body.message === "string" ? body.message.trim() : "";
        if (message.length > 5000) return jsonNoStore({ error: "Application message must be 5000 characters or fewer." }, { status: 400 });

        await connectToDatabase();
        const existingTask = await Task.findById(taskId).select("employer freelancer status").lean();
        if (!existingTask) {
            return jsonNoStore({ error: "Project not found." }, { status: 404 });
        }
        if (existingTask.employer.toString() === currentUser.userId) {
            return jsonNoStore({ error: "You cannot apply to your own project." }, { status: 403 });
        }
        if (existingTask.status !== "open" || existingTask.freelancer) {
            return jsonNoStore({ error: "This project is no longer accepting applications." }, { status: 409 });
        }

        const session = await mongoose.startSession();
        let applicationId = "";
        try {
            await session.withTransaction(async () => {
                const claimedOpenJob = await Task.findOneAndUpdate(
                    { _id: taskId, status: "open", employer: { $ne: currentUser.userId }, $or: [{ freelancer: { $exists: false } }, { freelancer: null }] },
                    { $inc: { applicationCount: 1 } },
                    { new: true, session },
                );
                if (!claimedOpenJob) throw new Error("JOB_NOT_AVAILABLE");

                const [application] = await Application.create([{
                    task: taskId,
                    employer: existingTask.employer,
                    freelancer: currentUser.userId,
                    message,
                    status: "pending",
                }], { session });
                applicationId = application.id;
                await Conversation.findOneAndUpdate(
                    { task: taskId, participants: { $all: [existingTask.employer, currentUser.userId], $size: 2 } },
                    { $setOnInsert: { task: taskId, participants: [existingTask.employer, currentUser.userId] } },
                    { upsert: true, new: true, setDefaultsOnInsert: true, session },
                );
                const notificationPreference = await UserPreference.findOne({ user: existingTask.employer }).select("inAppNotifications").session(session).lean();
                if (notificationPreference?.inAppNotifications !== false) {
                    await Notification.create([{
                        recipient: existingTask.employer,
                        actor: currentUser.userId,
                        type: "application",
                        title: "New job application",
                        body: "A freelancer applied to one of your jobs.",
                        href: "/client/dashboard/applications",
                    }], { session });
                }
            });
        } catch (error) {
            if (error instanceof Error && error.message === "JOB_NOT_AVAILABLE") {
                return jsonNoStore({ error: "This project is no longer accepting applications." }, { status: 409 });
            }
            throw error;
        } finally {
            await session.endSession();
        }
        return jsonNoStore({ application: { id: applicationId, status: "pending" }, applicationStatus: "pending" }, { status: 201 });
    } catch (error) {
        if (error && typeof error === "object" && "code" in error && error.code === 11000) {
            return jsonNoStore({ error: "You have already applied to this project." }, { status: 409 });
        }
        console.error("Task application error:", error);
        return jsonNoStore({ error: "Application is temporarily unavailable." }, { status: 500 });
    }
}
