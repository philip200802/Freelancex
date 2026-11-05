import mongoose from "mongoose";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { connectToDatabase } from "@/lib/mongodb";
import { initializePaystackTransaction, PaystackConfigurationError, PaystackRequestError } from "@/lib/payments/paystack";
import PaymentTransaction from "@/models/PaymentTransaction";
import Task from "@/models/Task";
import User from "@/models/User";

export const dynamic = "force-dynamic";

function jsonNoStore(body: unknown, init?: ResponseInit) {
    const response = NextResponse.json(body, init);
    response.headers.set("Cache-Control", "no-store");
    return response;
}

function appBaseUrl() {
    const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
    if (!configured) return null;
    try {
        const url = new URL(configured);
        if (url.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) {
            return null;
        }
        return url.origin;
    } catch {
        return null;
    }
}

export async function POST(request: Request) {
    const user = await getCurrentUser();
    if (!user) return jsonNoStore({ error: "Authentication required." }, { status: 401 });
    if (user.role !== "employer") return jsonNoStore({ error: "Only clients can fund projects." }, { status: 403 });

    let body: { projectId?: unknown };
    try {
        body = await request.json() as { projectId?: unknown };
    } catch {
        return jsonNoStore({ error: "A valid project ID is required." }, { status: 400 });
    }
    const projectId = typeof body.projectId === "string" ? body.projectId : "";
    if (!mongoose.Types.ObjectId.isValid(projectId)) return jsonNoStore({ error: "Project not found." }, { status: 404 });

    const baseUrl = appBaseUrl();
    if (!process.env.PAYSTACK_SECRET_KEY || !baseUrl) {
        return jsonNoStore({ error: "Online project funding is not configured. Contact the platform administrator." }, { status: 503 });
    }

    try {
        await connectToDatabase();
        const [employer, task] = await Promise.all([
            User.findById(user.userId).select("name email isActive").lean(),
            Task.findOne({ _id: projectId, employer: user.userId }).select("title amount status freelancer paystackReference").lean(),
        ]);
        if (!employer || employer.isActive === false) return jsonNoStore({ error: "Client account is unavailable." }, { status: 403 });
        if (!task) return jsonNoStore({ error: "Project not found." }, { status: 404 });
        if (task.status === "funded" || task.status === "in_progress" || task.status === "submitted" || task.status === "revision_requested" || task.status === "completed") {
            return jsonNoStore({ error: "This project is already funded or complete." }, { status: 409 });
        }
        if (task.status !== "awaiting_funding" || !task.freelancer) {
            return jsonNoStore({ error: "Accept a freelancer application before funding this project." }, { status: 409 });
        }
        const freelancer = await User.findById(task.freelancer).select("name isActive").lean();
        if (!freelancer || freelancer.isActive === false) {
            return jsonNoStore({ error: "The assigned freelancer account is unavailable. Select another freelancer before funding." }, { status: 409 });
        }

        const amountSubunit = Math.round(task.amount * 100);
        if (!Number.isSafeInteger(amountSubunit) || amountSubunit <= 0) {
            return jsonNoStore({ error: "The project amount cannot be represented as a valid NGN payment." }, { status: 400 });
        }

        let payment = await PaymentTransaction.findOne({
            task: task._id,
            status: { $in: ["initializing", "pending"] },
        }).sort({ createdAt: -1 });
        if (payment?.status === "pending" && payment.authorizationUrl) {
            return jsonNoStore({ authorizationUrl: payment.authorizationUrl, reference: payment.reference });
        }

        if (!payment) {
            const reference = `fx_${randomUUID().replace(/-/g, "")}`;
            const session = await mongoose.startSession();
            try {
                await session.withTransaction(async () => {
                    const reservedTask = await Task.findOneAndUpdate(
                        {
                            _id: task._id,
                            employer: user.userId,
                            status: "awaiting_funding",
                            freelancer: task.freelancer,
                            $or: [{ paystackReference: { $exists: false } }, { paystackReference: null }],
                        },
                        { $set: { paystackReference: reference } },
                        { returnDocument: "after", session },
                    );
                    if (!reservedTask) throw new Error("PAYMENT_ALREADY_INITIALIZED");
                    [payment] = await PaymentTransaction.create([{
                        task: task._id,
                        employer: user.userId,
                        freelancer: task.freelancer,
                        employerNameSnapshot: employer.name,
                        freelancerNameSnapshot: freelancer.name,
                        provider: "paystack",
                        reference,
                        amount: task.amount,
                        amountSubunit,
                        currency: "NGN",
                        status: "initializing",
                    }], { session });
                });
            } catch (error) {
                if (error instanceof Error && error.message === "PAYMENT_ALREADY_INITIALIZED") {
                    const activePayment = await PaymentTransaction.findOne({ task: task._id, status: { $in: ["initializing", "pending"] } }).sort({ createdAt: -1 }).lean();
                    if (activePayment?.status === "pending" && activePayment.authorizationUrl) {
                        return jsonNoStore({ authorizationUrl: activePayment.authorizationUrl, reference: activePayment.reference });
                    }
                    return jsonNoStore({ error: "A payment is already being initialized for this project. Retry shortly." }, { status: 409 });
                }
                throw error;
            } finally {
                await session.endSession();
            }
        }

        try {
            const initialized = await initializePaystackTransaction({
                email: employer.email,
                amountSubunit: payment.amountSubunit,
                reference: payment.reference,
                callbackUrl: `${baseUrl}/api/payments/paystack/callback`,
                metadata: { projectId: task._id.toString(), transactionReference: payment.reference },
            });
            await PaymentTransaction.updateOne(
                { _id: payment._id, status: "initializing" },
                { $set: { status: "pending", authorizationUrl: initialized.authorization_url } },
            );
            return jsonNoStore({ authorizationUrl: initialized.authorization_url, reference: payment.reference });
        } catch (error) {
            if (error instanceof PaystackRequestError && error.definitive) {
                await PaymentTransaction.updateOne({ _id: payment._id, status: "initializing" }, { $set: { status: "failed" } });
                await Task.updateOne({ _id: task._id, paystackReference: payment.reference }, { $unset: { paystackReference: 1 } });
                console.error("Paystack rejected transaction initialization.", { statusCode: error.statusCode });
                return jsonNoStore({ error: "Paystack could not initialize this payment. You can try again." }, { status: 502 });
            }
            if (error instanceof PaystackConfigurationError) {
                return jsonNoStore({ error: error.message }, { status: 503 });
            }
            console.error("Paystack transaction initialization outcome is uncertain.", {
                reference: payment.reference,
                errorName: error instanceof Error ? error.name : "UnknownError",
            });
            return jsonNoStore({ error: "Payment initialization could not be confirmed. Do not retry repeatedly; refresh this page shortly." }, { status: 503 });
        }
    } catch (error) {
        console.error("Payment initialization error:", error);
        return jsonNoStore({ error: "The payment could not be initialized." }, { status: 503 });
    }
}
