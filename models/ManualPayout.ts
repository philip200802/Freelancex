import mongoose, { Schema, type Document } from "mongoose";

export type ManualPayoutStatus = "pending" | "completed" | "failed" | "rejected";

export interface IManualPayout extends Document {
    task: mongoose.Types.ObjectId;
    paymentTransaction: mongoose.Types.ObjectId;
    freelancer: mongoose.Types.ObjectId;
    freelancerNameSnapshot: string;
    grossAmountKobo: number;
    commissionRatePercent: number;
    commissionAmountKobo: number;
    amountKobo: number;
    amount: number;
    currency: "NGN";
    approvedAt: Date;
    dueAt: Date;
    status: ManualPayoutStatus;
    bankAccountStatus?: "verified" | "missing" | "unverified";
    bankName?: string;
    bankCode?: string;
    accountName?: string;
    accountNumberLast4?: string;
    admin?: mongoose.Types.ObjectId;
    adminNameSnapshot?: string;
    transferReference?: string;
    transferredAt?: Date;
    receiptUrl?: string;
    failureReason?: string;
    failedAt?: Date;
    createdAt: Date;
    updatedAt: Date;
}

export type PendingManualPayoutInput = Pick<
    IManualPayout,
    | "task"
    | "paymentTransaction"
    | "freelancer"
    | "freelancerNameSnapshot"
    | "grossAmountKobo"
    | "commissionRatePercent"
    | "commissionAmountKobo"
    | "amountKobo"
    | "amount"
    | "currency"
    | "approvedAt"
    | "dueAt"
    | "bankAccountStatus"
> & Partial<Pick<IManualPayout, "bankName" | "bankCode" | "accountName" | "accountNumberLast4">>;

const completedPayoutRequired = function (this: IManualPayout) {
    return this.status === "completed";
};

const ManualPayoutSchema = new Schema<IManualPayout>({
    task: { type: Schema.Types.ObjectId, ref: "Task", required: true, unique: true },
    paymentTransaction: { type: Schema.Types.ObjectId, ref: "PaymentTransaction", required: true, unique: true },
    freelancer: { type: Schema.Types.ObjectId, ref: "User", required: true },
    freelancerNameSnapshot: { type: String, required: true, trim: true },
    grossAmountKobo: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
    commissionRatePercent: { type: Number, required: true, min: 0, max: 100, validate: Number.isInteger },
    commissionAmountKobo: { type: Number, required: true, min: 0, validate: Number.isSafeInteger },
    amountKobo: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
    amount: { type: Number, required: true, min: 0.01 },
    currency: { type: String, enum: ["NGN"], required: true },
    approvedAt: { type: Date, required: true },
    dueAt: { type: Date, required: true },
    status: { type: String, enum: ["pending", "completed", "failed", "rejected"], required: true, default: "pending" },
    bankAccountStatus: { type: String, enum: ["verified", "missing", "unverified"] },
    bankName: { type: String, required: completedPayoutRequired, trim: true },
    bankCode: { type: String, required: completedPayoutRequired, trim: true },
    accountName: { type: String, required: completedPayoutRequired, trim: true },
    accountNumberLast4: { type: String, required: completedPayoutRequired, match: /^\d{4}$/ },
    admin: { type: Schema.Types.ObjectId, ref: "User", required: completedPayoutRequired },
    adminNameSnapshot: { type: String, required: completedPayoutRequired, trim: true },
    transferReference: { type: String, required: completedPayoutRequired, trim: true, maxlength: 160 },
    transferredAt: { type: Date, required: completedPayoutRequired },
    receiptUrl: { type: String, trim: true, maxlength: 2048 },
    failureReason: { type: String, trim: true, maxlength: 1000 },
    failedAt: { type: Date },
}, { timestamps: true });

const immutablePayoutError = () => new Error("Manual payout history is immutable.");

ManualPayoutSchema.pre("save", function () {
    if (!this.isNew) throw immutablePayoutError();
});

ManualPayoutSchema.pre("updateOne", function () {
    const filter = this.getFilter();
    const update = this.getUpdate();
    const options = this.getOptions();
    if (!update || Array.isArray(update) || options.upsert) throw immutablePayoutError();

    const set = update.$set && typeof update.$set === "object" ? update.$set as Record<string, unknown> : {};
    const unset = update.$unset && typeof update.$unset === "object" ? update.$unset as Record<string, unknown> : {};
    const otherOperators = Object.keys(update).filter((operator) => operator !== "$set" && operator !== "$unset");
    const allowedKeys = (values: Record<string, unknown>, allowed: string[]) =>
        Object.keys(values).every((key) => allowed.includes(key));
    if (otherOperators.length || !allowedKeys(unset, ["failureReason", "failedAt", "updatedAt"])) {
        throw immutablePayoutError();
    }

    if (filter.status === "pending" && set.status === "failed") {
        if (!allowedKeys(set, ["status", "failedAt", "failureReason", "admin", "adminNameSnapshot", "updatedAt"])) {
            throw immutablePayoutError();
        }
        return;
    }

    const allowedPriorStatuses = filter.status && typeof filter.status === "object" && "$in" in filter.status
        ? filter.status.$in
        : undefined;
    if (
        Array.isArray(allowedPriorStatuses)
        && allowedPriorStatuses.length === 2
        && allowedPriorStatuses.includes("pending")
        && allowedPriorStatuses.includes("failed")
        && typeof filter.amountKobo === "number"
        && set.status === "completed"
        && allowedKeys(set, [
            "status", "bankAccountStatus", "bankName", "bankCode", "accountName", "accountNumberLast4",
            "admin", "adminNameSnapshot", "transferReference", "transferredAt", "receiptUrl", "updatedAt",
        ])
    ) {
        return;
    }

    throw immutablePayoutError();
});

ManualPayoutSchema.pre("updateMany", immutablePayoutError);
ManualPayoutSchema.pre("findOneAndUpdate", immutablePayoutError);
ManualPayoutSchema.pre("replaceOne", immutablePayoutError);
ManualPayoutSchema.pre("findOneAndReplace", immutablePayoutError);
ManualPayoutSchema.pre("deleteOne", { document: false, query: true }, immutablePayoutError);
ManualPayoutSchema.pre("deleteOne", { document: true, query: false }, immutablePayoutError);
ManualPayoutSchema.pre("deleteMany", immutablePayoutError);
ManualPayoutSchema.pre("findOneAndDelete", immutablePayoutError);

ManualPayoutSchema.pre("validate", function () {
    if (this.status === "completed" && (
        this.bankAccountStatus !== "verified" ||
        !this.admin ||
        !this.adminNameSnapshot ||
        !this.bankName ||
        !this.bankCode ||
        !this.accountName ||
        !this.accountNumberLast4 ||
        !this.transferReference ||
        !this.transferredAt
    )) {
        this.invalidate("status", "Completed payouts require admin, verified bank, and transfer details.");
    }
    if ((this.status === "failed" || this.status === "rejected") && (!this.failureReason || !this.failedAt)) {
        this.invalidate("failureReason", "Failed or rejected payouts require a reason and date.");
    }
});

ManualPayoutSchema.index({ freelancer: 1, createdAt: -1 });
ManualPayoutSchema.index({ admin: 1, createdAt: -1 });
ManualPayoutSchema.index({ status: 1, dueAt: 1 });

const ManualPayout = mongoose.models.ManualPayout || mongoose.model<IManualPayout>("ManualPayout", ManualPayoutSchema);

export function createPendingManualPayout(input: PendingManualPayoutInput) {
    return new ManualPayout({ ...input, status: "pending" });
}

export default ManualPayout;
