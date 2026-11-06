import { NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/mongodb";
import { PaystackConfigurationError, verifyPaystackWebhookSignature } from "@/lib/payments/paystack";
import { settlePaystackTransaction } from "@/lib/payments/settle-paystack-transaction";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
    const rawBody = await request.text();
    const signature = request.headers.get("x-paystack-signature") || "";
    console.info("Paystack webhook received.", { hasSignature: Boolean(signature) });
    try {
        if (!signature || !verifyPaystackWebhookSignature(rawBody, signature)) {
            console.warn("Paystack webhook rejected because its signature is invalid.");
            return NextResponse.json({ error: "Invalid webhook signature." }, { status: 401 });
        }
    } catch (error) {
        if (error instanceof PaystackConfigurationError) {
            console.error("Paystack webhook cannot validate its signature because Paystack is not configured.");
            return NextResponse.json({ error: "Paystack is not configured." }, { status: 503 });
        }
        console.error("Paystack webhook signature verification failed.", {
            errorName: error instanceof Error ? error.name : "UnknownError",
        });
        return NextResponse.json({ error: "Webhook signature could not be verified." }, { status: 503 });
    }

    let payload: unknown;
    try {
        payload = JSON.parse(rawBody) as unknown;
    } catch {
        return NextResponse.json({ error: "Invalid webhook payload." }, { status: 400 });
    }
    if (!payload || typeof payload !== "object") {
        return NextResponse.json({ error: "Invalid webhook payload." }, { status: 400 });
    }
    const event = payload as { event?: unknown; data?: { reference?: unknown } };
    if (event.event !== "charge.success" && event.event !== "charge.failed") {
        console.info("Paystack webhook event acknowledged without settlement.", { event: String(event.event || "unknown") });
        return NextResponse.json({ received: true });
    }
    const reference = typeof event.data?.reference === "string" ? event.data.reference : "";
    if (!reference || reference.length > 100) return NextResponse.json({ error: "Transaction reference is invalid." }, { status: 400 });
    console.info("Paystack settlement webhook accepted.", { event: event.event, reference });

    try {
        await connectToDatabase();
        const result = await settlePaystackTransaction(reference);
        console.info("Paystack webhook processed.", {
            event: event.event,
            reference,
            paymentStatus: result.status,
            projectStatus: result.taskStatus,
        });
        return NextResponse.json({ received: true, paymentStatus: result.status });
    } catch (error) {
        console.error("Paystack webhook transaction verification failed:", {
            reference,
            errorName: error instanceof Error ? error.name : "UnknownError",
            errorCode: error instanceof Error && "code" in error ? String(error.code) : undefined,
        });
        return NextResponse.json({ error: "Transaction verification is temporarily unavailable." }, { status: 503 });
    }
}
