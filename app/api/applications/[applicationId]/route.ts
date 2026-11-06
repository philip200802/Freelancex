import mongoose from "mongoose";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { connectToDatabase } from "@/lib/mongodb";
import Application from "@/models/Application";
import Conversation from "@/models/Conversation";
import Notification from "@/models/Notification";
import Task from "@/models/Task";
import User from "@/models/User";
import { sendWorkflowEmailSafely } from "@/lib/workflow-email";

export const dynamic = "force-dynamic";

function jsonNoStore(body: unknown, init?: ResponseInit) {
    const response = NextResponse.json(body, init);
    response.headers.set("Cache-Control", "no-store");
    return response;
}

async function notifyApplicationDecision({
    freelancerId,
    taskId,
    taskTitle,
    action,
}: {
    freelancerId: unknown;
    taskId: string;
    taskTitle: string;
    action: "accept" | "reject";
}) {
    try {
        const freelancer = await User.findById(freelancerId).select("name email isVerified").lean();
        await sendWorkflowEmailSafely(`application_${action}`, freelancer, action === "accept" ? {
            subject: "Congratulations! Your FreelanceX application has been accepted.",
            heading: "Your application was accepted",
            message: "The client accepted your application. Review the project details and follow the funding status before starting work.",
            details: [{ label: "Job", value: taskTitle }],
            actionPath: `/freelancer/dashboard/projects/${taskId}`,
            actionLabel: "View assigned project",
        } : {
            subject: "Update on your FreelanceX application.",
            heading: "An update on your application",
            message: "The client has decided to move forward with another applicant for this job. Thank you for your interest and for taking the time to apply.",
            details: [{ label: "Job", value: taskTitle }],
            actionPath: "/freelancer/dashboard/applications",
            actionLabel: "View applications",
        });
    } catch (error) {
        console.error("Application decision email could not be prepared.", {
            errorName: error instanceof Error ? error.name : "UnknownError",
        });
    }
}

