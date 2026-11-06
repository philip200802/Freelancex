import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { connectToDatabase } from "@/lib/mongodb";
import { settlePaystackTransaction } from "@/lib/payments/settle-paystack-transaction";
import PaymentTransaction from "@/models/PaymentTransaction";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
    const url = new URL(request.url);
    const configuredAppUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
    let appOrigin: string;
    try {
        if (!configuredAppUrl) throw new Error("Missing app URL");
        const appUrl = new URL(configuredAppUrl);
        if (appUrl.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && appUrl.protocol === "http:" && ["localhost", "127.0.0.1"].includes(appUrl.hostname))) {
            throw new Error("Invalid app URL");
        }
        appOrigin = appUrl.origin;
    } catch {
        return NextResponse.json({ error: "Project payment callback is not configured." }, { status: 503 });
    }
    const reference = url.searchParams.get("reference")?.trim() || "";
    if (!reference || reference.length > 100) {
        return NextResponse.redirect(new URL("/client/dashboard/payments?payment=invalid", appOrigin));
    }

    try {
        const user = await getCurrentUser();
        if (!user) return NextResponse.redirect(new URL("/login", appOrigin));
        if (user.role !== "employer") {
            return NextResponse.redirect(new URL(user.role === "admin" ? "/admin/dashboard" : "/freelancer/dashboard", appOrigin));
        }

        await connectToDatabase();
        const payment = await PaymentTransaction.findOne({ reference, employer: user.userId }).select("task").lean();
        if (!payment) return NextResponse.redirect(new URL("/client/dashboard/payments?payment=not-found", appOrigin));

        console.info("Paystack client callback received.", { reference, projectId: payment.task.toString() });
        const result = await settlePaystackTransaction(reference);
        console.info("Paystack client callback verification completed.", {
            reference,
            paymentStatus: result.status,
            projectStatus: result.taskStatus,
        });
        const destination = new URL(`/client/dashboard/projects/${payment.task.toString()}`, appOrigin);
        destination.searchParams.set("payment", result.status);
        if (result.status === "success" && !result.projectActivated) {
            destination.searchParams.set("payment", "needs-review");
        }
        return NextResponse.redirect(destination);
    } catch (error) {
        console.error("Paystack callback verification failed:", {
            reference,
            errorName: error instanceof Error ? error.name : "UnknownError",
            errorCode: error instanceof Error && "code" in error ? String(error.code) : undefined,
        });
        const destination = new URL("/client/dashboard/payments?payment=verification-error", appOrigin);
        return NextResponse.redirect(destination);
    }
}
