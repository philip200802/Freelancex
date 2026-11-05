import mongoose, { Document, Schema } from "mongoose";

export interface IAdminActivityLog extends Document {
    adminId?: mongoose.Types.ObjectId;
    adminNameSnapshot: string;
    action: string;
    targetUserId?: string;
    targetUserNameSnapshot?: string;
    description: string;
    metadata?: Record<string, unknown>;
    createdAt: Date;
}

const AdminActivityLogSchema = new Schema<IAdminActivityLog>({
    adminId: { type: Schema.Types.ObjectId, ref: "User" },
    adminNameSnapshot: { type: String, required: true, trim: true },
    action: { type: String, required: true, trim: true, index: true },
    targetUserId: { type: String, trim: true },
    targetUserNameSnapshot: { type: String, trim: true },
    description: { type: String, required: true, trim: true, maxlength: 2000 },
    metadata: { type: Schema.Types.Mixed },
}, { timestamps: { createdAt: true, updatedAt: false } });

AdminActivityLogSchema.index({ createdAt: -1 });
AdminActivityLogSchema.index({ adminId: 1, createdAt: -1 });

export default mongoose.models.AdminActivityLog || mongoose.model<IAdminActivityLog>("AdminActivityLog", AdminActivityLogSchema);
