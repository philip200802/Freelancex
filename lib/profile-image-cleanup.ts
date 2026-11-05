import mongoose from "mongoose";
import { deleteProfileImages } from "@/lib/cloudinary";
import ProfileImageDeletion from "@/models/ProfileImageDeletion";

const staleLock = () => new Date(Date.now() - 5 * 60 * 1000);

export async function processProfileImageCleanup(limit = 20, cleanupId?: string) {
    let completed = 0;
    let queued = 0;
    const processedIds: string[] = [];

    for (let index = 0; index < limit; index += 1) {
        const filter: Record<string, unknown> = {
            $or: [
                { status: "pending", $or: [{ nextAttemptAt: { $exists: false } }, { nextAttemptAt: { $lte: new Date() } }] },
                { status: "processing", processingAt: { $lt: staleLock() } },
            ],
        };
        if (cleanupId) filter._id = new mongoose.Types.ObjectId(cleanupId);
        if (processedIds.length) filter.$and = [{ _id: { $nin: processedIds } }];
        const item = await ProfileImageDeletion.findOneAndUpdate(
            filter,
            { $set: { status: "processing", processingAt: new Date() } },
            { sort: { createdAt: 1 }, returnDocument: "after" },
        );
        if (!item) break;
        processedIds.push(item._id.toString());

        try {
            await deleteProfileImages(item.publicIds);
            await ProfileImageDeletion.updateOne(
                { _id: item._id, status: "processing" },
                {
                    $set: { status: "completed", completedAt: new Date() },
                    $unset: { processingAt: 1, nextAttemptAt: 1, lastError: 1, publicIds: 1 },
                    $inc: { attempts: 1 },
                },
            );
            completed += 1;
        } catch (error) {
            await ProfileImageDeletion.updateOne(
                { _id: item._id, status: "processing" },
                {
                    $set: {
                        status: "pending",
                        lastError: error instanceof Error ? error.name : "CloudinaryDeletionError",
                        nextAttemptAt: new Date(Date.now() + Math.min(6 * 60 * 60 * 1000, 60 * 1000 * (2 ** Math.min(item.attempts, 8)))),
                    },
                    $unset: { processingAt: 1 },
                    $inc: { attempts: 1 },
                },
            );
            console.error("Profile image deletion failed; queued for retry.", {
                cleanupId: item._id.toString(),
                errorName: error instanceof Error ? error.name : "UnknownError",
            });
            queued += 1;
        }
    }
    return { completed, queued };
}
