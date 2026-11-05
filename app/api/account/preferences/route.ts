import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { connectToDatabase } from "@/lib/mongodb";
import UserPreference from "@/models/UserPreference";

export const dynamic = "force-dynamic";

function jsonNoStore(body: unknown, init?: ResponseInit) {
    const response = NextResponse.json(body, init);
    response.headers.set("Cache-Control", "no-store");
    return response;
}

export async function GET() {
    const user = await getCurrentUser();
    if (!user) return jsonNoStore({ error: "Authentication required." }, { status: 401 });

    try {
        await connectToDatabase();
        const preferences = await UserPreference.findOne({ user: user.userId }).lean();
        return jsonNoStore({ preferences: preferences || { emailNotifications: true, inAppNotifications: true, profileVisibility: "public" } });
    } catch (error) {
        console.error("Preference retrieval error:", error);
        return jsonNoStore({ error: "Settings are temporarily unavailable." }, { status: 503 });
    }
}

export async function PUT(request: Request) {
    const user = await getCurrentUser();
    if (!user) return jsonNoStore({ error: "Authentication required." }, { status: 401 });

    let body: { emailNotifications?: unknown; inAppNotifications?: unknown; profileVisibility?: unknown };
    try {
        body = await request.json() as typeof body;
    } catch {
        return jsonNoStore({ error: "Settings data is invalid." }, { status: 400 });
    }
    if (typeof body.emailNotifications !== "boolean" || typeof body.inAppNotifications !== "boolean" || !["public", "private"].includes(String(body.profileVisibility))) {
        return jsonNoStore({ error: "Choose valid notification and profile visibility settings." }, { status: 400 });
    }

    try {
        await connectToDatabase();
        const preferences = await UserPreference.findOneAndUpdate(
            { user: user.userId },
            { $set: { emailNotifications: body.emailNotifications, inAppNotifications: body.inAppNotifications, profileVisibility: body.profileVisibility } },
            { returnDocument: "after", upsert: true, runValidators: true, setDefaultsOnInsert: true },
        ).lean();
        return jsonNoStore({ preferences });
    } catch (error) {
        console.error("Preference update error:", error);
        return jsonNoStore({ error: "Settings could not be saved." }, { status: 503 });
    }
}
