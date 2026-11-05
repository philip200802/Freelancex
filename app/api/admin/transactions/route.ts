import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { connectToDatabase } from "@/lib/mongodb";
import PaymentTransaction, { type PaymentStatus } from "@/models/PaymentTransaction";

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
        const status = searchParams.get("status") || "all";
        const page = Number(searchParams.get("page") || "1");
        const limit = Number(searchParams.get("limit") || "20");
        if (!["all", "initializing", "pending", "success", "failed"].includes(status)) {
            return jsonNoStore({ error: "Choose a valid transaction status." }, { status: 400 });
        }
        if (!Number.isInteger(page) || page < 1 || ![20, 50, 100].includes(limit)) {
            return jsonNoStore({ error: "Page or page size is invalid." }, { status: 400 });
        }

        const filter: Record<string, unknown> = {};
        if (status !== "all") filter.status = status as PaymentStatus;
        if (query) {
            const expression = new RegExp(escapeRegex(query), "i");
            filter.$or = [
                { reference: expression },
                { employerNameSnapshot: expression },
                { freelancerNameSnapshot: expression },
            ];
        }
        const [total, transactions] = await Promise.all([
            PaymentTransaction.countDocuments(filter),
            PaymentTransaction.find(filter)
                .populate("task", "title status")
                .populate("employer", "name")
                .populate("freelancer", "name")
                .sort({ createdAt: -1, _id: -1 })
                .skip((page - 1) * limit)
                .limit(limit)
                .lean(),
        ]);
        return jsonNoStore({
            transactions: transactions.map((transaction) => ({
                id: transaction._id.toString(),
                reference: transaction.reference,
                provider: transaction.provider,
                amount: transaction.amount,
                amountSubunit: transaction.amountSubunit,
                currency: transaction.currency,
                status: transaction.status,
                task: transaction.task ? {
                    id: transaction.task._id.toString(),
                    title: transaction.task.title,
                    status: transaction.task.status,
                } : null,
                employerName: transaction.employerNameSnapshot || transaction.employer?.name || "Former user",
                freelancerName: transaction.freelancerNameSnapshot || transaction.freelancer?.name || "Former user",
                providerTransactionId: transaction.providerTransactionId || null,
                verifiedAt: transaction.verifiedAt || null,
                createdAt: transaction.createdAt,
            })),
            pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
        });
    } catch (error) {
        console.error("Admin transaction listing error:", error);
        return jsonNoStore({ error: "Transactions are temporarily unavailable." }, { status: 503 });
    }
}
