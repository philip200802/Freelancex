import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { connectToDatabase } from "@/lib/mongodb";
import Review from "@/models/Review";

export const dynamic = "force-dynamic";

function jsonNoStore(body: unknown, init?: ResponseInit) {
    const response = NextResponse.json(body, init);
    response.headers.set("Cache-Control", "no-store");
    return response;
}

function escapeRegex(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function GET(request: Request) {
    const admin = await getCurrentUser();
    if (!admin) return jsonNoStore({ error: "Authentication required." }, { status: 401 });
    if (admin.role !== "admin") return jsonNoStore({ error: "Admin access required." }, { status: 403 });

    try {
        await connectToDatabase();
        const { searchParams } = new URL(request.url);
        const query = (searchParams.get("q") || "").trim().slice(0, 120);
        const page = Number(searchParams.get("page") || "1");
        const limit = Number(searchParams.get("limit") || "20");
        if (!Number.isInteger(page) || page < 1 || ![20, 50, 100].includes(limit)) {
            return jsonNoStore({ error: "Page or page size is invalid." }, { status: 400 });
        }

        const filter: Record<string, unknown> = {};
        if (query) {
            const expression = new RegExp(escapeRegex(query), "i");
            filter.$or = [
                { comment: expression },
                { clientNameSnapshot: expression },
                { freelancerNameSnapshot: expression },
            ];
        }
        const [total, reviews] = await Promise.all([
            Review.countDocuments(filter),
            Review.find(filter)
                .populate("project", "title")
                .populate("client", "name")
                .populate("freelancer", "name")
                .sort({ createdAt: -1, _id: -1 })
                .skip((page - 1) * limit)
                .limit(limit)
                .lean(),
        ]);
        return jsonNoStore({
            reviews: reviews.map((review) => ({
                id: review._id.toString(),
                project: review.project && "title" in review.project ? review.project.title : "Project",
                client: review.clientNameSnapshot || review.client?.name || "Former user",
                freelancer: review.freelancerNameSnapshot || review.freelancer?.name || "Former user",
                rating: review.rating,
                comment: review.comment,
                createdAt: review.createdAt,
            })),
            pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
        });
    } catch (error) {
        console.error("Admin review listing error:", error);
        return jsonNoStore({ error: "Reviews are temporarily unavailable." }, { status: 503 });
    }
}
