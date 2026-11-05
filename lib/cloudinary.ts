import { createHash, randomBytes } from "crypto";

const allowedImageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const maxImageBytes = 5 * 1024 * 1024;
const allowedDeliverableTypes = new Set([
    "application/pdf",
    "application/zip",
    "application/x-zip-compressed",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "image/jpeg",
    "image/png",
    "image/webp",
    "text/plain",
]);
const maxDeliverableBytes = 10 * 1024 * 1024;

export type UploadedProjectDeliverable = {
    fileName: string;
    url: string;
    fileType: string;
    fileSize: number;
    publicId: string;
    resourceType: "image" | "raw";
};

export type UploadedMessageImage = {
    fileName: string;
    url: string;
    fileType: string;
    fileSize: number;
    publicId: string;
    resourceType: "image";
};

async function validateImageFile(file: File, label: string) {
    if (!allowedImageTypes.has(file.type)) return `${label} must be JPG, JPEG, PNG, or WEBP.`;
    if (file.size > maxImageBytes) return `${label} must be 5 MB or smaller.`;
    if (file.size === 0) return `${label} cannot be empty.`;
    const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
    const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    const isPng = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
    const isWebp = bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
    if (!isJpeg && !isPng && !isWebp) return "The selected file is not a valid JPG, PNG, or WEBP image.";
    return null;
}

export async function validateProfileImage(file: File) {
    return validateImageFile(file, "Profile image");
}

function signParameters(parameters: Record<string, string>, apiSecret: string) {
    const serialized = Object.keys(parameters).sort().map((key) => `${key}=${parameters[key]}`).join("&");
    return createHash("sha1").update(`${serialized}${apiSecret}`).digest("hex");
}

export async function uploadProfileImage(file: File) {
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
    const apiKey = process.env.CLOUDINARY_API_KEY;
    const apiSecret = process.env.CLOUDINARY_API_SECRET;
    if (!cloudName || !apiKey || !apiSecret) throw new Error("Cloudinary configuration is incomplete.");

    const timestamp = Math.floor(Date.now() / 1000).toString();
    const publicId = `profile-${randomBytes(12).toString("hex")}`;
    const parameters = { folder: "freelancex/profiles", public_id: publicId, timestamp };
    const form = new FormData();
    form.append("file", new Blob([await file.arrayBuffer()], { type: file.type }), file.name);
    form.append("api_key", apiKey);
    form.append("timestamp", timestamp);
    form.append("folder", parameters.folder);
    form.append("public_id", publicId);
    form.append("signature", signParameters(parameters, apiSecret));

    const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, { method: "POST", body: form });
    const result = await response.json() as { secure_url?: string; public_id?: string; error?: { message?: string } };
    if (!response.ok || !result.secure_url || !result.public_id) throw new Error(result.error?.message || "Profile image upload failed.");
    return { url: result.secure_url, publicId: result.public_id };
}

