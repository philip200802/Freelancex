import mongoose, { Document, Schema } from "mongoose";

export interface IUserPreference extends Document {
    user: mongoose.Types.ObjectId;
    emailNotifications: boolean;
    inAppNotifications: boolean;
    profileVisibility: "public" | "private";
    createdAt: Date;
    updatedAt: Date;
}

const UserPreferenceSchema = new Schema<IUserPreference>({
    user: { type: Schema.Types.ObjectId, ref: "User", required: true, unique: true },
    emailNotifications: { type: Boolean, default: true },
    inAppNotifications: { type: Boolean, default: true },
    profileVisibility: { type: String, enum: ["public", "private"], default: "public" },
}, { timestamps: true });

export default mongoose.models.UserPreference || mongoose.model<IUserPreference>("UserPreference", UserPreferenceSchema);
