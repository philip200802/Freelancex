import { cookies } from "next/headers";
import { connectToDatabase } from "@/lib/mongodb";
import User from "@/models/User";
import { verifyAuthToken, type AuthToken } from "@/lib/auth";

export async function getCurrentUser(): Promise<AuthToken | null> {
    const cookieStore = await cookies();
    const token = cookieStore.get("freelancex_session")?.value;
    if (!token) {
        return null;
    }

    let tokenUser: AuthToken;
    try {
        tokenUser = verifyAuthToken(token);
    } catch {
        return null;
    }

    await connectToDatabase();
    const user = await User.findById(tokenUser.userId).select("role isActive").lean();
    if (!user || user.isActive === false) return null;
    return { userId: user._id.toString(), role: user.role };
}
