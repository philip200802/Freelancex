import PaymentCallback from "@/components/payments/PaymentCallback";

export default async function PaymentCallbackPage({
    searchParams,
}: {
    searchParams: Promise<{ reference?: string | string[]; trxref?: string | string[] }>;
}) {
    const query = await searchParams;
    const reference = query.reference || query.trxref;
    return <PaymentCallback reference={Array.isArray(reference) ? reference[0] || "" : reference || ""} />;
}
