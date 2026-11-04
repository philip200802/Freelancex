import mongoose, { Document, Schema } from "mongoose";

export type UserRole = "employer" | "freelancer" | "admin";

export interface IUser extends Document {
    name: string;
    firstName: string;
    lastName: string;
    email: string;
    passwordHash: string;
    role: UserRole;
    bio: string;
    skills: string[];
    country: string;
    city: string;
    termsAcceptedAt: Date;
    termsVersion: string;
    privacyPolicyVersion: string;
    isVerified: boolean;
    verificationTokenHash?: string;
    verificationTokenExpiresAt?: Date;
    consumedVerificationTokenHash?: string;
    welcomeEmailSent: boolean;
    verificationResendAt?: Date;
    passwordResetTokenHash?: string;
    passwordResetTokenExpiresAt?: Date;
    paystackRecipientCode?: string;
    createdAt: Date;
    updatedAt: Date;
}

const UserSchema = new Schema<IUser>({
    name: { type: String, required: true, trim: true },
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ["employer", "freelancer", "admin"], default: "freelancer" },
    bio: { type: String, default: "" },
    skills: [{ type: String }],
    country: { type: String, required: true, trim: true },
    city: { type: String, required: true, trim: true },
    termsAcceptedAt: { type: Date, required: true },
    termsVersion: { type: String, required: true },
    privacyPolicyVersion: { type: String, required: true },
    isVerified: { type: Boolean, default: false },
    verificationTokenHash: { type: String, select: false },
    verificationTokenExpiresAt: { type: Date, select: false },
    consumedVerificationTokenHash: { type: String, select: false },
    welcomeEmailSent: { type: Boolean, default: false },
    verificationResendAt: { type: Date, select: false },
    passwordResetTokenHash: { type: String, select: false },
    passwordResetTokenExpiresAt: { type: Date, select: false },
    paystackRecipientCode: { type: String },
}, { timestamps: true });

export default mongoose.models.User || mongoose.model<IUser>("User", UserSchema);
