import mongoose, { Document, Schema } from "mongoose";

export interface IEmailOutbox extends Document {
    type: "account_removed" | "workflow_email";
    to?: string;
    recipientName?: string;
    reason?: string;
    eventKey?: string;
    workflowEvent?: string;
    relatedTask?: mongoose.Types.ObjectId;
    subject?: string;
    heading?: string;
    message?: string;
    details?: Array<{ label: string; value: string }>;
    actionUrl?: string;
    actionLabel?: string;
    status: "pending" | "processing" | "sent";
    attempts: number;
    lastError?: string;
    providerMessageId?: string;
    processingAt?: Date;
    nextAttemptAt?: Date;
    sentAt?: Date;
    createdAt: Date;
    updatedAt: Date;
}

const EmailOutboxSchema = new Schema<IEmailOutbox>({
    type: { type: String, enum: ["account_removed", "workflow_email"], required: true },
    to: { type: String, trim: true },
    recipientName: { type: String, trim: true },
    reason: { type: String, trim: true, maxlength: 1000 },
    eventKey: { type: String, trim: true, maxlength: 200 },
    workflowEvent: { type: String, trim: true, maxlength: 100 },
    relatedTask: { type: Schema.Types.ObjectId, ref: "Task", index: true },
    subject: { type: String, trim: true, maxlength: 200 },
    heading: { type: String, trim: true, maxlength: 200 },
    message: { type: String, trim: true, maxlength: 2000 },
    details: [{ _id: false, label: { type: String, trim: true }, value: { type: String, trim: true } }],
    actionUrl: { type: String, trim: true, maxlength: 2048 },
    actionLabel: { type: String, trim: true, maxlength: 100 },
    status: { type: String, enum: ["pending", "processing", "sent"], default: "pending", required: true },
    attempts: { type: Number, min: 0, default: 0 },
    lastError: { type: String, maxlength: 500 },
    providerMessageId: { type: String, trim: true, maxlength: 200 },
    processingAt: { type: Date },
    nextAttemptAt: { type: Date },
    sentAt: { type: Date },
}, { timestamps: true });

EmailOutboxSchema.index({ status: 1, nextAttemptAt: 1, createdAt: 1 });
EmailOutboxSchema.index({ eventKey: 1 }, { unique: true, partialFilterExpression: { eventKey: { $type: "string" } } });

const cachedEmailOutboxModel = mongoose.models.EmailOutbox;
if (cachedEmailOutboxModel) {
    const typePath = cachedEmailOutboxModel.schema.path("type");
    if (typePath instanceof mongoose.Schema.Types.String) {
        typePath.enum(false);
        typePath.validators = typePath.validators.filter((validator) => validator.type !== "enum");
        Object.assign(typePath, { enumValues: [] });
        typePath.options.enum = ["account_removed", "workflow_email"];
        typePath.enum({ values: ["account_removed", "workflow_email"] });
    }
    if (!cachedEmailOutboxModel.schema.path("relatedTask")) {
        cachedEmailOutboxModel.schema.add({
            relatedTask: { type: Schema.Types.ObjectId, ref: "Task", index: true },
            providerMessageId: { type: String, trim: true, maxlength: 200 },
        });
    }
}

export default cachedEmailOutboxModel || mongoose.model<IEmailOutbox>("EmailOutbox", EmailOutboxSchema);
