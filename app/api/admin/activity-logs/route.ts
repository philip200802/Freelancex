import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { connectToDatabase } from "@/lib/mongodb";
import AdminActivityLog from "@/models/AdminActivityLog";

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
        const action = searchParams.get("action") || "all";
        const page = Number(searchParams.get("page") || "1");
        const limit = Number(searchParams.get("limit") || "20");
        const from = searchParams.get("from");
        const to = searchParams.get("to");

        if (!["all", "user.permanently_removed", "bank_account.revealed", "payout.manual_recorded"].includes(action)) {
            return jsonNoStore({ error: "Choose a valid activity filter." }, { status: 400 });
        }
        if (!Number.isInteger(page) || page < 1 || ![20, 50, 100].includes(limit)) {
            return jsonNoStore({ error: "Page or page size is invalid." }, { status: 400 });
        }

        const filter: Record<string, unknown> = {};
        if (action !== "all") filter.action = action;
        if (query) {
            const expression = new RegExp(escapeRegex(query), "i");
            filter.$or = [
                { adminNameSnapshot: expression },
                { targetUserNameSnapshot: expression },
                { action: expression },
                { description: expression },
            ];
        }
        if (from || to) {
            const dateFilter: Record<string, Date> = {};
            if (from) {
                const start = new Date(`${from}T00:00:00.000Z`);
                if (!Number.isFinite(start.getTime())) return jsonNoStore({ error: "Start date is invalid." }, { status: 400 });
                dateFilter.$gte = start;
            }
            if (to) {
                const end = new Date(`${to}T00:00:00.000Z`);
                if (!Number.isFinite(end.getTime())) return jsonNoStore({ error: "End date is invalid." }, { status: 400 });
                end.setUTCDate(end.getUTCDate() + 1);
                dateFilter.$lt = end;
            }
            if (dateFilter.$gte && dateFilter.$lt && dateFilter.$gte >= dateFilter.$lt) {
                return jsonNoStore({ error: "Start date must be on or before end date." }, { status: 400 });
            }
            filter.createdAt = dateFilter;
        }

        const [total, logs] = await Promise.all([
            AdminActivityLog.countDocuments(filter),
            AdminActivityLog.find(filter)
                .select("adminNameSnapshot action targetUserId targetUserNameSnapshot description metadata createdAt")
                .sort({ createdAt: -1, _id: -1 })
                .skip((page - 1) * limit)
                .limit(limit)
                .lean(),
        ]);

        return jsonNoStore({
            logs: logs.map((log) => ({
                id: log._id.toString(),
                adminName: log.adminNameSnapshot,
                action: log.action,
                targetUserId: log.targetUserId || null,
                targetUserName: log.targetUserNameSnapshot || null,
                description: log.description,
                metadata: log.metadata || {},
                createdAt: log.createdAt,
            })),
            pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
        });
    } catch (error) {
        console.error("Admin activity log listing error:", error);
        return jsonNoStore({ error: "Activity logs are temporarily unavailable." }, { status: 503 });
    }
}
