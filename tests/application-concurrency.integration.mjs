import assert from "node:assert/strict";
import mongoose from "mongoose";
import Application from "../models/Application.ts";
import Task from "../models/Task.ts";
import {
    createProjectApplication,
    DuplicateProjectApplicationError,
} from "../lib/application-submission.ts";

const uri = process.env.MONGO_APPLICATION_TEST_URI;
if (!uri) {
    console.log("SKIP application concurrency integration test: MONGO_APPLICATION_TEST_URI is not configured.");
    process.exit(0);
}

const databaseName = new URL(uri).pathname.replace(/^\/+/, "").split("/")[0];
if (databaseName !== "freelancex_application_test") {
    throw new Error("MONGO_APPLICATION_TEST_URI must target the dedicated freelancex_application_test database.");
}

const taskId = new mongoose.Types.ObjectId();
let connected = false;

try {
    await mongoose.connect(uri, {
        serverSelectionTimeoutMS: 8_000,
        connectTimeoutMS: 8_000,
        socketTimeoutMS: 15_000,
        waitQueueTimeoutMS: 8_000,
        maxPoolSize: 10,
    });
    connected = true;
    await Application.init();
    const employerId = new mongoose.Types.ObjectId();
    const freelancerIds = Array.from({ length: 5 }, () => new mongoose.Types.ObjectId());
    await Task.create({
        _id: taskId,
        employer: employerId,
        title: "Concurrent application integration test",
        description: "Temporary record created by the application concurrency integration test.",
        amount: 100,
        category: "Development",
        status: "open",
        applicationCount: 0,
    });

    const created = await Promise.all(freelancerIds.map((freelancerId) => createProjectApplication({
        taskId: taskId.toString(),
        employerId,
        freelancerId: freelancerId.toString(),
        message: "Concurrency test application",
    })));
    assert.equal(new Set(created.map(({ applicationId }) => applicationId.toString())).size, 5);
    assert.equal(await Application.countDocuments({ task: taskId }), 5);
    assert.equal(await Task.findById(taskId).select("applicationCount").lean().then((task) => task?.applicationCount), 5);
    assert.equal(await Task.findById(taskId).select("status").lean().then((task) => task?.status), "open");

    await assert.rejects(
        createProjectApplication({
            taskId: taskId.toString(),
            employerId,
            freelancerId: freelancerIds[0].toString(),
            message: "Duplicate test application",
        }),
        DuplicateProjectApplicationError,
    );
    assert.equal(await Application.countDocuments({ task: taskId }), 5);
    assert.equal(await Task.findById(taskId).select("applicationCount").lean().then((task) => task?.applicationCount), 5);
    for (const freelancerId of freelancerIds) {
        assert.equal(await Application.countDocuments({ task: taskId, freelancer: freelancerId }), 1);
    }

    console.log("PASS application concurrency integration test: five freelancers retained separate applications; duplicate rejected; counter remained accurate.");
} finally {
    if (connected) {
        await Application.deleteMany({ task: taskId });
        await Task.deleteOne({ _id: taskId });
        await mongoose.disconnect();
    }
}
