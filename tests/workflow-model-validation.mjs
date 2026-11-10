import assert from "node:assert/strict";
import mongoose from "mongoose";
import BankAccount from "../models/BankAccount.ts";
import CancellationRequest from "../models/CancellationRequest.ts";
import DeadlineExtensionRequest from "../models/DeadlineExtensionRequest.ts";
import EmailOutbox from "../models/EmailOutbox.ts";
import ProjectSubmission from "../models/ProjectSubmission.ts";
import Task from "../models/Task.ts";

async function main() {
    const queuedEmail = new EmailOutbox({
        type: "workflow_email",
        to: "user@example.test",
        recipientName: "FreelanceX User",
        eventKey: "task:123:funded:abc",
        workflowEvent: "task_funded",
        subject: "Project funded",
        heading: "Project funded",
        message: "The project has been funded.",
        details: [{ label: "Project", value: "Sample project" }],
        actionUrl: "https://example.test/client/dashboard/projects/123",
        actionLabel: "View project",
    });
    await queuedEmail.validate();
    assert.equal(queuedEmail.status, "pending");
    assert.equal(queuedEmail.attempts, 0);
    assert.ok(EmailOutbox.schema.indexes().some(([keys, options]) =>
        keys.eventKey === 1 && options.unique && options.partialFilterExpression?.eventKey?.$type === "string"));

    const sentEmail = new EmailOutbox({
        type: "workflow_email",
        status: "sent",
        providerMessageId: "provider-message-123",
        sentAt: new Date("2026-01-03T00:00:00.000Z"),
    });
    await sentEmail.validate();

    const invalidEmail = new EmailOutbox({ type: "workflow_email", status: "delivered" });
    await assert.rejects(invalidEmail.validate());

    assert.equal(BankAccount.schema.path("encryptedAccountNumber").options.select, false);
    const verifiedBankAccount = new BankAccount({
        user: new mongoose.Types.ObjectId(),
        bankName: "Example Bank",
        bankCode: "001",
        encryptedAccountNumber: "encrypted-account-value",
        accountNumberLast4: "1234",
        accountName: "FreelanceX User",
        verificationStatus: "verified",
        verifiedAt: new Date("2026-01-03T00:00:00.000Z"),
    });
    await verifiedBankAccount.validate();

    const unverifiedBankAccount = new BankAccount({
        user: new mongoose.Types.ObjectId(),
        bankName: "Example Bank",
        bankCode: "001",
        accountNumberLast4: "1234",
        accountName: "FreelanceX User",
        verificationStatus: "unverified",
    });
    await unverifiedBankAccount.validate();

    const task = new mongoose.Types.ObjectId();
    const employer = new mongoose.Types.ObjectId();
    const freelancer = new mongoose.Types.ObjectId();
    const cancellation = new CancellationRequest({
        task,
        requestedBy: employer,
        requestedTo: freelancer,
        requesterRole: "employer",
        reason: "changed_requirements",
        description: "The project requirements changed significantly.",
        evidenceLinks: ["https://example.test/requirements"],
    });
    await cancellation.validate();
    const invalidCancellation = new CancellationRequest({
        task,
        requestedBy: employer,
        requestedTo: freelancer,
        requesterRole: "employer",
        reason: "not-a-valid-reason",
        description: "Invalid reason.",
    });
    await assert.rejects(invalidCancellation.validate());
    const disputedCancellation = new CancellationRequest({
        task,
        requestedBy: employer,
        requestedTo: freelancer,
        requesterRole: "employer",
        reason: "changed_requirements",
        description: "The cancellation request is now being handled through a dispute.",
        status: "disputed",
        disputedBy: freelancer,
        disputedAt: new Date("2026-01-03T00:00:00.000Z"),
        dispute: new mongoose.Types.ObjectId(),
    });
    await disputedCancellation.validate();
    assert.ok(CancellationRequest.schema.indexes().some(([keys, options]) =>
        keys.task === 1 && keys.status === 1 && options.unique && options.partialFilterExpression?.status === "pending"));

    const extension = new DeadlineExtensionRequest({
        task,
        employer,
        freelancer,
        currentDeadline: new Date("2026-01-10T00:00:00.000Z"),
        duration: 2,
        durationUnit: "weeks",
        proposedDeadline: new Date("2026-01-24T00:00:00.000Z"),
        reason: "Additional testing is required.",
    });
    await extension.validate();
    assert.equal(extension.currentDeadline.toISOString(), "2026-01-10T00:00:00.000Z");
    assert.equal(extension.proposedDeadline.toISOString(), "2026-01-24T00:00:00.000Z");
    const invalidExtension = new DeadlineExtensionRequest({
        task,
        employer,
        freelancer,
        currentDeadline: new Date("2026-01-10T00:00:00.000Z"),
        duration: 0,
        durationUnit: "days",
        proposedDeadline: new Date("2026-01-10T00:00:00.000Z"),
        reason: "Invalid duration.",
    });
    await assert.rejects(invalidExtension.validate());
    assert.ok(DeadlineExtensionRequest.schema.indexes().some(([keys, options]) =>
        keys.task === 1 && keys.status === 1 && options.unique && options.partialFilterExpression?.status === "pending"));

    const revision = new ProjectSubmission({
        task,
        employer,
        freelancer,
        submissionNumber: 1,
        message: "Initial submission.",
        attachments: [],
        links: [],
        status: "revision_requested",
        feedback: "Please include the missing content.",
        feedbackLinks: ["https://example.test/revision-notes"],
        revisionDeadline: new Date("2026-01-15T00:00:00.000Z"),
    });
    await revision.validate();

    const reminderTask = new Task({
        title: "Reminder tracking",
        description: "The reminder tracks the deadline already notified.",
        amount: 100,
        category: "Development",
        duration: 7,
        durationUnit: "days",
        deadlineAt: new Date("2026-01-10T00:00:00.000Z"),
        deadlineReminderSentFor: new Date("2026-01-10T00:00:00.000Z"),
    });
    await reminderTask.validate();
    assert.equal(reminderTask.deadlineReminderSentFor?.getTime(), reminderTask.deadlineAt?.getTime());
    assert.ok(Task.schema.indexes().some(([keys]) => keys.status === 1 && keys.deadlineAt === 1));

    console.log("Workflow model validation passed: idempotent email key, persisted reminder tracking, bank-account snapshots, extension/cancellation constraints, and revision metadata.");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
