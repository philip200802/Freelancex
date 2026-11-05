import mongoose, { Document, Schema } from "mongoose";

export type PaymentStatus = "initializing" | "pending" | "success" | "failed";

export interface IPaymentTransaction extends Document {
    task: mongoose.Types.ObjectId;
    employer: mongoose.Types.ObjectId;
    freelancer: mongoose.Types.ObjectId;
    employerNameSnapshot?: string;
    freelancerNameSnapshot?: string;
    provider: "paystack";
    reference: string;
    providerTransactionId?: number;
    amount: number;
    amountSubunit: number;
    currency: "NGN";
    status: PaymentStatus;
    authorizationUrl?: string;
    verifiedAt?: Date;
    createdAt: Date;
    updatedAt: Date;
}

const PaymentTransactionSchema = new Schema<IPaymentTransaction>({
    task: { type: Schema.Types.ObjectId, ref: "Task", required: true, index: true },
    employer: { type: Schema.Types.ObjectId, ref: "User", required: true },
    freelancer: { type: Schema.Types.ObjectId, ref: "User", required: true },
    employerNameSnapshot: { type: String, trim: true },
    freelancerNameSnapshot: { type: String, trim: true },
    provider: { type: String, enum: ["paystack"], required: true },
    reference: { type: String, required: true, unique: true, trim: true },
    providerTransactionId: { type: Number },
    amount: { type: Number, required: true, min: 0.01 },
    amountSubunit: { type: Number, required: true, min: 1 },
    currency: { type: String, enum: ["NGN"], required: true },
    status: { type: String, enum: ["initializing", "pending", "success", "failed"], required: true, index: true },
    authorizationUrl: { type: String, trim: true },
    verifiedAt: { type: Date },
}, { timestamps: true });

PaymentTransactionSchema.index({ status: 1, createdAt: -1 });
PaymentTransactionSchema.index({ employer: 1, createdAt: -1 });
PaymentTransactionSchema.index({ freelancer: 1, createdAt: -1 });

export default mongoose.models.PaymentTransaction || mongoose.model<IPaymentTransaction>("PaymentTransaction", PaymentTransactionSchema);
