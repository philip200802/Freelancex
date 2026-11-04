import mongoose, { Document, Schema } from "mongoose";

export interface IFreelancerProfile extends Document {
    user: mongoose.Types.ObjectId;
    professionalTitle: string;
    category: string;
    skills: string[];
    experienceLevel: "Beginner" | "Intermediate" | "Expert";
    bio: string;
    workType: "Freelance" | "Contract" | "Part-time";
    availability: "Available" | "Busy" | "Not currently available";
    hourlyRate?: number;
    portfolioUrl?: string;
    githubUrl?: string;
    linkedinUrl?: string;
    profileImage?: string;
    profileImagePublicId?: string;
}

const FreelancerProfileSchema = new Schema<IFreelancerProfile>({
    user: { type: Schema.Types.ObjectId, ref: "User", required: true, unique: true },
    professionalTitle: { type: String, required: true, trim: true },
    category: { type: String, required: true, trim: true },
    skills: { type: [String], required: true },
    experienceLevel: { type: String, enum: ["Beginner", "Intermediate", "Expert"], required: true },
    bio: { type: String, required: true, trim: true },
    workType: { type: String, enum: ["Freelance", "Contract", "Part-time"], required: true },
    availability: { type: String, enum: ["Available", "Busy", "Not currently available"], required: true },
    hourlyRate: { type: Number, min: 0 },
    portfolioUrl: { type: String, trim: true },
    githubUrl: { type: String, trim: true },
    linkedinUrl: { type: String, trim: true },
    profileImage: { type: String, trim: true },
    profileImagePublicId: { type: String, trim: true },
}, { timestamps: true });

export default mongoose.models.FreelancerProfile || mongoose.model<IFreelancerProfile>("FreelancerProfile", FreelancerProfileSchema);