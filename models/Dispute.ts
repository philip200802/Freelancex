import mongoose, { Document, Schema } from "mongoose";
import type { UserRole } from "@/models/User";

export const disputeStatuses = [
    "open",
    "under_review",
    "awaiting_client_response",
    "awaiting_freelancer_response",
    "resolved",
    "closed",
] as const;
export type DisputeStatus = typeof disputeStatuses[number];

export const disputeReasons = [
    "work_quality",
    "missed_deadline",
    "scope_mismatch",
    "communication",
    "payment",
    "other",
] as const;
export type DisputeReason = typeof disputeReasons[number];

export interface IDispute extends Document {
    task: mongoose.Types.ObjectId;
    employer: mongoose.Types.ObjectId;
    freelancer: mongoose.Types.ObjectId;
    reason: DisputeReason;
    description: string;
    evidenceLinks: string[];
    status: DisputeStatus;
    projectStatusBeforeDispute: string;
    history: Array<{
        entryId: string;
        author: mongoose.Types.ObjectId;
        authorRole: UserRole;
        message: string;
        authorName?: string;
        attachments: string[];
        readBy: mongoose.Types.ObjectId[];
        createdAt: Date;
    }>;
    resolution?: string;
    resolvedBy?: mongoose.Types.ObjectId;
    resolvedAt?: Date;
    createdAt: Date;
    updatedAt: Date;
}

const DisputeSchema = new Schema<IDispute>({
    task: { type: Schema.Types.ObjectId, ref: "Task", required: true, index: true },
    employer: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    freelancer: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    reason: { type: String, enum: disputeReasons, required: true },
    description: { type: String, required: true, trim: true, minlength: 1, maxlength: 5000 },
    evidenceLinks: {
        type: [{ type: String, trim: true, maxlength: 2048 }],
        default: [],
        validate: { validator: (links: unknown[]) => links.length <= 10, message: "A dispute can include up to ten evidence links." },
    },
    status: { type: String, enum: disputeStatuses, required: true, default: "open", index: true },
    projectStatusBeforeDispute: { type: String, required: true },
    history: {
        type: [{
            entryId: { type: String, required: true },
            author: { type: Schema.Types.ObjectId, ref: "User", required: true },
            authorRole: { type: String, enum: ["employer", "freelancer", "admin"], required: true },
            message: { type: String, required: true, trim: true, maxlength: 5000 },
            authorName: { type: String, trim: true, maxlength: 120 },
            attachments: {
                type: [{ type: String, trim: true, maxlength: 2048 }],
                default: [],
                validate: { validator: (links: unknown[]) => links.length <= 10, message: "A dispute message can include up to ten links." },
            },
            readBy: [{ type: Schema.Types.ObjectId, ref: "User" }],
            createdAt: { type: Date, required: true, default: Date.now },
        }],
        default: [],
    },
    resolution: { type: String, trim: true, maxlength: 5000 },
    resolvedBy: { type: Schema.Types.ObjectId, ref: "User" },
    resolvedAt: { type: Date },
}, { timestamps: true });

DisputeSchema.index({ task: 1, createdAt: -1 });
DisputeSchema.index({ status: 1, updatedAt: -1 });

const cachedDisputeModel = mongoose.models.Dispute;
if (cachedDisputeModel) {
    const historyPath = cachedDisputeModel.schema.path("history");
    if (historyPath instanceof mongoose.Schema.Types.DocumentArray) {
        const historySchema = historyPath.schema;
        historySchema.add({
            authorName: { type: String, trim: true, maxlength: 120 },
            attachments: {
                type: [{ type: String, trim: true, maxlength: 2048 }],
                default: [],
                validate: { validator: (links: unknown[]) => links.length <= 10, message: "A dispute message can include up to ten links." },
            },
            readBy: [{ type: Schema.Types.ObjectId, ref: "User" }],
        });
    }
}

export default cachedDisputeModel || mongoose.model<IDispute>("Dispute", DisputeSchema);
