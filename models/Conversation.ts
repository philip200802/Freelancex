import mongoose, { Document, Schema } from "mongoose";

export interface IConversation extends Document {
    task: mongoose.Types.ObjectId;
    participants: mongoose.Types.ObjectId[];
    participantSnapshots: Array<{ userId: string; archivedUserId?: string; name: string; role: string }>;
    createdAt: Date;
    updatedAt: Date;
}

const ConversationSchema = new Schema<IConversation>({
    task: { type: Schema.Types.ObjectId, ref: "Task", required: true },
    participants: [{ type: Schema.Types.ObjectId, ref: "User", required: true }],
    participantSnapshots: { type: [{
        userId: { type: String, required: true },
        archivedUserId: { type: String },
        name: { type: String, required: true },
        role: { type: String, required: true },
    }], default: [] },
}, { timestamps: true });

ConversationSchema.index({ task: 1, participants: 1 }, { unique: true });
ConversationSchema.index({ participants: 1, updatedAt: -1 });

export default mongoose.models.Conversation || mongoose.model<IConversation>("Conversation", ConversationSchema);
