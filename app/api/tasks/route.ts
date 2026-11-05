import { NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/mongodb";
import { getCurrentUser } from "@/lib/current-user";
import { sendNewJobAlertEmail } from "@/lib/email";
import Task, { type TaskCategory } from "@/models/Task";
import User from "@/models/User";
import UserPreference from "@/models/UserPreference";

const categories: TaskCategory[] = ["Development", "Design", "Writing", "Marketing"];

export const dynamic = "force-dynamic";

function jsonNoStore(body: unknown, init?: ResponseInit) {
    const response = NextResponse.json(body, init);
    response.headers.set("Cache-Control", "no-store");
    return response;
}

export async function GET(request: Request) {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
        return jsonNoStore({ error: "Authentication required." }, { status: 401 });
    }
    if (currentUser.role !== "freelancer") {
        return jsonNoStore({ error: "Only freelancers can browse available jobs." }, { status: 403 });
    }

    try {
        const searchParams = new URL(request.url).searchParams;
        const rawPage = Number(searchParams.get("page") || "1");
        const pageSize = 9;
        const page = Number.isSafeInteger(rawPage) && rawPage > 0 ? rawPage : 1;
        const query = (searchParams.get("q") || "").trim().slice(0, 100);
        const requestedCategory = searchParams.get("category") || "";
        const requestedBudget = searchParams.get("maxBudget");
        const maximumBudget = requestedBudget ? Number(requestedBudget) : undefined;
        if (requestedCategory && !categories.includes(requestedCategory as TaskCategory)) {
            return jsonNoStore({ error: "Category filter is invalid." }, { status: 400 });
        }
        if (requestedBudget && (!Number.isFinite(maximumBudget) || (maximumBudget ?? 0) <= 0)) {
            return jsonNoStore({ error: "Maximum budget filter is invalid." }, { status: 400 });
        }
        const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        await connectToDatabase();
        const filter: Record<string, unknown> = {
            status: "open",
            $or: [{ freelancer: { $exists: false } }, { freelancer: null }],
        };
        if (requestedCategory) filter.category = requestedCategory;
        if (maximumBudget) filter.amount = { $lte: maximumBudget };
        if (escapedQuery) filter.$and = [{ $or: [
            { title: { $regex: escapedQuery, $options: "i" } },
            { description: { $regex: escapedQuery, $options: "i" } },
        ] }];
        const [tasks, totalCount] = await Promise.all([
            Task.find(filter)
                .select("title description amount category status createdAt employer employerNameSnapshot")
                .populate("employer", "name")
                .sort({ createdAt: -1, _id: -1 })
                .skip((page - 1) * pageSize)
                .limit(pageSize)
                .lean(),
            Task.countDocuments(filter),
        ]);
        return jsonNoStore({
            tasks: tasks.map((task) => ({
                ...task,
                employer: task.employer
                    ? { ...task.employer, name: task.employerNameSnapshot || task.employer.name }
                    : task.employerNameSnapshot ? { name: task.employerNameSnapshot } : null,
            })),
            pagination: { page, pageSize, totalCount, totalPages: Math.ceil(totalCount / pageSize) },
        });
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
        const freelancers = await User.find({ role: "freelancer", isVerified: true })
            .select("name email")
            .lean();

        const taskUrl = `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/freelancer/dashboard/jobs/${task._id}`;
        const preferences = await UserPreference.find({ user: { $in: freelancers.map((freelancer) => freelancer._id) } }).select("user emailNotifications").lean();
        const allowedUserIds = new Set((preferences.filter((preference) => preference.emailNotifications !== false)).map((preference) => preference.user.toString()));
        const emailRecipients = freelancers.filter((freelancer) => allowedUserIds.has(String(freelancer._id)));
        for (const freelancer of emailRecipients) {
            try {
                await sendNewJobAlertEmail({
                    email: freelancer.email,
                    freelancerName: freelancer.name,
                    jobTitle: title,
                    description,
                    budget: amount,
                    category,
                    jobUrl: taskUrl,
                });
            } catch (mailError) {
                console.error("New job email alert failed:", mailError);
            }
        }

        return jsonNoStore({ task }, { status: 201 });
    } catch (error) {
        console.error("Task creation error:", error);
        return jsonNoStore({ error: "Project creation is temporarily unavailable." }, { status: 500 });
    }
}
