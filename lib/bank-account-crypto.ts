import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export class BankAccountEncryptionConfigurationError extends Error {
    constructor() {
        super("BANK_ACCOUNT_ENCRYPTION_KEY must be configured as a 32-byte key.");
        this.name = "BankAccountEncryptionConfigurationError";
    }
}

function getEncryptionKey() {
    const configuredKey = process.env.BANK_ACCOUNT_ENCRYPTION_KEY;
    if (!configuredKey) throw new BankAccountEncryptionConfigurationError();

    let key: Buffer;
    if (/^[\da-f]{64}$/i.test(configuredKey)) {
        key = Buffer.from(configuredKey, "hex");
    } else {
        if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(configuredKey)) {
            throw new BankAccountEncryptionConfigurationError();
        }
        const encoding = /[-_]/.test(configuredKey) ? "base64url" : "base64";
        key = Buffer.from(configuredKey, encoding);
        if (key.toString(encoding).replace(/=+$/, "") !== configuredKey.replace(/=+$/, "")) {
            throw new BankAccountEncryptionConfigurationError();
        }
    }
    if (key.length !== 32) throw new BankAccountEncryptionConfigurationError();
    return key;
}

export function encryptBankAccountNumber(accountNumber: string) {
    if (typeof accountNumber !== "string" || !/^\d{10}$/.test(accountNumber)) {
        throw new TypeError("Bank account number must contain exactly 10 digits.");
    }
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
    const encrypted = Buffer.concat([cipher.update(accountNumber, "utf8"), cipher.final()]);
    return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}

export function decryptBankAccountNumber(value: string) {
    const [version, encodedIv, encodedTag, encodedCiphertext, ...extra] = value.split(".");
    if (version !== "v1" || !encodedIv || !encodedTag || !encodedCiphertext || extra.length) {
        throw new Error("Stored bank account encryption data is invalid.");
    }
    const decipher = createDecipheriv("aes-256-gcm", getEncryptionKey(), Buffer.from(encodedIv, "base64url"));
    decipher.setAuthTag(Buffer.from(encodedTag, "base64url"));
    return Buffer.concat([
        decipher.update(Buffer.from(encodedCiphertext, "base64url")),
        decipher.final(),
    ]).toString("utf8");
}
