import mongoose from "mongoose";

const globalForMongoose = globalThis as typeof globalThis & {
    mongooseConnection?: Promise<typeof mongoose>;
};

const mongoConnectionOptions: mongoose.ConnectOptions = {
    serverSelectionTimeoutMS: 10_000,
    connectTimeoutMS: 10_000,
    socketTimeoutMS: 30_000,
    waitQueueTimeoutMS: 10_000,
    maxPoolSize: 20,
    minPoolSize: 0,
    maxIdleTimeMS: 30_000,
};

export async function connectToDatabase() {
    const mongoUri = process.env.MONGO_URI;
    if (!mongoUri) {
        throw new Error("MONGO_URI is not configured.");
    }

    if (!globalForMongoose.mongooseConnection) {
        const connectionStartedAt = performance.now();
        const connectionPromise = mongoose.connect(mongoUri, mongoConnectionOptions)
            .then((connection) => {
                console.info("MongoDB connection established.", {
                    readyState: connection.connection.readyState,
                    durationMs: Math.round(performance.now() - connectionStartedAt),
                });
                return connection;
            })
            .catch((error: unknown) => {
                if (globalForMongoose.mongooseConnection === connectionPromise) {
                    globalForMongoose.mongooseConnection = undefined;
                }
                console.error("MongoDB connection attempt failed.", {
                    errorName: error instanceof Error ? error.name : "UnknownError",
                });
                throw error;
            });
        globalForMongoose.mongooseConnection = connectionPromise;
    }

    return globalForMongoose.mongooseConnection;
}
