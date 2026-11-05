"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

type AdminUser = {
    id: string;
    name: string;
    email: string;
    role: "freelancer" | "employer" | "admin";
    isVerified: boolean;
    isActive: boolean;
    createdAt: string;
    profileImage: string | null;
};

type UserDetails = {
    user: Omit<AdminUser, "profileImage"> & { country?: string; city?: string };
    profile: Record<string, unknown> | null;
};

type Pagination = { page: number; limit: number; total: number; totalPages: number };
type UserResponse = { users?: AdminUser[]; pagination?: Pagination; error?: string };

function Spinner({ label }: { label?: string }) {
    return <span aria-label={label || "Loading"} className="admin-users-spinner" role="status" />;
}

function formatDate(value: string) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "Not provided" : date.toLocaleDateString();
}

function displayValue(value: unknown) {
    if (typeof value !== "string" || !value.trim()) return "Not provided";
    return value;
}

function DetailField({ label, value }: { label: string; value: unknown }) {
    return <div className="admin-user-detail-field"><dt>{label}</dt><dd>{displayValue(value)}</dd></div>;
}

export default function AdminUsersPage() {
    const [users, setUsers] = useState<AdminUser[]>([]);
    const [pagination, setPagination] = useState<Pagination>({ page: 1, limit: 20, total: 0, totalPages: 1 });
    const [query, setQuery] = useState("");
    const [role, setRole] = useState("all");
    const [verification, setVerification] = useState("all");
    const [page, setPage] = useState(1);
    const [retry, setRetry] = useState(0);
    const [loading, setLoading] = useState(true);
    const [hasLoaded, setHasLoaded] = useState(false);
    const [error, setError] = useState("");
    const [toast, setToast] = useState("");
    const [detailsId, setDetailsId] = useState("");
    const [detailsRetry, setDetailsRetry] = useState(0);
    const [details, setDetails] = useState<UserDetails | null>(null);
    const [detailsLoading, setDetailsLoading] = useState(false);
    const [detailsError, setDetailsError] = useState("");
    const [removingUser, setRemovingUser] = useState<AdminUser | null>(null);
    const [isRemoving, setIsRemoving] = useState(false);
    const [removeError, setRemoveError] = useState("");
    const [removalReason, setRemovalReason] = useState("");

    useEffect(() => {
        const controller = new AbortController();
        const timer = window.setTimeout(async () => {
            setLoading(true);
            setError("");
            try {
                const params = new URLSearchParams({
                    q: query.trim(),
                    role,
                    verification,
                    page: String(page),
                    limit: String(pagination.limit),
                });
                const response = await fetch(`/api/admin/users?${params}`, { cache: "no-store", signal: controller.signal });
                const result = await response.json() as UserResponse;
                if (!response.ok || !Array.isArray(result.users) || !result.pagination) {
                    throw new Error(result.error || "Users could not be loaded.");
                }
                if (controller.signal.aborted) return;
                setUsers(result.users);
                setPagination(result.pagination);
                setHasLoaded(true);
                if (page > result.pagination.totalPages) setPage(result.pagination.totalPages);
            } catch (loadError) {
                if (controller.signal.aborted) return;
                setError(loadError instanceof Error ? loadError.message : "Users could not be loaded.");
                setHasLoaded(true);
            } finally {
                if (!controller.signal.aborted) setLoading(false);
            }
        }, 250);

        return () => {
            window.clearTimeout(timer);
            controller.abort();
        };
    }, [page, pagination.limit, query, retry, role, verification]);

    useEffect(() => {
        if (!detailsId) return;
        const controller = new AbortController();
        async function loadDetails() {
            setDetailsLoading(true);
            setDetailsError("");
            setDetails(null);
            try {
                const response = await fetch(`/api/admin/users/${detailsId}`, { cache: "no-store", signal: controller.signal });
                const result = await response.json() as UserDetails & { error?: string };
                if (!response.ok || !result.user) throw new Error(result.error || "User details could not be loaded.");
                if (!controller.signal.aborted) setDetails(result);
            } catch (loadError) {
                if (!controller.signal.aborted) setDetailsError(loadError instanceof Error ? loadError.message : "User details could not be loaded.");
            } finally {
                if (!controller.signal.aborted) setDetailsLoading(false);
            }
        }
        void loadDetails();
        return () => controller.abort();
    }, [detailsId, detailsRetry]);

    useEffect(() => {
        if (!toast) return;
        const timer = window.setTimeout(() => setToast(""), 4000);
        return () => window.clearTimeout(timer);
    }, [toast]);

    async function confirmRemoval() {
        if (!removingUser || isRemoving) return;
        setIsRemoving(true);
        setRemoveError("");
        try {
            const response = await fetch(`/api/admin/users/${removingUser.id}`, {
                method: "DELETE",
                cache: "no-store",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ reason: removalReason.trim() || undefined }),
            });
            const result = await response.json() as { success?: boolean; message?: string; error?: string };
            if (!response.ok || !result.success) throw new Error(result.error || "The user account could not be removed.");
            setRemovingUser(null);
            setRemovalReason("");
            setToast(result.message || "User account permanently removed.");
            if (users.length === 1 && page > 1) setPage((current) => current - 1);
            else setRetry((current) => current + 1);
        } catch (requestError) {
            setRemoveError(requestError instanceof Error ? requestError.message : "The user account could not be removed.");
        } finally {
            setIsRemoving(false);
        }
    }

    function openDetails(userId: string) {
        setDetailsId(userId);
    }

    function closeDetails() {
        setDetailsId("");
        setDetails(null);
        setDetailsError("");
    }

    const hasFilters = Boolean(query.trim() || role !== "all" || verification !== "all");

    return <section className="admin-users">
        <div className="admin-users-toolbar">
            <label className="admin-users-search">
                <span>Search users</span>
                <input className="filter-input" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="Search by name or email" />
            </label>
            <label>
                <span>Role</span>
                <select className="filter-input" value={role} onChange={(event) => { setRole(event.target.value); setPage(1); }}>
                    <option value="all">All roles</option>
                    <option value="freelancer">Freelancer</option>
                    <option value="employer">Employer</option>
                    <option value="admin">Admin</option>
                </select>
            </label>
            <label>
                <span>Verification</span>
                <select className="filter-input" value={verification} onChange={(event) => { setVerification(event.target.value); setPage(1); }}>
                    <option value="all">All statuses</option>
                    <option value="verified">Verified</option>
                    <option value="unverified">Unverified</option>
                </select>
            </label>
            <div className="admin-users-count" aria-live="polite">
                {loading && hasLoaded && <Spinner label="Updating users" />}
                <span>{pagination.total} {pagination.total === 1 ? "user" : "users"}</span>
            </div>
        </div>

        {error && <div className="admin-users-error" role="alert"><span>{error}</span><button className="button button-quiet" onClick={() => setRetry((current) => current + 1)} type="button">Retry</button></div>}

        <section className="dashboard-panel admin-users-panel" aria-label="User records">
            {!hasLoaded && loading ? <div className="admin-users-loading" role="status"><Spinner label="Loading users" /><span>Loading users...</span></div> : !error && users.length === 0 ? <div className="dashboard-empty"><strong>{hasFilters ? "No users found." : "No users found."}</strong><p>{hasFilters ? "Try changing your search or filters." : "There are no active user accounts to display."}</p></div> : !error && <>
                <div className="admin-users-table" role="table" aria-label="Users">
                    <div className="admin-users-row admin-users-header" role="row">
                        <span role="columnheader">User</span><span role="columnheader">Email</span><span role="columnheader">Role</span><span role="columnheader">Verification</span><span role="columnheader">Joined</span><span role="columnheader">Actions</span>
                    </div>
                    {users.map((user) => <div className="admin-users-row" role="row" key={user.id}>
                        <div className="admin-users-identity" data-label="User" role="cell">
                            {user.profileImage ? <Image className="admin-users-avatar" src={user.profileImage} alt="" width={40} height={40} unoptimized /> : <span className="admin-users-avatar admin-users-avatar-fallback" aria-hidden="true">{user.name.trim().charAt(0).toUpperCase() || "?"}</span>}
                            <span className="admin-users-name" title={user.name}>{user.name}</span>
                        </div>
                        <span className="admin-users-email" data-label="Email" role="cell" title={user.email}>{user.email}</span>
                        <span data-label="Role" role="cell"><span className={`admin-users-badge role-${user.role}`}>{user.role === "employer" ? "Employer" : user.role === "admin" ? "Admin" : "Freelancer"}</span></span>
                        <span data-label="Verification" role="cell"><span className={`admin-users-badge ${user.isVerified ? "verified" : "unverified"}`}>{user.isVerified ? "Verified" : "Unverified"}</span></span>
                        <span className="admin-users-date" data-label="Joined" role="cell">{formatDate(user.createdAt)}</span>
                        <div className="admin-users-actions" data-label="Actions" role="cell">
                            <button className="button button-quiet" onClick={() => openDetails(user.id)} type="button">View Details</button>
                            <button className="button button-quiet admin-users-remove" onClick={() => { setRemovingUser(user); setRemoveError(""); }} type="button">Remove</button>
                        </div>
                    </div>)}
                </div>
                {loading && hasLoaded && <div className="admin-users-refreshing" role="status"><Spinner label="Refreshing users" />Updating results...</div>}
                <div className="admin-users-pagination">
                    <span>Page {pagination.page} of {pagination.totalPages}</span>
                    <div>
                        <button className="button button-quiet" disabled={page <= 1 || loading} onClick={() => setPage((current) => Math.max(1, current - 1))} type="button">Previous</button>
                        <button className="button button-quiet" disabled={page >= pagination.totalPages || loading} onClick={() => setPage((current) => current + 1)} type="button">Next</button>
                    </div>
                </div>
            </>}
        </section>

        {toast && <div className="admin-users-toast" role="status">{toast}</div>}

        {detailsId && <div className="admin-users-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) closeDetails(); }}>
            <section aria-labelledby="admin-user-details-title" aria-modal="true" className="admin-users-dialog" role="dialog">
                <div className="admin-users-dialog-heading"><h2 id="admin-user-details-title">User details</h2><button className="button button-quiet" onClick={closeDetails} type="button" aria-label="Close user details">&times;</button></div>
                {detailsLoading && <div className="admin-users-loading" role="status"><Spinner label="Loading user details" /><span>Loading user details...</span></div>}
                {detailsError && <div className="admin-users-error" role="alert"><span>{detailsError}</span><button className="button button-quiet" onClick={() => setDetailsRetry((current) => current + 1)} type="button">Retry</button></div>}
                {details && <>
                    <div className="admin-users-detail-identity">
                        {details.profile?.profileImage && typeof details.profile.profileImage === "string"
                            ? <Image className="admin-users-avatar admin-users-avatar-large" src={details.profile.profileImage} alt="" width={64} height={64} unoptimized />
                            : <span className="admin-users-avatar admin-users-avatar-fallback admin-users-avatar-large" aria-hidden="true">{details.user.name.trim().charAt(0).toUpperCase() || "?"}</span>}
                        <div><strong>{details.user.name}</strong><span>{details.user.email}</span></div>
                    </div>
                    <dl className="admin-users-details-grid">
                        <DetailField label="Role" value={details.user.role === "employer" ? "Employer" : details.user.role === "admin" ? "Admin" : "Freelancer"} />
                        <DetailField label="Email verification" value={details.user.isVerified ? "Verified" : "Unverified"} />
                        <DetailField label="Account status" value={details.user.isActive ? "Active" : "Inactive"} />
                        <DetailField label="Date joined" value={formatDate(details.user.createdAt)} />
                        <DetailField label="Location" value={[details.user.city, details.user.country].filter(Boolean).join(", ")} />
                        {details.user.role === "freelancer" && <>
                            <DetailField label="Professional title" value={details.profile?.professionalTitle} />
                            <DetailField label="Category / specialization" value={details.profile?.category} />
                            <DetailField label="Experience level" value={details.profile?.experienceLevel} />
                            <div className="admin-user-detail-field"><dt>Skills</dt><dd>{Array.isArray(details.profile?.skills) && details.profile.skills.length ? details.profile.skills.map(String).join(", ") : "Not provided"}</dd></div>
                            <DetailField label="Biography" value={details.profile?.bio} />
                            <DetailField label="Portfolio URL" value={details.profile?.portfolioUrl} />
                        </>}
                        {details.user.role === "employer" && <>
                            <DetailField label="Account type" value={details.profile?.accountType} />
                            <DetailField label="Company" value={details.profile?.companyName} />
                            <DetailField label="Industry" value={details.profile?.industry} />
                            <DetailField label="Website" value={details.profile?.companyWebsite} />
                            <DetailField label="Position" value={details.profile?.position || details.profile?.occupation} />
                            <div className="admin-user-detail-field"><dt>Hiring categories</dt><dd>{Array.isArray(details.profile?.hiringCategories) && details.profile.hiringCategories.length ? details.profile.hiringCategories.map(String).join(", ") : "Not provided"}</dd></div>
                        </>}
                    </dl>
                </>}
            </section>
        </div>}

        {removingUser && <div className="admin-users-overlay">
            <section aria-labelledby="admin-remove-user-title" aria-modal="true" className="admin-users-dialog admin-users-confirm-dialog" role="alertdialog">
                <h2 id="admin-remove-user-title">Permanently remove user?</h2>
                <p>This permanently removes <strong>{removingUser.name}</strong> ({removingUser.email}) and prevents sign-in. Their marketplace history is retained with anonymized account references. A notification email will be queued.</p>
                <label className="admin-users-reason-label" htmlFor="admin-removal-reason">Reason (optional)</label>
                <textarea
                    className="input"
                    id="admin-removal-reason"
                    maxLength={1000}
                    onChange={(event) => setRemovalReason(event.target.value)}
                    value={removalReason}
                />
                {removeError && <p className="form-error" role="alert">{removeError}</p>}
                <div className="admin-users-dialog-actions">
                    <button className="button button-quiet" disabled={isRemoving} onClick={() => { setRemovingUser(null); setRemovalReason(""); }} type="button">Cancel</button>
                    <button className="button button-primary admin-users-remove-confirm" disabled={isRemoving} onClick={() => void confirmRemoval()} type="button">{isRemoving && <Spinner label="Removing user" />} {isRemoving ? "Removing..." : "Permanently Remove"}</button>
                </div>
            </section>
        </div>}
    </section>;
}
