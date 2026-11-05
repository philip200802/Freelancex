import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { connectToDatabase } from "@/lib/mongodb";
import PaymentTransaction from "@/models/PaymentTransaction";

export const dynamic = "force-dynamic";

export async function GET() {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    if (user.role !== "employer") return NextResponse.json({ error: "Only clients can view their payment history." }, { status: 403 });

    try {
        await connectToDatabase();
        const transactions = await PaymentTransaction.find({ employer: user.userId })
            .populate("task", "title status")
            .sort({ createdAt: -1 })
            .limit(100)
            .lean();
        return NextResponse.json({
            transactions: transactions.map((transaction) => ({
                id: transaction._id.toString(),
                reference: transaction.reference,
                amount: transaction.amount,
                currency: transaction.currency,
                status: transaction.status,
                taskTitle: transaction.task?.title || "Project",
                taskStatus: transaction.task?.status || "not available",
                createdAt: transaction.createdAt,
                verifiedAt: transaction.verifiedAt || null,
            })),
        }, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
        console.error("Client payment history error:", error);
        return NextResponse.json({ error: "Payment history is temporarily unavailable." }, { status: 503 });
    }
}
