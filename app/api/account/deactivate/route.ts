import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { connectToDatabase } from "@/lib/mongodb";
import Task from "@/models/Task";
import User from "@/models/User";

export const dynamic = "force-dynamic";

function jsonNoStore(body: unknown, init?: ResponseInit) {
    const response = NextResponse.json(body, init);
    response.headers.set("Cache-Control", "no-store");
    return response;
}

export async function POST(request: Request) {
    const currentUser = await getCurrentUser();
    if (!currentUser) return jsonNoStore({ error: "Authentication required." }, { status: 401 });
    if (currentUser.role === "admin") return jsonNoStore({ error: "Admin accounts cannot be deactivated through account settings." }, { status: 403 });

    let body: { currentPassword?: unknown; confirmation?: unknown };
    try {
        body = await request.json() as typeof body;
    } catch {
        return jsonNoStore({ error: "Deactivation details are invalid." }, { status: 400 });
    }

    const password = typeof body.currentPassword === "string" ? body.currentPassword : "";
    if (!password || body.confirmation !== "DEACTIVATE") {
        return jsonNoStore({ error: "Enter your password and type DEACTIVATE to confirm." }, { status: 400 });
    }

    try {
        await connectToDatabase();
        const user = await User.findById(currentUser.userId).select("+passwordHash isActive");
        if (!user || user.isActive === false) return jsonNoStore({ error: "Account not found." }, { status: 404 });
        if (!await bcrypt.compare(password, user.passwordHash)) {
            return jsonNoStore({ error: "Your password is incorrect." }, { status: 400 });
        }

        const activeStatuses = ["pending_approval", "open", "awaiting_funding", "funded", "in_progress", "submitted", "revision_requested", "disputed"];
        const ownership = currentUser.role === "employer" ? { employer: currentUser.userId } : { freelancer: currentUser.userId };
        const hasOpenOrActiveWork = await Task.exists({ ...ownership, status: { $in: activeStatuses } });
        if (hasOpenOrActiveWork) {
            return jsonNoStore({ error: "Close open postings and resolve active or disputed projects before deactivating your account." }, { status: 409 });
        }

        const deactivatedUser = await User.findOneAndUpdate(
            { _id: currentUser.userId, isActive: { $ne: false } },
            { $set: { isActive: false } },
            { returnDocument: "after" },
        ).select("_id");
        if (!deactivatedUser) return jsonNoStore({ error: "Account not found." }, { status: 404 });

        const response = jsonNoStore({ success: true, message: "Your account has been deactivated." });
        response.cookies.set("freelancex_session", "", {
            httpOnly: true,
            expires: new Date(0),
            sameSite: "lax",
            secure: process.env.NODE_ENV === "production",
            path: "/",
        });
        return response;
    } catch (error) {
        console.error("Account deactivation error:", { errorName: error instanceof Error ? error.name : "UnknownError" });
        return jsonNoStore({ error: "Account could not be deactivated." }, { status: 503 });
    }
}
