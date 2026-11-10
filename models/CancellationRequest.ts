import mongoose, { Document, Schema } from "mongoose";

export const cancellationReasons = [
    "changed_requirements",
    "freelancer_unable_to_continue",
    "communication_problems",
    "project_no_longer_needed",
    "unrealistic_requirements",
    "mutual_agreement",
    "other",
] as const;
export type CancellationReason = typeof cancellationReasons[number];
export type CancellationRequestStatus = "pending" | "accepted" | "rejected" | "disputed";

export interface ICancellationRequest extends Document {
    task: mongoose.Types.ObjectId;
    requestedBy: mongoose.Types.ObjectId;
    requestedTo: mongoose.Types.ObjectId;
    requesterRole: "employer" | "freelancer";
    reason: CancellationReason;
    description: string;
    evidenceLinks: string[];
    status: CancellationRequestStatus;
    resolvedBy?: mongoose.Types.ObjectId;
    resolvedAt?: Date;
    disputedBy?: mongoose.Types.ObjectId;
    disputedAt?: Date;
    dispute?: mongoose.Types.ObjectId;
    createdAt: Date;
    updatedAt: Date;
}

const CancellationRequestSchema = new Schema<ICancellationRequest>({
    task: { type: Schema.Types.ObjectId, ref: "Task", required: true, index: true },
    requestedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    requestedTo: { type: Schema.Types.ObjectId, ref: "User", required: true },
    requesterRole: { type: String, enum: ["employer", "freelancer"], required: true },
    reason: { type: String, enum: cancellationReasons, required: true },
    description: { type: String, required: true, trim: true, minlength: 1, maxlength: 5000 },
    evidenceLinks: {
        type: [{ type: String, trim: true, maxlength: 2048 }],
        default: [],
        validate: { validator: (links: unknown[]) => links.length <= 10, message: "A cancellation request can include up to ten evidence links." },
    },
    status: { type: String, enum: ["pending", "accepted", "rejected", "disputed"], required: true, default: "pending" },
    resolvedBy: { type: Schema.Types.ObjectId, ref: "User" },
    resolvedAt: { type: Date },
    disputedBy: { type: Schema.Types.ObjectId, ref: "User" },
    disputedAt: { type: Date },
    dispute: { type: Schema.Types.ObjectId, ref: "Dispute" },
}, { timestamps: true });

CancellationRequestSchema.index(
    { task: 1, status: 1 },
    { unique: true, partialFilterExpression: { status: "pending" } },
);

export default mongoose.models.CancellationRequest
    || mongoose.model<ICancellationRequest>("CancellationRequest", CancellationRequestSchema);
