import mongoose, { Document, Schema } from "mongoose";

export interface IProfileImageDeletion extends Document {
    publicIds: string[];
    status: "pending" | "processing" | "completed";
    attempts: number;
    lastError?: string;
    processingAt?: Date;
    nextAttemptAt?: Date;
    completedAt?: Date;
    createdAt: Date;
    updatedAt: Date;
}

const ProfileImageDeletionSchema = new Schema<IProfileImageDeletion>({
    publicIds: { type: [String], required: true },
    status: { type: String, enum: ["pending", "processing", "completed"], default: "pending", required: true },
    attempts: { type: Number, min: 0, default: 0 },
    lastError: { type: String, maxlength: 500 },
    processingAt: { type: Date },
    nextAttemptAt: { type: Date, default: Date.now },
    completedAt: { type: Date },
}, { timestamps: true });

ProfileImageDeletionSchema.index({ status: 1, nextAttemptAt: 1, createdAt: 1 });

export default mongoose.models.ProfileImageDeletion || mongoose.model<IProfileImageDeletion>("ProfileImageDeletion", ProfileImageDeletionSchema);
