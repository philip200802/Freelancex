import { NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/mongodb";
import User from "@/models/User";
import { createOneTimeToken } from "@/lib/tokens";
import { sendPasswordResetEmail } from "@/lib/email";

export async function POST(request: Request) {
    try {
        const email = (await request.json() as { email?: string }).email?.trim().toLowerCase();
        if (!email) return NextResponse.json({ error: "Email is required." }, { status: 400 });
        await connectToDatabase();
        const user = await User.findOne({ email }).select("+passwordResetTokenHash +passwordResetTokenExpiresAt");
        if (user) {
            const reset = createOneTimeToken();
            user.passwordResetTokenHash = reset.tokenHash;
            user.passwordResetTokenExpiresAt = new Date(Date.now() + 60 * 60 * 1000);
            await user.save();
            const appUrl = process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin;
            await sendPasswordResetEmail({ email, resetUrl: `${appUrl}/reset-password?token=${reset.token}` });
        }
        return NextResponse.json({ message: "If an account exists for that email, a reset link is on its way." });
    } catch (error) {
        console.error("Password reset request error", { errorName: error instanceof Error ? error.name : "UnknownError" });
        return NextResponse.json({ error: "Password reset is temporarily unavailable." }, { status: 500 });
    }
}