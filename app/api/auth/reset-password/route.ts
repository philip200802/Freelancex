import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/mongodb";
import User from "@/models/User";
import { hashToken } from "@/lib/tokens";

export async function POST(request: Request) {
    try {
        const body = await request.json() as { token?: string; password?: string };
        if (!body.token || !body.password || body.password.length < 8) return NextResponse.json({ error: "A valid token and password of at least 8 characters are required." }, { status: 400 });
        await connectToDatabase();
        const user = await User.findOne({ passwordResetTokenHash: hashToken(body.token), passwordResetTokenExpiresAt: { $gt: new Date() } }).select("+passwordHash +passwordResetTokenHash +passwordResetTokenExpiresAt");
        if (!user) return NextResponse.json({ error: "This reset link is invalid or has expired." }, { status: 400 });
        user.passwordHash = await bcrypt.hash(body.password, 12);
        user.passwordResetTokenHash = undefined;
        user.passwordResetTokenExpiresAt = undefined;
        await user.save();
        return NextResponse.json({ message: "Password updated successfully." });
    } catch (error) {
        console.error("Password reset error", { errorName: error instanceof Error ? error.name : "UnknownError" });
        return NextResponse.json({ error: "Password reset is temporarily unavailable." }, { status: 500 });
    }
}