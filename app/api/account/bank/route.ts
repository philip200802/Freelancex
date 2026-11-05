import { NextResponse } from "next/server";
import { decryptBankAccountNumber, encryptBankAccountNumber, BankAccountEncryptionConfigurationError } from "@/lib/bank-account-crypto";
import { getCurrentUser } from "@/lib/current-user";
import { connectToDatabase } from "@/lib/mongodb";
import { migrateLegacyBankAccounts } from "@/lib/migrate-legacy-bank-accounts";
import {
    listPaystackBanks,
    PaystackConfigurationError,
    PaystackRequestError,
    resolvePaystackBankAccount,
    savePaystackTransferRecipient,
} from "@/lib/payments/paystack";
import User from "@/models/User";
import BankAccount from "@/models/BankAccount";

export const dynamic = "force-dynamic";
const activeBankVerifications = new Set<string>();

function jsonNoStore(body: unknown, init?: ResponseInit) {
    const response = NextResponse.json(body, init);
    response.headers.set("Cache-Control", "no-store");
    return response;
}

function getRateLimitRetryAt(value?: string) {
    if (!value) return undefined;
    const numeric = Number(value);
    let resetAt: number;
    if (Number.isFinite(numeric)) {
        resetAt = numeric > 1_000_000_000_000
            ? numeric
            : numeric > 1_000_000_000
                ? numeric * 1000
                : Date.now() + numeric * 1000;
    } else {
        resetAt = Date.parse(value);
    }
    return Number.isFinite(resetAt) && resetAt > Date.now() ? new Date(resetAt).toISOString() : undefined;
}

function providerError(error: unknown) {
    if (error instanceof PaystackConfigurationError || error instanceof BankAccountEncryptionConfigurationError) {
        return jsonNoStore({ error: "Bank verification is not configured. Contact the platform administrator." }, { status: 500 });
    }
    if (error instanceof PaystackRequestError) {
        if (error.statusCode === 429) {
            const retryAt = getRateLimitRetryAt(error.rateLimitReset);
            console.warn("Paystack bank request was rate limited.", {
                operation: error.operation,
                rateLimitReset: error.rateLimitReset,
            });
            const headers = new Headers();
            if (error.rateLimitReset) headers.set("x-ratelimit-reset", error.rateLimitReset);
            return jsonNoStore({
                error: "Paystack is temporarily limiting bank verification requests. Please retry after the indicated time.",
                retryAt,
            }, { status: 429, headers });
        }
        if (error.verificationFailure) {
            return jsonNoStore({
                error: error.providerMessage || "Paystack could not verify this account. Check the account number and bank code.",
            }, { status: 422 });
        }
        console.error("Paystack bank request failed.", {
            operation: error.operation,
            statusCode: error.statusCode,
            definitive: error.definitive,
        });
        if (error.statusCode && error.statusCode >= 500) {
            return jsonNoStore({ error: "Paystack is temporarily unavailable. Please try again later." }, { status: 502 });
        }
        if (error.statusCode === 401 || error.statusCode === 403) {
            return jsonNoStore({ error: "Bank verification could not authenticate with Paystack. Contact the platform administrator." }, { status: 502 });
        }
        return jsonNoStore({ error: "Bank verification is temporarily unavailable. Please try again later." }, { status: 503 });
    }
    console.error("Bank details request failed.", { errorName: error instanceof Error ? error.name : "UnknownError" });
    return jsonNoStore({ error: "Bank details are temporarily unavailable." }, { status: 503 });
}

export async function GET(request: Request) {
    const currentUser = await getCurrentUser();
    if (!currentUser) return jsonNoStore({ error: "Authentication required." }, { status: 401 });
    if (currentUser.role !== "freelancer") return jsonNoStore({ error: "Only freelancers can manage payout bank details." }, { status: 403 });

    if (new URL(request.url).searchParams.get("list") === "true") {
        try {
            const banks = await listPaystackBanks();
            return jsonNoStore({ banks: banks.map(({ name, code }) => ({ name, code })) });
        } catch (error) {
            return providerError(error);
        }
    }

    try {
        await connectToDatabase();
        await migrateLegacyBankAccounts();
        const user = await User.findById(currentUser.userId)
            .select("+paystackRecipientCode")
            .lean();
        if (!user) return jsonNoStore({ error: "Account not found." }, { status: 404 });
        const bankAccount = await BankAccount.findOne({ user: user._id }).select("-encryptedAccountNumber").lean();
        return jsonNoStore({
            bankDetails: bankAccount
                ? {
                    bankCode: bankAccount.bankCode,
                    bankName: bankAccount.bankName,
                    accountName: bankAccount.accountName,
                    maskedAccountNumber: `••••••${bankAccount.accountNumberLast4}`,
                    verifiedAt: bankAccount.verifiedAt || null,
                    verified: bankAccount.verificationStatus === "verified" && Boolean(bankAccount.verifiedAt && user.paystackRecipientCode),
                }
                : null,
        });
    } catch (error) {
        return providerError(error);
    }
}

