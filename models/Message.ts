import mongoose, { Document, Schema } from "mongoose";

export interface IMessage extends Document {
    conversation: mongoose.Types.ObjectId;
    sender: mongoose.Types.ObjectId;
    body: string;
    readBy: mongoose.Types.ObjectId[];
    createdAt: Date;
    updatedAt: Date;
}

const MessageSchema = new Schema<IMessage>({
    conversation: { type: Schema.Types.ObjectId, ref: "Conversation", required: true },
    sender: { type: Schema.Types.ObjectId, ref: "User", required: true },
    body: { type: String, required: true, trim: true, maxlength: 5000 },
    readBy: [{ type: Schema.Types.ObjectId, ref: "User" }],
}, { timestamps: true });

MessageSchema.index({ conversation: 1, createdAt: 1 });

export default mongoose.models.Message || mongoose.model<IMessage>("Message", MessageSchema);
