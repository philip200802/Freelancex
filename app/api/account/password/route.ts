import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { connectToDatabase } from "@/lib/mongodb";
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

    let body: { currentPassword?: unknown; newPassword?: unknown };
    try {
        body = await request.json() as typeof body;
    } catch {
        return jsonNoStore({ error: "Password details are invalid." }, { status: 400 });
    }

    const currentPassword = typeof body.currentPassword === "string" ? body.currentPassword : "";
    const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";
    if (!currentPassword || currentPassword.length > 128 || newPassword.length < 8 || newPassword.length > 128) {
        return jsonNoStore({ error: "Enter your current password and a new password between 8 and 128 characters." }, { status: 400 });
    }

    try {
        await connectToDatabase();
        const user = await User.findById(currentUser.userId).select("+passwordHash");
        if (!user) return jsonNoStore({ error: "Account not found." }, { status: 404 });
        if (!await bcrypt.compare(currentPassword, user.passwordHash)) {
            return jsonNoStore({ error: "Your current password is incorrect." }, { status: 400 });
        }
        if (await bcrypt.compare(newPassword, user.passwordHash)) {
            return jsonNoStore({ error: "Choose a new password different from your current password." }, { status: 400 });
        }

        user.passwordHash = await bcrypt.hash(newPassword, 12);
        await user.save();
        return jsonNoStore({ success: true, message: "Password updated successfully." });
    } catch (error) {
        console.error("Password update error:", { errorName: error instanceof Error ? error.name : "UnknownError" });
        return jsonNoStore({ error: "Password could not be updated." }, { status: 503 });
    }
}
