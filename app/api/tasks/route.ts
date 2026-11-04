import { NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/mongodb";
import { getCurrentUser } from "@/lib/current-user";
import Task, { type TaskCategory } from "@/models/Task";

const categories: TaskCategory[] = ["Development", "Design", "Writing", "Marketing"];

export const dynamic = "force-dynamic";

function jsonNoStore(body: unknown, init?: ResponseInit) {
    const response = NextResponse.json(body, init);
    response.headers.set("Cache-Control", "no-store");
    return response;
}

export async function GET() {
    try {
        await connectToDatabase();
        const tasks = await Task.find({
            status: "open",
            $or: [{ freelancer: { $exists: false } }, { freelancer: null }],
        })
            .select("title description amount category status createdAt employer")
            .populate("employer", "name")
            .sort({ createdAt: -1 })
            .lean();
        return jsonNoStore({ tasks });
    } catch (error) {
        console.error("Task listing error:", error);
        return jsonNoStore({ error: "Projects are temporarily unavailable." }, { status: 503 });
    }
}

export async function POST(request: Request) {
    try {
        const currentUser = await getCurrentUser();
        if (!currentUser || currentUser.role !== "employer") {
            return jsonNoStore({ error: "Only authenticated employers can create projects." }, { status: 403 });
        }

        const body = await request.json() as { title?: string; description?: string; amount?: number; category?: TaskCategory };
        const title = body.title?.trim();
        const description = body.description?.trim();
        const amount = Number(body.amount);
        const category = body.category;

        if (!title || !description || !Number.isFinite(amount) || amount <= 0 || !category || !categories.includes(category)) {
            return jsonNoStore({ error: "Title, description, a positive amount, and a valid category are required." }, { status: 400 });
        }

        await connectToDatabase();
        const task = await Task.create({ employer: currentUser.userId, title, description, amount, category, status: "open" });
        return jsonNoStore({ task }, { status: 201 });
    } catch (error) {
        console.error("Task creation error:", error);
        return jsonNoStore({ error: "Project creation is temporarily unavailable." }, { status: 500 });
    }
}
