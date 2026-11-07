import assert from "node:assert/strict";
import mongoose from "mongoose";
import BankAccount from "../models/BankAccount.ts";
import EmailOutbox from "../models/EmailOutbox.ts";

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

    console.log("Workflow model validation passed: outbox lifecycle and bank-account verification snapshots.");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
