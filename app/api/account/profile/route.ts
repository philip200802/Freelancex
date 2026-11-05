import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { connectToDatabase } from "@/lib/mongodb";
import EmployerProfile from "@/models/EmployerProfile";
import FreelancerProfile from "@/models/FreelancerProfile";
import ProfileImageDeletion from "@/models/ProfileImageDeletion";
import User from "@/models/User";
import { uploadProfileImage, validateProfileImage } from "@/lib/cloudinary";

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
        const user = await User.findById(currentUser.userId).select("firstName lastName name email role country city isVerified isActive").lean();
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
    let profileImage: File | undefined;
    try {
        if (request.headers.get("content-type")?.includes("multipart/form-data")) {
            const formData = await request.formData();
            const userDataValue = formData.get("userData");
            const profileDataValue = formData.get("profileData");
            const userData = typeof userDataValue === "string" ? JSON.parse(userDataValue) as unknown : {};
            const profileData = typeof profileDataValue === "string" ? JSON.parse(profileDataValue) as unknown : {};
            if (!userData || typeof userData !== "object" || Array.isArray(userData) || !profileData || typeof profileData !== "object" || Array.isArray(profileData)) {
                return jsonNoStore({ error: "Profile data is invalid." }, { status: 400 });
            }
            body = { ...(userData as Record<string, unknown>), ...(profileData as Record<string, unknown>) };
            const imageValue = formData.get("profileImage");
            if (imageValue instanceof File && imageValue.size > 0) profileImage = imageValue;
        } else {
            const parsedBody: unknown = await request.json();
            if (!parsedBody || typeof parsedBody !== "object" || Array.isArray(parsedBody)) {
                return jsonNoStore({ error: "Profile data is invalid." }, { status: 400 });
            }
            body = parsedBody as Record<string, unknown>;
        }
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
    const profileUnsets: Record<string, 1> = {};
    const allowedExperienceLevels = ["Beginner", "Intermediate", "Expert"];
    const allowedWorkTypes = ["Freelance", "Contract", "Part-time"];
    const allowedAvailability = ["Available", "Busy", "Not currently available"];
    for (const field of profileFields) {
        if (body[field] === undefined) continue;
        const value = body[field];
        if (field === "hourlyRate" && currentUser.role === "freelancer" && value === null) {
            profileUnsets[field] = 1;
            continue;
        }
        if (field === "experienceLevel" && currentUser.role === "freelancer" && (typeof value !== "string" || !allowedExperienceLevels.includes(value))) {
            return jsonNoStore({ error: "experienceLevel has an invalid value." }, { status: 400 });
        } else if (field === "workType" && currentUser.role === "freelancer" && (typeof value !== "string" || !allowedWorkTypes.includes(value))) {
            return jsonNoStore({ error: "workType has an invalid value." }, { status: 400 });
        } else if (field === "availability" && currentUser.role === "freelancer" && (typeof value !== "string" || !allowedAvailability.includes(value))) {
            return jsonNoStore({ error: "availability has an invalid value." }, { status: 400 });
        } else if (typeof value === "string" && value.trim().length <= 5000) profileUpdates[field] = value.trim();
        else if (Array.isArray(value) && value.length <= 50 && (field !== "skills" && field !== "hiringCategories" || value.length > 0) && value.every((item) => typeof item === "string" && item.trim().length > 0 && item.trim().length <= 100)) profileUpdates[field] = value.map((item) => (item as string).trim());
        else if (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1_000_000_000) profileUpdates[field] = value;
        else return jsonNoStore({ error: `${field} has an invalid value.` }, { status: 400 });
    }

    if (profileImage && currentUser.role !== "freelancer") {
        return jsonNoStore({ error: "Profile image updates are only available for freelancer accounts." }, { status: 403 });
    }
    if (profileImage) {
        const imageError = await validateProfileImage(profileImage);
        if (imageError) return jsonNoStore({ error: imageError }, { status: 400 });
    }

    if (Object.keys(userUpdates).length === 0 && Object.keys(profileUpdates).length === 0 && Object.keys(profileUnsets).length === 0 && !profileImage) {
        return jsonNoStore({ error: "No profile changes were provided." }, { status: 400 });
    }

    let uploadedImage: { url: string; publicId: string } | undefined;
    try {
        await connectToDatabase();
        const user = await User.findById(currentUser.userId);
        if (!user) return jsonNoStore({ error: "Account not found." }, { status: 404 });
        if (profileImage) uploadedImage = await uploadProfileImage(profileImage);
        Object.assign(user, userUpdates);
        if (userUpdates.firstName || userUpdates.lastName) user.name = `${user.firstName} ${user.lastName}`;
        await user.save();

        let profile = null;
        const profileUpdate = {
            ...(Object.keys(profileUpdates).length ? { $set: profileUpdates } : {}),
            ...(Object.keys(profileUnsets).length ? { $unset: profileUnsets } : {}),
        };
        let previousProfileImagePublicId: string | undefined;
        if ((Object.keys(profileUpdates).length > 0 || uploadedImage) && currentUser.role === "employer") {
            profile = await EmployerProfile.findOneAndUpdate({ user: currentUser.userId }, { $set: profileUpdates }, { returnDocument: "after", runValidators: true }).select("-profileImagePublicId").lean();
            if (!profile) throw new Error("Employer profile is unavailable.");
        } else if ((Object.keys(profileUpdates).length > 0 || Object.keys(profileUnsets).length > 0 || uploadedImage) && currentUser.role === "freelancer") {
            const existingProfile = await FreelancerProfile.findOne({ user: currentUser.userId }).select("profileImagePublicId").lean();
            previousProfileImagePublicId = existingProfile?.profileImagePublicId;
            profile = await FreelancerProfile.findOneAndUpdate(
                { user: currentUser.userId },
                {
                    ...profileUpdate,
                    ...(uploadedImage ? { $set: { ...profileUpdates, profileImage: uploadedImage.url, profileImagePublicId: uploadedImage.publicId } } : {}),
                },
                { returnDocument: "after", runValidators: true },
            ).select("-profileImagePublicId").lean();
            if (!profile) throw new Error("Freelancer profile is unavailable.");
            if (uploadedImage && previousProfileImagePublicId) {
                try {
                    await ProfileImageDeletion.create({ publicIds: [previousProfileImagePublicId] });
                } catch (cleanupError) {
                    console.error("Previous profile image cleanup could not be queued.", {
                        errorName: cleanupError instanceof Error ? cleanupError.name : "UnknownError",
                    });
                }
            }
        }
        return jsonNoStore({ success: true, user: { firstName: user.firstName, lastName: user.lastName, name: user.name, country: user.country, city: user.city }, profile });
    } catch (error) {
        if (uploadedImage) {
            try {
                await ProfileImageDeletion.create({ publicIds: [uploadedImage.publicId] });
            } catch (cleanupError) {
                console.error("Uploaded profile image cleanup could not be queued.", {
                    errorName: cleanupError instanceof Error ? cleanupError.name : "UnknownError",
                });
            }
        }
        console.error("Profile update error:", error);
        return jsonNoStore({ error: "Profile could not be saved." }, { status: 503 });
    }
}
