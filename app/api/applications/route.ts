import { NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/mongodb";
import { getCurrentUser } from "@/lib/current-user";
import Application from "@/models/Application";
import Task from "@/models/Task";

export const dynamic = "force-dynamic";

function jsonNoStore(body: unknown, init?: ResponseInit) {
    const response = NextResponse.json(body, init);
    response.headers.set("Cache-Control", "no-store");
    return response;
}

export async function GET() {
    const user = await getCurrentUser();
    if (!user) return jsonNoStore({ error: "Authentication required." }, { status: 401 });

    try {
        await connectToDatabase();
        const filter = user.role === "employer"
            ? { employer: user.userId }
            : user.role === "freelancer"
                ? { freelancer: user.userId }
                : {};
        const applications = await Application.find(filter)
            .populate("task", "title category amount status")
            .populate("employer", "name")
            .populate("freelancer", "name email")
            .sort({ createdAt: -1 })
            .lean();

        const legacyFilter = user.role === "employer"
            ? { employer: user.userId, status: "pending_approval" as const }
            : user.role === "freelancer"
                ? { freelancer: user.userId, status: "pending_approval" as const }
                : { status: "pending_approval" as const };
        const legacyApplications = await Task.find(legacyFilter)
            .select("title category amount employer freelancer status createdAt")
            .populate("employer", "name")
            .populate("freelancer", "name email")
            .sort({ createdAt: -1 })
            .lean();

        return jsonNoStore({
            applications: [
                ...applications,
                ...legacyApplications.map((task) => ({
                    id: `legacy-${task._id.toString()}`,
                    task: { id: task._id.toString(), title: task.title, category: task.category, amount: task.amount, status: task.status },
                    employer: task.employer,
                    freelancer: task.freelancer,
                    message: "",
                    status: "pending" as const,
                    createdAt: task.createdAt,
                    legacy: true,
                })),
            ],
        });
    } catch (error) {
        console.error("Application listing error:", error);
        return jsonNoStore({ error: "Applications are temporarily unavailable." }, { status: 503 });
    }
}
