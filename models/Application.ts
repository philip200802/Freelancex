import mongoose, { Document, Schema } from "mongoose";

export type ApplicationStatus = "pending" | "accepted" | "rejected";

export interface IApplication extends Document {
    task: mongoose.Types.ObjectId;
    employer: mongoose.Types.ObjectId;
    freelancer: mongoose.Types.ObjectId;
    message: string;
    status: ApplicationStatus;
    createdAt: Date;
    updatedAt: Date;
}

const ApplicationSchema = new Schema<IApplication>({
    task: { type: Schema.Types.ObjectId, ref: "Task", required: true },
    employer: { type: Schema.Types.ObjectId, ref: "User", required: true },
    freelancer: { type: Schema.Types.ObjectId, ref: "User", required: true },
    message: { type: String, trim: true, maxlength: 5000, default: "" },
    status: { type: String, enum: ["pending", "accepted", "rejected"], default: "pending", required: true },
}, { timestamps: true });

ApplicationSchema.index({ task: 1, freelancer: 1 }, { unique: true });
ApplicationSchema.index({ employer: 1, status: 1, createdAt: -1 });
ApplicationSchema.index({ freelancer: 1, status: 1, createdAt: -1 });

export default mongoose.models.Application || mongoose.model<IApplication>("Application", ApplicationSchema);
