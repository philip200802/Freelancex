import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/mongodb";
import User from "@/models/User";
import { createAuthToken } from "@/lib/auth";

export async function POST(request: Request) {
    try {
        const body = await request.json() as { email?: string; password?: string };
        const email = body.email?.trim().toLowerCase();
        const password = body.password;

        if (!email || !password) {
            return NextResponse.json({ error: "Email and password are required." }, { status: 400 });
        }

        await connectToDatabase();
        const user = await User.findOne({ email }).select("+passwordHash +isVerified");
        const passwordMatches = user ? await bcrypt.compare(password, user.passwordHash) : false;
        if (!user || !passwordMatches) {
            return NextResponse.json({ error: "Invalid email or password." }, { status: 401 });
        }
        if (!user.isVerified) {
            return NextResponse.json({ success: false, code: "EMAIL_NOT_VERIFIED", message: "Please verify your email before signing in.", email: user.email }, { status: 403 });
        }

        const token = createAuthToken({ userId: user.id, role: user.role });
        const response = NextResponse.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role } });
        response.cookies.set("freelancex_session", token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 60 * 60 * 24 * 7, path: "/" });
        return response;
    } catch (error) {
        console.error("Login error", { errorName: error instanceof Error ? error.name : "UnknownError" });
        return NextResponse.json({ error: "Login is temporarily unavailable." }, { status: 500 });
    }
}
