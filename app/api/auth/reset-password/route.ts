import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/mongodb";
import User from "@/models/User";
import { hashToken } from "@/lib/tokens";

export async function POST(request: Request) {
    try {
        const body = await request.json() as { token?: string; password?: string };
        if (
            typeof body.token !== "string" ||
            body.token.length !== 64 ||
            typeof body.password !== "string" ||
            body.password.length < 8 ||
            body.password.length > 128
        ) {
            return NextResponse.json({ error: "A valid token and password between 8 and 128 characters are required." }, { status: 400 });
        }
        await connectToDatabase();
        const tokenHash = hashToken(body.token);
        const user = await User.findOne({
            passwordResetTokenHash: tokenHash,
            passwordResetTokenExpiresAt: { $gt: new Date() },
        }).select("_id");
        if (!user) return NextResponse.json({ error: "This reset link is invalid or has expired." }, { status: 400 });
        const passwordHash = await bcrypt.hash(body.password, 12);
        const updated = await User.updateOne(
            { _id: user._id, passwordResetTokenHash: tokenHash, passwordResetTokenExpiresAt: { $gt: new Date() } },
            {
                $set: { passwordHash },
                $unset: { passwordResetTokenHash: 1, passwordResetTokenExpiresAt: 1 },
            },
        );
        if (updated.modifiedCount !== 1) return NextResponse.json({ error: "This reset link is invalid or has expired." }, { status: 400 });
        return NextResponse.json({ message: "Password updated successfully." });
    } catch (error) {
        console.error("Password reset error", { errorName: error instanceof Error ? error.name : "UnknownError" });
        return NextResponse.json({ error: "Password reset is temporarily unavailable." }, { status: 500 });
    }
}