export async function PATCH(request: Request, context: { params: Promise<{ applicationId: string }> }) {
    const user = await getCurrentUser();
    if (!user) return jsonNoStore({ error: "Authentication required." }, { status: 401 });
    if (user.role !== "employer") return jsonNoStore({ error: "Only employers can review applications." }, { status: 403 });

    const { applicationId } = await context.params;
    if (applicationId.startsWith("legacy-")) {
        const taskId = applicationId.slice("legacy-".length);
        if (!mongoose.Types.ObjectId.isValid(taskId)) return jsonNoStore({ error: "Application not found." }, { status: 404 });
        let legacyBody: { action?: string };
        try {
            legacyBody = await request.json() as { action?: string };
        } catch {
            return jsonNoStore({ error: "A valid application action is required." }, { status: 400 });
        }
        if (legacyBody.action !== "accept" && legacyBody.action !== "reject") {
            return jsonNoStore({ error: "Choose whether to accept or reject this application." }, { status: 400 });
        }

        try {
            await connectToDatabase();
            const task = await Task.findOne({ _id: taskId, employer: user.userId, status: "pending_approval", isDeleted: { $ne: true } }).select("employer freelancer title").lean();
            if (!task?.freelancer) return jsonNoStore({ error: "Pending application not found." }, { status: 404 });
            const rejectedFreelancerIds: unknown[] = [];

            if (legacyBody.action === "accept") {
                const session = await mongoose.startSession();
                try {
                    await session.withTransaction(async () => {
                        const updatedTask = await Task.findOneAndUpdate(
                            { _id: taskId, employer: user.userId, status: "pending_approval", isDeleted: { $ne: true }, freelancer: task.freelancer },
                            { status: "awaiting_funding" },
                            { returnDocument: "after", session },
                        );
                        if (!updatedTask) throw new Error("APPLICATION_CHANGED");
                        const acceptedApplication = await Application.findOneAndUpdate(
                            { task: taskId, freelancer: task.freelancer },
                            {
                                $set: { status: "accepted" },
                                $setOnInsert: { task: taskId, employer: user.userId, freelancer: task.freelancer, message: "" },
                            },
                            { upsert: true, returnDocument: "after", setDefaultsOnInsert: true, session },
                        );
                        const otherApplications = await Application.find({
                            task: taskId,
                            freelancer: { $ne: task.freelancer },
                            status: "pending",
                        }).select("freelancer").session(session).lean();
                        rejectedFreelancerIds.splice(0, rejectedFreelancerIds.length, ...otherApplications.map((application) => application.freelancer));
                        await Application.updateMany(
                            { task: taskId, freelancer: { $ne: task.freelancer }, status: "pending" },
                            { status: "rejected" },
                            { session },
                        );
                        if (otherApplications.length) {
                            await Notification.create(otherApplications.map((application) => ({
                                recipient: application.freelancer,
                                recipientRole: "freelancer" as const,
                                actor: user.userId,
                                type: "application_rejected",
                                title: "Application update",
                                body: "The employer selected another freelancer for this project.",
                                relatedTask: taskId,
                                relatedApplication: application._id,
                                eventKey: `application:${application._id}:rejected`,
                                href: "/freelancer/dashboard/applications",
                            })), { session });
                        }
                        let conversation = await Conversation.findOne({ task: taskId, participants: { $all: [user.userId, task.freelancer], $size: 2 } }).session(session).lean();
                        if (!conversation) {
                            try {
                                [conversation] = await Conversation.create([{ task: taskId, participants: [user.userId, task.freelancer] }], { session });
                            } catch (conversationError) {
                                const duplicateError = conversationError as { code?: number };
                                if (duplicateError.code !== 11000) throw conversationError;
                                conversation = await Conversation.findOne({ task: taskId, participants: { $all: [user.userId, task.freelancer], $size: 2 } }).session(session).lean();
                            }
                        }
                        await Notification.create([{
                            recipient: task.freelancer,
                            recipientRole: "freelancer",
                            actor: user.userId,
                            type: "application_accepted",
                            title: "Application accepted",
                            body: "Your application was accepted. The client must fund the project before work can begin.",
                            relatedTask: taskId,
                            relatedApplication: acceptedApplication?._id,
                            eventKey: `task:${taskId}:application-accepted:${task.freelancer}`,
                            href: "/freelancer/dashboard/contracts",
                        }], { session });
                    });
                } catch (error) {
                    if (error instanceof Error && error.message === "APPLICATION_CHANGED") {
                        return jsonNoStore({ error: "This application has already been updated." }, { status: 409 });
                    }
                    throw error;
                } finally {
                    await session.endSession();
                }
            } else {
                const session = await mongoose.startSession();
                try {
                    await session.withTransaction(async () => {
                        const updatedTask = await Task.findOneAndUpdate(
                            { _id: taskId, employer: user.userId, status: "pending_approval", isDeleted: { $ne: true }, freelancer: task.freelancer },
                            { $set: { status: "open" }, $unset: { freelancer: 1 } },
                            { returnDocument: "after", session },
                        );
                        if (!updatedTask) throw new Error("APPLICATION_CHANGED");
                        await Application.findOneAndUpdate(
                            { task: taskId, freelancer: task.freelancer },
                            {
                                $set: { status: "rejected" },
                                $setOnInsert: { task: taskId, employer: user.userId, freelancer: task.freelancer, message: "" },
                            },
                            { upsert: true, returnDocument: "after", setDefaultsOnInsert: true, session },
                        );
                        await Notification.create([{
                            recipient: task.freelancer,
                            recipientRole: "freelancer",
                            actor: user.userId,
                            type: "application_rejected",
                            title: "Application update",
                            body: "The employer has declined your application.",
                            relatedTask: taskId,
                            eventKey: `task:${taskId}:application-rejected:${task.freelancer}`,
                            href: "/freelancer/dashboard/applications",
                        }], { session });
                    });
                } catch (error) {
                    if (error instanceof Error && error.message === "APPLICATION_CHANGED") {
                        return jsonNoStore({ error: "This application has already been updated." }, { status: 409 });
                    }
                    throw error;
                } finally {
                    await session.endSession();
                }
            }
            await notifyApplicationDecision({
                freelancerId: task.freelancer,
                taskId,
                taskTitle: task.title,
                action: legacyBody.action,
            });
            for (const freelancerId of rejectedFreelancerIds) {
                await notifyApplicationDecision({ freelancerId, taskId, taskTitle: task.title, action: "reject" });
            }
            return jsonNoStore({
                application: { id: applicationId, status: legacyBody.action === "accept" ? "accepted" : "rejected" },
                ...(legacyBody.action === "accept" ? { redirectTo: `/client/dashboard/projects/${taskId}/fund` } : {}),
            });
        } catch (error) {
            console.error("Legacy application review error:", error);
            return jsonNoStore({ error: "The application could not be updated." }, { status: 500 });
        }
    }

    if (!mongoose.Types.ObjectId.isValid(applicationId)) {
        return jsonNoStore({ error: "Application not found." }, { status: 404 });
    }

    let body: { action?: string };
    try {
        body = await request.json() as { action?: string };
    } catch {
        return jsonNoStore({ error: "A valid application action is required." }, { status: 400 });
    }
    if (body.action !== "accept" && body.action !== "reject") {
        return jsonNoStore({ error: "Choose whether to accept or reject this application." }, { status: 400 });
    }

    try {
        await connectToDatabase();
        const application = await Application.findOne({ _id: applicationId, employer: user.userId, status: "pending" });
        if (!application) return jsonNoStore({ error: "Pending application not found." }, { status: 404 });
        const rejectedFreelancerIds: unknown[] = [];

        if (body.action === "accept") {
            const session = await mongoose.startSession();
            try {
                await session.withTransaction(async () => {
                    const task = await Task.findOneAndUpdate(
                        { _id: application.task, employer: user.userId, status: "open", isDeleted: { $ne: true }, $or: [{ freelancer: { $exists: false } }, { freelancer: null }] },
                        { freelancer: application.freelancer, status: "awaiting_funding" },
                        { returnDocument: "after", session },
                    );
                    if (!task) throw new Error("JOB_NOT_AVAILABLE");

                    application.status = "accepted";
                    await application.save({ session });
                    const otherApplications = await Application.find({
                        task: application.task,
                        _id: { $ne: application._id },
                        status: "pending",
                    }).select("freelancer").session(session).lean();
                    rejectedFreelancerIds.splice(0, rejectedFreelancerIds.length, ...otherApplications.map((otherApplication) => otherApplication.freelancer));
                    await Application.updateMany(
                        { task: application.task, _id: { $ne: application._id }, status: "pending" },
                        { status: "rejected" },
                        { session },
                    );
                    if (otherApplications.length) {
                        await Notification.create(otherApplications.map((otherApplication) => ({
                            recipient: otherApplication.freelancer,
                            recipientRole: "freelancer" as const,
                            actor: user.userId,
                            type: "application_rejected",
                            title: "Application update",
                            body: "The employer selected another freelancer for this project.",
                            relatedTask: application.task,
                            relatedApplication: otherApplication._id,
                            eventKey: `application:${otherApplication._id}:rejected`,
                            href: "/freelancer/dashboard/applications",
                        })), { session });
                    }
                    await Notification.create([{
                        recipient: application.freelancer,
                        recipientRole: "freelancer",
                        actor: user.userId,
                        type: "application_accepted",
                        title: "Application accepted",
                        body: "Your application was accepted. The client must fund the project before work can begin.",
                        relatedTask: application.task,
                        relatedApplication: application._id,
                        eventKey: `application:${application._id}:accepted`,
                        href: "/freelancer/dashboard/contracts",
                    }], { session });
                });
            } catch (error) {
                if (error instanceof Error && error.message === "JOB_NOT_AVAILABLE") {
                    return jsonNoStore({ error: "This job is no longer available to accept." }, { status: 409 });
                }
                throw error;
            } finally {
                await session.endSession();
            }
        } else {
            application.status = "rejected";
            await application.save();
            await Notification.create({
                recipient: application.freelancer,
                recipientRole: "freelancer",
                actor: user.userId,
                type: "application_rejected",
                title: "Application update",
                body: "The employer has declined your application.",
                relatedTask: application.task,
                relatedApplication: application._id,
                eventKey: `application:${application._id}:rejected`,
                href: "/freelancer/dashboard/applications",
            });
        }

        try {
            const task = await Task.findById(application.task).select("title").lean();
            const taskTitle = task?.title || "Your job";
            await notifyApplicationDecision({
                freelancerId: application.freelancer,
                taskId: application.task.toString(),
                taskTitle,
                action: body.action,
            });
            for (const freelancerId of rejectedFreelancerIds) {
                await notifyApplicationDecision({ freelancerId, taskId: application.task.toString(), taskTitle, action: "reject" });
            }
        } catch (emailError) {
            console.error("Application emails could not be prepared.", {
                errorName: emailError instanceof Error ? emailError.name : "UnknownError",
            });
        }

        return jsonNoStore({
            application: { id: application.id, status: application.status },
            ...(body.action === "accept" ? { redirectTo: `/client/dashboard/projects/${application.task.toString()}/fund` } : {}),
        });
    } catch (error) {
        console.error("Application review error:", error);
        return jsonNoStore({ error: "The application could not be updated." }, { status: 500 });
    }
}
