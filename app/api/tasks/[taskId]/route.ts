import mongoose from "mongoose";
import { NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/mongodb";
import { getCurrentUser } from "@/lib/current-user";
import Application from "@/models/Application";
import Conversation from "@/models/Conversation";
import Dispute from "@/models/Dispute";
import Notification from "@/models/Notification";
import PaymentTransaction from "@/models/PaymentTransaction";
import ProjectSubmission from "@/models/ProjectSubmission";
import UserPreference from "@/models/UserPreference";
import Task from "@/models/Task";
import User from "@/models/User";
import { sendWorkflowEmailSafely } from "@/lib/workflow-email";

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
            .select("_id title description amount category status isDeleted createdAt employer freelancer employerNameSnapshot freelancerNameSnapshot")
            .lean();
        if (!task) {
            return jsonNoStore({ error: "Project not found." }, { status: 404 });
        }

        const isEmployer = currentUser.role === "employer" && task.employer?.toString() === currentUser.userId;
        const isAssignedFreelancer = currentUser.role === "freelancer" && task.freelancer?.toString() === currentUser.userId;
        const isAdmin = currentUser.role === "admin";
        const isFreelancerBrowsingOpenJob = currentUser.role === "freelancer" && task.status === "open" && !task.isDeleted && !task.freelancer;
        if (!isFreelancerBrowsingOpenJob && !isEmployer && !isAssignedFreelancer && !isAdmin) {
            return jsonNoStore({ error: "Project not found." }, { status: 404 });
        }

        const [employer, freelancer, successfulPayment] = await Promise.all([
            task.employer ? User.findById(task.employer).select("name").lean() : null,
            task.freelancer ? User.findById(task.freelancer).select("name").lean() : null,
            (isEmployer || isAssignedFreelancer || isAdmin
                ? PaymentTransaction.findOne({ task: task._id, status: "success" })
                .sort({ verifiedAt: -1 })
                .select("amount currency verifiedAt")
                .lean()
                : Promise.resolve(null)),
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
            funding: successfulPayment ? {
                status: "funded" as const,
                amount: successfulPayment.amount,
                currency: successfulPayment.currency,
                verifiedAt: successfulPayment.verifiedAt,
            } : null,
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
        const existingTask = await Task.findById(taskId).select("employer freelancer status title isDeleted").lean();
        if (!existingTask) {
            return jsonNoStore({ error: "Project not found." }, { status: 404 });
        }
        if (existingTask.employer.toString() === currentUser.userId) {
            return jsonNoStore({ error: "You cannot apply to your own project." }, { status: 403 });
        }
        if (existingTask.isDeleted || existingTask.status !== "open" || existingTask.freelancer) {
            return jsonNoStore({ error: "This project is no longer accepting applications." }, { status: 409 });
        }

        const session = await mongoose.startSession();
        let applicationId = "";
        try {
            await session.withTransaction(async () => {
                const claimedOpenJob = await Task.findOneAndUpdate(
                    { _id: taskId, status: "open", isDeleted: { $ne: true }, employer: { $ne: currentUser.userId }, $or: [{ freelancer: { $exists: false } }, { freelancer: null }] },
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
                        recipientRole: "employer",
                        actor: currentUser.userId,
                        type: "application",
                        title: "New job application",
                        body: "A freelancer applied to one of your jobs.",
                        relatedTask: taskId,
                        relatedApplication: application._id,
                        eventKey: `application:${application._id}:created`,
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
        try {
            const [client, freelancer] = await Promise.all([
                User.findById(existingTask.employer).select("name email isVerified").lean(),
                User.findById(currentUser.userId).select("name email isVerified").lean(),
            ]);
            await sendWorkflowEmailSafely("freelancer_applied", client, {
                subject: "A freelancer has applied to your job on FreelanceX.",
                heading: "New application for your job",
                message: "A freelancer has applied to your job.",
                details: [
                    { label: "Freelancer", value: freelancer?.name || "Freelancer" },
                    { label: "Job", value: existingTask.title },
                ],
                actionPath: "/client/dashboard/applications",
                actionLabel: "Review applications",
            });
        } catch (emailError) {
            console.error("Application email notification could not be prepared.", {
                errorName: emailError instanceof Error ? emailError.name : "UnknownError",
            });
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
            const session = await mongoose.startSession();
            let updated;
            try {
                updated = await session.withTransaction(async () => {
                    if (await Application.exists({ task: taskId, status: "pending" }).session(session)) {
                        throw new Error("PENDING_APPLICATIONS");
                    }
                    const cancelledTask = await Task.findOneAndUpdate(
                        { _id: taskId, employer: user.userId, status: task.status, $or: [{ freelancer: { $exists: false } }, { freelancer: null }] },
                        { $set: { status: "cancelled" } },
                        { returnDocument: "after", session },
                    );
                    if (!cancelledTask) throw new Error("CANCELLATION_STATE_CHANGED");
                    await Notification.create([{
                        recipient: user.userId,
                        recipientRole: "employer",
                        type: "job_cancelled",
                        title: "Job posting cancelled",
                        body: `Your job posting "${task.title}" was cancelled.`,
                        relatedTask: taskId,
                        eventKey: `task:${taskId}:cancelled`,
                        href: `/client/dashboard/projects/${taskId}`,
                    }], { session });
                    return cancelledTask;
                });
            } catch (error) {
                if (error instanceof Error && error.message === "PENDING_APPLICATIONS") {
                    return jsonNoStore({ error: "Review or reject pending applications before cancelling this posting." }, { status: 409 });
                }
                if (error instanceof Error && error.message === "CANCELLATION_STATE_CHANGED") {
                    return jsonNoStore({ error: "This posting is no longer eligible for cancellation." }, { status: 409 });
                }
                throw error;
            } finally {
                await session.endSession();
            }
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

export async function DELETE(_request: Request, context: { params: Promise<{ taskId: string }> }) {
    const user = await getCurrentUser();
    if (!user) return jsonNoStore({ error: "Authentication required." }, { status: 401 });
    if (user.role !== "employer") return jsonNoStore({ error: "Only the job owner can delete a posting." }, { status: 403 });

    const { taskId } = await context.params;
    if (!mongoose.Types.ObjectId.isValid(taskId)) return jsonNoStore({ error: "Job not found." }, { status: 404 });

    try {
        await connectToDatabase();
        const session = await mongoose.startSession();
        let deletion: { title: string; archived: boolean; deletedAt: Date } | undefined;
        try {
            deletion = await session.withTransaction(async () => {
                const task = await Task.findOne({ _id: taskId, employer: user.userId, isDeleted: { $ne: true } }).select("title status freelancer").session(session).lean();
                if (!task) throw new Error("JOB_NOT_FOUND");

                const [hasApplications, hasPayments, hasSubmissions, hasDisputes] = await Promise.all([
                    Application.exists({ task: taskId }).session(session),
                    PaymentTransaction.exists({ task: taskId }).session(session),
                    ProjectSubmission.exists({ task: taskId }).session(session),
                    Dispute.exists({ task: taskId }).session(session),
                ]);
                const preserveHistory = Boolean(hasApplications || hasPayments || hasSubmissions || hasDisputes || task.freelancer || task.status !== "open");
                const deletedAt = new Date();
                if (preserveHistory) {
                    const archived = await Task.updateOne(
                        { _id: taskId, employer: user.userId, isDeleted: { $ne: true } },
                        { $set: { isDeleted: true, deletedAt } },
                        { session },
                    );
                    if (archived.modifiedCount !== 1) throw new Error("JOB_DELETE_STATE_CHANGED");
                } else {
                    const removed = await Task.deleteOne({ _id: taskId, employer: user.userId, isDeleted: { $ne: true }, status: "open" }, { session });
                    if (removed.deletedCount !== 1) throw new Error("JOB_DELETE_STATE_CHANGED");
                }
                await Notification.create([{
                    recipient: user.userId,
                    recipientRole: "employer",
                    type: "job_deleted",
                    title: "Job posting deleted",
                    body: preserveHistory ? `"${task.title}" was safely archived to preserve its project or application history.` : `"${task.title}" was deleted.`,
                    relatedTask: taskId,
                    eventKey: `task:${taskId}:deleted`,
                    href: "/client/dashboard/projects",
                }], { session });
                return { title: task.title, archived: preserveHistory, deletedAt };
            });
        } finally {
            await session.endSession();
        }

        if (!deletion) return jsonNoStore({ error: "The job could not be deleted." }, { status: 409 });
        try {
            const client = await User.findById(user.userId).select("name email isVerified").lean();
            await sendWorkflowEmailSafely("job_deleted_client", client, {
                subject: "Your FreelanceX job posting was deleted.",
                heading: deletion.archived ? "Job posting archived" : "Job posting deleted",
                message: deletion.archived
                    ? "The posting was removed from your active jobs and safely archived to preserve project or application history."
                    : "The posting was deleted successfully.",
                details: [
                    { label: "Job title", value: deletion.title },
                    { label: "Job reference", value: taskId },
                    { label: "Deletion date", value: deletion.deletedAt.toLocaleString("en-NG", { timeZone: "UTC" }) + " UTC" },
                    { label: "Deletion status", value: deletion.archived ? "Archived; history preserved" : "Deleted" },
                ],
                actionPath: "/client/dashboard/projects",
                actionLabel: "View My Jobs",
            });
        } catch (mailError) {
            console.error("Job deletion confirmation email could not be prepared.", { errorName: mailError instanceof Error ? mailError.name : "UnknownError" });
        }
        return jsonNoStore({ message: deletion.archived ? "Job archived to preserve its history." : "Job deleted.", archived: deletion.archived });
    } catch (error) {
        if (error instanceof Error && error.message === "JOB_NOT_FOUND") return jsonNoStore({ error: "Job not found." }, { status: 404 });
        if (error instanceof Error && error.message === "JOB_DELETE_STATE_CHANGED") return jsonNoStore({ error: "The job changed before deletion completed. Refresh and retry." }, { status: 409 });
        console.error("Job deletion error:", { errorName: error instanceof Error ? error.name : "UnknownError" });
        return jsonNoStore({ error: "The job could not be deleted." }, { status: 503 });
    }
}

export async function PUT(request: Request, context: { params: Promise<{ taskId: string }> }) {
    const user = await getCurrentUser();
    if (!user) return jsonNoStore({ error: "Authentication required." }, { status: 401 });
    if (user.role !== "employer") return jsonNoStore({ error: "Only the job owner can edit a posting." }, { status: 403 });

    const { taskId } = await context.params;
    if (!mongoose.Types.ObjectId.isValid(taskId)) return jsonNoStore({ error: "Job not found." }, { status: 404 });

    let body: { title?: unknown; description?: unknown; category?: unknown; amount?: unknown };
    try {
        body = await request.json() as typeof body;
    } catch {
        return jsonNoStore({ error: "Job details are invalid." }, { status: 400 });
    }
    const title = typeof body.title === "string" ? body.title.trim() : "";
    const description = typeof body.description === "string" ? body.description.trim() : "";
    const category = body.category;
    const amount = Number(body.amount);
    if (!title || title.length > 180 || !description || description.length > 5000 || !Number.isFinite(amount) || amount <= 0 ||
        typeof category !== "string" || !["Development", "Design", "Writing", "Marketing"].includes(category)) {
        return jsonNoStore({ error: "Enter a valid title, description, category, and positive budget." }, { status: 400 });
    }

    try {
        await connectToDatabase();
        const session = await mongoose.startSession();
        let updated;
        try {
            updated = await session.withTransaction(async () => {
                const task = await Task.findOne({ _id: taskId, employer: user.userId, isDeleted: { $ne: true } }).select("status freelancer").session(session).lean();
                if (!task) throw new Error("JOB_NOT_FOUND");
                if (task.status !== "open" || task.freelancer) throw new Error("JOB_NOT_EDITABLE");
                if (await Application.exists({ task: taskId, status: "pending" }).session(session)) throw new Error("JOB_HAS_PENDING_APPLICATIONS");
                return Task.findOneAndUpdate(
                    { _id: taskId, employer: user.userId, status: "open", isDeleted: { $ne: true }, $or: [{ freelancer: { $exists: false } }, { freelancer: null }] },
                    { $set: { title, description, category, amount } },
                    { returnDocument: "after", session },
                );
            });
        } finally {
            await session.endSession();
        }
        if (!updated) return jsonNoStore({ error: "The job changed before it could be updated. Refresh and retry." }, { status: 409 });
        return jsonNoStore({ task: { id: updated._id.toString(), title: updated.title, description: updated.description, category: updated.category, amount: updated.amount } });
    } catch (error) {
        if (error instanceof Error && error.message === "JOB_NOT_FOUND") return jsonNoStore({ error: "Job not found." }, { status: 404 });
        if (error instanceof Error && error.message === "JOB_NOT_EDITABLE") return jsonNoStore({ error: "Only an open, unassigned job can be edited." }, { status: 409 });
        if (error instanceof Error && error.message === "JOB_HAS_PENDING_APPLICATIONS") return jsonNoStore({ error: "Review pending applications before editing this job." }, { status: 409 });
        console.error("Job update error:", { errorName: error instanceof Error ? error.name : "UnknownError" });
        return jsonNoStore({ error: "The job could not be updated." }, { status: 503 });
    }
}
