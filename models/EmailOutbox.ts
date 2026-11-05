import mongoose, { Document, Schema } from "mongoose";

export interface IEmailOutbox extends Document {
    type: "account_removed";
    to?: string;
    recipientName?: string;
    reason?: string;
    status: "pending" | "processing" | "sent";
    attempts: number;
    lastError?: string;
    processingAt?: Date;
    nextAttemptAt?: Date;
    sentAt?: Date;
    createdAt: Date;
    updatedAt: Date;
}

const EmailOutboxSchema = new Schema<IEmailOutbox>({
    type: { type: String, enum: ["account_removed"], required: true },
    to: { type: String, trim: true },
    recipientName: { type: String, trim: true },
    reason: { type: String, trim: true, maxlength: 1000 },
    status: { type: String, enum: ["pending", "processing", "sent"], default: "pending", required: true },
    attempts: { type: Number, min: 0, default: 0 },
    lastError: { type: String, maxlength: 500 },
    processingAt: { type: Date },
    nextAttemptAt: { type: Date },
    sentAt: { type: Date },
}, { timestamps: true });

EmailOutboxSchema.index({ status: 1, nextAttemptAt: 1, createdAt: 1 });

export default mongoose.models.EmailOutbox || mongoose.model<IEmailOutbox>("EmailOutbox", EmailOutboxSchema);
