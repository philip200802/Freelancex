import mongoose, { Document, Schema } from "mongoose";
import type { ProjectDurationUnit } from "@/lib/project-deadline";

export type DeadlineExtensionStatus = "pending" | "approved" | "rejected";

export interface IDeadlineExtensionRequest extends Document {
    task: mongoose.Types.ObjectId;
    freelancer: mongoose.Types.ObjectId;
    employer: mongoose.Types.ObjectId;
    currentDeadline: Date;
    duration: number;
    durationUnit: ProjectDurationUnit;
    proposedDeadline: Date;
    reason: string;
    status: DeadlineExtensionStatus;
    decidedBy?: mongoose.Types.ObjectId;
    decidedAt?: Date;
    createdAt: Date;
    updatedAt: Date;
}

const DeadlineExtensionRequestSchema = new Schema<IDeadlineExtensionRequest>({
    task: { type: Schema.Types.ObjectId, ref: "Task", required: true, index: true },
    freelancer: { type: Schema.Types.ObjectId, ref: "User", required: true },
    employer: { type: Schema.Types.ObjectId, ref: "User", required: true },
    currentDeadline: { type: Date, required: true },
    duration: { type: Number, required: true, min: 1, max: 520, validate: Number.isSafeInteger },
    durationUnit: { type: String, enum: ["days", "weeks"], required: true },
    proposedDeadline: { type: Date, required: true },
    reason: { type: String, required: true, trim: true, minlength: 1, maxlength: 5000 },
    status: { type: String, enum: ["pending", "approved", "rejected"], required: true, default: "pending" },
    decidedBy: { type: Schema.Types.ObjectId, ref: "User" },
    decidedAt: { type: Date },
}, { timestamps: true });

DeadlineExtensionRequestSchema.index(
    { task: 1, status: 1 },
    { unique: true, partialFilterExpression: { status: "pending" } },
);
DeadlineExtensionRequestSchema.index({ task: 1, createdAt: -1 });

export default mongoose.models.DeadlineExtensionRequest
    || mongoose.model<IDeadlineExtensionRequest>("DeadlineExtensionRequest", DeadlineExtensionRequestSchema);
