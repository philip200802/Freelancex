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

export async function GET(request: Request) {
    const user = await getCurrentUser();
    if (!user) return jsonNoStore({ error: "Authentication required." }, { status: 401 });

    try {
        const searchParams = new URL(request.url).searchParams;
        const requestedPage = Number(searchParams.get("page") || "1");
        const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? Math.min(requestedPage, 100) : 1;
        const pageSize = 10;
        const requestedStatus = searchParams.get("status");
        if (requestedStatus && !["pending", "accepted", "rejected"].includes(requestedStatus)) {
            return jsonNoStore({ error: "Application status filter is invalid." }, { status: 400 });
        }
        await connectToDatabase();
        const filter: Record<string, unknown> = user.role === "employer"
            ? { employer: user.userId }
            : user.role === "freelancer"
                ? { freelancer: user.userId }
                : {};
        if (requestedStatus) filter.status = requestedStatus;

        const applicationsPromise = Application.find(filter)
            .populate("task", "title category amount status")
            .populate("employer", "name")
            .populate("freelancer", "name email")
            .sort({ createdAt: -1, _id: -1 })
            .limit(page * pageSize)
            .lean();

        const legacyFilter = user.role === "employer"
            ? { employer: user.userId, status: "pending_approval" as const }
            : user.role === "freelancer"
                ? { freelancer: user.userId, status: "pending_approval" as const }
                : { status: "pending_approval" as const };
        const includeLegacy = !requestedStatus || requestedStatus === "pending";
        const legacyPromise = includeLegacy
            ? Task.find(legacyFilter)
                .select("title category amount employer freelancer employerNameSnapshot freelancerNameSnapshot status createdAt")
                .populate("employer", "name")
                .populate("freelancer", "name email")
                .sort({ createdAt: -1, _id: -1 })
                .limit(page * pageSize)
                .lean()
            : Promise.resolve([]);
        const [applications, legacyApplications, applicationCount, legacyApplicationCount] = await Promise.all([
            applicationsPromise,
            legacyPromise,
            Application.countDocuments(filter),
            includeLegacy ? Task.countDocuments(legacyFilter) : Promise.resolve(0),
        ]);
        const applicationsWithSnapshots = applications.map((application) => ({
            ...application,
            sortId: application._id.toString(),
            employer: application.employer
                ? { ...application.employer, name: application.employerNameSnapshot || application.employer.name }
                : application.employerNameSnapshot ? { name: application.employerNameSnapshot } : null,
            freelancer: application.freelancer
                ? { ...application.freelancer, name: application.freelancerNameSnapshot || application.freelancer.name }
                : application.freelancerNameSnapshot ? { name: application.freelancerNameSnapshot } : null,
        }));
        const combined = [
            ...applicationsWithSnapshots,
            ...legacyApplications.map((task) => ({
                id: `legacy-${task._id.toString()}`,
                sortId: task._id.toString(),
                task: { id: task._id.toString(), title: task.title, category: task.category, amount: task.amount, status: task.status },
                employer: task.employer
                    ? { ...task.employer, name: task.employerNameSnapshot || task.employer.name }
                    : task.employerNameSnapshot ? { name: task.employerNameSnapshot } : null,
                freelancer: task.freelancer
                    ? { ...task.freelancer, name: task.freelancerNameSnapshot || task.freelancer.name }
                    : task.freelancerNameSnapshot ? { name: task.freelancerNameSnapshot } : null,
                message: "",
                status: "pending" as const,
                createdAt: task.createdAt,
                legacy: true,
            })),
        ].sort((first, second) => {
            const dateDifference = new Date(second.createdAt).getTime() - new Date(first.createdAt).getTime();
            if (dateDifference !== 0) return dateDifference;
            const firstId = "sortId" in first ? first.sortId : first._id.toString();
            const secondId = "sortId" in second ? second.sortId : second._id.toString();
            return secondId.localeCompare(firstId);
        });
        const offset = (page - 1) * pageSize;
        const totalCount = applicationCount + legacyApplicationCount;
        return jsonNoStore({
            applications: combined.slice(offset, offset + pageSize).map((application) => {
                const publicApplication = { ...application };
                delete publicApplication.sortId;
                return publicApplication;
            }),
            pagination: { page, pageSize, totalCount, totalPages: Math.ceil(totalCount / pageSize) },
        });
    } catch (error) {
        console.error("Application listing error:", error);
        return jsonNoStore({ error: "Applications are temporarily unavailable." }, { status: 503 });
    }
}
