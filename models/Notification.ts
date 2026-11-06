import mongoose, { Document, Schema } from "mongoose";

export type NotificationType =
    | "job_created" | "job_cancelled" | "job_deleted" | "application" | "application_accepted" | "application_rejected"
    | "message" | "payment_funded" | "project_funded" | "project_completed" | "payout_recorded" | "submission" | "deliverable_submitted"
    | "admin_submission" | "submission_approved" | "revision_requested" | "dispute_opened" | "dispute_updated"
    | "dispute_resolved" | "dispute_message" | "admin_dispute" | "account" | "account_removed" | "system";

export const notificationTypes: NotificationType[] = [
    "job_created", "job_cancelled", "job_deleted", "application", "application_accepted", "application_rejected",
    "message", "payment_funded", "project_funded", "project_completed", "payout_recorded", "submission", "deliverable_submitted",
    "admin_submission", "submission_approved", "revision_requested", "dispute_opened", "dispute_updated",
    "dispute_resolved", "dispute_message", "admin_dispute", "account", "account_removed", "system",
];

export interface INotification extends Document {
    recipient: mongoose.Types.ObjectId;
    recipientRole: "employer" | "freelancer" | "admin";
    actor?: mongoose.Types.ObjectId;
    actorNameSnapshot?: string;
    relatedTask?: mongoose.Types.ObjectId;
    relatedSubmission?: mongoose.Types.ObjectId;
    relatedApplication?: mongoose.Types.ObjectId;
    relatedPayment?: mongoose.Types.ObjectId;
    relatedDispute?: mongoose.Types.ObjectId;
    eventKey?: string;
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
    recipientRole: { type: String, enum: ["employer", "freelancer", "admin"], required: true },
    actor: { type: Schema.Types.ObjectId, ref: "User" },
    actorNameSnapshot: { type: String, trim: true },
    relatedTask: { type: Schema.Types.ObjectId, ref: "Task" },
    relatedSubmission: { type: Schema.Types.ObjectId, ref: "ProjectSubmission" },
    relatedApplication: { type: Schema.Types.ObjectId, ref: "Application" },
    relatedPayment: { type: Schema.Types.ObjectId, ref: "PaymentTransaction" },
    relatedDispute: { type: Schema.Types.ObjectId, ref: "Dispute" },
    eventKey: { type: String, trim: true, maxlength: 200 },
    type: { type: String, enum: notificationTypes, required: true },
    title: { type: String, required: true, trim: true, maxlength: 160 },
    body: { type: String, required: true, trim: true, maxlength: 1000 },
    href: { type: String, trim: true },
    readAt: { type: Date },
}, { timestamps: true });

NotificationSchema.index({ recipient: 1, createdAt: -1 });
NotificationSchema.index({ recipient: 1, readAt: 1 });
NotificationSchema.index({ recipient: 1, eventKey: 1 }, { unique: true, partialFilterExpression: { eventKey: { $type: "string" } } });
NotificationSchema.index(
    { recipient: 1, relatedSubmission: 1, type: 1 },
    { unique: true, partialFilterExpression: { relatedSubmission: { $type: "objectId" } } },
);

const cachedNotificationModel = mongoose.models.Notification;
if (cachedNotificationModel) {
    const cachedTypePath = cachedNotificationModel.schema.path("type");
    if (cachedTypePath instanceof mongoose.Schema.Types.String) {
        cachedTypePath.enum(false);
        cachedTypePath.validators = cachedTypePath.validators.filter((validator) => validator.type !== "enum");
        Object.assign(cachedTypePath, { enumValues: [] });
        cachedTypePath.options.enum = [...notificationTypes];
        cachedTypePath.enum({ values: [...notificationTypes] });
    }
}

export default cachedNotificationModel || mongoose.model<INotification>("Notification", NotificationSchema);
