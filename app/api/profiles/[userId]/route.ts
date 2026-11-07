import mongoose from "mongoose";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { connectToDatabase } from "@/lib/mongodb";
import { canShowCompanyInfo, canShowProfileEmail, canViewProfile } from "@/lib/profile-visibility";
import Application from "@/models/Application";
import EmployerProfile from "@/models/EmployerProfile";
import FreelancerProfile from "@/models/FreelancerProfile";
import Review from "@/models/Review";
import Task from "@/models/Task";
import User from "@/models/User";
import UserPreference from "@/models/UserPreference";

export const dynamic = "force-dynamic";

function jsonNoStore(body: unknown, init?: ResponseInit) {
    const response = NextResponse.json(body, init);
    response.headers.set("Cache-Control", "no-store");
    return response;
}

function safeWebsite(value?: string) {
    if (!value) return null;
    try {
        const url = new URL(value);
        return ["http:", "https:"].includes(url.protocol) ? url.toString() : null;
    } catch {
        return null;
    }
}

export async function GET(_request: Request, context: { params: Promise<{ userId: string }> }) {
    const viewer = await getCurrentUser();
    if (!viewer) return jsonNoStore({ error: "Authentication required." }, { status: 401 });

    const { userId } = await context.params;
    if (!mongoose.Types.ObjectId.isValid(userId)) return jsonNoStore({ error: "Profile not found." }, { status: 404 });

    try {
        await connectToDatabase();
        const target = await User.findById(userId)
            .select("_id name email role country city isVerified isActive createdAt rating reviewCount")
            .lean();
        if (!target || !target.isActive || (target.role !== "employer" && target.role !== "freelancer")) {
            return jsonNoStore({ error: "Profile not found." }, { status: 404 });
        }

        const isOwner = viewer.userId === target._id.toString();
        const isAdmin = viewer.role === "admin";
        const settings = await UserPreference.findOne({ user: target._id })
            .select("profileVisibility emailVisibility companyInfoVisibility")
            .lean();
        let hasRelevantRelationship = false;
        if (!isOwner && !isAdmin) {
            if (viewer.role === "freelancer" && target.role === "employer") {
                hasRelevantRelationship = Boolean(await Task.exists({
                    employer: target._id,
                    isDeleted: { $ne: true },
                    $or: [{ status: "open" }, { freelancer: viewer.userId }],
                }));
            } else if (viewer.role === "employer" && target.role === "freelancer") {
                const [application, assignedTask] = await Promise.all([
                    Application.exists({ employer: viewer.userId, freelancer: target._id }),
                    Task.exists({ employer: viewer.userId, freelancer: target._id, isDeleted: { $ne: true } }),
                ]);
                hasRelevantRelationship = Boolean(application || assignedTask);
            }
        }
        if (!canViewProfile(settings || {}, isOwner, isAdmin, hasRelevantRelationship)) {
            return jsonNoStore({ error: "Profile not found." }, { status: 404 });
        }

        const publicIdentity = {
            id: target._id.toString(),
            name: target.name,
            location: [target.city, target.country].filter(Boolean).join(", "),
            verified: target.isVerified,
            memberSince: target.createdAt,
            ...(canShowProfileEmail(settings || {}) ? { email: target.email } : {}),
        };

        if (target.role === "freelancer") {
            const [profile, completedProjects, reviews] = await Promise.all([
                FreelancerProfile.findOne({ user: target._id })
                    .select("professionalTitle category skills experienceLevel bio workType availability hourlyRate portfolioUrl githubUrl linkedinUrl profileImage")
                    .lean(),
                Task.countDocuments({ freelancer: target._id, status: "completed", isDeleted: { $ne: true } }),
                Review.find({ freelancer: target._id })
                    .select("rating comment createdAt project")
                    .populate("project", "title")
                    .sort({ createdAt: -1 })
                    .limit(10)
                    .lean(),
            ]);
            return jsonNoStore({
                profile: {
                    ...publicIdentity,
                    role: "freelancer",
                    professionalTitle: profile?.professionalTitle || "",
                    category: profile?.category || "",
                    skills: profile?.skills || [],
                    experienceLevel: profile?.experienceLevel || "",
                    bio: profile?.bio || "",
                    workType: profile?.workType || "",
                    availability: profile?.availability || "",
                    hourlyRate: profile?.hourlyRate ?? null,
                    portfolioUrl: safeWebsite(profile?.portfolioUrl),
                    githubUrl: safeWebsite(profile?.githubUrl),
                    linkedinUrl: safeWebsite(profile?.linkedinUrl),
                    profileImage: profile?.profileImage || null,
                    completedProjects,
                    rating: typeof target.rating === "number" && target.reviewCount ? target.rating : null,
                    reviewCount: target.reviewCount || 0,
                    reviews: reviews.map((review) => ({
                        rating: review.rating,
                        comment: review.comment,
                        createdAt: review.createdAt,
                        projectTitle: review.project && typeof review.project === "object" && "title" in review.project ? review.project.title : null,
                    })),
                },
            });
        }

        const [profile, projectCount, completedProjects] = await Promise.all([
            EmployerProfile.findOne({ user: target._id })
                .select("accountType companyName industry companyDescription companyWebsite companySize profileImage")
                .lean(),
            Task.countDocuments({ employer: target._id, isDeleted: { $ne: true } }),
            Task.countDocuments({ employer: target._id, status: "completed", isDeleted: { $ne: true } }),
        ]);
        const showCompanyInfo = canShowCompanyInfo(settings || {});
        return jsonNoStore({
            profile: {
                ...publicIdentity,
                role: "employer",
                profileImage: profile?.profileImage || null,
                ...(showCompanyInfo ? {
                    accountType: profile?.accountType || "",
                    companyName: profile?.companyName || "",
                    industry: profile?.industry || "",
                    companyDescription: profile?.companyDescription || "",
                    companyWebsite: safeWebsite(profile?.companyWebsite),
                    companySize: profile?.companySize || "",
                } : {}),
                projectCount,
                completedProjects,
                rating: null,
                reviewCount: 0,
                reviews: [],
            },
        });
    } catch (error) {
        console.error("Public profile retrieval error:", error);
        return jsonNoStore({ error: "Profile is temporarily unavailable." }, { status: 503 });
    }
}
