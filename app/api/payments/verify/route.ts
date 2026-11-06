import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { connectToDatabase } from "@/lib/mongodb";
import { settlePaystackTransaction } from "@/lib/payments/settle-paystack-transaction";
import PaymentTransaction from "@/models/PaymentTransaction";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    if (user.role !== "employer") return NextResponse.json({ error: "Only clients can verify project payments." }, { status: 403 });

    let body: { reference?: unknown };
    try {
        body = await request.json() as { reference?: unknown };
    } catch {
        return NextResponse.json({ error: "A valid transaction reference is required." }, { status: 400 });
    }
    const reference = typeof body.reference === "string" ? body.reference.trim() : "";
    if (!reference || reference.length > 100) {
        return NextResponse.json({ error: "A valid transaction reference is required." }, { status: 400 });
    }

    try {
        await connectToDatabase();
        const payment = await PaymentTransaction.findOne({ provider: "paystack", reference, employer: user.userId })
            .select("task")
            .lean();
        if (!payment) return NextResponse.json({ error: "Payment not found." }, { status: 404 });

        const result = await settlePaystackTransaction(reference);
        return NextResponse.json({
            status: result.status,
            projectId: payment.task.toString(),
            projectStatus: result.taskStatus,
            projectFunded: result.projectActivated,
        }, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
        console.error("Authenticated Paystack verification failed.", {
            reference,
            errorName: error instanceof Error ? error.name : "UnknownError",
            errorCode: error instanceof Error && "code" in error ? String(error.code) : undefined,
        });
        return NextResponse.json({ error: "Payment verification is temporarily unavailable." }, {
            status: 503,
            headers: { "Cache-Control": "no-store" },
        });
    }
}
