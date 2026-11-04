import mongoose, { Document, Schema } from "mongoose";

export type NotificationType = "application" | "application_accepted" | "application_rejected" | "message" | "system";

export interface INotification extends Document {
    recipient: mongoose.Types.ObjectId;
    actor?: mongoose.Types.ObjectId;
    type: NotificationType;
    title: string;
    body: string;
    href?: string;
    readAt?: Date;
    createdAt: Date;
    updatedAt: Date;
}

const NotificationSchema = new Schema<INotification>({
    recipient: { type: Schema.Types.ObjectId, ref: "User", required: true },
    actor: { type: Schema.Types.ObjectId, ref: "User" },
    type: { type: String, enum: ["application", "application_accepted", "application_rejected", "message", "system"], required: true },
    title: { type: String, required: true, trim: true, maxlength: 160 },
    body: { type: String, required: true, trim: true, maxlength: 1000 },
    href: { type: String, trim: true },
    readAt: { type: Date },
}, { timestamps: true });

NotificationSchema.index({ recipient: 1, createdAt: -1 });
NotificationSchema.index({ recipient: 1, readAt: 1 });

export default mongoose.models.Notification || mongoose.model<INotification>("Notification", NotificationSchema);
