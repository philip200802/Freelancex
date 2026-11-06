import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { connectToDatabase } from "@/lib/mongodb";
import Application from "@/models/Application";
import Task from "@/models/Task";

export const dynamic = "force-dynamic";

const pageSize = 10;
const allowedStatuses = ["all", "open", "funded", "in_progress", "revision_requested", "completed", "cancelled"] as const;
type JobStatusFilter = typeof allowedStatuses[number];

function jsonNoStore(body: unknown, init?: ResponseInit) {
    const response = NextResponse.json(body, init);
    response.headers.set("Cache-Control", "no-store");
    return response;
}

export async function GET(request: Request) {
    const user = await getCurrentUser();
    if (!user) return jsonNoStore({ error: "Authentication required." }, { status: 401 });
    if (user.role !== "employer") return jsonNoStore({ error: "Only clients can view their jobs." }, { status: 403 });

    const params = new URL(request.url).searchParams;
    const statusValue = params.get("status") || "all";
    if (!allowedStatuses.includes(statusValue as JobStatusFilter)) {
        return jsonNoStore({ error: "Choose a valid job status filter." }, { status: 400 });
    }
    const rawPage = Number(params.get("page") || "1");
    const page = Number.isSafeInteger(rawPage) && rawPage > 0 ? rawPage : 1;
    const query = (params.get("q") || "").trim().slice(0, 100);

    try {
        await connectToDatabase();
        const filter: Record<string, unknown> = { employer: user.userId, isDeleted: { $ne: true } };
        if (statusValue === "cancelled") filter.status = "cancelled";
        else if (statusValue !== "all") filter.status = statusValue;
        else filter.status = { $ne: "cancelled" };
        if (query) {
            const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            filter.title = { $regex: escaped, $options: "i" };
        }

        const [jobs, totalCount, activeCount] = await Promise.all([
            Task.find(filter)
                .select("_id title description category amount status applicationCount createdAt")
                .sort({ createdAt: -1, _id: -1 })
                .skip((page - 1) * pageSize)
                .limit(pageSize)
                .lean(),
            Task.countDocuments(filter),
            Task.countDocuments({ employer: user.userId, isDeleted: { $ne: true }, status: { $ne: "cancelled" } }),
        ]);
        const applicationCounts = jobs.length
            ? await Application.aggregate<{ _id: string; count: number }>([
                { $match: { task: { $in: jobs.map((job) => job._id) } } },
                { $group: { _id: "$task", count: { $sum: 1 } } },
            ])
            : [];
        const countsByTask = new Map(applicationCounts.map((entry) => [entry._id.toString(), entry.count]));

        return jsonNoStore({
            jobs: jobs.map((job) => ({
                id: job._id.toString(),
                title: job.title,
                description: job.description,
                category: job.category,
                amount: job.amount,
                status: job.status,
                applications: countsByTask.get(job._id.toString()) || job.applicationCount || 0,
                createdAt: job.createdAt,
            })),
            activeCount,
            totalCount,
            page,
            pageSize,
            totalPages: Math.ceil(totalCount / pageSize),
        });
    } catch (error) {
        console.error("Client job listing error:", { errorName: error instanceof Error ? error.name : "UnknownError" });
        return jsonNoStore({ error: "Your jobs are temporarily unavailable." }, { status: 503 });
    }
}
