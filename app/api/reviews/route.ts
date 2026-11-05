import { NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/mongodb";
import { getCurrentUser } from "@/lib/current-user";
import Review from "@/models/Review";
import Task from "@/models/Task";
import User from "@/models/User";

export const dynamic = "force-dynamic";

function jsonNoStore(body: unknown, init?: ResponseInit) {
    const response = NextResponse.json(body, init);
    response.headers.set("Cache-Control", "no-store");
    return response;
}

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get("projectId");
    const freelancerId = searchParams.get("freelancerId");

    try {
        await connectToDatabase();
        const filter: Record<string, unknown> = {};
        if (projectId) filter.project = projectId;
        if (freelancerId) filter.freelancer = freelancerId;

        const reviews = await Review.find(filter)
            .populate("client", "name")
            .populate("freelancer", "name")
            .sort({ createdAt: -1 })
            .lean();

        return jsonNoStore({ reviews: reviews.map((review) => ({
            id: review._id.toString(),
            project: review.project.toString(),
            client: {
                id: review.client?._id.toString() || "",
                name: review.clientNameSnapshot || review.client?.name || "Former user",
            },
            freelancer: {
                id: review.freelancer?._id.toString() || "",
                name: review.freelancerNameSnapshot || review.freelancer?.name || "Former user",
            },
            rating: review.rating,
            comment: review.comment,
            createdAt: review.createdAt,
        })) });
    } catch (error) {
        console.error("Review listing error:", error);
        return jsonNoStore({ error: "Reviews are temporarily unavailable." }, { status: 503 });
    }
}

export async function POST(request: Request) {
    const user = await getCurrentUser();
    if (!user) return jsonNoStore({ error: "Authentication required." }, { status: 401 });
    if (user.role !== "employer") return jsonNoStore({ error: "Only clients can leave project reviews." }, { status: 403 });

    let body: { projectId?: unknown; rating?: unknown; comment?: unknown };
    try {
        body = await request.json() as { projectId?: unknown; rating?: unknown; comment?: unknown };
    } catch {
        return jsonNoStore({ error: "A valid review payload is required." }, { status: 400 });
    }

    const projectId = typeof body.projectId === "string" ? body.projectId : "";
    const rating = Number(body.rating);
    const comment = typeof body.comment === "string" ? body.comment.trim() : "";

    if (!projectId || !Number.isFinite(rating) || rating < 1 || rating > 5 || comment.length < 5 || comment.length > 2000) {
        return jsonNoStore({ error: "Enter a valid rating and a review message between 5 and 2000 characters." }, { status: 400 });
    }

    try {
        await connectToDatabase();
        const task = await Task.findById(projectId).select("employer freelancer freelancerNameSnapshot status").lean();
        if (!task) return jsonNoStore({ error: "Project not found." }, { status: 404 });
        if (task.employer?.toString() !== user.userId) return jsonNoStore({ error: "You can only review projects you own." }, { status: 403 });
        if (task.status !== "completed") return jsonNoStore({ error: "Only completed projects can be reviewed." }, { status: 400 });

        const existingReview = await Review.findOne({ project: projectId, client: user.userId });
        if (existingReview) return jsonNoStore({ error: "You have already submitted a review for this project." }, { status: 409 });

        const freelancerId = task.freelancer;
        if (!freelancerId) return jsonNoStore({ error: "This project has no assigned freelancer to review." }, { status: 400 });

        const review = await Review.create({
            project: projectId,
            client: user.userId,
            freelancer: freelancerId,
            freelancerNameSnapshot: task.freelancerNameSnapshot,
            rating,
            comment,
        });

        const freelancerUser = await User.findById(freelancerId).select("isActive").lean();
        if (freelancerUser?.isActive !== false) {
            const allReviews = await Review.find({ freelancer: freelancerId }).select("rating").lean();
            const averageRating = allReviews.reduce((sum, item) => sum + item.rating, 0) / allReviews.length;
            await User.findByIdAndUpdate(freelancerId, {
                rating: Number(averageRating.toFixed(1)),
                reviewCount: allReviews.length,
            });
        }

        return jsonNoStore({ review: { id: review._id.toString(), rating: review.rating, comment: review.comment, createdAt: review.createdAt } }, { status: 201 });
    } catch (error) {
        console.error("Review creation error:", error);
        return jsonNoStore({ error: "The review could not be saved." }, { status: 500 });
    }
}
