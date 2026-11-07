import mongoose, { Document, Schema } from "mongoose";

export type TaskCategory = "Development" | "Design" | "Writing" | "Marketing";
export type TaskStatus = "pending_approval" | "open" | "awaiting_funding" | "funded" | "in_progress" | "submitted" | "revision_requested" | "completed" | "disputed" | "cancelled";

export interface ITask extends Document {
    employer?: mongoose.Types.ObjectId;
    freelancer?: mongoose.Types.ObjectId;
    employerNameSnapshot?: string;
    freelancerNameSnapshot?: string;
    title: string;
    description: string;
    amount: number;
    commissionRatePercent?: number;
    grossAmountKobo?: number;
    commissionAmountKobo?: number;
    freelancerNetAmountKobo?: number;
    payoutStatus?: "pending" | "completed" | "failed";
    category: TaskCategory;
    applicationCount: number;
    createRequestId?: string;
    status: TaskStatus;
    paystackReference?: string;
    isDeleted: boolean;
    deletedAt?: Date;
    createdAt: Date;
    updatedAt: Date;
}

const TaskSchema = new Schema<ITask>({
    employer: { type: Schema.Types.ObjectId, ref: "User" },
    freelancer: { type: Schema.Types.ObjectId, ref: "User" },
    employerNameSnapshot: { type: String, trim: true },
    freelancerNameSnapshot: { type: String, trim: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, required: true, trim: true },
    amount: { type: Number, required: true, min: 1 },
    commissionRatePercent: { type: Number, min: 0, max: 100 },
    grossAmountKobo: { type: Number, min: 1 },
    commissionAmountKobo: { type: Number, min: 0 },
    freelancerNetAmountKobo: { type: Number, min: 0 },
    payoutStatus: { type: String, enum: ["pending", "completed", "failed"] },
    category: { type: String, enum: ["Development", "Design", "Writing", "Marketing"], required: true },
    applicationCount: { type: Number, min: 0, default: 0 },
    createRequestId: { type: String, trim: true, select: false },
    status: { type: String, enum: ["pending_approval", "open", "awaiting_funding", "funded", "in_progress", "submitted", "revision_requested", "completed", "disputed", "cancelled"], default: "open" },
    paystackReference: { type: String },
    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt: { type: Date },
}, { timestamps: true });

TaskSchema.index({ employer: 1, createRequestId: 1 }, { unique: true, partialFilterExpression: { createRequestId: { $type: "string" } } });

const cachedTaskModel = mongoose.models.Task;
if (cachedTaskModel) {
    const missingTaskPaths: Record<string, mongoose.SchemaDefinitionProperty<unknown>> = {};
    if (!cachedTaskModel.schema.path("isDeleted")) {
        missingTaskPaths.isDeleted = { type: Boolean, default: false, index: true };
        missingTaskPaths.deletedAt = { type: Date };
    }
    if (!cachedTaskModel.schema.path("commissionRatePercent")) missingTaskPaths.commissionRatePercent = { type: Number, min: 0, max: 100 };
    if (!cachedTaskModel.schema.path("grossAmountKobo")) missingTaskPaths.grossAmountKobo = { type: Number, min: 1 };
    if (!cachedTaskModel.schema.path("commissionAmountKobo")) missingTaskPaths.commissionAmountKobo = { type: Number, min: 0 };
    if (!cachedTaskModel.schema.path("freelancerNetAmountKobo")) missingTaskPaths.freelancerNetAmountKobo = { type: Number, min: 0 };
    if (!cachedTaskModel.schema.path("payoutStatus")) missingTaskPaths.payoutStatus = { type: String, enum: ["pending", "completed", "failed"] };
    if (Object.keys(missingTaskPaths).length) cachedTaskModel.schema.add(missingTaskPaths);
}

export default cachedTaskModel || mongoose.model<ITask>("Task", TaskSchema);
