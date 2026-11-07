"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";

type Review = { rating: number; comment: string; createdAt: string; projectTitle: string | null };
type PublicProfile = {
    id: string;
    role: "employer" | "freelancer";
    name: string;
    location: string;
    verified: boolean;
    memberSince: string;
    email?: string;
    profileImage: string | null;
    companyName?: string;
    accountType?: string;
    industry?: string;
    companyDescription?: string;
    companyWebsite?: string | null;
    companySize?: string;
    projectCount?: number;
    professionalTitle?: string;
    category?: string;
    skills?: string[];
    experienceLevel?: string;
    bio?: string;
    workType?: string;
    availability?: string;
    hourlyRate?: number | null;
    portfolioUrl?: string | null;
    githubUrl?: string | null;
    linkedinUrl?: string | null;
    completedProjects: number;
    rating: number | null;
    reviewCount: number;
    reviews: Review[];
};

function formatMemberDate(value: string) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "Unavailable" : new Intl.DateTimeFormat(undefined, { year: "numeric", month: "long" }).format(date);
}

export default function ProfileView({ userId, viewerRole }: { userId: string; viewerRole: "employer" | "freelancer" | "admin" }) {
    const [profile, setProfile] = useState<PublicProfile | null>(null);
    const [state, setState] = useState<"loading" | "ready" | "error">("loading");
    const [error, setError] = useState("");

    useEffect(() => {
        const controller = new AbortController();
        async function load() {
            try {
                const response = await fetch(`/api/profiles/${encodeURIComponent(userId)}`, { cache: "no-store", signal: controller.signal });
                const result = await response.json() as { profile?: PublicProfile; error?: string };
                if (!response.ok || !result.profile) throw new Error(result.error || "Profile is unavailable.");
                if (controller.signal.aborted) return;
                setProfile(result.profile);
                setState("ready");
            } catch (loadError) {
                if (controller.signal.aborted) return;
                setError(loadError instanceof Error ? loadError.message : "Profile is unavailable.");
                setState("error");
            }
        }
        void load();
        return () => controller.abort();
    }, [userId]);

    if (state === "loading") return <section className="public-profile-card" role="status">Loading profile...</section>;
    if (state === "error" || !profile) return <section className="public-profile-card" role="alert"><strong>Profile unavailable</strong><p>{error}</p></section>;

    const backHref = viewerRole === "employer"
        ? "/client/dashboard/applications"
        : viewerRole === "freelancer" ? "/freelancer/dashboard/jobs" : "/admin/dashboard";

    return <section className="public-profile">
        <Link className="button button-quiet public-profile-back" href={backHref}>Back</Link>
        <article className="public-profile-card">
            <header className="public-profile-header">
                {profile.profileImage
                    ? <Image alt={`${profile.name} profile`} className="public-profile-avatar" height={96} src={profile.profileImage} unoptimized width={96} />
                    : <div aria-hidden="true" className="public-profile-avatar public-profile-avatar-placeholder">{profile.name.charAt(0).toUpperCase()}</div>}
                <div className="public-profile-identity">
                    <span className="panel-kicker">{profile.role === "freelancer" ? "Freelancer profile" : "Client profile"}</span>
                    <h2>{profile.name}</h2>
                    {profile.role === "freelancer" && profile.professionalTitle && <p>{profile.professionalTitle}</p>}
                    <div className="public-profile-badges">
                        <span className={`profile-verification-badge${profile.verified ? " is-verified" : ""}`}>{profile.verified ? "Verified email" : "Not verified"}</span>
                        {profile.role === "freelancer" && profile.availability && <span className="status-badge">{profile.availability}</span>}
                    </div>
                </div>
            </header>

            <dl className="public-profile-facts">
                <div><dt>Location</dt><dd>{profile.location || "Not provided"}</dd></div>
                <div><dt>Member since</dt><dd>{formatMemberDate(profile.memberSince)}</dd></div>
                {profile.role === "employer" && <>
                    <div><dt>Projects posted</dt><dd>{profile.projectCount}</dd></div>
                    <div><dt>Completed projects</dt><dd>{profile.completedProjects}</dd></div>
                </>}
                {profile.role === "freelancer" && <>
                    <div><dt>Experience</dt><dd>{profile.experienceLevel || "Not provided"}</dd></div>
                    <div><dt>Completed projects</dt><dd>{profile.completedProjects}</dd></div>
                    <div><dt>Rating</dt><dd>{profile.rating === null ? "No reviews yet" : `${profile.rating.toFixed(1)} / 5 (${profile.reviewCount})`}</dd></div>
                </>}
            </dl>

            {profile.role === "employer" ? <section className="public-profile-section">
                <h3>{profile.companyName || "Professional details"}</h3>
                {profile.industry && <p className="public-profile-industry">{profile.industry}{profile.accountType ? ` · ${profile.accountType}` : ""}{profile.companySize ? ` · ${profile.companySize} employees` : ""}</p>}
                {profile.companyDescription && <p className="public-profile-bio">{profile.companyDescription}</p>}
                {profile.companyWebsite && <a className="text-link" href={profile.companyWebsite} rel="noreferrer" target="_blank">Company website</a>}
            </section> : <section className="public-profile-section">
                {profile.bio && <><h3>About</h3><p className="public-profile-bio">{profile.bio}</p></>}
                {profile.category && <p><strong>Specialty:</strong> {profile.category}</p>}
                {!!profile.skills?.length && <div><h3>Skills</h3><ul className="public-profile-skills">{profile.skills.map((skill) => <li key={skill}>{skill}</li>)}</ul></div>}
                <div className="public-profile-links">
                    {profile.portfolioUrl && <a className="text-link" href={profile.portfolioUrl} rel="noreferrer" target="_blank">Portfolio</a>}
                    {profile.githubUrl && <a className="text-link" href={profile.githubUrl} rel="noreferrer" target="_blank">GitHub</a>}
                    {profile.linkedinUrl && <a className="text-link" href={profile.linkedinUrl} rel="noreferrer" target="_blank">LinkedIn</a>}
                </div>
            </section>}

            {profile.email && <section className="public-profile-contact"><h3>Contact</h3><a href={`mailto:${profile.email}`}>{profile.email}</a></section>}

            {profile.role === "freelancer" && <section className="public-profile-section">
                <h3>Reviews</h3>
                {profile.reviews.length ? <ul className="public-profile-reviews">{profile.reviews.map((review, index) => <li key={`${review.createdAt}-${index}`}>
                    <div><strong>{review.rating} / 5</strong><time>{formatMemberDate(review.createdAt)}</time></div>
                    {review.projectTitle && <span>{review.projectTitle}</span>}
                    <p>{review.comment}</p>
                </li>)}</ul> : <p className="muted-copy">No reviews yet.</p>}
            </section>}
        </article>
    </section>;
}
