import { NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/mongodb";
import { PaystackConfigurationError, verifyPaystackWebhookSignature } from "@/lib/payments/paystack";
import { settlePaystackTransaction } from "@/lib/payments/settle-paystack-transaction";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
    const rawBody = await request.text();
    const signature = request.headers.get("x-paystack-signature") || "";
    try {
        if (!signature || !verifyPaystackWebhookSignature(rawBody, signature)) {
            return NextResponse.json({ error: "Invalid webhook signature." }, { status: 401 });
        }
    } catch (error) {
        if (error instanceof PaystackConfigurationError) {
            return NextResponse.json({ error: "Paystack is not configured." }, { status: 503 });
        }
        console.error("Paystack webhook signature verification failed:", error);
        return NextResponse.json({ error: "Webhook signature could not be verified." }, { status: 503 });
    }

    let event: { event?: unknown; data?: { reference?: unknown } };
    try {
        event = JSON.parse(rawBody) as typeof event;
    } catch {
        return NextResponse.json({ error: "Invalid webhook payload." }, { status: 400 });
    }
    if (event.event !== "charge.success" && event.event !== "charge.failed") {
        return NextResponse.json({ received: true });
    }
    const reference = typeof event.data?.reference === "string" ? event.data.reference : "";
    if (!reference || reference.length > 100) return NextResponse.json({ error: "Transaction reference is invalid." }, { status: 400 });

    try {
        await connectToDatabase();
        const result = await settlePaystackTransaction(reference);
        return NextResponse.json({ received: true, paymentStatus: result.status });
    } catch (error) {
        console.error("Paystack webhook transaction verification failed:", {
            reference,
            errorName: error instanceof Error ? error.name : "UnknownError",
        });
        return NextResponse.json({ error: "Transaction verification is temporarily unavailable." }, { status: 503 });
    }
}
