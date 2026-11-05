import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { randomBytes, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { processAccountRemovalEmails } from "@/lib/admin-email-outbox";
import { processProfileImageCleanup } from "@/lib/profile-image-cleanup";
import { getCurrentUser } from "@/lib/current-user";
import { connectToDatabase } from "@/lib/mongodb";
import AdminActivityLog from "@/models/AdminActivityLog";
import BankAccount from "@/models/BankAccount";
import Application from "@/models/Application";
import Conversation from "@/models/Conversation";
import EmailOutbox from "@/models/EmailOutbox";
import EmployerProfile from "@/models/EmployerProfile";
import FreelancerProfile from "@/models/FreelancerProfile";
import Message from "@/models/Message";
import Notification from "@/models/Notification";
import PaymentTransaction from "@/models/PaymentTransaction";
import ProfileImageDeletion from "@/models/ProfileImageDeletion";
import type { IConversation } from "@/models/Conversation";
import Review from "@/models/Review";
import Task from "@/models/Task";
import UserPreference from "@/models/UserPreference";
import User from "@/models/User";

export const dynamic = "force-dynamic";

function jsonNoStore(body: unknown, init?: ResponseInit) {
    const response = NextResponse.json(body, init);
    response.headers.set("Cache-Control", "no-store");
    return response;
}

export async function GET(_request: Request, context: { params: Promise<{ userId: string }> }) {
    try {
        const admin = await getCurrentUser();
        if (!admin) return jsonNoStore({ error: "Authentication required." }, { status: 401 });
        if (admin.role !== "admin") return jsonNoStore({ error: "Admin access required." }, { status: 403 });

        const { userId } = await context.params;
        if (!mongoose.Types.ObjectId.isValid(userId)) return jsonNoStore({ error: "User not found." }, { status: 404 });

        await connectToDatabase();
        const user = await User.findById(userId)
            .select("name email role isVerified isActive country city createdAt")
            .lean();
        if (!user || user.isActive === false) return jsonNoStore({ error: "User not found." }, { status: 404 });

        let profile: Record<string, unknown> | null = null;
        if (user.role === "freelancer") {
            const freelancer = await FreelancerProfile.findOne({ user: user._id })
                .select("professionalTitle bio skills category experienceLevel portfolioUrl profileImage")
                .lean();
            if (freelancer) {
                profile = {
                    professionalTitle: freelancer.professionalTitle,
                    bio: freelancer.bio,
                    skills: freelancer.skills,
                    category: freelancer.category,
                    experienceLevel: freelancer.experienceLevel,
                    portfolioUrl: freelancer.portfolioUrl,
                    profileImage: freelancer.profileImage,
                };
            }
        } else if (user.role === "employer") {
            const employer = await EmployerProfile.findOne({ user: user._id })
                .select("accountType companyName industry companyWebsite companySize position occupation hiringCategories hiringFrequency hiringPurpose profileImage")
                .lean();
            if (employer) {
                profile = {
                    accountType: employer.accountType,
                    companyName: employer.companyName,
                    industry: employer.industry,
                    companyWebsite: employer.companyWebsite,
                    companySize: employer.companySize,
                    position: employer.position,
                    occupation: employer.occupation,
                    hiringCategories: employer.hiringCategories,
                    hiringFrequency: employer.hiringFrequency,
                    hiringPurpose: employer.hiringPurpose,
                    profileImage: employer.profileImage,
                };
            }
        }

        return jsonNoStore({
            user: {
                id: user._id.toString(),
                name: user.name,
                email: user.email,
                role: user.role,
                isVerified: user.isVerified,
                isActive: user.isActive !== false,
                country: user.country,
                city: user.city,
                createdAt: user.createdAt,
            },
            profile,
        });
    } catch (error) {
        console.error("Admin user detail error:", error);
        return jsonNoStore({ error: "User details are temporarily unavailable." }, { status: 503 });
    }
}

export async function DELETE(request: Request, context: { params: Promise<{ userId: string }> }) {
    try {
        const admin = await getCurrentUser();
        if (!admin) return jsonNoStore({ error: "Authentication required." }, { status: 401 });
        if (admin.role !== "admin") return jsonNoStore({ error: "Admin access required." }, { status: 403 });

        const { userId } = await context.params;
        if (!mongoose.Types.ObjectId.isValid(userId)) return jsonNoStore({ error: "User not found." }, { status: 404 });
        if (new mongoose.Types.ObjectId(userId).equals(admin.userId)) {
            return jsonNoStore({ error: "You cannot remove your own account." }, { status: 403 });
        }

        let reason: string | undefined;
        try {
            const body = await request.json() as { reason?: unknown };
            if (body.reason !== undefined && typeof body.reason !== "string") {
                return jsonNoStore({ error: "Removal reason must be text." }, { status: 400 });
            }
            reason = typeof body.reason === "string" ? body.reason.trim() : undefined;
            if (reason && reason.length > 1000) {
                return jsonNoStore({ error: "Removal reason must be 1000 characters or fewer." }, { status: 400 });
            }
        } catch {
            return jsonNoStore({ error: "A valid JSON request body is required." }, { status: 400 });
        }

        await connectToDatabase();
        const target = await User.findById(userId).select("name firstName lastName email role isActive").lean();
        if (!target || target.isActive === false) return jsonNoStore({ error: "Active user not found." }, { status: 404 });

        const tombstonePassword = await bcrypt.hash(randomBytes(64).toString("hex"), 12);
        const session = await mongoose.startSession();
        let outboxId: string | undefined;
        let mediaCleanupId: string | undefined;
        try {
            await session.withTransaction(async () => {
                const currentAdmin = await User.findOne({
                    _id: admin.userId,
                    role: "admin",
                    isActive: { $ne: false },
                }).select("name").session(session);
                if (!currentAdmin) throw new Error("ADMIN_UNAUTHORIZED");
                const currentTarget = await User.findOne({ _id: userId, isActive: { $ne: false } }).session(session);
                if (!currentTarget) throw new Error("USER_NOT_FOUND");
                if (currentTarget.role === "admin") {
                    const guardAdmin = await User.findOne({ role: "admin", isActive: { $ne: false } })
                        .sort({ _id: 1 })
                        .select("_id")
                        .session(session);
                    if (!guardAdmin) throw new Error("LAST_ACTIVE_ADMIN");
                    await User.updateOne({ _id: guardAdmin._id }, { $inc: { adminRemovalGuard: 1 } }, { session });
                    const activeAdmins = await User.countDocuments({ role: "admin", isActive: { $ne: false } }).session(session);
                    if (activeAdmins <= 1) throw new Error("LAST_ACTIVE_ADMIN");
                }

                const archivedUser = new User({
                    name: "Former user",
                    firstName: "Former",
                    lastName: "user",
                    email: `removed+${randomUUID()}@users.invalid`,
                    passwordHash: tombstonePassword,
                    role: currentTarget.role,
                    bio: "",
                    skills: [],
                    country: "Removed",
                    city: "Removed",
                    termsAcceptedAt: new Date(),
                    termsVersion: "account-removal",
                    privacyPolicyVersion: "account-removal",
                    isVerified: false,
                    isActive: false,
                    welcomeEmailSent: false,
                });
                await archivedUser.save({ session });

                await Task.updateMany(
                    { employer: currentTarget._id },
                    { $set: { employer: archivedUser._id, employerNameSnapshot: currentTarget.name } },
                    { session },
                );
                await Task.updateMany(
                    { freelancer: currentTarget._id },
                    { $set: { freelancer: archivedUser._id, freelancerNameSnapshot: currentTarget.name } },
                    { session },
                );
                await Task.updateMany(
                    { employer: archivedUser._id, status: { $in: ["open", "pending_approval", "awaiting_funding"] } },
                    { $set: { status: "cancelled" } },
                    { session },
                );
                await Task.updateMany(
                    { freelancer: archivedUser._id, status: "awaiting_funding" },
                    { $set: { status: "cancelled" } },
                    { session },
                );

                await Application.updateMany(
                    { employer: currentTarget._id },
                    { $set: { employer: archivedUser._id, employerNameSnapshot: currentTarget.name, status: "rejected" } },
                    { session },
                );
                await Application.updateMany(
                    { freelancer: currentTarget._id },
                    { $set: { freelancer: archivedUser._id, freelancerNameSnapshot: currentTarget.name, status: "rejected" } },
                    { session },
                );

                const conversations = await Conversation.find({ participants: currentTarget._id }).session(session);
                for (const conversation of conversations) {
                    const participantSnapshots = conversation.participantSnapshots ?? [];
                    const hasSnapshot = participantSnapshots.some((item: IConversation["participantSnapshots"][number]) => item.userId === userId);
                    conversation.participants = conversation.participants.map((participant: mongoose.Types.ObjectId) =>
                        participant.equals(currentTarget._id) ? archivedUser._id : participant,
                    );
                    if (!hasSnapshot) {
                        participantSnapshots.push({
                            userId,
                            archivedUserId: archivedUser._id.toString(),
                            name: currentTarget.name,
                            role: currentTarget.role,
                        });
                    }
                    conversation.participantSnapshots = participantSnapshots;
                    await conversation.save({ session });
                }

                await Message.updateMany(
                    { sender: currentTarget._id },
                    {
                        $set: { sender: archivedUser._id, senderNameSnapshot: currentTarget.name, senderRoleSnapshot: currentTarget.role },
                    },
                    { session },
                );
                await Message.updateMany(
                    { readBy: currentTarget._id },
                    { $pull: { readBy: currentTarget._id } },
                    { session },
                );

                await Review.updateMany(
                    { client: currentTarget._id },
                    { $set: { client: archivedUser._id, clientNameSnapshot: currentTarget.name } },
                    { session },
                );
                await Review.updateMany(
                    { freelancer: currentTarget._id },
                    { $set: { freelancer: archivedUser._id, freelancerNameSnapshot: currentTarget.name } },
                    { session },
                );
                await PaymentTransaction.updateMany(
                    { employer: currentTarget._id },
                    { $set: { employer: archivedUser._id, employerNameSnapshot: currentTarget.name } },
                    { session },
                );
                await PaymentTransaction.updateMany(
                    { freelancer: currentTarget._id },
                    { $set: { freelancer: archivedUser._id, freelancerNameSnapshot: currentTarget.name } },
                    { session },
                );

                await Notification.deleteMany({ recipient: currentTarget._id }, { session });
                await Notification.updateMany(
                    { actor: currentTarget._id },
                    { $set: { actor: archivedUser._id, actorNameSnapshot: currentTarget.name } },
                    { session },
                );

                await AdminActivityLog.updateMany(
                    { adminId: currentTarget._id },
                    { $set: { adminNameSnapshot: currentTarget.name }, $unset: { adminId: 1 } },
                    { session },
                );

                const employerProfile = await EmployerProfile.findOne({ user: currentTarget._id }).select("profileImagePublicId").session(session).lean();
                const freelancerProfile = await FreelancerProfile.findOne({ user: currentTarget._id }).select("profileImagePublicId").session(session).lean();
                const profileImagePublicIds = [...new Set(
                    [employerProfile?.profileImagePublicId, freelancerProfile?.profileImagePublicId]
                        .filter((publicId): publicId is string => Boolean(publicId)),
                )];
                if (profileImagePublicIds.length) {
                    const cleanup = await ProfileImageDeletion.create([{
                        publicIds: profileImagePublicIds,
                        status: "pending",
                        attempts: 0,
                        nextAttemptAt: new Date(),
                    }], { session });
                    mediaCleanupId = cleanup[0]._id.toString();
                }

                await EmployerProfile.deleteOne({ user: currentTarget._id }, { session });
                await FreelancerProfile.deleteOne({ user: currentTarget._id }, { session });
                await UserPreference.deleteOne({ user: currentTarget._id }, { session });
                await BankAccount.deleteOne({ user: currentTarget._id }, { session });

                const outbox = await EmailOutbox.create([{
                    type: "account_removed",
                    to: currentTarget.email,
                    recipientName: currentTarget.name,
                    reason,
                    status: "pending",
                    attempts: 0,
                    nextAttemptAt: new Date(),
                }], { session });
                outboxId = outbox[0]._id.toString();

                await new AdminActivityLog({
                    adminId: admin.userId,
                    adminNameSnapshot: currentAdmin.name,
                    action: "user.permanently_removed",
                    targetUserId: userId,
                    targetUserNameSnapshot: currentTarget.name,
                    description: reason
                        ? `Permanently removed ${currentTarget.name}. Reason: ${reason}`
                        : `Permanently removed ${currentTarget.name}.`,
                    metadata: { targetRole: currentTarget.role },
                }).save({ session });

                const deleted = await User.deleteOne({ _id: currentTarget._id, isActive: { $ne: false } }, { session });
                if (deleted.deletedCount !== 1) throw new Error("USER_NOT_FOUND");
            });
        } catch (error) {
            if (error instanceof Error && error.message === "LAST_ACTIVE_ADMIN") {
                return jsonNoStore({ error: "The last active admin account cannot be removed." }, { status: 409 });
            }
            if (error instanceof Error && error.message === "USER_NOT_FOUND") {
                return jsonNoStore({ error: "Active user not found." }, { status: 404 });
            }
            if (error instanceof Error && error.message === "ADMIN_UNAUTHORIZED") {
                return jsonNoStore({ error: "Admin access required." }, { status: 403 });
            }
            throw error;
        } finally {
            await session.endSession();
        }

        let emailStatus: "sent" | "queued" = "queued";
        if (outboxId) {
            try {
                const delivery = await processAccountRemovalEmails(1, outboxId);
                if (delivery.sent > 0) emailStatus = "sent";
            } catch (error) {
                console.error("Account removal email remains queued after immediate delivery failed:", {
                    outboxId,
                    errorName: error instanceof Error ? error.name : "UnknownError",
                });
            }
        }
        let profileImagesStatus: "deleted" | "queued" | "not_applicable" = mediaCleanupId ? "queued" : "not_applicable";
        if (mediaCleanupId) {
            try {
                const cleanup = await processProfileImageCleanup(1, mediaCleanupId);
                if (cleanup.completed > 0) profileImagesStatus = "deleted";
            } catch (error) {
                console.error("Profile image cleanup remains queued after immediate delivery failed:", {
                    cleanupId: mediaCleanupId,
                    errorName: error instanceof Error ? error.name : "UnknownError",
                });
            }
        }
        return jsonNoStore({
            success: true,
            emailStatus,
            profileImagesStatus,
            message: emailStatus === "sent"
                ? `User account permanently removed. The notification email was sent${profileImagesStatus === "queued" ? "; profile image removal is queued." : "."}`
                : `User account permanently removed. The notification email is queued for retry${profileImagesStatus === "queued" ? "; profile image removal is also queued." : "."}`,
        });
    } catch (error) {
        console.error("Admin user removal error:", error);
        return jsonNoStore({ error: "The user account could not be removed due to an unexpected error." }, { status: 500 });
    }
}
