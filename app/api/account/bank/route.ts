import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
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

function failure(status: number, code: string, message: string, retryable: boolean, extra: Record<string, unknown> = {}) {
    return jsonNoStore({ success: false, code, message, error: message, retryable, ...extra }, { status });
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
    if (error instanceof BankAccountEncryptionConfigurationError) {
        return failure(503, "BANK_ENCRYPTION_KEY_NOT_CONFIGURED", "Bank account encryption is not configured. Set a valid 32-byte BANK_ACCOUNT_ENCRYPTION_KEY and restart the server.", false);
    }
    if (error instanceof PaystackConfigurationError) {
        const code = error.reason === "missing_secret" ? "PAYSTACK_TEST_KEY_MISSING" : "PAYSTACK_TEST_KEY_REQUIRED";
        return failure(503, code, error.reason === "missing_secret"
            ? "Paystack test mode is not configured. Set PAYSTACK_SECRET_KEY to a test key."
            : "Bank verification only accepts a Paystack test key. Configure an sk_test_ key.", false);
    }
    if (error instanceof PaystackRequestError) {
        if (error.statusCode === 429) {
            const retryAt = getRateLimitRetryAt(error.retryAfter) || getRateLimitRetryAt(error.rateLimitReset);
            console.warn("Paystack bank request was rate limited.", {
                operation: error.operation,
                retryAfterProvided: Boolean(error.retryAfter),
                rateLimitResetProvided: Boolean(error.rateLimitReset),
            });
            const headers = new Headers();
            if (error.retryAfter) headers.set("Retry-After", error.retryAfter);
            if (error.rateLimitReset) headers.set("X-RateLimit-Reset", error.rateLimitReset);
            return jsonNoStore({
                success: false,
                code: "PAYSTACK_RATE_LIMITED",
                message: "Paystack is temporarily limiting bank verification requests. Please wait before trying again.",
                error: "Paystack is temporarily limiting bank verification requests. Please wait before trying again.",
                retryable: true,
                ...(retryAt ? { retryAt } : {}),
            }, { status: 429, headers });
        }
        if (error.verificationFailure) {
            return failure(422, "BANK_VERIFICATION_FAILED", "We could not verify this bank account. Check the account number and selected bank.", false);
        }
        console.error("Paystack bank request failed.", {
            operation: error.operation,
            statusCode: error.statusCode,
            definitive: error.definitive,
        });
        if (error.statusCode === 401 || error.statusCode === 403) {
            return failure(502, "PAYSTACK_AUTHENTICATION_FAILED", "Bank verification could not authenticate with Paystack. Contact the platform administrator.", false);
        }
        return failure(503, "PAYSTACK_UNAVAILABLE", "Paystack is temporarily unavailable. Please try again later.", true);
    }
    if (error && typeof error === "object" && "code" in error && error.code === 11000) {
        return failure(409, "BANK_UPDATE_IN_PROGRESS", "A bank details update is already being processed. Please retry shortly.", true);
    }
    if (error instanceof Error && error.message === "FREELANCER_NOT_FOUND") {
        return failure(404, "FREELANCER_NOT_FOUND", "Freelancer account not found.", false);
    }

    const diagnosticId = randomUUID();
    console.error("Bank details operation failed.", {
        diagnosticId,
        errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return failure(500, "BANK_DETAILS_INTERNAL_ERROR", "Bank details could not be saved due to an unexpected error. Contact support with the diagnostic ID.", false, { diagnosticId });
}

export async function GET(request: Request) {
    const currentUser = await getCurrentUser();
    if (!currentUser) return failure(401, "AUTHENTICATION_REQUIRED", "Authentication required.", false);
    if (currentUser.role !== "freelancer") return failure(403, "FREELANCER_REQUIRED", "Only freelancers can manage payout bank details.", false);

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
    let currentUser: Awaited<ReturnType<typeof getCurrentUser>>;
    try {
        currentUser = await getCurrentUser();
    } catch (error) {
        return providerError(error);
    }
    if (!currentUser) return failure(401, "AUTHENTICATION_REQUIRED", "Authentication required.", false);
    if (currentUser.role !== "freelancer") return failure(403, "FREELANCER_REQUIRED", "Only freelancers can manage payout bank details.", false);

    let body: { accountNumber?: unknown; bankCode?: unknown };
    try {
        body = await request.json() as typeof body;
    } catch {
        return failure(400, "INVALID_BANK_DETAILS", "Bank details are invalid.", false);
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
        return failure(400, "INVALID_BANK_DETAILS", "Bank details are invalid.", false);
    }
    const accountNumber = typeof body.accountNumber === "string" ? body.accountNumber.trim() : "";
    const bankCode = typeof body.bankCode === "string" ? body.bankCode.trim() : "";
    if (!/^\d{10}$/.test(accountNumber) || !bankCode || bankCode.length > 32) {
        return failure(400, "INVALID_BANK_DETAILS", "Choose a bank and enter a valid 10-digit account number.", false);
    }
    if (activeBankVerifications.has(currentUser.userId)) {
        return failure(409, "BANK_VERIFICATION_IN_PROGRESS", "Bank verification is already in progress. Please wait for it to finish.", true);
    }

    activeBankVerifications.add(currentUser.userId);
    try {
        const encryptedAccountNumber = encryptBankAccountNumber(accountNumber);
        await connectToDatabase();
        await migrateLegacyBankAccounts();
        const user = await User.findById(currentUser.userId)
            .select("+paystackRecipientCode +payoutAccountNumber email role");
        if (!user || user.role !== "freelancer") return failure(404, "FREELANCER_NOT_FOUND", "Freelancer account not found.", false);

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
                success: true,
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
        if (!bank) return failure(400, "INVALID_BANK_CODE", "Choose a bank from the current bank list.", false);

        const verifiedAccount = await resolvePaystackBankAccount(accountNumber, bank.code);

        const recipient = await savePaystackTransferRecipient({
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
            success: true,
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
