import mongoose, { Document, Schema } from "mongoose";

export interface IBankAccount extends Document {
    user: mongoose.Types.ObjectId;
    bankName: string;
    bankCode: string;
    encryptedAccountNumber?: string;
    accountNumberLast4: string;
    accountName: string;
    verificationStatus: "verified" | "unverified";
    verifiedAt?: Date;
    createdAt: Date;
    updatedAt: Date;
}

const BankAccountSchema = new Schema<IBankAccount>({
    user: { type: Schema.Types.ObjectId, ref: "User", required: true, unique: true },
    bankName: { type: String, required: true, trim: true, maxlength: 160 },
    bankCode: { type: String, required: true, trim: true, maxlength: 32 },
    encryptedAccountNumber: {
        type: String,
        required: function (this: IBankAccount): boolean {
            return this.verificationStatus === "verified";
        },
        select: false,
    },
    accountNumberLast4: { type: String, required: true, match: /^\d{4}$/ },
    accountName: { type: String, required: true, trim: true, maxlength: 160 },
    verificationStatus: { type: String, enum: ["verified", "unverified"], required: true, index: true },
    verifiedAt: { type: Date },
}, { timestamps: true });

BankAccountSchema.index({ verificationStatus: 1, updatedAt: -1 });

export default mongoose.models.BankAccount || mongoose.model<IBankAccount>("BankAccount", BankAccountSchema);
