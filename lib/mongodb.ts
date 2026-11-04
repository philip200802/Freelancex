import mongoose from "mongoose";

const globalForMongoose = globalThis as typeof globalThis & {
    mongooseConnection?: Promise<typeof mongoose>;
};

export async function connectToDatabase() {
    if (!process.env.MONGO_URI) {
        throw new Error("MONGO_URI is not configured.");
    }

    if (!globalForMongoose.mongooseConnection) {
        globalForMongoose.mongooseConnection = mongoose.connect(process.env.MONGO_URI);
    }

    return globalForMongoose.mongooseConnection;
}