export async function PUT(request: Request) {
    const currentUser = await getCurrentUser();
    if (!currentUser) return jsonNoStore({ error: "Authentication required." }, { status: 401 });
    if (currentUser.role !== "freelancer") return jsonNoStore({ error: "Only freelancers can manage payout bank details." }, { status: 403 });

    let body: { accountNumber?: unknown; bankCode?: unknown };
    try {
        body = await request.json() as typeof body;
    } catch {
        return jsonNoStore({ error: "Bank details are invalid." }, { status: 400 });
    }
    const accountNumber = typeof body.accountNumber === "string" ? body.accountNumber.trim() : "";
    const bankCode = typeof body.bankCode === "string" ? body.bankCode.trim() : "";
    if (!/^\d{10}$/.test(accountNumber) || !bankCode || bankCode.length > 32) {
        return jsonNoStore({ error: "Choose a bank and enter a valid 10-digit account number." }, { status: 400 });
    }
    if (activeBankVerifications.has(currentUser.userId)) {
        return jsonNoStore({ error: "Bank verification is already in progress. Please wait for it to finish." }, { status: 409 });
    }

    activeBankVerifications.add(currentUser.userId);
    try {
        const encryptedAccountNumber = encryptBankAccountNumber(accountNumber);
        await connectToDatabase();
        await migrateLegacyBankAccounts();
        const user = await User.findById(currentUser.userId)
            .select("+paystackRecipientCode +payoutAccountNumber email role");
        if (!user || user.role !== "freelancer") return jsonNoStore({ error: "Freelancer account not found." }, { status: 404 });

        const existingBankAccount = await BankAccount.findOne({ user: currentUser.userId })
            .select("+encryptedAccountNumber")
            .lean();
        if (
            existingBankAccount?.verificationStatus === "verified" &&
            existingBankAccount.bankCode === bankCode &&
            existingBankAccount.encryptedAccountNumber &&
            user.paystackRecipientCode &&
            decryptBankAccountNumber(existingBankAccount.encryptedAccountNumber) === accountNumber
        ) {
            return jsonNoStore({
                message: "These verified bank details are already saved.",
                bankDetails: {
                    bankCode: existingBankAccount.bankCode,
                    bankName: existingBankAccount.bankName,
                    accountName: existingBankAccount.accountName,
                    maskedAccountNumber: `••••••${existingBankAccount.accountNumberLast4}`,
                    verifiedAt: existingBankAccount.verifiedAt || null,
                    verified: true,
                },
            });
        }

        const banks = await listPaystackBanks();
        const bank = banks.find((candidate) => candidate.code === bankCode);
        if (!bank) return jsonNoStore({ error: "Choose a bank from the current bank list." }, { status: 400 });

        const verifiedAccount = await resolvePaystackBankAccount(accountNumber, bank.code);

        const recipient = await savePaystackTransferRecipient({
            recipientCode: user.paystackRecipientCode,
            name: verifiedAccount.account_name,
            accountNumber,
            bankCode: bank.code,
        });
        const verifiedAt = new Date();
        const session = await User.startSession();
        try {
            await session.withTransaction(async () => {
                const currentUserRecord = await User.findOne({ _id: currentUser.userId, role: "freelancer", isActive: { $ne: false } })
                    .select("+paystackRecipientCode")
                    .session(session);
                if (!currentUserRecord) throw new Error("FREELANCER_NOT_FOUND");
                currentUserRecord.paystackRecipientCode = recipient.recipient_code;
                currentUserRecord.set("payoutAccountNumber", undefined);
                await currentUserRecord.save({ session });

                await BankAccount.findOneAndUpdate(
                    { user: currentUser.userId },
                    {
                        $set: {
                            bankName: bank.name,
                            bankCode: bank.code,
                            encryptedAccountNumber,
                            accountNumberLast4: accountNumber.slice(-4),
                            accountName: verifiedAccount.account_name.trim(),
                            verificationStatus: "verified",
                            verifiedAt,
                        },
                    },
                    { upsert: true, new: true, runValidators: true, session, setDefaultsOnInsert: true },
                );
            });
        } finally {
            await session.endSession();
        }

        return jsonNoStore({
            message: "Bank details verified and saved.",
            bankDetails: {
                bankCode: bank.code,
                bankName: bank.name,
                accountName: verifiedAccount.account_name.trim(),
                maskedAccountNumber: `••••••${accountNumber.slice(-4)}`,
                verifiedAt,
                verified: true,
            },
        });
    } catch (error) {
        return providerError(error);
    } finally {
        activeBankVerifications.delete(currentUser.userId);
    }
}
