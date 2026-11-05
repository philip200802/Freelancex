import mongoose, { Document, Schema } from "mongoose";

export interface IReview extends Document {
    project: mongoose.Types.ObjectId;
    client?: mongoose.Types.ObjectId;
    freelancer?: mongoose.Types.ObjectId;
    clientNameSnapshot?: string;
    freelancerNameSnapshot?: string;
    rating: number;
    comment: string;
    createdAt: Date;
    updatedAt: Date;
}

const ReviewSchema = new Schema<IReview>({
    project: { type: Schema.Types.ObjectId, ref: "Task", required: true },
    client: { type: Schema.Types.ObjectId, ref: "User" },
    freelancer: { type: Schema.Types.ObjectId, ref: "User" },
    clientNameSnapshot: { type: String, trim: true },
    freelancerNameSnapshot: { type: String, trim: true },
    rating: { type: Number, required: true, min: 1, max: 5 },
    comment: { type: String, required: true, trim: true, maxlength: 2000 },
}, { timestamps: true });

ReviewSchema.index({ project: 1, client: 1 }, { unique: true });
ReviewSchema.index({ freelancer: 1, createdAt: -1 });

export default mongoose.models.Review || mongoose.model<IReview>("Review", ReviewSchema);
