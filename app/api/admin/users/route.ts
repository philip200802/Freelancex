import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { connectToDatabase } from "@/lib/mongodb";
import EmployerProfile from "@/models/EmployerProfile";
import FreelancerProfile from "@/models/FreelancerProfile";
import User, { type UserRole } from "@/models/User";

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
    try {
        const admin = await getCurrentUser();
        if (!admin) return jsonNoStore({ error: "Authentication required." }, { status: 401 });
        if (admin.role !== "admin") return jsonNoStore({ error: "Admin access required." }, { status: 403 });

        await connectToDatabase();
        const { searchParams } = new URL(request.url);
        const search = (searchParams.get("q") || "").trim().slice(0, 120);
        const role = searchParams.get("role") || "all";
        const verification = searchParams.get("verification") || "all";
        const pageValue = Number(searchParams.get("page") || "1");
        const limitValue = Number(searchParams.get("limit") || "20");

        if (!["all", "freelancer", "employer", "admin"].includes(role)) {
            return jsonNoStore({ error: "Choose a valid user role filter." }, { status: 400 });
        }
        if (!["all", "verified", "unverified"].includes(verification)) {
            return jsonNoStore({ error: "Choose a valid verification filter." }, { status: 400 });
        }
        if (!Number.isInteger(pageValue) || pageValue < 1 || ![20, 50, 100].includes(limitValue)) {
            return jsonNoStore({ error: "Page or page size is invalid." }, { status: 400 });
        }

        const filter: Record<string, unknown> = { isActive: { $ne: false } };
        if (role !== "all") filter.role = role as UserRole;
        if (verification !== "all") filter.isVerified = verification === "verified";
        if (search) {
            const expression = new RegExp(escapeRegex(search), "i");
            filter.$or = [{ name: expression }, { email: expression }];
        }

        const [total, users] = await Promise.all([
            User.countDocuments(filter),
            User.find(filter)
                .select("name email role isVerified isActive createdAt")
                .sort({ createdAt: -1, _id: -1 })
                .skip((pageValue - 1) * limitValue)
                .limit(limitValue)
                .lean(),
        ]);
        const userIds = users.map((user) => user._id);
        const [freelancerProfiles, employerProfiles] = await Promise.all([
            FreelancerProfile.find({ user: { $in: userIds } }).select("user profileImage").lean(),
            EmployerProfile.find({ user: { $in: userIds } }).select("user profileImage").lean(),
        ]);
        const imageByUserId = new Map<string, string>();
        for (const profile of [...freelancerProfiles, ...employerProfiles]) {
            if (profile.profileImage) imageByUserId.set(profile.user.toString(), profile.profileImage);
        }

        return jsonNoStore({
            users: users.map((user) => ({
                id: user._id.toString(),
                name: user.name,
                email: user.email,
                role: user.role,
                isVerified: user.isVerified,
                isActive: user.isActive !== false,
                createdAt: user.createdAt,
                profileImage: imageByUserId.get(user._id.toString()) || null,
            })),
            pagination: {
                page: pageValue,
                limit: limitValue,
                total,
                totalPages: Math.max(1, Math.ceil(total / limitValue)),
            },
        });
    } catch (error) {
        console.error("Admin user listing error:", error);
        return jsonNoStore({ error: "Users are temporarily unavailable." }, { status: 503 });
    }
}
