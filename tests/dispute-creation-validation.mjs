import assert from "node:assert/strict";
import mongoose from "mongoose";
import Dispute, { buildDisputeOpeningDocument, disputeReasons } from "../models/Dispute.ts";
import Notification from "../models/Notification.ts";

const task = new mongoose.Types.ObjectId();
const employer = new mongoose.Types.ObjectId();
const freelancer = new mongoose.Types.ObjectId();
const evidenceLinks = ["https://example.test/evidence"];
const input = {
    task,
    employer,
    freelancer,
    author: employer,
    authorRole: "employer",
    reason: "work_quality",
    description: "The delivered work does not match the agreed scope.",
    evidenceLinks,
    projectStatusBeforeDispute: "completed",
    entryId: "test-dispute-entry",
    authorName: "Project Client",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
};

async function main() {
    assert.ok(disputeReasons.includes(input.reason));

    const openingDocument = buildDisputeOpeningDocument(input);
    const dispute = new Dispute(openingDocument);
    await dispute.validate();
    assert.ok(!dispute.validateSync());
    assert.equal(dispute.status, "open");
    assert.equal(dispute.history[0].authorRole, "employer");
    assert.deepEqual(dispute.history[0].attachments, evidenceLinks);
    assert.deepEqual(dispute.history[0].readBy.map(String), [employer.toString()]);

    const freelancerOpening = buildDisputeOpeningDocument({
        ...input,
        author: freelancer,
        authorRole: "freelancer",
        authorName: "Project Freelancer",
    });
    assert.equal(freelancerOpening.history[0].authorRole, "freelancer");
    assert.equal(freelancerOpening.history[0].author.toString(), freelancer.toString());
    assert.deepEqual(freelancerOpening.history[0].readBy.map(String), [freelancer.toString()]);

    const invalidDispute = new Dispute({
        ...openingDocument,
        reason: "invalid_reason",
    });
    await assert.rejects(invalidDispute.validate());
    assert.ok(invalidDispute.validateSync());

    for (const [recipient, recipientRole, type] of [
        [employer, "employer", "dispute_opened"],
        [freelancer, "freelancer", "dispute_opened"],
        [new mongoose.Types.ObjectId(), "admin", "admin_dispute"],
    ]) {
        const notification = new Notification({
            recipient,
            recipientRole,
            actor: employer,
            type,
            title: "Project dispute opened",
            body: "A dispute was opened for the project.",
            relatedTask: task,
            relatedDispute: dispute._id,
            eventKey: `dispute:${dispute._id}:opened`,
        });
        await notification.validate();
        assert.ok(!notification.validateSync());
    }

    console.log("Dispute creation validation passed: opening document, invalid reason, and participant/admin notifications.");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
