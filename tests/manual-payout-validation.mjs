import assert from "node:assert/strict";
import mongoose from "mongoose";
import ManualPayout, { createPendingManualPayout } from "../models/ManualPayout.ts";

const approvalPayload = {
    task: new mongoose.Types.ObjectId(),
    paymentTransaction: new mongoose.Types.ObjectId(),
    freelancer: new mongoose.Types.ObjectId(),
    freelancerNameSnapshot: "Freelancer",
    grossAmountKobo: 100000,
    commissionRatePercent: 10,
    commissionAmountKobo: 10000,
    amountKobo: 90000,
    amount: 900,
    currency: "NGN",
    approvedAt: new Date("2026-01-01T00:00:00.000Z"),
    dueAt: new Date("2026-01-02T00:00:00.000Z"),
    bankAccountStatus: "verified",
    bankName: "Example Bank",
    bankCode: "001",
    accountName: "Freelancer",
    accountNumberLast4: "1234",
};

async function main() {
    assert.ok(ManualPayout.schema.path("status").enumValues.includes("pending"));

    const pending = createPendingManualPayout(approvalPayload);
    await pending.validate();
    assert.ok(!pending.validateSync());
    assert.equal(pending.status, "pending");
    assert.ok(!pending.admin);
    assert.ok(!pending.adminNameSnapshot);
    assert.ok(!pending.transferReference);
    assert.ok(!pending.transferredAt);

    const completed = new ManualPayout({
        ...approvalPayload,
        status: "completed",
        admin: new mongoose.Types.ObjectId(),
        adminNameSnapshot: "Admin",
        transferReference: "manual-transfer-001",
        transferredAt: new Date("2026-01-03T00:00:00.000Z"),
    });
    await completed.validate();
    assert.ok(!completed.validateSync());

    const incompleteCompleted = new ManualPayout({
        ...approvalPayload,
        status: "completed",
    });
    await assert.rejects(incompleteCompleted.validate());
    assert.ok(incompleteCompleted.validateSync());

    console.log("ManualPayout validation passed: approval payload, pending, and completed lifecycle.");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
