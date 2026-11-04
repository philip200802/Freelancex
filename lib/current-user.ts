import { cookies } from "next/headers";
import { verifyAuthToken, type AuthToken } from "@/lib/auth";

export async function getCurrentUser(): Promise<AuthToken | null> {
    const cookieStore = await cookies();
    const token = cookieStore.get("freelancex_session")?.value;
    if (!token) {
        return null;
    }

    try {
        return verifyAuthToken(token);
    } catch {
        return null;
    }
}
