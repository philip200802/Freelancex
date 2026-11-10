import assert from "node:assert/strict";
import Task from "../models/Task.ts";
import { createAcceptedProjectDeadline, getProjectDeadlineCountdown } from "../lib/project-deadline.ts";

async function main() {
    const task = new Task({
        title: "Seven day delivery",
        description: "A project with a one week deadline.",
        amount: 100,
        category: "Development",
        duration: 7,
        durationUnit: "days",
        status: "open",
    });
    await task.validate();
    assert.equal(task.projectStartedAt, undefined);
    assert.equal(task.deadlineAt, undefined);

    const acceptanceDate = new Date("2026-11-09T08:30:45.000Z");
    const deadline = createAcceptedProjectDeadline(task, acceptanceDate);
    assert.ok(deadline);
    assert.equal(deadline.projectStartedAt.toISOString(), acceptanceDate.toISOString());
    assert.equal(deadline.deadlineAt.toISOString(), "2026-11-16T08:30:45.000Z");
    assert.equal(getProjectDeadlineCountdown(deadline.deadlineAt, acceptanceDate), "7 days remaining");

    assert.equal(createAcceptedProjectDeadline({
        status: "awaiting_funding",
        duration: 7,
        durationUnit: "days",
        projectStartedAt: deadline.projectStartedAt,
        deadlineAt: deadline.deadlineAt,
    }, new Date("2026-11-10T08:30:45.000Z")), null);
    assert.equal(createAcceptedProjectDeadline({
        status: "open",
        duration: 7,
        durationUnit: "days",
        projectStartedAt: deadline.projectStartedAt,
        deadlineAt: deadline.deadlineAt,
    }, new Date("2026-11-10T08:30:45.000Z")), null);

    const invalidTask = new Task({
        title: "Invalid duration",
        description: "A project duration must be positive.",
        amount: 100,
        category: "Development",
        duration: 0,
        durationUnit: "days",
    });
    await assert.rejects(invalidTask.validate());

    console.log("Project deadline validation passed: seven-day acceptance date calculation, no posting-time deadline, and no deadline reset.");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
