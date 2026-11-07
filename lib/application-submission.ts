import mongoose from "mongoose";
import Application from "../models/Application.ts";
import Task from "../models/Task.ts";

const maxTransactionAttempts = 8;
const maxNonConflictAttempts = 2;

export class ProjectNotAcceptingApplicationsError extends Error {
    constructor() {
        super("This project is no longer accepting applications.");
        this.name = "ProjectNotAcceptingApplicationsError";
    }
}

export class DuplicateProjectApplicationError extends Error {
    constructor() {
        super("You have already applied to this project.");
        this.name = "DuplicateProjectApplicationError";
    }
}

export class ApplicationTransactionError extends Error {
    constructor() {
        super("Project applications are temporarily unavailable. Please try again.");
        this.name = "ApplicationTransactionError";
    }
}

function hasErrorLabel(error: unknown, label: string) {
    return !!error
        && typeof error === "object"
        && "hasErrorLabel" in error
        && typeof error.hasErrorLabel === "function"
        && error.hasErrorLabel(label);
}

function isRetryableTransactionError(error: unknown) {
    if (!error || typeof error !== "object") return false;
    const code = "code" in error ? error.code : undefined;
    const name = "name" in error && typeof error.name === "string" ? error.name : "";
    return code === 112
        || code === 251
        || hasErrorLabel(error, "TransientTransactionError")
        || hasErrorLabel(error, "UnknownTransactionCommitResult")
        || name.startsWith("MongoNetwork")
        || name === "PoolClearedOnNetworkError"
        || name === "MongoServerSelectionError"
        || name === "MongoWaitQueueTimeoutError";
}

function getAttemptLimit(error: unknown) {
    if (error && typeof error === "object" && "code" in error && error.code === 112) {
        return maxTransactionAttempts;
    }
    return maxNonConflictAttempts;
}

export function isTemporaryApplicationDatabaseError(error: unknown) {
    return isRetryableTransactionError(error);
}

function sleep(milliseconds: number) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function findCommittedApplication(applicationId: mongoose.Types.ObjectId) {
    return Application.findById(applicationId).select("_id").read("primary").lean();
}

export async function createProjectApplication({
    taskId,
    employerId,
    freelancerId,
    message,
}: {
    taskId: string;
    employerId: mongoose.Types.ObjectId;
    freelancerId: string;
    message: string;
}) {
    const applicationId = new mongoose.Types.ObjectId();
    const totalStartedAt = performance.now();

    for (let attempt = 1; attempt <= maxTransactionAttempts; attempt += 1) {
        const session = await mongoose.startSession();
        const attemptStartedAt = performance.now();
        try {
            session.startTransaction({ maxCommitTimeMS: 5_000 });
            const taskWriteStartedAt = performance.now();
            const openTask = await Task.findOneAndUpdate(
                { _id: taskId, status: "open", isDeleted: { $ne: true }, employer: { $ne: freelancerId } },
                { $inc: { applicationCount: 1 } },
                { returnDocument: "after", session, projection: { _id: 1 } },
            );
            const taskWriteDurationMs = Math.round(performance.now() - taskWriteStartedAt);
            if (!openTask) throw new ProjectNotAcceptingApplicationsError();

            const applicationWriteStartedAt = performance.now();
            await Application.create([{
                _id: applicationId,
                task: taskId,
                employer: employerId,
                freelancer: freelancerId,
                message,
                status: "pending",
            }], { session });
            const applicationWriteDurationMs = Math.round(performance.now() - applicationWriteStartedAt);

            await session.commitTransaction();
            console.info("Project application transaction completed.", {
                attempt,
                taskWriteDurationMs,
                applicationWriteDurationMs,
                durationMs: Math.round(performance.now() - attemptStartedAt),
                totalDurationMs: Math.round(performance.now() - totalStartedAt),
                outcome: "committed",
            });
            return { applicationId };
        } catch (error) {
            try {
                if (session.inTransaction()) await session.abortTransaction();
            } catch (abortError) {
                console.warn("Project application transaction abort failed.", {
                    attempt,
                    errorName: abortError instanceof Error ? abortError.name : "UnknownError",
                });
            }

            const duplicateKeyPattern = error && typeof error === "object" && "keyPattern" in error
                ? error.keyPattern
                : undefined;
            const duplicateError = !!error
                && typeof error === "object"
                && "code" in error
                && error.code === 11000
                && (!duplicateKeyPattern
                    || (typeof duplicateKeyPattern === "object"
                        && duplicateKeyPattern !== null
                        && "task" in duplicateKeyPattern
                        && "freelancer" in duplicateKeyPattern));
            if (duplicateError || isRetryableTransactionError(error)) {
                try {
                    const committedApplication = await findCommittedApplication(applicationId);
                    if (committedApplication) {
                        console.info("Project application transaction resolved after an uncertain result.", {
                            attempt,
                            durationMs: Math.round(performance.now() - attemptStartedAt),
                            outcome: "confirmed",
                        });
                        return { applicationId };
                    }

                    const existingApplication = await Application.findOne({ task: taskId, freelancer: freelancerId })
                        .select("_id")
                        .read("primary")
                        .lean();
                    if (existingApplication) throw new DuplicateProjectApplicationError();
                } catch (resolutionError) {
                    if (resolutionError instanceof DuplicateProjectApplicationError) throw resolutionError;
                    console.warn("Could not resolve project application transaction outcome.", {
                        attempt,
                        errorName: resolutionError instanceof Error ? resolutionError.name : "UnknownError",
                    });
                    if (duplicateError || attempt >= getAttemptLimit(error)) {
                        throw new ApplicationTransactionError();
                    }
                }
            }

            if (error instanceof ProjectNotAcceptingApplicationsError) throw error;

            const retryable = isRetryableTransactionError(error);
            console.warn("Project application transaction attempt failed.", {
                attempt,
                durationMs: Math.round(performance.now() - attemptStartedAt),
                errorName: error instanceof Error ? error.name : "UnknownError",
                retryable,
            });
            if (retryable && attempt < getAttemptLimit(error)) {
                const delay = Math.min(500, 40 * (2 ** (attempt - 1))) + Math.floor(Math.random() * 40);
                await sleep(delay);
                continue;
            }

            if (duplicateError) throw new DuplicateProjectApplicationError();
            if (retryable) throw new ApplicationTransactionError();
            throw error;
        } finally {
            await session.endSession();
        }
    }

    throw new ApplicationTransactionError();
}
