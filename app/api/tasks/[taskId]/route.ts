import mongoose from "mongoose";
import { NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/mongodb";
import { getCurrentUser } from "@/lib/current-user";
import Task from "@/models/Task";

export async function GET(_request: Request, context: { params: Promise<{ taskId: string }> }) {
    const { taskId } = await context.params;
    if (!mongoose.Types.ObjectId.isValid(taskId)) {
        return NextResponse.json({ error: "Invalid project id." }, { status: 400 });
    }

    try {
        await connectToDatabase();
        const task = await Task.findById(taskId).populate("employer", "name bio skills").populate("freelancer", "name bio skills").lean();
        if (!task) {
            return NextResponse.json({ error: "Project not found." }, { status: 404 });
        }
        return NextResponse.json({ task });
    } catch (error) {
        console.error("Task detail error:", error);
        return NextResponse.json({ error: "Project details are temporarily unavailable." }, { status: 503 });
    }
}

export async function POST(_request: Request, context: { params: Promise<{ taskId: string }> }) {
    const { taskId } = await context.params;
    const currentUser = await getCurrentUser();
    if (!currentUser || currentUser.role !== "freelancer") {
        return NextResponse.json({ error: "Only authenticated freelancers can apply to projects." }, { status: 403 });
    }
    if (!mongoose.Types.ObjectId.isValid(taskId)) {
        return NextResponse.json({ error: "Invalid project id." }, { status: 400 });
    }

    try {
        await connectToDatabase();
        const task = await Task.findOneAndUpdate(
            { _id: taskId, status: "open", employer: { $ne: currentUser.userId } },
            { freelancer: currentUser.userId, status: "pending_approval" },
            { new: true },
        );
        if (!task) {
            return NextResponse.json({ error: "This project is no longer available for applications." }, { status: 409 });
        }
        return NextResponse.json({ task });
    } catch (error) {
        console.error("Task application error:", error);
        return NextResponse.json({ error: "Application is temporarily unavailable." }, { status: 500 });
    }
}
