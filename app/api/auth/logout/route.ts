import { NextResponse } from "next/server";

export async function POST() {
    const response = NextResponse.json({ success: true });
    response.cookies.set("freelancex_session", "", { httpOnly: true, expires: new Date(0), sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/" });
    return response;
}
