import { encryptBankAccountNumber } from "@/lib/bank-account-crypto";
import BankAccount from "@/models/BankAccount";
import User from "@/models/User";

let migration: Promise<void> | undefined;

export async function migrateLegacyBankAccounts() {
    if (migration) return migration;
    migration = (async () => {
        const users = await User.find({
            role: "freelancer",
            $or: [
                { payoutBankCode: { $exists: true, $ne: "" } },
                { payoutAccountNumber: { $exists: true } },
            ],
        })
            .select("+paystackRecipientCode +payoutBankCode +payoutBankName +payoutAccountName +payoutAccountNumber +payoutAccountNumberMasked +payoutAccountVerifiedAt")
            .lean();

        for (const user of users) {
            const fullAccountNumber = /^\d{10}$/.test(user.payoutAccountNumber || "") ? user.payoutAccountNumber : undefined;
            const bankCode = user.payoutBankCode?.trim();
            const bankName = user.payoutBankName?.trim();
            const accountName = user.payoutAccountName?.trim();
            const lastFour = user.payoutAccountNumberMasked?.match(/(\d{4})$/)?.[1] || fullAccountNumber?.slice(-4);
            if (bankCode && bankName && accountName && lastFour) {
                const verified = Boolean(fullAccountNumber && user.payoutAccountVerifiedAt && user.paystackRecipientCode);
                await BankAccount.updateOne(
                    { user: user._id },
                    {
                        $setOnInsert: {
                            user: user._id,
                            bankCode,
                            bankName,
                            accountName,
                            accountNumberLast4: lastFour,
                            ...(fullAccountNumber ? { encryptedAccountNumber: encryptBankAccountNumber(fullAccountNumber) } : {}),
                            verificationStatus: verified ? "verified" : "unverified",
                            ...(verified ? { verifiedAt: user.payoutAccountVerifiedAt } : {}),
                        },
                    },
                    { upsert: true, runValidators: true },
                );
            }

            if (user.payoutAccountNumber) {
                await User.updateOne(
                    { _id: user._id, payoutAccountNumber: user.payoutAccountNumber },
                    { $unset: { payoutAccountNumber: 1 } },
                );
            }
        }
    })().catch((error) => {
        migration = undefined;
        throw error;
    });
    return migration;
}
