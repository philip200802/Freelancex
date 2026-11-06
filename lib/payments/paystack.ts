import { createHmac, timingSafeEqual } from "node:crypto";

type PaystackTransaction = {
    id: number;
    reference: string;
    amount: number;
    currency: string;
    status: string;
    authorization_url?: string;
};

type PaystackEnvelope<T> = {
    status: boolean;
    message?: string;
    data: T;
};

export type PaystackBank = {
    name: string;
    code: string;
    currency?: string;
};

export class PaystackConfigurationError extends Error {
    readonly reason: "missing_secret" | "test_secret_required";

    constructor(reason: "missing_secret" | "test_secret_required") {
        super(reason === "missing_secret"
            ? "PAYSTACK_SECRET_KEY is not configured."
            : "PAYSTACK_SECRET_KEY must use a Paystack test key.");
        this.name = "PaystackConfigurationError";
        this.reason = reason;
    }
}

export class PaystackRequestError extends Error {
    readonly definitive: boolean;
    readonly statusCode?: number;
    readonly operation?: string;
    readonly providerMessage?: string;
    readonly retryAfter?: string;
    readonly rateLimitReset?: string;
    readonly verificationFailure: boolean;

    constructor(
        message: string,
        definitive: boolean,
        statusCode?: number,
        details: {
            operation?: string;
            providerMessage?: string;
            retryAfter?: string;
            rateLimitReset?: string;
            verificationFailure?: boolean;
        } = {},
    ) {
        super(message);
        this.name = "PaystackRequestError";
        this.definitive = definitive;
        this.statusCode = statusCode;
        this.operation = details.operation;
        this.providerMessage = details.providerMessage;
        this.retryAfter = details.retryAfter;
        this.rateLimitReset = details.rateLimitReset;
        this.verificationFailure = details.verificationFailure ?? false;
    }
}

let banksCache: { banks: PaystackBank[]; expiresAt: number } | undefined;
let banksRequest: Promise<PaystackBank[]> | undefined;

function getSecret() {
    const secret = process.env.PAYSTACK_SECRET_KEY;
    if (!secret) throw new PaystackConfigurationError("missing_secret");
    if (!secret.startsWith("sk_test_")) throw new PaystackConfigurationError("test_secret_required");
    return secret;
}

export function assertPaystackTestModeConfigured() {
    getSecret();
}

async function paystackRequest<T>(path: string, init?: RequestInit): Promise<PaystackEnvelope<T>> {
    const secret = getSecret();
    const operation = new URL(path, "https://api.paystack.co").pathname;
    let response: Response;
    try {
        response = await fetch(`https://api.paystack.co${path}`, {
            ...init,
            cache: "no-store",
            signal: AbortSignal.timeout(10_000),
            headers: {
                Authorization: `Bearer ${secret}`,
                "Content-Type": "application/json",
                ...init?.headers,
            },
        });
    } catch (error) {
        throw new PaystackRequestError(error instanceof Error ? error.message : "Paystack is unreachable.", false, undefined, { operation });
    }

    let result: PaystackEnvelope<T>;
    try {
        result = await response.json() as PaystackEnvelope<T>;
    } catch {
        const definitive = [400, 401, 403, 404, 422, 429].includes(response.status);
        throw new PaystackRequestError("Paystack returned an unreadable response.", definitive, response.status, {
            operation,
            retryAfter: response.headers.get("retry-after") || undefined,
            rateLimitReset: response.headers.get("x-ratelimit-reset") || undefined,
        });
    }
    if (!response.ok || !result.status) {
        const verificationFailure = operation === "/bank/resolve" && (response.status === 400 || response.status === 404 || response.status === 422 || response.ok);
        const definitive = [400, 401, 403, 404, 422, 429].includes(response.status) || verificationFailure;
        throw new PaystackRequestError("Paystack rejected the request.", definitive, response.status, {
            operation,
            providerMessage: typeof result.message === "string" ? result.message.slice(0, 300) : undefined,
            retryAfter: response.headers.get("retry-after") || undefined,
            rateLimitReset: response.headers.get("x-ratelimit-reset") || undefined,
            verificationFailure,
        });
    }
    return result;
}

