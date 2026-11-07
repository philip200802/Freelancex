import mongoose, { Document, Schema } from "mongoose";

export interface IEmployerProfile extends Document {
    user: mongoose.Types.ObjectId;
    accountType: "Individual" | "Company";
    companyName?: string;
    industry?: string;
    companyDescription?: string;
    companyWebsite?: string;
    companySize?: string;
    position?: string;
    occupation?: string;
    hiringCategories: string[];
    hiringFrequency: "Occasionally" | "Monthly" | "Frequently" | "For ongoing projects";
    hiringPurpose?: string;
    profileImage?: string;
    profileImagePublicId?: string;
}

const EmployerProfileSchema = new Schema<IEmployerProfile>({
    user: { type: Schema.Types.ObjectId, ref: "User", required: true, unique: true },
    accountType: { type: String, enum: ["Individual", "Company"], required: true },
    companyName: { type: String, trim: true },
    industry: { type: String, trim: true },
    companyDescription: { type: String, trim: true, maxlength: 5000 },
    companyWebsite: { type: String, trim: true },
    companySize: { type: String, trim: true },
    position: { type: String, trim: true },
    occupation: { type: String, trim: true },
    hiringCategories: { type: [String], required: true },
    hiringFrequency: { type: String, enum: ["Occasionally", "Monthly", "Frequently", "For ongoing projects"], required: true },
    hiringPurpose: { type: String, trim: true },
    profileImage: { type: String, trim: true },
    profileImagePublicId: { type: String, trim: true },
}, { timestamps: true });

const cachedEmployerProfile = mongoose.models.EmployerProfile;
if (cachedEmployerProfile && !cachedEmployerProfile.schema.path("companyDescription")) {
    cachedEmployerProfile.schema.add({ companyDescription: { type: String, trim: true, maxlength: 5000 } });
}

export default cachedEmployerProfile || mongoose.model<IEmployerProfile>("EmployerProfile", EmployerProfileSchema);