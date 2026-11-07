export const FREELANCEX_COMMISSION_PERCENT = 10;

export interface CommissionBreakdown {
    grossAmountKobo: number;
    commissionRatePercent: number;
    commissionAmountKobo: number;
    freelancerNetAmountKobo: number;
}

export function toKobo(amountNaira: number) {
    if (!Number.isFinite(amountNaira) || amountNaira <= 0) {
        throw new Error("PROJECT_AMOUNT_INVALID");
    }
    const amountKobo = Math.round((amountNaira + Number.EPSILON) * 100);
    if (!Number.isSafeInteger(amountKobo) || amountKobo <= 0) {
        throw new Error("PROJECT_AMOUNT_INVALID");
    }
    return amountKobo;
}

export function calculateCommission(
    grossAmountKobo: number,
    commissionRatePercent = FREELANCEX_COMMISSION_PERCENT,
): CommissionBreakdown {
    if (
        !Number.isSafeInteger(grossAmountKobo) ||
        grossAmountKobo <= 0 ||
        !Number.isInteger(commissionRatePercent) ||
        commissionRatePercent < 0 ||
        commissionRatePercent > 100
    ) {
        throw new Error("COMMISSION_INPUT_INVALID");
    }
    const wholeHundreds = Math.floor(grossAmountKobo / 100);
    const remainder = grossAmountKobo % 100;
    const commissionAmountKobo = wholeHundreds * commissionRatePercent
        + Math.round((remainder * commissionRatePercent) / 100);
    return {
        grossAmountKobo,
        commissionRatePercent,
        commissionAmountKobo,
        freelancerNetAmountKobo: grossAmountKobo - commissionAmountKobo,
    };
}

export function resolveCommission(
    projectAmountNaira: number,
    saved?: Partial<CommissionBreakdown>,
): CommissionBreakdown {
    const snapshot = saved || {};
    const grossAmountKobo = toKobo(projectAmountNaira);
    if (
        snapshot.grossAmountKobo === undefined &&
        snapshot.commissionRatePercent === undefined &&
        snapshot.commissionAmountKobo === undefined &&
        snapshot.freelancerNetAmountKobo === undefined
    ) {
        return calculateCommission(grossAmountKobo);
    }
    if (
        snapshot.grossAmountKobo !== grossAmountKobo ||
        snapshot.commissionRatePercent === undefined ||
        snapshot.commissionAmountKobo === undefined ||
        snapshot.freelancerNetAmountKobo === undefined
    ) {
        throw new Error("COMMISSION_SNAPSHOT_INVALID");
    }
    const calculated = calculateCommission(grossAmountKobo, snapshot.commissionRatePercent);
    if (
        calculated.commissionAmountKobo !== snapshot.commissionAmountKobo ||
        calculated.freelancerNetAmountKobo !== snapshot.freelancerNetAmountKobo
    ) {
        throw new Error("COMMISSION_SNAPSHOT_INVALID");
    }
    return calculated;
}
