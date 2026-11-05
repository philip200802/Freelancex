import mongoose from "mongoose";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { connectToDatabase } from "@/lib/mongodb";
import Notification from "@/models/Notification";
import ProjectSubmission from "@/models/ProjectSubmission";
import Task from "@/models/Task";
import UserPreference from "@/models/UserPreference";

export const dynamic = "force-dynamic";

function jsonNoStore(body: unknown, init?: ResponseInit) {
    const response = NextResponse.json(body, init);
    response.headers.set("Cache-Control", "no-store");
    return response;
}

export async function PATCH(request: Request, context: { params: Promise<{ taskId: string; submissionId: string }> }) {
    const user = await getCurrentUser();
    if (!user) return jsonNoStore({ error: "Authentication required." }, { status: 401 });
    if (user.role !== "employer") return jsonNoStore({ error: "Only employers can review project submissions." }, { status: 403 });

    const { taskId, submissionId } = await context.params;
    if (!mongoose.Types.ObjectId.isValid(taskId) || !mongoose.Types.ObjectId.isValid(submissionId)) {
        return jsonNoStore({ error: "Submission not found." }, { status: 404 });
    }

    let body: { action?: unknown; feedback?: unknown };
    try {
        body = await request.json() as { action?: unknown; feedback?: unknown };
    } catch {
        return jsonNoStore({ error: "A valid review action is required." }, { status: 400 });
    }

    if (body.action !== "approve" && body.action !== "request_revision") {
        return jsonNoStore({ error: "Choose whether to approve the submission or request a revision." }, { status: 400 });
    }
    const feedback = typeof body.feedback === "string" ? body.feedback.trim() : "";
    if (body.action === "request_revision" && (!feedback || feedback.length > 5000)) {
        return jsonNoStore({ error: "Revision feedback of 1 to 5000 characters is required." }, { status: 400 });
    }
    if (body.action === "approve" && feedback.length > 5000) {
        return jsonNoStore({ error: "Feedback must be 5000 characters or fewer." }, { status: 400 });
    }

    try {
        await connectToDatabase();
        const [task, submission] = await Promise.all([
            Task.findOne({ _id: taskId, employer: user.userId }).select("_id title freelancer status").lean(),
            ProjectSubmission.findOne({ _id: submissionId, task: taskId, employer: user.userId }).select("_id freelancer status").lean(),
        ]);
        if (!task || !submission) return jsonNoStore({ error: "Submission not found." }, { status: 404 });
        if (task.status !== "submitted" || submission.status !== "submitted") {
            return jsonNoStore({ error: "This submission has already been reviewed or is no longer current." }, { status: 409 });
        }
        if (submission.freelancer.toString() !== task.freelancer?.toString()) {
            return jsonNoStore({ error: "This submission is not from the freelancer assigned to the project." }, { status: 409 });
        }

        const nextStatus = body.action === "approve" ? "completed" : "revision_requested";
        const submissionStatus = body.action === "approve" ? "approved" : "revision_requested";
        const notificationType = body.action === "approve" ? "submission_approved" : "revision_requested";
        const title = body.action === "approve" ? "Submission approved" : "Revision requested";
        const notificationBody = body.action === "approve"
            ? `Your work on "${task.title}" was approved.`
            : `The employer requested changes to your submission for "${task.title}".`;
        const reviewedAt = new Date();
        const session = await mongoose.startSession();
        try {
            await session.withTransaction(async () => {
                const updatedTask = await Task.findOneAndUpdate(
                    { _id: taskId, employer: user.userId, status: "submitted" },
                    { $set: { status: nextStatus } },
                    { returnDocument: "after", session },
                );
                if (!updatedTask) throw new Error("REVIEW_STATE_CHANGED");

                const updatedSubmission = await ProjectSubmission.findOneAndUpdate(
                    { _id: submissionId, task: taskId, employer: user.userId, status: "submitted" },
                    {
                        $set: {
                            status: submissionStatus,
                            ...(body.action === "request_revision" ? { feedback } : feedback ? { feedback } : {}),
                            reviewedBy: user.userId,
                            reviewedAt,
                        },
                    },
                    { returnDocument: "after", session },
                );
                if (!updatedSubmission) throw new Error("REVIEW_STATE_CHANGED");

                const preference = await UserPreference.findOne({ user: submission.freelancer }).select("inAppNotifications").session(session).lean();
                if (preference?.inAppNotifications !== false) {
                    await Notification.create([{
                        recipient: submission.freelancer,
                        actor: user.userId,
                        type: notificationType,
                        title,
                        body: notificationBody,
                        relatedTask: taskId,
                        relatedSubmission: submissionId,
                        href: `/freelancer/dashboard/projects/${taskId}`,
                    }], { session });
                }
            });
        } catch (error) {
            if (error instanceof Error && error.message === "REVIEW_STATE_CHANGED") {
                return jsonNoStore({ error: "This submission was reviewed by another request. Refresh the project to see its current status." }, { status: 409 });
            }
            throw error;
        } finally {
            await session.endSession();
        }

        return jsonNoStore({
            message: body.action === "approve" ? "Submission approved and project completed." : "Revision request sent to the freelancer.",
            task: { id: taskId, status: nextStatus },
            submission: { id: submissionId, status: submissionStatus, feedback: feedback || undefined, reviewedAt },
        });
    } catch (error) {
        console.error("Project submission review error:", { errorName: error instanceof Error ? error.name : "UnknownError" });
        return jsonNoStore({ error: "The submission review could not be saved." }, { status: 503 });
    }
}
