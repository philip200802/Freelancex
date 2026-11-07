import { NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/mongodb";
import { getCurrentUser } from "@/lib/current-user";
import Task, { type TaskCategory } from "@/models/Task";
import User from "@/models/User";
import Notification from "@/models/Notification";
import { queueWorkflowEmailsAfterCommit, type WorkflowEmailQueueItem } from "@/lib/workflow-email";

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
            isDeleted: { $ne: true },
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

        let parsedBody: unknown;
        try {
            parsedBody = await request.json();
        } catch {
            return jsonNoStore({ error: "Project details are invalid." }, { status: 400 });
        }
        if (!parsedBody || typeof parsedBody !== "object" || Array.isArray(parsedBody)) {
            return jsonNoStore({ error: "Project details are invalid." }, { status: 400 });
        }
        const body = parsedBody as { title?: unknown; description?: unknown; amount?: unknown; category?: unknown };
        const idempotencyKey = request.headers.get("Idempotency-Key")?.trim() || "";
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(idempotencyKey)) {
            return jsonNoStore({ error: "A valid idempotency key is required to create a project safely." }, { status: 400 });
        }
        const title = typeof body.title === "string" ? body.title.trim() : "";
        const description = typeof body.description === "string" ? body.description.trim() : "";
        const amount = Number(body.amount);
        const category = body.category;

        if (!title || title.length > 180 || !description || description.length > 5000 || !Number.isFinite(amount) || amount <= 0 || !category || typeof category !== "string" || !categories.includes(category as TaskCategory)) {
            return jsonNoStore({ error: "Title, description, a positive amount, and a valid category are required." }, { status: 400 });
        }

        await connectToDatabase();
        let task;
        try {
            task = await Task.create({ employer: currentUser.userId, title, description, amount, category, status: "open", createRequestId: idempotencyKey });
        } catch (error) {
            if (error && typeof error === "object" && "code" in error && error.code === 11000) {
                const existing = await Task.findOne({ employer: currentUser.userId, createRequestId: idempotencyKey }).select("_id title description amount category status createdAt").lean();
                if (existing) {
                    try {
                        await Notification.updateOne(
                            { recipient: currentUser.userId, eventKey: `task:${existing._id}:created` },
                            { $setOnInsert: { recipient: currentUser.userId, recipientRole: "employer", type: "job_created", title: "Job posting created", body: `Your job posting "${existing.title}" is now live.`, relatedTask: existing._id, eventKey: `task:${existing._id}:created`, href: `/client/dashboard/projects/${existing._id}` } },
                            { upsert: true },
                        );
                    } catch (notificationError) {
                        console.error("Job creation notification could not be saved.", { errorName: notificationError instanceof Error ? notificationError.name : "UnknownError" });
                    }
                    return jsonNoStore({ task: existing, duplicate: true });
                }
            }
            throw error;
        }

        try {
            await Notification.updateOne(
                { recipient: currentUser.userId, eventKey: `task:${task._id}:created` },
                { $setOnInsert: { recipient: currentUser.userId, recipientRole: "employer", type: "job_created", title: "Job posting created", body: `Your job posting "${task.title}" is now live.`, relatedTask: task._id, eventKey: `task:${task._id}:created`, href: `/client/dashboard/projects/${task._id}` } },
                { upsert: true },
            );
        } catch (notificationError) {
            console.error("Job creation notification could not be saved.", { errorName: notificationError instanceof Error ? notificationError.name : "UnknownError" });
        }

        try {
            const [client, freelancers] = await Promise.all([
                User.findById(currentUser.userId).select("name email isVerified").lean(),
                User.find({ role: "freelancer", isVerified: true, isActive: true })
                    .select("name email isVerified")
                    .lean(),
            ]);
            const budget = new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 }).format(task.amount);
            const workflowEmails: WorkflowEmailQueueItem[] = [{
                workflowEvent: "job_created_client",
                dedupeKey: `task:${task._id}:created:client`,
                recipient: client,
                email: {
                subject: "Your FreelanceX job posting is live.",
                heading: "Job posting created",
                message: "Your job was saved successfully and is now available to freelancers.",
                details: [
                    { label: "Job title", value: task.title },
                    { label: "Job reference", value: task._id.toString() },
                    { label: "Budget", value: budget },
                    { label: "Category", value: task.category },
                    { label: "Created", value: task.createdAt.toLocaleString("en-NG", { timeZone: "UTC" }) + " UTC" },
                ],
                actionPath: `/client/dashboard/projects/${task._id}`,
                actionLabel: "View job",
                },
            }];
            for (const freelancer of freelancers) {
                workflowEmails.push({
                    workflowEvent: "new_job_alert",
                    dedupeKey: `task:${task._id}:job-alert`,
                    recipient: freelancer,
                    email: {
                        subject: `New project opportunity: ${task.title}`,
                        heading: "A new project is available",
                        message: "A new project has been posted that may interest you.",
                        details: [
                            { label: "Job title", value: task.title },
                            { label: "Description", value: task.description },
                            { label: "Budget", value: budget },
                            { label: "Category", value: task.category },
                        ],
                        actionPath: `/freelancer/dashboard/jobs/${task._id}`,
                        actionLabel: "View project",
                    },
                });
            }
            await queueWorkflowEmailsAfterCommit(workflowEmails);
        } catch (mailError) {
            console.error("Job emails could not be queued after project creation.", {
                errorName: mailError instanceof Error ? mailError.name : "UnknownError",
            });
        }

        return jsonNoStore({
            task: {
                _id: task._id,
                title: task.title,
                description: task.description,
                amount: task.amount,
                category: task.category,
                status: task.status,
                createdAt: task.createdAt,
            },
        }, { status: 201 });
    } catch (error) {
        console.error("Task creation error:", error);
        return jsonNoStore({ error: "Project creation is temporarily unavailable." }, { status: 500 });
    }
}
