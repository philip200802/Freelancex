import mongoose from "mongoose";
import { NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/mongodb";
import { getCurrentUser } from "@/lib/current-user";
import Application from "@/models/Application";
import Conversation from "@/models/Conversation";
import Notification from "@/models/Notification";
import ProjectSubmission from "@/models/ProjectSubmission";
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

    const currentUser = await getCurrentUser();
    if (!currentUser) {
        return jsonNoStore({ error: "Authentication required." }, { status: 401 });
    }

    try {
        await connectToDatabase();
        const task = await Task.findById(taskId)
            .select("_id title description amount category status createdAt employer freelancer employerNameSnapshot freelancerNameSnapshot")
            .lean();
        if (!task) {
            return jsonNoStore({ error: "Project not found." }, { status: 404 });
        }

        const isEmployer = currentUser.role === "employer" && task.employer?.toString() === currentUser.userId;
        const isAssignedFreelancer = currentUser.role === "freelancer" && task.freelancer?.toString() === currentUser.userId;
        const isAdmin = currentUser.role === "admin";
        const isFreelancerBrowsingOpenJob = currentUser.role === "freelancer" && task.status === "open" && !task.freelancer;
        if (!isFreelancerBrowsingOpenJob && !isEmployer && !isAssignedFreelancer && !isAdmin) {
            return jsonNoStore({ error: "Project not found." }, { status: 404 });
        }

        const [employer, freelancer] = await Promise.all([
            task.employer ? User.findById(task.employer).select("name").lean() : null,
            task.freelancer ? User.findById(task.freelancer).select("name").lean() : null,
        ]);
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
            employer: employer ? { name: task.employerNameSnapshot || employer.name } : task.employerNameSnapshot ? { name: task.employerNameSnapshot } : null,
            freelancer: freelancer ? { name: task.freelancerNameSnapshot || freelancer.name } : task.freelancerNameSnapshot ? { name: task.freelancerNameSnapshot } : null,
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
                    { returnDocument: "after", session },
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

                let conversation = await Conversation.findOne({
                    task: taskId,
                    participants: { $all: [existingTask.employer, currentUser.userId], $size: 2 },
                }).session(session).lean();
                if (!conversation) {
                    try {
                        [conversation] = await Conversation.create([{ task: taskId, participants: [existingTask.employer, currentUser.userId] }], { session });
                    } catch (conversationError) {
                        const duplicateError = conversationError as { code?: number };
                        if (duplicateError.code !== 11000) throw conversationError;
                        conversation = await Conversation.findOne({
                            task: taskId,
                            participants: { $all: [existingTask.employer, currentUser.userId], $size: 2 },
                        }).session(session).lean();
                    }
                }
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

export async function PATCH(request: Request, context: { params: Promise<{ taskId: string }> }) {
    const user = await getCurrentUser();
    if (!user) return jsonNoStore({ error: "Authentication required." }, { status: 401 });

    const { taskId } = await context.params;
    if (!mongoose.Types.ObjectId.isValid(taskId)) return jsonNoStore({ error: "Project not found." }, { status: 404 });

    let body: { action?: unknown };
    try {
        body = await request.json() as { action?: unknown };
    } catch {
        return jsonNoStore({ error: "A valid project action is required." }, { status: 400 });
    }

    const action = typeof body.action === "string" ? body.action.trim() : "";
    if (!action || !["fund", "submit", "complete", "cancel"].includes(action)) {
        return jsonNoStore({ error: "Choose a valid project action." }, { status: 400 });
    }

    try {
        await connectToDatabase();
        const task = await Task.findById(taskId).select("employer freelancer status title amount employerNameSnapshot freelancerNameSnapshot").lean();
        if (!task) return jsonNoStore({ error: "Project not found." }, { status: 404 });

        if (action === "fund") {
            return jsonNoStore({ error: "Project funding must be completed and verified through Paystack." }, { status: 409 });
        }

        if (action === "cancel") {
            if (user.role !== "employer" || task.employer?.toString() !== user.userId) {
                return jsonNoStore({ error: "Only the project owner can cancel this posting." }, { status: 403 });
            }
            if (!["open", "pending_approval"].includes(task.status) || task.freelancer) {
                return jsonNoStore({ error: "Only an unassigned posting can be cancelled." }, { status: 409 });
            }
            if (await Application.exists({ task: taskId, status: "pending" })) {
                return jsonNoStore({ error: "Review or reject pending applications before cancelling this posting." }, { status: 409 });
            }
            const updated = await Task.findOneAndUpdate(
                { _id: taskId, employer: user.userId, status: task.status, $or: [{ freelancer: { $exists: false } }, { freelancer: null }] },
                { $set: { status: "cancelled" } },
                { returnDocument: "after" },
            );
            if (!updated) return jsonNoStore({ error: "This posting is no longer eligible for cancellation." }, { status: 409 });
            return jsonNoStore({ message: "Posting cancelled.", task: { id: updated._id.toString(), status: updated.status } });
        }

        if (action === "submit") {
            if (user.role !== "freelancer" || task.freelancer?.toString() !== user.userId) {
                return jsonNoStore({ error: "Only the assigned freelancer can submit work." }, { status: 403 });
            }
            return jsonNoStore({ error: "Use the project submission form to submit work and preserve its history." }, { status: 409 });
        }

        if (user.role !== "employer" || task.employer?.toString() !== user.userId) {
            return jsonNoStore({ error: "Only the project owner can complete the project." }, { status: 403 });
        }
        if (task.status !== "submitted") {
            return jsonNoStore({ error: "The project must be submitted and reviewed before it can be completed." }, { status: 400 });
        }
        if (await ProjectSubmission.exists({ task: taskId })) {
            return jsonNoStore({ error: "Review the current submission using the project review controls." }, { status: 409 });
        }
        const updated = await Task.findOneAndUpdate({ _id: taskId, employer: user.userId, status: "submitted" }, { status: "completed" }, { returnDocument: "after" });
        if (!updated) return jsonNoStore({ error: "This project is no longer eligible to complete." }, { status: 409 });
        return jsonNoStore({ message: "Project marked complete. You can now leave a review for this freelancer.", task: { id: updated._id.toString(), status: updated.status } });
    } catch (error) {
        console.error("Project status update error:", error);
        return jsonNoStore({ error: "The project status could not be updated." }, { status: 500 });
    }
}
