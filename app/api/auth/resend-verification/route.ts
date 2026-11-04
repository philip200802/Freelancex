import { NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/mongodb";
import User from "@/models/User";
import { createOneTimeToken } from "@/lib/tokens";
import { sendVerificationEmail } from "@/lib/email";

export async function POST(request: Request) {
    try {
        const body = await request.json() as { email?: string };
        const email = body.email?.trim().toLowerCase();
        if (!email) return NextResponse.json({ error: "Email is required." }, { status: 400 });
        await connectToDatabase();
        const user = await User.findOne({ email }).select("+verificationTokenHash +verificationTokenExpiresAt +verificationResendAt");
        if (!user || user.isVerified) return NextResponse.json({ message: "If that account needs verification, a new email will be sent." });
        const cooldownMs = 60 * 1000;
        if (user.verificationResendAt && Date.now() - user.verificationResendAt.getTime() < cooldownMs) return NextResponse.json({ error: "Please wait before requesting another verification email.", retryAfterSeconds: Math.ceil((cooldownMs - (Date.now() - user.verificationResendAt.getTime())) / 1000) }, { status: 429 });
        const verification = createOneTimeToken();
        user.verificationTokenHash = verification.tokenHash;
        user.verificationTokenExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
        user.verificationResendAt = new Date();
        await user.save();
        const appUrl = process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin;
        try {
            await sendVerificationEmail({ name: user.name, email: user.email, verifyUrl: `${appUrl}/verify?token=${verification.token}` });
        } catch (error) {
            console.error("Verification resend delivery error", { provider: process.env.BREVO_API_KEY ? "brevo-api" : "smtp", errorName: error instanceof Error ? error.name : "UnknownError", errorMessage: error instanceof Error ? error.message : "unknown email error" });
            return NextResponse.json({ error: "The verification email could not be sent. Please try again later." }, { status: 503 });
        }
        return NextResponse.json({ message: "A new verification email has been sent." });
    } catch (error) {
        console.error("Verification resend error", { errorName: error instanceof Error ? error.name : "UnknownError" });
        return NextResponse.json({ error: "Verification email is temporarily unavailable." }, { status: 500 });
    }
}