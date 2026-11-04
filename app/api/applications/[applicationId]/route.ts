import mongoose from "mongoose";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { connectToDatabase } from "@/lib/mongodb";
import Application from "@/models/Application";
import Conversation from "@/models/Conversation";
import Notification from "@/models/Notification";
import Task from "@/models/Task";

export const dynamic = "force-dynamic";

function jsonNoStore(body: unknown, init?: ResponseInit) {
    const response = NextResponse.json(body, init);
    response.headers.set("Cache-Control", "no-store");
    return response;
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
            const task = await Task.findOne({ _id: taskId, employer: user.userId, status: "pending_approval" }).select("employer freelancer title").lean();
            if (!task?.freelancer) return jsonNoStore({ error: "Pending application not found." }, { status: 404 });

            if (legacyBody.action === "accept") {
                const session = await mongoose.startSession();
                try {
                    await session.withTransaction(async () => {
                        const updatedTask = await Task.findOneAndUpdate(
                            { _id: taskId, employer: user.userId, status: "pending_approval", freelancer: task.freelancer },
                            { status: "funded" },
                            { new: true, session },
                        );
                        if (!updatedTask) throw new Error("APPLICATION_CHANGED");
                        await Application.findOneAndUpdate(
                            { task: taskId, freelancer: task.freelancer },
                            {
                                $set: { status: "accepted" },
                                $setOnInsert: { task: taskId, employer: user.userId, freelancer: task.freelancer, message: "" },
                            },
                            { upsert: true, new: true, setDefaultsOnInsert: true, session },
                        );
                        const otherApplications = await Application.find({
                            task: taskId,
                            freelancer: { $ne: task.freelancer },
                            status: "pending",
                        }).select("freelancer").session(session).lean();
                        await Application.updateMany(
                            { task: taskId, freelancer: { $ne: task.freelancer }, status: "pending" },
                            { status: "rejected" },
                            { session },
                        );
                        if (otherApplications.length) {
                            await Notification.create(otherApplications.map((application) => ({
                                recipient: application.freelancer,
                                actor: user.userId,
                                type: "application_rejected",
                                title: "Application update",
                                body: "The employer selected another freelancer for this project.",
                                href: "/freelancer/dashboard/applications",
                            })), { session });
                        }
                        await Conversation.findOneAndUpdate(
                            { task: taskId, participants: { $all: [user.userId, task.freelancer], $size: 2 } },
                            { $setOnInsert: { task: taskId, participants: [user.userId, task.freelancer] } },
                            { upsert: true, new: true, setDefaultsOnInsert: true, session },
                        );
                        await Notification.create([{
                            recipient: task.freelancer,
                            actor: user.userId,
                            type: "application_accepted",
                            title: "Application accepted",
                            body: "Your application was accepted. The project is now in your active work.",
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
                            { _id: taskId, employer: user.userId, status: "pending_approval", freelancer: task.freelancer },
                            { $set: { status: "open" }, $unset: { freelancer: 1 } },
                            { new: true, session },
                        );
                        if (!updatedTask) throw new Error("APPLICATION_CHANGED");
                        await Application.findOneAndUpdate(
                            { task: taskId, freelancer: task.freelancer },
                            {
                                $set: { status: "rejected" },
                                $setOnInsert: { task: taskId, employer: user.userId, freelancer: task.freelancer, message: "" },
                            },
                            { upsert: true, new: true, setDefaultsOnInsert: true, session },
                        );
                        await Notification.create([{
                            recipient: task.freelancer,
                            actor: user.userId,
                            type: "application_rejected",
                            title: "Application update",
                            body: "The employer has declined your application.",
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
            return jsonNoStore({ application: { id: applicationId, status: legacyBody.action === "accept" ? "accepted" : "rejected" } });
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

        if (body.action === "accept") {
            const session = await mongoose.startSession();
            try {
                await session.withTransaction(async () => {
                    const task = await Task.findOneAndUpdate(
                        { _id: application.task, employer: user.userId, status: "open", $or: [{ freelancer: { $exists: false } }, { freelancer: null }] },
                        { freelancer: application.freelancer, status: "funded" },
                        { new: true, session },
                    );
                    if (!task) throw new Error("JOB_NOT_AVAILABLE");

                    application.status = "accepted";
                    await application.save({ session });
                    const otherApplications = await Application.find({
                        task: application.task,
                        _id: { $ne: application._id },
                        status: "pending",
                    }).select("freelancer").session(session).lean();
                    await Application.updateMany(
                        { task: application.task, _id: { $ne: application._id }, status: "pending" },
                        { status: "rejected" },
                        { session },
                    );
                    if (otherApplications.length) {
                        await Notification.create(otherApplications.map((otherApplication) => ({
                            recipient: otherApplication.freelancer,
                            actor: user.userId,
                            type: "application_rejected",
                            title: "Application update",
                            body: "The employer selected another freelancer for this project.",
                            href: "/freelancer/dashboard/applications",
                        })), { session });
                    }
                    await Notification.create([{
                        recipient: application.freelancer,
                        actor: user.userId,
                        type: "application_accepted",
                        title: "Application accepted",
                        body: "Your application was accepted. The project is now in your active work.",
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
                actor: user.userId,
                type: "application_rejected",
                title: "Application update",
                body: "The employer has declined your application.",
                href: "/freelancer/dashboard/applications",
            });
        }

        return jsonNoStore({ application: { id: application.id, status: application.status } });
    } catch (error) {
        console.error("Application review error:", error);
        return jsonNoStore({ error: "The application could not be updated." }, { status: 500 });
    }
}
