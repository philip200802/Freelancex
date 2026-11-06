import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { connectToDatabase } from "@/lib/mongodb";
import EmployerProfile from "@/models/EmployerProfile";
import FreelancerProfile from "@/models/FreelancerProfile";
import ProfileImageDeletion from "@/models/ProfileImageDeletion";
import User from "@/models/User";
import { uploadProfileImage, validateProfileImage } from "@/lib/cloudinary";
import { createOneTimeToken } from "@/lib/tokens";
import { sendVerificationEmail } from "@/lib/email";

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
        const user = await User.findById(currentUser.userId).select("firstName lastName name email role country city isVerified isActive createdAt updatedAt").lean();
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
    for (const field of ["firstName", "lastName", "email", "country", "city"] as const) {
        const value = body[field];
        if (value !== undefined) {
            if (typeof value !== "string" || value.trim().length === 0 || value.trim().length > (field === "email" ? 254 : 120)) {
                return jsonNoStore({ error: `${field} must be a non-empty value of at most ${field === "email" ? 254 : 120} characters.` }, { status: 400 });
            }
            const normalizedValue = value.trim();
            if (field === "email") {
                const email = normalizedValue.toLowerCase();
                if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                    return jsonNoStore({ error: "Enter a valid email address." }, { status: 400 });
                }
                userUpdates.email = email;
            } else {
                userUpdates[field] = normalizedValue;
            }
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
        if (currentUser.role === "employer" && field === "accountType" && (typeof value !== "string" || !["Individual", "Company"].includes(value))) {
            return jsonNoStore({ error: "accountType has an invalid value." }, { status: 400 });
        }
        if (currentUser.role === "employer" && field === "hiringFrequency" && (typeof value !== "string" || !["Occasionally", "Monthly", "Frequently", "For ongoing projects"].includes(value))) {
            return jsonNoStore({ error: "hiringFrequency has an invalid value." }, { status: 400 });
        }
        if (currentUser.role === "employer" && field === "companyWebsite" && typeof value === "string" && value.trim()) {
            try {
                const website = new URL(value.trim());
                if (!["http:", "https:"].includes(website.protocol)) throw new Error("Unsupported website protocol.");
            } catch {
                return jsonNoStore({ error: "companyWebsite must be a valid HTTP or HTTPS URL." }, { status: 400 });
            }
        }
        if (currentUser.role === "employer" && field === "companySize" && typeof value === "string" && value.trim()) {
            const size = Number(value);
            if (!Number.isSafeInteger(size) || size < 1 || size > 1_000_000_000) {
                return jsonNoStore({ error: "companySize must be a positive whole number." }, { status: 400 });
            }
        }
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

    if (profileImage && currentUser.role === "admin") {
        return jsonNoStore({ error: "Profile image updates are not available for admin accounts." }, { status: 403 });
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
        const emailChanged = Boolean(userUpdates.email && userUpdates.email !== user.email);
        if (emailChanged && await User.exists({ email: userUpdates.email, _id: { $ne: user._id } })) {
            return jsonNoStore({ error: "An account with that email already exists." }, { status: 409 });
        }
        if (profileImage) uploadedImage = await uploadProfileImage(profileImage);
        let verification: ReturnType<typeof createOneTimeToken> | undefined;
        Object.assign(user, userUpdates);
        if (userUpdates.firstName || userUpdates.lastName) user.name = `${user.firstName} ${user.lastName}`;
        if (emailChanged) {
            verification = createOneTimeToken();
            user.isVerified = false;
            user.verificationTokenHash = verification.tokenHash;
            user.verificationTokenExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
        }
        await user.save();

        let profile = null;
        const profileUpdate = {
            ...(Object.keys(profileUpdates).length ? { $set: profileUpdates } : {}),
            ...(Object.keys(profileUnsets).length ? { $unset: profileUnsets } : {}),
        };
        let previousProfileImagePublicId: string | undefined;
        if ((Object.keys(profileUpdates).length > 0 || uploadedImage) && currentUser.role === "employer") {
            const existingProfile = uploadedImage
                ? await EmployerProfile.findOne({ user: currentUser.userId }).select("profileImagePublicId").lean()
                : null;
            previousProfileImagePublicId = existingProfile?.profileImagePublicId;
            profile = await EmployerProfile.findOneAndUpdate(
                { user: currentUser.userId },
                { $set: { ...profileUpdates, ...(uploadedImage ? { profileImage: uploadedImage.url, profileImagePublicId: uploadedImage.publicId } : {}) } },
                { returnDocument: "after", runValidators: true },
            ).select("-profileImagePublicId").lean();
            if (!profile) throw new Error("Employer profile is unavailable.");
            if (uploadedImage && previousProfileImagePublicId) {
                try {
                    await ProfileImageDeletion.create({ publicIds: [previousProfileImagePublicId] });
                } catch (cleanupError) {
                    console.error("Previous profile image cleanup could not be queued.", {
                        errorName: cleanupError instanceof Error ? cleanupError.name : "UnknownError",
                    });
                }
            }
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
        let emailVerificationSent: boolean | undefined;
        if (verification) {
            try {
                const appUrl = process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin;
                await sendVerificationEmail({ name: user.name, email: user.email, verifyUrl: `${appUrl}/verify?token=${verification.token}` });
                emailVerificationSent = true;
            } catch (emailError) {
                emailVerificationSent = false;
                console.error("Profile email verification delivery error", {
                    errorName: emailError instanceof Error ? emailError.name : "UnknownError",
                });
            }
        }
        return jsonNoStore({
            success: true,
            emailVerificationRequired: emailChanged,
            emailVerificationSent,
            user: {
                firstName: user.firstName,
                lastName: user.lastName,
                name: user.name,
                email: user.email,
                country: user.country,
                city: user.city,
                isVerified: user.isVerified,
                createdAt: user.createdAt,
                updatedAt: user.updatedAt,
            },
            profile,
        });
    } catch (error) {
        if (uploadedImage) {
            try {
                await ProfileImageDeletion.create({ publicIds: [uploadedImage.publicId] });
            } catch (cleanupError) {
                console.error("Uploaded profile image cleanup could not be queued.", {
                    errorName: cleanupError instanceof Error ? cleanupError.name : "UnknownError",
                });
            }
            if (typeof error === "object" && error !== null && "code" in error && error.code === 11000) {
                return jsonNoStore({ error: "An account with that email already exists." }, { status: 409 });
            }
        }
        console.error("Profile update error:", error);
        return jsonNoStore({ error: "Profile could not be saved." }, { status: 503 });
    }
}
