import mongoose from "mongoose";
import ManualPayout from "@/models/ManualPayout";
import Task from "@/models/Task";
import User from "@/models/User";
import { queueWorkflowEmailToAdmins } from "@/lib/workflow-email";

export async function queueOverdueManualPayoutEmails(limit = 50) {
    const session = await mongoose.connection.startSession();
    const queuedIds: mongoose.Types.ObjectId[] = [];
    try {
        await session.withTransaction(async () => {
            const payouts = await ManualPayout.find({ status: "pending", dueAt: { $lte: new Date() } })
                .sort({ dueAt: 1, _id: 1 })
                .limit(limit)
                .session(session)
                .lean();
            if (!payouts.length) return;

            const taskIds = [...new Set(payouts.map((payout) => payout.task.toString()))]
                .map((id) => new mongoose.Types.ObjectId(id));
            const freelancerIds = [...new Set(payouts.map((payout) => payout.freelancer.toString()))]
                .map((id) => new mongoose.Types.ObjectId(id));
            const [tasks, freelancers] = await Promise.all([
                Task.find({ _id: { $in: taskIds } }).select("_id title").session(session).lean(),
                User.find({ _id: { $in: freelancerIds } }).select("_id name").session(session).lean(),
            ]);
            const taskById = new Map(tasks.map((task) => [task._id.toString(), task]));
            const freelancerById = new Map(freelancers.map((freelancer) => [freelancer._id.toString(), freelancer]));

            for (const payout of payouts) {
                const task = taskById.get(payout.task.toString());
                if (!task) continue;
                const freelancer = freelancerById.get(payout.freelancer.toString());
                const ids = await queueWorkflowEmailToAdmins(
                    "manual_payout_overdue_admin",
                    `manual-payout:${payout._id}:overdue:admin`,
                    {
                        subject: "Manual project payout is overdue",
                        heading: "Payout processing target passed",
                        message: "A pending manual payout is past its processing target. This does not indicate whether an external bank transfer has occurred.",
                        details: [
                            { label: "Project", value: task.title },
                            { label: "Freelancer", value: payout.freelancerNameSnapshot || freelancer?.name || "Freelancer" },
                            { label: "Net payout", value: new Intl.NumberFormat("en-NG", { style: "currency", currency: payout.currency, maximumFractionDigits: 2 }).format(payout.amount) },
                            { label: "Due date", value: payout.dueAt.toLocaleString("en-NG", { timeZone: "UTC" }) + " UTC" },
                            { label: "Bank verification", value: payout.bankAccountStatus || "Unknown" },
                        ],
                        actionPath: "/admin/dashboard/payouts",
                        actionLabel: "Review payout",
                        relatedTask: payout.task,
                    },
                    session,
                );
                queuedIds.push(...ids);
            }
        });
    } finally {
        await session.endSession();
    }
    return queuedIds;
}
