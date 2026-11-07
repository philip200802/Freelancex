import mongoose from "mongoose";

const mongoUri = process.env.MONGO_URI;
if (!mongoUri) {
    throw new Error("Set MONGO_URI in the process environment before running this migration.");
}

const checkOnly = process.argv.includes("--check");
await mongoose.connect(mongoUri, { autoIndex: false });

try {
    const collection = mongoose.connection.collection("applications");
    const indexes = await collection.listIndexes().toArray();
    console.log("Current application indexes:");
    for (const index of indexes) {
        console.log(JSON.stringify({ name: index.name, key: index.key, unique: index.unique === true }));
    }

    const duplicatePairs = await collection.aggregate([
        { $group: { _id: { task: "$task", freelancer: "$freelancer" }, count: { $sum: 1 }, applicationIds: { $push: "$_id" } } },
        { $match: { count: { $gt: 1 } } },
        { $limit: 25 },
    ]).toArray();

    if (duplicatePairs.length) {
        console.error("Migration stopped: duplicate task/freelancer application pairs must be reviewed before creating the unique index.");
        console.error(JSON.stringify(duplicatePairs.map((pair) => ({
            taskId: pair._id.task?.toString() || null,
            freelancerId: pair._id.freelancer?.toString() || null,
            count: pair.count,
            applicationIds: pair.applicationIds.map((id) => id.toString()),
        })), null, 2));
        process.exitCode = 1;
    } else if (checkOnly) {
        console.log("Index check completed. No records or indexes were changed.");
    } else {
        const expectedIndex = indexes.find((index) =>
            index.unique === true
            && Object.keys(index.key).length === 2
            && Object.keys(index.key).includes("task")
            && Object.keys(index.key).includes("freelancer"));
        const conflictingCompoundIndexes = indexes.filter((index) =>
            Object.keys(index.key).length === 2
            && Object.keys(index.key).includes("task")
            && Object.keys(index.key).includes("freelancer")
            && index.unique !== true);

        for (const index of conflictingCompoundIndexes) {
            await collection.dropIndex(index.name);
            console.log(`Dropped non-unique task/freelancer index "${index.name}".`);
        }

        if (!expectedIndex) {
            await collection.createIndex({ task: 1, freelancer: 1 }, { unique: true, name: "task_1_freelancer_1" });
            console.log("Created the unique (task, freelancer) application index.");
        }

        const staleProjectIndexes = indexes.filter((index) =>
            index.unique === true
            && Object.keys(index.key).length === 1
            && index.key.task === 1);
        for (const index of staleProjectIndexes) {
            await collection.dropIndex(index.name);
            console.log(`Dropped stale task-only unique index "${index.name}".`);
        }

        console.log("Application index migration completed. No application records were deleted.");
    }
} finally {
    await mongoose.disconnect();
}
