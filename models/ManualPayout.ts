import mongoose, { Document, Schema } from "mongoose";

export interface IManualPayout extends Document {
    task: mongoose.Types.ObjectId;
    paymentTransaction: mongoose.Types.ObjectId;
    freelancer: mongoose.Types.ObjectId;
    freelancerNameSnapshot: string;
    bankName: string;
    bankCode: string;
    accountName: string;
    accountNumberLast4: string;
    amount: number;
    currency: "NGN";
    admin: mongoose.Types.ObjectId;
    adminNameSnapshot: string;
    transferReference: string;
    transferredAt: Date;
    receiptUrl?: string;
    status: "completed";
    createdAt: Date;
    updatedAt: Date;
}

const ManualPayoutSchema = new Schema<IManualPayout>({
    task: { type: Schema.Types.ObjectId, ref: "Task", required: true, unique: true },
    paymentTransaction: { type: Schema.Types.ObjectId, ref: "PaymentTransaction", required: true, unique: true },
    freelancer: { type: Schema.Types.ObjectId, ref: "User", required: true },
    freelancerNameSnapshot: { type: String, required: true, trim: true },
    bankName: { type: String, required: true, trim: true },
    bankCode: { type: String, required: true, trim: true },
    accountName: { type: String, required: true, trim: true },
    accountNumberLast4: { type: String, required: true, match: /^\d{4}$/ },
    amount: { type: Number, required: true, min: 0.01 },
    currency: { type: String, enum: ["NGN"], required: true },
    admin: { type: Schema.Types.ObjectId, ref: "User", required: true },
    adminNameSnapshot: { type: String, required: true, trim: true },
    transferReference: { type: String, required: true, trim: true, maxlength: 160 },
    transferredAt: { type: Date, required: true },
    receiptUrl: { type: String, trim: true, maxlength: 2048 },
    status: { type: String, enum: ["completed"], required: true, default: "completed" },
}, { timestamps: true });

ManualPayoutSchema.pre("save", function () {
    if (!this.isNew) throw new Error("Manual payout history is immutable.");
});
ManualPayoutSchema.pre("updateOne", function () {
    throw new Error("Manual payout history is immutable.");
});
ManualPayoutSchema.pre("updateMany", function () {
    throw new Error("Manual payout history is immutable.");
});
ManualPayoutSchema.pre("findOneAndUpdate", function () {
    throw new Error("Manual payout history is immutable.");
});
ManualPayoutSchema.pre("deleteOne", function () {
    throw new Error("Manual payout history is immutable.");
});
ManualPayoutSchema.pre("deleteMany", function () {
    throw new Error("Manual payout history is immutable.");
});
ManualPayoutSchema.pre("findOneAndDelete", function () {
    throw new Error("Manual payout history is immutable.");
});

ManualPayoutSchema.index({ freelancer: 1, createdAt: -1 });
ManualPayoutSchema.index({ admin: 1, createdAt: -1 });

export default mongoose.models.ManualPayout || mongoose.model<IManualPayout>("ManualPayout", ManualPayoutSchema);
