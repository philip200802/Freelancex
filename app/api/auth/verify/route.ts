import { NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/mongodb";
import User from "@/models/User";
import { hashToken } from "@/lib/tokens";
import { sendWelcomeEmail } from "@/lib/email";

export async function GET(request: Request) {
    const token = new URL(request.url).searchParams.get("token");
    if (!token) return NextResponse.json({ error: "Verification token is required." }, { status: 400 });
    await connectToDatabase();
    const tokenHash = hashToken(token);
    const user = await User.findOne({ verificationTokenHash: tokenHash, verificationTokenExpiresAt: { $gt: new Date() } }).select("+verificationTokenHash +verificationTokenExpiresAt +consumedVerificationTokenHash");
    const alreadyVerifiedUser = user || await User.findOne({ consumedVerificationTokenHash: tokenHash, isVerified: true }).select("+consumedVerificationTokenHash");
    if (!alreadyVerifiedUser) return NextResponse.json({ error: "This verification link is invalid or has expired." }, { status: 400 });

    const wasAlreadyVerified = alreadyVerifiedUser.isVerified;
    if (!wasAlreadyVerified) {
        alreadyVerifiedUser.isVerified = true;
        alreadyVerifiedUser.consumedVerificationTokenHash = tokenHash;
        alreadyVerifiedUser.verificationTokenHash = undefined;
        alreadyVerifiedUser.verificationTokenExpiresAt = undefined;
        await alreadyVerifiedUser.save();
    }

    let welcomeEmailPending = false;
    if (!alreadyVerifiedUser.welcomeEmailSent) {
        try {
            const appUrl = process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin;
            await sendWelcomeEmail({ name: alreadyVerifiedUser.name, email: alreadyVerifiedUser.email, signInUrl: `${appUrl}/login` });
            alreadyVerifiedUser.welcomeEmailSent = true;
            await alreadyVerifiedUser.save();
        } catch (error) {
            welcomeEmailPending = true;
            console.error("Welcome email delivery error", { errorName: error instanceof Error ? error.name : "UnknownError" });
        }
    }
    return NextResponse.json({ message: wasAlreadyVerified ? "Your email has already been verified." : "Email verified successfully.", alreadyVerified: wasAlreadyVerified, welcomeEmailPending });
}