export async function validateProjectDeliverable(file: File) {
    if (!allowedDeliverableTypes.has(file.type)) return "Use a PDF, DOCX, XLSX, PPTX, ZIP, TXT, JPG, PNG, or WEBP file.";
    if (file.size === 0) return "Deliverable files cannot be empty.";
    if (file.size > maxDeliverableBytes) return "Each deliverable file must be 10 MB or smaller.";
    if (!file.name.trim() || file.name.length > 180) return "File names must be 1 to 180 characters.";

    const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
    const startsWith = (offset: number, ...signature: number[]) => signature.every((byte, index) => bytes[offset + index] === byte);
    if (file.type === "application/pdf" && !new TextDecoder().decode(bytes).startsWith("%PDF-")) {
        return "The selected file is not a valid PDF.";
    }
    if (file.type === "image/jpeg" && !startsWith(0, 0xff, 0xd8, 0xff)) return "The selected file is not a valid JPEG image.";
    if (file.type === "image/png" && !startsWith(0, 0x89, 0x50, 0x4e, 0x47)) return "The selected file is not a valid PNG image.";
    if (file.type === "image/webp" && !(startsWith(0, 0x52, 0x49, 0x46, 0x46) && startsWith(8, 0x57, 0x45, 0x42, 0x50))) {
        return "The selected file is not a valid WEBP image.";
    }
    if (
        file.type === "application/zip" ||
        file.type === "application/x-zip-compressed" ||
        file.type.startsWith("application/vnd.openxmlformats-officedocument.")
    ) {
        if (!startsWith(0, 0x50, 0x4b, 0x03, 0x04) && !startsWith(0, 0x50, 0x4b, 0x05, 0x06) && !startsWith(0, 0x50, 0x4b, 0x07, 0x08)) {
            return "The selected file is not a valid ZIP or Office document.";
        }
    }
    if (file.type === "text/plain") {
        try {
            const text = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
            if (text.includes("\0")) return "Text files cannot contain binary data.";
        } catch {
            return "Text files must use valid UTF-8 encoding.";
        }
    }
    return null;
}

export async function validateMessageImage(file: File) {
    return validateImageFile(file, "Message image");
}

export async function uploadMessageImage(conversationId: string, file: File): Promise<UploadedMessageImage> {
    const validationError = await validateMessageImage(file);
    if (validationError) throw new Error(validationError);

    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
    const apiKey = process.env.CLOUDINARY_API_KEY;
    const apiSecret = process.env.CLOUDINARY_API_SECRET;
    if (!cloudName || !apiKey || !apiSecret) throw new Error("Cloudinary configuration is incomplete.");

    const timestamp = Math.floor(Date.now() / 1000).toString();
    const publicId = `message-${randomBytes(12).toString("hex")}`;
    const folder = `freelancex/messages/${conversationId}`;
    const parameters = { folder, public_id: publicId, timestamp };
    const form = new FormData();
    const fileName = file.name.replace(/[\\/\u0000-\u001f\u007f]/g, "_").trim();
    form.append("file", new Blob([await file.arrayBuffer()], { type: file.type }), fileName);
    form.append("api_key", apiKey);
    form.append("timestamp", timestamp);
    form.append("folder", folder);
    form.append("public_id", publicId);
    form.append("signature", signParameters(parameters, apiSecret));

    const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
        method: "POST",
        body: form,
        signal: AbortSignal.timeout(30_000),
    });
    const result = await response.json() as { secure_url?: string; public_id?: string; error?: { message?: string } };
    let deliveryUrl: URL | null = null;
    try {
        deliveryUrl = result.secure_url ? new URL(result.secure_url) : null;
    } catch {
        deliveryUrl = null;
    }
    if (!response.ok || !deliveryUrl || deliveryUrl.protocol !== "https:" || deliveryUrl.hostname !== "res.cloudinary.com" || !result.public_id) {
        throw new Error(result.error?.message || "Message image upload failed.");
    }
    return {
        fileName,
        url: deliveryUrl.toString(),
        fileType: file.type,
        fileSize: file.size,
        publicId: result.public_id,
        resourceType: "image",
    };
}

