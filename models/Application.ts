import mongoose, { Document, Schema } from "mongoose";

export type ApplicationStatus = "pending" | "accepted" | "rejected";

export interface IApplication extends Document {
    task: mongoose.Types.ObjectId;
    employer?: mongoose.Types.ObjectId;
    freelancer?: mongoose.Types.ObjectId;
    employerNameSnapshot?: string;
    freelancerNameSnapshot?: string;
    message: string;
    status: ApplicationStatus;
    createdAt: Date;
    updatedAt: Date;
}

const ApplicationSchema = new Schema<IApplication>({
    task: { type: Schema.Types.ObjectId, ref: "Task", required: true },
    employer: { type: Schema.Types.ObjectId, ref: "User" },
    freelancer: { type: Schema.Types.ObjectId, ref: "User" },
    employerNameSnapshot: { type: String, trim: true },
    freelancerNameSnapshot: { type: String, trim: true },
    message: { type: String, trim: true, maxlength: 5000, default: "" },
    status: { type: String, enum: ["pending", "accepted", "rejected"], default: "pending", required: true },
}, { timestamps: true });

ApplicationSchema.index({ task: 1, freelancer: 1 }, { unique: true });
ApplicationSchema.index({ employer: 1, status: 1, createdAt: -1 });
ApplicationSchema.index({ freelancer: 1, status: 1, createdAt: -1 });

export default mongoose.models.Application || mongoose.model<IApplication>("Application", ApplicationSchema);
