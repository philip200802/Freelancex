import { createHash, randomBytes } from "crypto";

const allowedImageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const maxImageBytes = 5 * 1024 * 1024;

export async function validateProfileImage(file: File) {
    if (!allowedImageTypes.has(file.type)) return "Profile image must be JPG, JPEG, PNG, or WEBP.";
    if (file.size > maxImageBytes) return "Profile image must be 5 MB or smaller.";
    if (file.size === 0) return "Profile image cannot be empty.";
    const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
    const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    const isPng = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
    const isWebp = bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
    if (!isJpeg && !isPng && !isWebp) return "The selected file is not a valid JPG, PNG, or WEBP image.";
    return null;
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