import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/mongodb";
import User, { type UserRole } from "@/models/User";
import { createOneTimeToken } from "@/lib/tokens";
import { sendVerificationEmail } from "@/lib/email";
import FreelancerProfile from "@/models/FreelancerProfile";
import EmployerProfile from "@/models/EmployerProfile";
import { uploadProfileImage, validateProfileImage } from "@/lib/cloudinary";
import { validateFreelancerRegistrationProfile } from "@/lib/registration-validation";

const allowedRoles: UserRole[] = ["employer", "freelancer"];
const employerAccountTypes = ["Individual", "Company"] as const;
const employerHiringFrequencies = ["Occasionally", "Monthly", "Frequently", "For ongoing projects"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAllowedValue<T extends string>(value: unknown, allowed: readonly T[]): value is T {
    return typeof value === "string" && allowed.includes(value as T);
}

export async function POST(request: Request) {
    try {
        let body: Record<string, unknown>;
        let profileImage: File | undefined;
        if (request.headers.get("content-type")?.includes("multipart/form-data")) {
            const formData = await request.formData();
            const profileDataValue = formData.get("profileData");
            let profileData: unknown;
            try {
                profileData = typeof profileDataValue === "string" ? JSON.parse(profileDataValue) : undefined;
            } catch {
                return NextResponse.json({ error: "Role profile information is invalid." }, { status: 400 });
            }
            body = { firstName: formData.get("firstName"), lastName: formData.get("lastName"), email: formData.get("email"), password: formData.get("password"), role: formData.get("role"), country: formData.get("country"), city: formData.get("city"), termsAccepted: formData.get("termsAccepted") === "true", profileData };
            const imageValue = formData.get("profileImage");
            if (imageValue instanceof File && imageValue.size > 0) profileImage = imageValue;
        } else {
            body = await request.json() as Record<string, unknown>;
        }
        const firstName = typeof body.firstName === "string" ? body.firstName.trim() : "";
        const lastName = typeof body.lastName === "string" ? body.lastName.trim() : "";
        const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
        const password = typeof body.password === "string" ? body.password : "";
        const role = body.role;
        const country = typeof body.country === "string" ? body.country.trim() : "";
        const city = typeof body.city === "string" ? body.city.trim() : "";
        const termsAccepted = body.termsAccepted === true;

        if (!firstName || !lastName || !email || !password || !role || !allowedRoles.includes(role as UserRole) || !country || !city || !termsAccepted) {
            return NextResponse.json({ error: "Complete the required account and legal information." }, { status: 400 });
        }

        if (password.length < 8 || password.length > 128) {
            return NextResponse.json({ error: "Password must be between 8 and 128 characters." }, { status: 400 });
        }

        await connectToDatabase();
        const existingUser = await User.findOne({ email }).select("_id");
        if (existingUser) {
            return NextResponse.json({ error: "An account with that email already exists." }, { status: 409 });
        }

        const profileData = body.profileData as Record<string, unknown> | undefined;
        if (!isRecord(profileData)) return NextResponse.json({ error: "Role profile information is required." }, { status: 400 });
        const profileError = role === "freelancer"
            ? validateFreelancerRegistrationProfile(profileData, Boolean(profileImage))
            : !isAllowedValue(profileData.accountType, employerAccountTypes) || !Array.isArray(profileData.hiringCategories) || profileData.hiringCategories.length === 0 || !isAllowedValue(profileData.hiringFrequency, employerHiringFrequencies) || (profileData.accountType === "Company" && (!String(profileData.companyName || "").trim() || !String(profileData.industry || "").trim() || !String(profileData.companySize || "").trim() || !String(profileData.position || "").trim()))
                ? "Complete the employer profile with valid account type and hiring preference values."
                : "";
        if (profileError) return NextResponse.json({ error: profileError }, { status: 400 });
        if (profileImage) {
            const imageError = await validateProfileImage(profileImage);
            if (imageError) return NextResponse.json({ error: imageError }, { status: 400 });
        }
        let uploadedImage: { url: string; publicId: string } | undefined;
        if (profileImage) {
            try {
                uploadedImage = await uploadProfileImage(profileImage);
            } catch (error) {
                console.error("Profile image upload error:", error instanceof Error ? error.message : "unknown upload error");
                return NextResponse.json({ error: "Profile image upload is temporarily unavailable." }, { status: 503 });
            }
        }
        const name = `${firstName} ${lastName}`;
        const termsAcceptedAt = new Date();
        const passwordHash = await bcrypt.hash(password, 12);
        const verification = createOneTimeToken();
        const user = await User.create({ name, firstName, lastName, email, passwordHash, role, country, city, termsAcceptedAt, termsVersion: "2026-11-04", privacyPolicyVersion: "2026-11-04", isVerified: false, verificationTokenHash: verification.tokenHash, verificationTokenExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) });
        try {
            const profileDocument = { ...profileData, ...(uploadedImage ? { profileImage: uploadedImage.url, profileImagePublicId: uploadedImage.publicId } : {}), user: user.id };
            if (role === "freelancer") await FreelancerProfile.create(profileDocument);
            else await EmployerProfile.create(profileDocument);
        } catch (profileError) {
            await User.deleteOne({ _id: user.id });
            throw profileError;
        }
        const appUrl = process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin;
        try {
            await sendVerificationEmail({ name, email, verifyUrl: `${appUrl}/verify?token=${verification.token}` });
        } catch (emailError) {
            console.error("Verification email delivery error", { provider: process.env.BREVO_API_KEY ? "brevo-api" : "smtp", errorName: emailError instanceof Error ? emailError.name : "UnknownError", errorMessage: emailError instanceof Error ? emailError.message : "unknown email error" });
            return NextResponse.json({ code: "verification_email_failed", message: "Your account was created, but the verification email could not be sent. Request a new verification email once the email service is available." }, { status: 503 });
        }
        return NextResponse.json({ message: "Check your inbox to verify your email before signing in." }, { status: 201 });
    } catch (error) {
        console.error("Registration error:", error);
        return NextResponse.json({ error: "Registration is temporarily unavailable." }, { status: 500 });
    }
}
