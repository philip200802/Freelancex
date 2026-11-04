import jwt, { type SignOptions } from "jsonwebtoken";
import type { UserRole } from "@/models/User";

export type AuthToken = {
    userId: string;
    role: UserRole;
};

function getJwtSecret() {
    if (!process.env.JWT_SECRET) {
        throw new Error("JWT_SECRET is not configured.");
    }

    return process.env.JWT_SECRET;
}

export function createAuthToken(payload: AuthToken) {
    const options: SignOptions = { expiresIn: (process.env.JWT_EXPIRES_IN || "7d") as SignOptions["expiresIn"] };
    return jwt.sign(payload, getJwtSecret(), options);
}

export function verifyAuthToken(token: string) {
    return jwt.verify(token, getJwtSecret()) as AuthToken;
}
