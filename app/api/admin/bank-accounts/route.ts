import { NextResponse } from "next/server";
import { BankAccountEncryptionConfigurationError } from "@/lib/bank-account-crypto";
import { getCurrentUser } from "@/lib/current-user";
import { connectToDatabase } from "@/lib/mongodb";
import BankAccount from "@/models/BankAccount";
import { migrateLegacyBankAccounts } from "@/lib/migrate-legacy-bank-accounts";
import User from "@/models/User";

export const dynamic = "force-dynamic";

function jsonNoStore(body: unknown, init?: ResponseInit) {
    const response = NextResponse.json(body, init);
    response.headers.set("Cache-Control", "no-store");
    return response;
}

function escapeRegex(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function GET(request: Request) {
    const admin = await getCurrentUser();
    if (!admin) return jsonNoStore({ error: "Authentication required." }, { status: 401 });
    if (admin.role !== "admin") return jsonNoStore({ error: "Admin access required." }, { status: 403 });

    try {
        await connectToDatabase();
        await migrateLegacyBankAccounts();
        const { searchParams } = new URL(request.url);
        const query = (searchParams.get("q") || "").trim().slice(0, 120);
        const verification = searchParams.get("verification") || "all";
        const page = Number(searchParams.get("page") || "1");
        const limit = Number(searchParams.get("limit") || "20");
        if (!["all", "verified", "unverified", "missing"].includes(verification)) {
            return jsonNoStore({ error: "Choose a valid verification filter." }, { status: 400 });
        }
        if (!Number.isInteger(page) || page < 1 || ![20, 50, 100].includes(limit)) {
            return jsonNoStore({ error: "Page or page size is invalid." }, { status: 400 });
        }

        const match: Record<string, unknown> = {};
        if (verification === "verified") {
            match["bankAccount.verificationStatus"] = "verified";
            match["bankAccount.verifiedAt"] = { $ne: null };
        } else if (verification === "unverified") {
            match["bankAccount._id"] = { $exists: true };
            match["bankAccount.verificationStatus"] = { $ne: "verified" };
        } else if (verification === "missing") {
            match["bankAccount._id"] = { $exists: false };
        }
        if (query) {
            const expression = new RegExp(escapeRegex(query), "i");
            match.$or = [
                { name: expression },
                { email: expression },
                { "bankAccount.bankName": expression },
                { "bankAccount.accountName": expression },
            ];
        }

        const [result] = await User.aggregate([
            { $match: { role: "freelancer", isActive: { $ne: false } } },
            {
                $lookup: {
                    from: BankAccount.collection.name,
                    localField: "_id",
                    foreignField: "user",
                    as: "bankAccount",
                },
            },
            { $unwind: { path: "$bankAccount", preserveNullAndEmptyArrays: true } },
            {
                $facet: {
                    entries: [
                        { $match: match },
                        { $sort: { name: 1, _id: 1 } },
                        { $skip: (page - 1) * limit },
                        { $limit: limit },
                        {
                            $project: {
                                name: 1,
                                email: 1,
                                bankName: "$bankAccount.bankName",
                                bankCode: "$bankAccount.bankCode",
                                accountName: "$bankAccount.accountName",
                                accountNumberLast4: "$bankAccount.accountNumberLast4",
                                verificationStatus: "$bankAccount.verificationStatus",
                                verifiedAt: "$bankAccount.verifiedAt",
                                updatedAt: "$bankAccount.updatedAt",
                            },
                        },
                    ],
                    totals: [{ $match: match }, { $count: "total" }],
                    summary: [{
                        $group: {
                            _id: null,
                            totalFreelancers: { $sum: 1 },
                            verifiedAccounts: { $sum: { $cond: [{ $and: [{ $eq: ["$bankAccount.verificationStatus", "verified"] }, { $ne: ["$bankAccount.verifiedAt", null] }] }, 1, 0] } },
                            unverifiedAccounts: { $sum: { $cond: [{ $and: [{ $ne: ["$bankAccount._id", null] }, { $or: [{ $ne: ["$bankAccount.verificationStatus", "verified"] }, { $eq: ["$bankAccount.verifiedAt", null] }] }] }, 1, 0] } },
                            freelancersWithoutAccounts: { $sum: { $cond: [{ $eq: ["$bankAccount._id", null] }, 1, 0] } },
                        },
                    }],
                },
            },
        ]);
        const entries = result?.entries || [];
        const total = result?.totals?.[0]?.total || 0;
        const summary = result?.summary?.[0] || { totalFreelancers: 0, verifiedAccounts: 0, unverifiedAccounts: 0, freelancersWithoutAccounts: 0 };
        return jsonNoStore({
            bankAccounts: entries.map((entry: {
                _id: { toString(): string };
                name: string;
                email: string;
                bankName?: string;
                bankCode?: string;
                accountName?: string;
                accountNumberLast4?: string;
                verificationStatus?: string;
                verifiedAt?: Date;
                updatedAt?: Date;
            }) => ({
                userId: entry._id.toString(),
                freelancerName: entry.name,
                freelancerEmail: entry.email,
                bankName: entry.bankName || null,
                bankCode: entry.bankCode || null,
                accountName: entry.accountName || null,
                maskedAccountNumber: entry.accountNumberLast4 ? `••••••${entry.accountNumberLast4}` : null,
                verificationStatus: !entry.verificationStatus ? "missing" : entry.verificationStatus === "verified" && entry.verifiedAt ? "verified" : "unverified",
                verifiedAt: entry.verifiedAt || null,
                updatedAt: entry.updatedAt || null,
            })),
            summary,
            pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
        });
    } catch (error) {
        console.error("Admin bank account listing error:", { errorName: error instanceof Error ? error.name : "UnknownError" });
        if (error instanceof BankAccountEncryptionConfigurationError) {
            return jsonNoStore({ error: "Bank account encryption is not configured. Contact the platform administrator." }, { status: 500 });
        }
        return jsonNoStore({ error: "Freelancer bank accounts are temporarily unavailable." }, { status: 503 });
    }
}