export async function initializePaystackTransaction({
    email,
    amountSubunit,
    reference,
    callbackUrl,
    metadata,
}: {
    email: string;
    amountSubunit: number;
    reference: string;
    callbackUrl: string;
    metadata: Record<string, string>;
}) {
    const result = await paystackRequest<{ authorization_url: string; reference: string }>("/transaction/initialize", {
        method: "POST",
        body: JSON.stringify({
            email,
            amount: amountSubunit,
            currency: "NGN",
            reference,
            callback_url: callbackUrl,
            metadata,
        }),
    });
    let authorizationUrl: URL | null = null;
    try {
        authorizationUrl = new URL(result.data.authorization_url);
    } catch {
        authorizationUrl = null;
    }
    if (
        !authorizationUrl ||
        authorizationUrl.protocol !== "https:" ||
        !["checkout.paystack.com", "checkout-staging.paystack.com"].includes(authorizationUrl.hostname) ||
        result.data.reference !== reference
    ) {
        throw new PaystackRequestError("Paystack returned invalid transaction initialization data.", false);
    }
    return result.data;
}

export async function verifyPaystackTransaction(reference: string) {
    const encodedReference = encodeURIComponent(reference);
    const result = await paystackRequest<PaystackTransaction>(`/transaction/verify/${encodedReference}`);
    return result.data;
}

export async function listPaystackBanks(): Promise<PaystackBank[]> {
    if (banksCache && banksCache.expiresAt > Date.now()) return banksCache.banks;
    if (banksRequest) return banksRequest;

    banksRequest = (async () => {
        const result = await paystackRequest<PaystackBank[]>("/bank?country=nigeria&currency=NGN&perPage=100&use_cursor=false");
        if (!Array.isArray(result.data)) throw new PaystackRequestError("Paystack returned an invalid bank list.", false, undefined, { operation: "/bank" });
        const banks = result.data.filter((bank) => typeof bank.name === "string" && typeof bank.code === "string" && bank.code.length > 0);
        banksCache = { banks, expiresAt: Date.now() + 5 * 60 * 1000 };
        return banks;
    })();

    try {
        return await banksRequest;
    } finally {
        banksRequest = undefined;
    }
}

export async function resolvePaystackBankAccount(accountNumber: string, bankCode: string) {
    const params = new URLSearchParams({ account_number: accountNumber, bank_code: bankCode });
    const result = await paystackRequest<{ account_number: string; account_name: string; bank_id: number }>(`/bank/resolve?${params.toString()}`);
    if (result.data.account_number !== accountNumber || !result.data.account_name?.trim()) {
        throw new PaystackRequestError("Paystack could not verify this bank account.", true, 422, {
            operation: "/bank/resolve",
            verificationFailure: true,
        });
    }
    return result.data;
}

export async function savePaystackTransferRecipient({
    recipientCode,
    name,
    accountNumber,
    bankCode,
}: {
    recipientCode?: string;
    name: string;
    accountNumber: string;
    bankCode: string;
}) {
    const payload = JSON.stringify({
        type: "nuban",
        name,
        account_number: accountNumber,
        bank_code: bankCode,
        currency: "NGN",
    });
    const result = await paystackRequest<{ recipient_code: string }>(
        recipientCode ? `/transferrecipient/${encodeURIComponent(recipientCode)}` : "/transferrecipient",
        { method: recipientCode ? "PUT" : "POST", body: payload },
    );
    if (!result.data.recipient_code) throw new PaystackRequestError("Paystack did not return a transfer recipient.", false);
    return result.data;
}

export function verifyPaystackWebhookSignature(rawBody: string, signature: string) {
    const secret = getSecret();
    const expected = createHmac("sha512", secret).update(rawBody).digest("hex");
    const expectedBuffer = Buffer.from(expected, "hex");
    const suppliedBuffer = Buffer.from(signature, "hex");
    return suppliedBuffer.length === expectedBuffer.length && timingSafeEqual(suppliedBuffer, expectedBuffer);
}
