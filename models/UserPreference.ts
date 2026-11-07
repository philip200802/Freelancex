import mongoose, { Document, Schema } from "mongoose";

export interface IUserPreference extends Document {
    user: mongoose.Types.ObjectId;
    emailNotifications: boolean;
    inAppNotifications: boolean;
    profileVisibility: "public" | "private";
    emailVisibility: boolean;
    companyInfoVisibility: boolean;
    createdAt: Date;
    updatedAt: Date;
}

const UserPreferenceSchema = new Schema<IUserPreference>({
    user: { type: Schema.Types.ObjectId, ref: "User", required: true, unique: true },
    emailNotifications: { type: Boolean, default: true },
    inAppNotifications: { type: Boolean, default: true },
    profileVisibility: { type: String, enum: ["public", "private"], default: "public" },
    emailVisibility: { type: Boolean, default: false },
    companyInfoVisibility: { type: Boolean, default: true },
}, { timestamps: true });

const cachedUserPreference = mongoose.models.UserPreference;
if (cachedUserPreference) {
    const missingPreferencePaths: Record<string, mongoose.SchemaDefinitionProperty<unknown>> = {};
    if (!cachedUserPreference.schema.path("emailVisibility")) missingPreferencePaths.emailVisibility = { type: Boolean, default: false };
    if (!cachedUserPreference.schema.path("companyInfoVisibility")) missingPreferencePaths.companyInfoVisibility = { type: Boolean, default: true };
    if (Object.keys(missingPreferencePaths).length) cachedUserPreference.schema.add(missingPreferencePaths);
}

export default cachedUserPreference || mongoose.model<IUserPreference>("UserPreference", UserPreferenceSchema);
