import mongoose from "mongoose";
import { NextResponse } from "next/server";
import { BankAccountEncryptionConfigurationError, decryptBankAccountNumber } from "@/lib/bank-account-crypto";
import { getCurrentUser } from "@/lib/current-user";
import { connectToDatabase } from "@/lib/mongodb";
import AdminActivityLog from "@/models/AdminActivityLog";
import BankAccount from "@/models/BankAccount";
import User from "@/models/User";

export const dynamic = "force-dynamic";

function jsonNoStore(body: unknown, init?: ResponseInit) {
    const response = NextResponse.json(body, init);
    response.headers.set("Cache-Control", "no-store");
    return response;
}

export async function POST(request: Request, context: { params: Promise<{ userId: string }> }) {
    const admin = await getCurrentUser();
    if (!admin) return jsonNoStore({ error: "Authentication required." }, { status: 401 });
    if (admin.role !== "admin") return jsonNoStore({ error: "Admin access required." }, { status: 403 });

    const { userId } = await context.params;
    if (!mongoose.Types.ObjectId.isValid(userId)) return jsonNoStore({ error: "Bank account not found." }, { status: 404 });
    let reason: string;
    try {
        const body = await request.json() as { reason?: unknown };
        reason = typeof body.reason === "string" ? body.reason.trim() : "";
    } catch {
        return jsonNoStore({ error: "Provide a reason for accessing the full account number." }, { status: 400 });
    }
    if (reason.length < 10 || reason.length > 500) {
        return jsonNoStore({ error: "Provide an access reason between 10 and 500 characters." }, { status: 400 });
    }

    try {
        await connectToDatabase();
        const [adminRecord, freelancer, bankAccount] = await Promise.all([
            User.findOne({ _id: admin.userId, role: "admin", isActive: { $ne: false } }).select("name").lean(),
            User.findOne({ _id: userId, role: "freelancer", isActive: { $ne: false } }).select("name").lean(),
            BankAccount.findOne({ user: userId, verificationStatus: "verified", verifiedAt: { $exists: true } })
                .select("+encryptedAccountNumber bankName accountNumberLast4")
                .lean(),
        ]);
        if (!adminRecord) return jsonNoStore({ error: "Admin access required." }, { status: 403 });
        if (!freelancer || !bankAccount) return jsonNoStore({ error: "Verified bank account not found." }, { status: 404 });

        const accountNumber = decryptBankAccountNumber(bankAccount.encryptedAccountNumber);
        if (!/^\d{10}$/.test(accountNumber) || accountNumber.slice(-4) !== bankAccount.accountNumberLast4) {
            throw new Error("Stored bank account does not match its encrypted record.");
        }
        await new AdminActivityLog({
            adminId: admin.userId,
            adminNameSnapshot: adminRecord.name,
            action: "bank_account.revealed",
            targetUserId: userId,
            targetUserNameSnapshot: freelancer.name,
            description: "Admin accessed a freelancer's full payout account number.",
            metadata: { reason: reason.replace(/\d{4,}/g, "[redacted]"), bankName: bankAccount.bankName },
        }).save();

        return jsonNoStore({ accountNumber });
    } catch (error) {
        console.error("Admin bank account reveal failed:", { errorName: error instanceof Error ? error.name : "UnknownError" });
        if (error instanceof BankAccountEncryptionConfigurationError) {
            return jsonNoStore({ error: "Bank account encryption is not configured. Contact the platform administrator." }, { status: 500 });
        }
        return jsonNoStore({ error: "The bank account number could not be revealed." }, { status: 503 });
    }
}
