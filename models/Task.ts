import mongoose, { Document, Schema } from "mongoose";

export type TaskCategory = "Development" | "Design" | "Writing" | "Marketing";
export type TaskStatus = "pending_approval" | "open" | "funded" | "in_progress" | "submitted" | "completed" | "disputed";

export interface ITask extends Document {
    employer: mongoose.Types.ObjectId;
    freelancer?: mongoose.Types.ObjectId;
    title: string;
    description: string;
    amount: number;
    category: TaskCategory;
    applicationCount: number;
    status: TaskStatus;
    paystackReference?: string;
    createdAt: Date;
    updatedAt: Date;
}

const TaskSchema = new Schema<ITask>({
    employer: { type: Schema.Types.ObjectId, ref: "User", required: true },
    freelancer: { type: Schema.Types.ObjectId, ref: "User" },
    title: { type: String, required: true, trim: true },
    description: { type: String, required: true, trim: true },
    amount: { type: Number, required: true, min: 1 },
    category: { type: String, enum: ["Development", "Design", "Writing", "Marketing"], required: true },
    applicationCount: { type: Number, min: 0, default: 0 },
    status: { type: String, enum: ["pending_approval", "open", "funded", "in_progress", "submitted", "completed", "disputed"], default: "open" },
    paystackReference: { type: String },
}, { timestamps: true });

export default mongoose.models.Task || mongoose.model<ITask>("Task", TaskSchema);