export async function uploadProjectDeliverable(taskId: string, file: File): Promise<UploadedProjectDeliverable> {
    const validationError = await validateProjectDeliverable(file);
    if (validationError) throw new Error(validationError);

    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
    const apiKey = process.env.CLOUDINARY_API_KEY;
    const apiSecret = process.env.CLOUDINARY_API_SECRET;
    if (!cloudName || !apiKey || !apiSecret) throw new Error("Cloudinary configuration is incomplete.");

    const resourceType = file.type.startsWith("image/") ? "image" : "raw";
    const extensionByType: Record<string, string> = {
        "application/pdf": "pdf",
        "application/zip": "zip",
        "application/x-zip-compressed": "zip",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
        "image/jpeg": "jpg",
        "image/png": "png",
        "image/webp": "webp",
        "text/plain": "txt",
    };
    const extension = extensionByType[file.type] || "bin";
    const publicId = `deliverable-${randomBytes(12).toString("hex")}${resourceType === "raw" ? `.${extension}` : ""}`;
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const folder = `freelancex/projects/${taskId}/deliverables`;
    const parameters = { folder, public_id: publicId, timestamp };
    const form = new FormData();
    const fileName = file.name.replace(/[\\/\u0000-\u001f\u007f]/g, "_").trim();
    form.append("file", new Blob([await file.arrayBuffer()], { type: file.type }), fileName);
    form.append("api_key", apiKey);
    form.append("timestamp", timestamp);
    form.append("folder", folder);
    form.append("public_id", publicId);
    form.append("signature", signParameters(parameters, apiSecret));

    const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/${resourceType}/upload`, {
        method: "POST",
        body: form,
        signal: AbortSignal.timeout(30_000),
    });
    const result = await response.json() as { secure_url?: string; public_id?: string; error?: { message?: string } };
    let deliveryUrl: URL | null = null;
    try {
        deliveryUrl = result.secure_url ? new URL(result.secure_url) : null;
    } catch {
        deliveryUrl = null;
    }
    if (
        !response.ok ||
        !deliveryUrl ||
        deliveryUrl.protocol !== "https:" ||
        deliveryUrl.hostname !== "res.cloudinary.com" ||
        !result.public_id
    ) {
        throw new Error(result.error?.message || "Deliverable upload failed.");
    }
    return {
        fileName,
        url: deliveryUrl.toString(),
        fileType: file.type,
        fileSize: file.size,
        publicId: result.public_id,
        resourceType,
    };
}

export async function deleteProjectDeliverable(publicId: string, resourceType: "image" | "raw") {
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
    const apiKey = process.env.CLOUDINARY_API_KEY;
    const apiSecret = process.env.CLOUDINARY_API_SECRET;
    if (!cloudName || !apiKey || !apiSecret) throw new Error("Cloudinary configuration is incomplete.");

    const timestamp = Math.floor(Date.now() / 1000).toString();
    const parameters = { invalidate: "true", public_id: publicId, timestamp };
    const form = new FormData();
    form.append("api_key", apiKey);
    form.append("timestamp", timestamp);
    form.append("public_id", publicId);
    form.append("invalidate", "true");
    form.append("signature", signParameters(parameters, apiSecret));
    const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/${resourceType}/destroy`, {
        method: "POST",
        body: form,
        signal: AbortSignal.timeout(10_000),
    });
    const result = await response.json() as { result?: string; error?: { message?: string } };
    if (!response.ok || (result.result !== "ok" && result.result !== "not found")) {
        throw new Error(result.error?.message || "Cloudinary deliverable cleanup failed.");
    }
}

export async function deleteProfileImages(publicIds: string[]) {
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
    const apiKey = process.env.CLOUDINARY_API_KEY;
    const apiSecret = process.env.CLOUDINARY_API_SECRET;
    if (!cloudName || !apiKey || !apiSecret) throw new Error("Cloudinary configuration is incomplete.");

    for (const publicId of publicIds) {
        const timestamp = Math.floor(Date.now() / 1000).toString();
        const parameters = { invalidate: "true", public_id: publicId, timestamp };
        const form = new FormData();
        form.append("api_key", apiKey);
        form.append("timestamp", timestamp);
        form.append("public_id", publicId);
        form.append("invalidate", "true");
        form.append("signature", signParameters(parameters, apiSecret));

        const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/destroy`, {
            method: "POST",
            body: form,
            signal: AbortSignal.timeout(10_000),
        });
        const result = await response.json() as { result?: string; error?: { message?: string } };
        if (!response.ok || (result.result !== "ok" && result.result !== "not found")) {
            throw new Error(result.error?.message || "Cloudinary profile image deletion failed.");
        }
    }
}