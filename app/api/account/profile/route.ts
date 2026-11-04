import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { connectToDatabase } from "@/lib/mongodb";
import EmployerProfile from "@/models/EmployerProfile";
import FreelancerProfile from "@/models/FreelancerProfile";
import User from "@/models/User";

export const dynamic = "force-dynamic";

function jsonNoStore(body: unknown, init?: ResponseInit) {
    const response = NextResponse.json(body, init);
    response.headers.set("Cache-Control", "no-store");
    return response;
}

export async function GET() {
    const currentUser = await getCurrentUser();
    if (!currentUser) return jsonNoStore({ error: "Authentication required." }, { status: 401 });

    try {
        await connectToDatabase();
        const user = await User.findById(currentUser.userId).select("firstName lastName name email role country city").lean();
        if (!user) return jsonNoStore({ error: "Account not found." }, { status: 404 });
        const profile = currentUser.role === "employer"
            ? await EmployerProfile.findOne({ user: currentUser.userId }).select("-profileImagePublicId").lean()
            : currentUser.role === "freelancer"
                ? await FreelancerProfile.findOne({ user: currentUser.userId }).select("-profileImagePublicId").lean()
                : null;
        return jsonNoStore({ user, profile });
    } catch (error) {
        console.error("Profile retrieval error:", error);
        return jsonNoStore({ error: "Profile is temporarily unavailable." }, { status: 503 });
    }
}

export async function PATCH(request: Request) {
    const currentUser = await getCurrentUser();
    if (!currentUser) return jsonNoStore({ error: "Authentication required." }, { status: 401 });

    let body: Record<string, unknown>;
    try {
        body = await request.json() as Record<string, unknown>;
    } catch {
        return jsonNoStore({ error: "Profile data is invalid." }, { status: 400 });
    }

    const userUpdates: Record<string, string> = {};
    for (const field of ["firstName", "lastName", "country", "city"] as const) {
        const value = body[field];
        if (value !== undefined) {
            if (typeof value !== "string" || value.trim().length === 0 || value.trim().length > 120) {
                return jsonNoStore({ error: `${field} must be a non-empty value of at most 120 characters.` }, { status: 400 });
            }
            userUpdates[field] = value.trim();
        }
    }

    const profileFields = currentUser.role === "employer"
        ? ["accountType", "companyName", "industry", "companyWebsite", "companySize", "position", "occupation", "hiringCategories", "hiringFrequency", "hiringPurpose"]
        : currentUser.role === "freelancer"
            ? ["professionalTitle", "category", "skills", "experienceLevel", "bio", "workType", "availability", "hourlyRate", "portfolioUrl", "githubUrl", "linkedinUrl"]
            : [];
    const profileUpdates: Record<string, unknown> = {};
    for (const field of profileFields) {
        if (body[field] === undefined) continue;
        const value = body[field];
        if (typeof value === "string" && value.trim().length <= 5000) profileUpdates[field] = value.trim();
        else if (Array.isArray(value) && value.length <= 50 && value.every((item) => typeof item === "string" && item.trim().length > 0 && item.trim().length <= 100)) profileUpdates[field] = value.map((item) => (item as string).trim());
        else if (typeof value === "number" && Number.isFinite(value) && value >= 0) profileUpdates[field] = value;
        else return jsonNoStore({ error: `${field} has an invalid value.` }, { status: 400 });
    }

    if (Object.keys(userUpdates).length === 0 && Object.keys(profileUpdates).length === 0) {
        return jsonNoStore({ error: "No profile changes were provided." }, { status: 400 });
    }

    try {
        await connectToDatabase();
        const user = await User.findById(currentUser.userId);
        if (!user) return jsonNoStore({ error: "Account not found." }, { status: 404 });
        Object.assign(user, userUpdates);
        if (userUpdates.firstName || userUpdates.lastName) user.name = `${user.firstName} ${user.lastName}`;
        await user.save();

        let profile = null;
        if (Object.keys(profileUpdates).length > 0 && currentUser.role === "employer") {
            profile = await EmployerProfile.findOneAndUpdate({ user: currentUser.userId }, { $set: profileUpdates }, { new: true, runValidators: true }).select("-profileImagePublicId").lean();
        } else if (Object.keys(profileUpdates).length > 0 && currentUser.role === "freelancer") {
            profile = await FreelancerProfile.findOneAndUpdate({ user: currentUser.userId }, { $set: profileUpdates }, { new: true, runValidators: true }).select("-profileImagePublicId").lean();
        }
        return jsonNoStore({ success: true, user: { firstName: user.firstName, lastName: user.lastName, name: user.name, country: user.country, city: user.city }, profile });
    } catch (error) {
        console.error("Profile update error:", error);
        return jsonNoStore({ error: "Profile could not be saved." }, { status: 503 });
    }
}
