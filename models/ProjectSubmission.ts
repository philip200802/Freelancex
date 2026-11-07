import mongoose, { Document, Schema } from "mongoose";

export type ProjectSubmissionStatus = "submitted" | "revision_requested" | "approved";

export interface IProjectSubmission extends Document {
    task: mongoose.Types.ObjectId;
    freelancer: mongoose.Types.ObjectId;
    employer: mongoose.Types.ObjectId;
    submissionNumber: number;
    message: string;
    attachments: Array<{
        fileName: string;
        url: string;
        fileType: string;
        fileSize: number;
        publicId: string;
        resourceType: "image" | "raw";
    }>;
    links: string[];
    status: ProjectSubmissionStatus;
    commissionAcknowledged?: boolean;
    commissionAcknowledgedAt?: Date;
    grossAmountKobo?: number;
    commissionRatePercent?: number;
    commissionAmountKobo?: number;
    freelancerNetAmountKobo?: number;
    feedback?: string;
    reviewedBy?: mongoose.Types.ObjectId;
    reviewedAt?: Date;
    submittedAt: Date;
    createdAt: Date;
    updatedAt: Date;
}

const ProjectSubmissionSchema = new Schema<IProjectSubmission>({
    task: { type: Schema.Types.ObjectId, ref: "Task", required: true },
    freelancer: { type: Schema.Types.ObjectId, ref: "User", required: true },
    employer: { type: Schema.Types.ObjectId, ref: "User", required: true },
    submissionNumber: { type: Number, required: true, min: 1 },
    message: { type: String, required: true, trim: true, minlength: 1, maxlength: 5000 },
    attachments: {
        type: [{
            fileName: { type: String, required: true, trim: true, maxlength: 180 },
            url: { type: String, required: true },
            fileType: { type: String, required: true },
            fileSize: { type: Number, required: true, min: 1 },
            publicId: { type: String, required: true },
            resourceType: { type: String, enum: ["image", "raw"], required: true },
        }],
        default: [],
        validate: { validator: (attachments: unknown[]) => attachments.length <= 5, message: "A submission can include at most five attachments." },
    },
    links: {
        type: [{ type: String, trim: true, maxlength: 2048 }],
        default: [],
        validate: { validator: (links: unknown[]) => links.length <= 10, message: "A submission can include at most ten links." },
    },
    status: { type: String, enum: ["submitted", "revision_requested", "approved"], required: true, default: "submitted" },
    commissionAcknowledged: { type: Boolean, default: false },
    commissionAcknowledgedAt: { type: Date },
    grossAmountKobo: { type: Number, min: 1 },
    commissionRatePercent: { type: Number, min: 0, max: 100 },
    commissionAmountKobo: { type: Number, min: 0 },
    freelancerNetAmountKobo: { type: Number, min: 0 },
    feedback: { type: String, trim: true, maxlength: 5000 },
    reviewedBy: { type: Schema.Types.ObjectId, ref: "User" },
    reviewedAt: { type: Date },
    submittedAt: { type: Date, required: true, default: Date.now },
}, { timestamps: true });

ProjectSubmissionSchema.index({ task:  1, submissionNumber: 1 }, { unique: true });
ProjectSubmissionSchema.index({ task: 1, submittedAt: 1 });
ProjectSubmissionSchema.index(
    { task: 1, status: 1 },
    { unique: true, partialFilterExpression: { status: "submitted" } },
);

const cachedProjectSubmissionModel = mongoose.models.ProjectSubmission;
if (cachedProjectSubmissionModel) {
    const missingSubmissionPaths: Record<string, mongoose.SchemaDefinitionProperty<unknown>> = {};
    if (!cachedProjectSubmissionModel.schema.path("commissionAcknowledged")) missingSubmissionPaths.commissionAcknowledged = { type: Boolean, default: false };
    if (!cachedProjectSubmissionModel.schema.path("commissionAcknowledgedAt")) missingSubmissionPaths.commissionAcknowledgedAt = { type: Date };
    if (!cachedProjectSubmissionModel.schema.path("grossAmountKobo")) missingSubmissionPaths.grossAmountKobo = { type: Number, min: 1 };
    if (!cachedProjectSubmissionModel.schema.path("commissionRatePercent")) missingSubmissionPaths.commissionRatePercent = { type: Number, min: 0, max: 100 };
    if (!cachedProjectSubmissionModel.schema.path("commissionAmountKobo")) missingSubmissionPaths.commissionAmountKobo = { type: Number, min: 0 };
    if (!cachedProjectSubmissionModel.schema.path("freelancerNetAmountKobo")) missingSubmissionPaths.freelancerNetAmountKobo = { type: Number, min: 0 };
    if (Object.keys(missingSubmissionPaths).length) cachedProjectSubmissionModel.schema.add(missingSubmissionPaths);
}

export default cachedProjectSubmissionModel || mongoose.model<IProjectSubmission>("ProjectSubmission", ProjectSubmissionSchema);
