import mongoose, { Document, Schema } from "mongoose";

export interface IMessage extends Document {
    conversation: mongoose.Types.ObjectId;
    sender?: mongoose.Types.ObjectId;
    senderNameSnapshot?: string;
    senderRoleSnapshot?: string;
    body: string;
    attachments: Array<{
        fileName: string;
        url: string;
        fileType: string;
        fileSize: number;
        publicId: string;
        resourceType: "image";
    }>;
    readBy: mongoose.Types.ObjectId[];
    createdAt: Date;
    updatedAt: Date;
}

const MessageSchema = new Schema<IMessage>({
    conversation: { type: Schema.Types.ObjectId, ref: "Conversation", required: true },
    sender: { type: Schema.Types.ObjectId, ref: "User" },
    senderNameSnapshot: { type: String, trim: true },
    senderRoleSnapshot: { type: String, trim: true },
    body: {
        type: String,
        default: "",
        trim: true,
        maxlength: 5000,
        validate: {
            validator: function (value: string) {
                return Boolean(value?.trim() || this.get("attachments")?.length);
            },
            message: "A message must include text or an image.",
        },
    },
    attachments: {
        type: [{
            fileName: { type: String, required: true, trim: true, maxlength: 180 },
            url: { type: String, required: true, match: /^https:\/\/res\.cloudinary\.com\// },
            fileType: { type: String, required: true, enum: ["image/jpeg", "image/png", "image/webp"] },
            fileSize: { type: Number, required: true, min: 1, max: 5 * 1024 * 1024 },
            publicId: { type: String, required: true },
            resourceType: { type: String, enum: ["image"], required: true },
        }],
        default: [],
        validate: { validator: (attachments: unknown[]) => attachments.length <= 1, message: "A message can include at most one image." },
    },
    readBy: [{ type: Schema.Types.ObjectId, ref: "User" }],
}, { timestamps: true });

MessageSchema.index({ conversation: 1, createdAt: 1 });

export default mongoose.models.Message || mongoose.model<IMessage>("Message", MessageSchema);
