"use client";

import Image from "next/image";
import { ChangeEvent, FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { dashboardProfileImageUpdatedEvent } from "@/lib/dashboard-events";

type AccountUser = {
    firstName: string;
    lastName: string;
    name: string;
    email: string;
    role: string;
    country: string;
    city: string;
    isVerified: boolean;
    isActive: boolean;
};
type AccountProfile = { user: AccountUser; profile: Record<string, unknown> | null };
type Preferences = { emailNotifications: boolean; inAppNotifications: boolean; profileVisibility: "public" | "private" };
type PaystackBankOption = { name: string; code: string };
type PayoutBankDetails = {
    bankCode: string;
    bankName: string;
    accountName: string;
    maskedAccountNumber: string;
    verifiedAt: string | null;
    verified: boolean;
};

const freelancerProfileFields = [
    "professionalTitle",
    "category",
    "skills",
    "experienceLevel",
    "bio",
    "workType",
    "availability",
    "hourlyRate",
    "portfolioUrl",
    "githubUrl",
    "linkedinUrl",
] as const;

function profileText(profile: Record<string, unknown>, key: string) {
    const value = profile[key];
    return typeof value === "string" ? value : "";
}

export default function AccountPanel({ section, role }: { section: "profile" | "settings"; role: "freelancer" | "employer" | "admin" }) {
    const router = useRouter();
    const [profile, setProfile] = useState<AccountProfile | null>(null);
    const [preferences, setPreferences] = useState<Preferences>({ emailNotifications: true, inAppNotifications: true, profileVisibility: "public" });
    const [state, setState] = useState<"loading" | "ready" | "error">("loading");
    const [error, setError] = useState("");
    const [success, setSuccess] = useState("");
    const [isSaving, setIsSaving] = useState(false);
    const [isResendingVerification, setIsResendingVerification] = useState(false);
    const [currentPassword, setCurrentPassword] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [isChangingPassword, setIsChangingPassword] = useState(false);
    const [passwordError, setPasswordError] = useState("");
    const [passwordSuccess, setPasswordSuccess] = useState("");
    const [deactivationPassword, setDeactivationPassword] = useState("");
    const [deactivationConfirmation, setDeactivationConfirmation] = useState("");
    const [deactivationError, setDeactivationError] = useState("");
    const [isDeactivating, setIsDeactivating] = useState(false);
    const [selectedImage, setSelectedImage] = useState<File | null>(null);
    const [imagePreview, setImagePreview] = useState("");
    const [banks, setBanks] = useState<PaystackBankOption[]>([]);
    const [payoutBank, setPayoutBank] = useState<PayoutBankDetails | null>(null);
    const [bankCode, setBankCode] = useState("");
    const [accountNumber, setAccountNumber] = useState("");
    const [bankState, setBankState] = useState<"loading" | "ready" | "error">("loading");
    const [bankLoadAttempt, setBankLoadAttempt] = useState(0);
    const [bankError, setBankError] = useState("");
    const [bankSuccess, setBankSuccess] = useState("");
    const [isSavingBank, setIsSavingBank] = useState(false);
    const [bankRetryAt, setBankRetryAt] = useState<number | null>(null);
    const [bankRetrySeconds, setBankRetrySeconds] = useState(0);
    const bankVerificationInFlight = useRef(false);

    useEffect(() => {
        const controller = new AbortController();
        async function load() {
            try {
                if (section === "profile") {
                    const response = await fetch("/api/account/profile", { cache: "no-store", signal: controller.signal });
                    const result = await response.json() as AccountProfile & { error?: string };
                    if (!response.ok) throw new Error(result.error || "Profile is unavailable.");
                    if (!controller.signal.aborted) setProfile(result);
                } else {
                    const response = await fetch("/api/account/preferences", { cache: "no-store", signal: controller.signal });
                    const result = await response.json() as { preferences?: Preferences; error?: string };
                    if (!response.ok) throw new Error(result.error || "Settings are unavailable.");
                    if (!controller.signal.aborted && result.preferences) setPreferences(result.preferences);
                }
                if (!controller.signal.aborted) setState("ready");
            } catch (loadError) {
                if (controller.signal.aborted) return;
                setError(loadError instanceof Error ? loadError.message : "Account data is unavailable.");
                setState("error");
            }
        }
        void load();
        return () => controller.abort();
    }, [section]);

    useEffect(() => {
        if (section !== "settings" || role !== "freelancer") return;
        const controller = new AbortController();
        async function loadBankDetails() {
            try {
                const [banksResponse, detailsResponse] = await Promise.all([
                    fetch("/api/account/bank?list=true", { cache: "no-store", signal: controller.signal }),
                    fetch("/api/account/bank", { cache: "no-store", signal: controller.signal }),
                ]);
                const [banksResult, detailsResult] = await Promise.all([
                    banksResponse.json() as Promise<{ banks?: PaystackBankOption[]; error?: string }>,
                    detailsResponse.json() as Promise<{ bankDetails?: PayoutBankDetails | null; error?: string }>,
                ]);
                if (!banksResponse.ok || !Array.isArray(banksResult.banks)) throw new Error(banksResult.error || "Bank list is unavailable.");
                if (!detailsResponse.ok) throw new Error(detailsResult.error || "Saved bank details are unavailable.");
                if (controller.signal.aborted) return;
                setBanks(banksResult.banks);
                setPayoutBank(detailsResult.bankDetails || null);
                setBankCode(detailsResult.bankDetails?.bankCode || banksResult.banks[0]?.code || "");
                setBankState("ready");
            } catch (loadError) {
                if (controller.signal.aborted) return;
                setBankError(loadError instanceof Error ? loadError.message : "Bank details are unavailable.");
                setBankState("error");
            }
        }
        void loadBankDetails();
        return () => controller.abort();
    }, [bankLoadAttempt, role, section]);

    useEffect(() => () => {
        if (imagePreview) URL.revokeObjectURL(imagePreview);
    }, [imagePreview]);

    useEffect(() => {
        if (!bankRetryAt) return;
        const updateRetryTime = () => {
            const seconds = Math.max(0, Math.ceil((bankRetryAt - Date.now()) / 1000));
            setBankRetrySeconds(seconds);
            if (seconds === 0) setBankRetryAt(null);
        };
        updateRetryTime();
        const interval = window.setInterval(updateRetryTime, 1000);
        return () => window.clearInterval(interval);
    }, [bankRetryAt]);

    function updateUser(field: "firstName" | "lastName" | "city" | "country", value: string) {
        setProfile((current) => current ? { ...current, user: { ...current.user, [field]: value } } : current);
    }

    function updateProfessionalProfile(field: string, value: string | string[]) {
        setProfile((current) => current ? {
            ...current,
            profile: { ...(current.profile || {}), [field]: value },
        } : current);
    }

    function handleImageChange(event: ChangeEvent<HTMLInputElement>) {
        const file = event.target.files?.[0];
        if (!file) return;
        if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
            setError("Profile image must be JPG, JPEG, PNG, or WEBP.");
            event.target.value = "";
            return;
        }
        if (file.size === 0 || file.size > 5 * 1024 * 1024) {
            setError("Choose a profile image that is larger than 0 bytes and no more than 5 MB.");
            event.target.value = "";
            return;
        }
        setError("");
        setSuccess("");
        setSelectedImage(file);
        setImagePreview(URL.createObjectURL(file));
    }

    async function resendVerification() {
        if (!profile) return;
        setError("");
        setSuccess("");
        setIsResendingVerification(true);
        try {
            const response = await fetch("/api/auth/resend-verification", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email: profile.user.email }),
            });
            const result = await response.json() as { message?: string; error?: string };
            if (!response.ok) throw new Error(result.error || "Verification email could not be sent.");
            setSuccess(result.message || "A new verification email has been sent.");
        } catch (resendError) {
            setError(resendError instanceof Error ? resendError.message : "Verification email could not be sent.");
        } finally {
            setIsResendingVerification(false);
        }
    }

    async function save(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setError("");
        setSuccess("");
        setIsSaving(true);
        const isFreelancerProfile = section === "profile" && profile?.user.role === "freelancer";
        const endpoint = section === "profile" ? "/api/account/profile" : "/api/account/preferences";
        const method = section === "profile" ? "PATCH" : "PUT";
        try {
            let response: Response;
            if (isFreelancerProfile && profile) {
                const userData = {
                    firstName: profile.user.firstName,
                    lastName: profile.user.lastName,
                    city: profile.user.city,
                    country: profile.user.country,
                };
                const currentProfile = profile.profile || {};
                const profileData: Record<string, unknown> = {};
                for (const field of freelancerProfileFields) {
                    if (field === "skills") {
                        profileData.skills = Array.isArray(currentProfile.skills) ? currentProfile.skills : [];
                    } else if (field === "hourlyRate") {
                        const rate = currentProfile.hourlyRate;
                        if (typeof rate === "number") profileData.hourlyRate = rate;
                        else if (typeof rate === "string") profileData.hourlyRate = rate.trim() ? Number(rate) : null;
                    } else {
                        profileData[field] = typeof currentProfile[field] === "string" ? currentProfile[field] : "";
                    }
                }
                const formData = new FormData();
                formData.append("userData", JSON.stringify(userData));
                formData.append("profileData", JSON.stringify(profileData));
                if (selectedImage) formData.append("profileImage", selectedImage);
                response = await fetch(endpoint, { method, body: formData });
            } else {
                const payload = section === "profile" ? {
                    firstName: profile?.user.firstName,
                    lastName: profile?.user.lastName,
                    city: profile?.user.city,
                    country: profile?.user.country,
                } : preferences;
                response = await fetch(endpoint, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
            }
            const result = await response.json() as { error?: string; user?: Partial<AccountUser>; profile?: Record<string, unknown> | null };
            if (!response.ok) throw new Error(result.error || "Changes could not be saved.");
            if (section === "profile" && result.user && profile) {
                setProfile({ ...profile, user: { ...profile.user, ...result.user }, ...(result.profile ? { profile: result.profile } : {}) });
            }
            if (isFreelancerProfile && selectedImage) {
                window.dispatchEvent(new Event(dashboardProfileImageUpdatedEvent));
            }
            setSelectedImage(null);
            setImagePreview("");
            setSuccess(section === "profile" ? "Profile saved." : "Settings saved.");
        } catch (saveError) {
            setError(saveError instanceof Error ? saveError.message : "Changes could not be saved.");
        } finally {
            setIsSaving(false);
        }
    }

    async function saveBankDetails(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (bankVerificationInFlight.current || (bankRetryAt && bankRetryAt > Date.now())) return;
        bankVerificationInFlight.current = true;
        setBankError("");
        setBankSuccess("");
        setIsSavingBank(true);
        try {
            const response = await fetch("/api/account/bank", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ accountNumber, bankCode }),
            });
            const result = await response.json() as { error?: string; message?: string; retryAt?: string; bankDetails?: PayoutBankDetails };
            if (response.status === 429) {
                const retryAt = result.retryAt ? Date.parse(result.retryAt) : Number.NaN;
                const fallbackRetryAt = Date.now() + 30_000;
                setBankRetryAt(Number.isFinite(retryAt) && retryAt > Date.now() ? retryAt : fallbackRetryAt);
                throw new Error(result.error || "Paystack is rate limiting verification. Please wait before trying again.");
            }
            if (!response.ok || !result.bankDetails) throw new Error(result.error || "Bank details could not be verified and saved.");
            setPayoutBank(result.bankDetails);
            setAccountNumber("");
            setBankSuccess(result.message || "Bank details verified and saved.");
        } catch (saveError) {
            setBankError(saveError instanceof Error ? saveError.message : "Bank details could not be verified and saved.");
        } finally {
            bankVerificationInFlight.current = false;
            setIsSavingBank(false);
        }
    }

    async function changePassword(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setPasswordError("");
        setPasswordSuccess("");
        if (newPassword !== confirmPassword) {
            setPasswordError("New password and confirmation do not match.");
            return;
        }
        setIsChangingPassword(true);
        try {
            const response = await fetch("/api/account/password", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ currentPassword, newPassword }),
            });
            const result = await response.json() as { error?: string; message?: string };
            if (!response.ok) throw new Error(result.error || "Password could not be updated.");
            setCurrentPassword("");
            setNewPassword("");
            setConfirmPassword("");
            setPasswordSuccess(result.message || "Password updated successfully.");
        } catch (passwordError) {
            setPasswordError(passwordError instanceof Error ? passwordError.message : "Password could not be updated.");
        } finally {
            setIsChangingPassword(false);
        }
    }

    async function deactivateAccount(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setDeactivationError("");
        setIsDeactivating(true);
        try {
            const response = await fetch("/api/account/deactivate", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ currentPassword: deactivationPassword, confirmation: deactivationConfirmation }),
            });
            const result = await response.json() as { error?: string; message?: string };
            if (!response.ok) throw new Error(result.error || "Account could not be deactivated.");
            await router.replace("/login");
        } catch (deactivationError) {
            setDeactivationError(deactivationError instanceof Error ? deactivationError.message : "Account could not be deactivated.");
        } finally {
            setIsDeactivating(false);
        }
    }

    if (state === "loading") return <div className="dashboard-empty" role="status">Loading {section}...</div>;
    if (state === "error") return <div className="dashboard-empty" role="alert">{error}</div>;

    if (section === "profile" && profile) {
        if (profile.user.role === "freelancer") {
            const professionalProfile = profile.profile || {};
            const completionValues = [
                profile.user.firstName,
                profile.user.lastName,
                profile.user.country,
                profile.user.city,
                profileText(professionalProfile, "professionalTitle"),
                profileText(professionalProfile, "category"),
                Array.isArray(professionalProfile.skills) && professionalProfile.skills.length > 0,
                profileText(professionalProfile, "experienceLevel"),
                profileText(professionalProfile, "bio"),
                profileText(professionalProfile, "workType"),
                profileText(professionalProfile, "availability"),
            ];
            const completion = Math.round(completionValues.filter(Boolean).length / completionValues.length * 100);
            const avatar = imagePreview || profileText(professionalProfile, "profileImage");

            return <form className="dashboard-form freelancer-profile-form" onSubmit={(event) => void save(event)}>
                <div className="dashboard-form-heading">
                    <div><h2>Freelancer profile</h2><p className="form-hint">Keep your professional details current so clients can find the right fit.</p></div>
                    <span className={`profile-verification-badge${profile.user.isVerified ? " is-verified" : ""}`}>
                        {profile.user.isVerified ? "Email verified" : "Email not verified"}
                    </span>
                </div>
                {!profile.user.isVerified && <div className="profile-verification-notice">
                    <span>Verify your email to make your profile eligible for the full freelancer experience.</span>
                    <button className="button button-quiet" disabled={isResendingVerification} onClick={() => void resendVerification()} type="button">
                        {isResendingVerification ? "Sending..." : "Resend verification email"}
                    </button>
                </div>}
                <section className="freelancer-profile-progress" aria-label="Profile completeness">
                    <div><strong>Profile completeness</strong><span>{completion}%</span></div>
                    <progress max={100} value={completion}>{completion}%</progress>
                </section>
                <div className="profile-image-field">
                    <span className="filter-label">Profile image</span>
                    <div className="profile-image-row">
                        {avatar
                            ? <Image className="profile-image-preview" src={avatar} alt="Profile preview" width={82} height={82} unoptimized />
                            : <div className="profile-image-placeholder" aria-hidden="true">{profile.user.firstName.charAt(0).toUpperCase()}</div>}
                        <label className="profile-image-upload">Choose an image<input accept="image/jpeg,image/png,image/webp" className="filter-input" onChange={handleImageChange} type="file" /><span className="form-hint">JPG, PNG, or WEBP; up to 5 MB.</span></label>
                    </div>
                </div>
                <div className="dashboard-form-row">
                    <label>First name<input className="filter-input" autoComplete="given-name" maxLength={120} required value={profile.user.firstName} onChange={(event) => updateUser("firstName", event.target.value)} /></label>
                    <label>Last name<input className="filter-input" autoComplete="family-name" maxLength={120} required value={profile.user.lastName} onChange={(event) => updateUser("lastName", event.target.value)} /></label>
                </div>
                <label>Email address<input className="filter-input" autoComplete="email" disabled value={profile.user.email} /></label>
                <div className="dashboard-form-row">
                    <label>City<input className="filter-input" autoComplete="address-level2" maxLength={120} required value={profile.user.city} onChange={(event) => updateUser("city", event.target.value)} /></label>
                    <label>Country<input className="filter-input" autoComplete="country-name" maxLength={120} required value={profile.user.country} onChange={(event) => updateUser("country", event.target.value)} /></label>
                </div>
                <label>Professional title<input className="filter-input" maxLength={120} required value={profileText(professionalProfile, "professionalTitle")} onChange={(event) => updateProfessionalProfile("professionalTitle", event.target.value)} placeholder="e.g. Product designer" /></label>
                <div className="dashboard-form-row">
                    <label>Specialty or category<input className="filter-input" maxLength={120} required value={profileText(professionalProfile, "category")} onChange={(event) => updateProfessionalProfile("category", event.target.value)} /></label>
                    <label>Experience level<select className="filter-input" required value={profileText(professionalProfile, "experienceLevel")} onChange={(event) => updateProfessionalProfile("experienceLevel", event.target.value)}><option value="">Select experience level</option><option>Beginner</option><option>Intermediate</option><option>Expert</option></select></label>
                </div>
                <label>Skills <span className="form-hint">Separate each skill with a comma.</span><input className="filter-input" maxLength={2000} required value={Array.isArray(professionalProfile.skills) ? professionalProfile.skills.join(", ") : ""} onChange={(event) => updateProfessionalProfile("skills", event.target.value.split(",").map((skill) => skill.trim()).filter(Boolean))} placeholder="Research, Figma, prototyping" /></label>
                <label>Professional bio<textarea className="filter-input dashboard-textarea" maxLength={5000} required value={profileText(professionalProfile, "bio")} onChange={(event) => updateProfessionalProfile("bio", event.target.value)} /></label>
                <div className="dashboard-form-row">
                    <label>Work type<select className="filter-input" required value={profileText(professionalProfile, "workType")} onChange={(event) => updateProfessionalProfile("workType", event.target.value)}><option value="">Select work type</option><option>Freelance</option><option>Contract</option><option>Part-time</option></select></label>
                    <label>Availability<select className="filter-input" required value={profileText(professionalProfile, "availability")} onChange={(event) => updateProfessionalProfile("availability", event.target.value)}><option value="">Select availability</option><option>Available</option><option>Busy</option><option>Not currently available</option></select></label>
                </div>
                <label>Hourly rate (USD)<input className="filter-input" max={1_000_000_000} min={0} step="0.01" type="number" value={typeof professionalProfile.hourlyRate === "number" || typeof professionalProfile.hourlyRate === "string" ? professionalProfile.hourlyRate : ""} onChange={(event) => updateProfessionalProfile("hourlyRate", event.target.value)} /></label>
                <label>Portfolio URL<input className="filter-input" maxLength={500} placeholder="https://" type="url" value={profileText(professionalProfile, "portfolioUrl")} onChange={(event) => updateProfessionalProfile("portfolioUrl", event.target.value)} /></label>
                <div className="dashboard-form-row">
                    <label>GitHub URL<input className="filter-input" maxLength={500} placeholder="https://" type="url" value={profileText(professionalProfile, "githubUrl")} onChange={(event) => updateProfessionalProfile("githubUrl", event.target.value)} /></label>
                    <label>LinkedIn URL<input className="filter-input" maxLength={500} placeholder="https://" type="url" value={profileText(professionalProfile, "linkedinUrl")} onChange={(event) => updateProfessionalProfile("linkedinUrl", event.target.value)} /></label>
                </div>
                {passwordError && <p className="form-error" role="alert">{passwordError}</p>}
                {passwordSuccess && <p className="success-message" role="status">{passwordSuccess}</p>}
                <button className="button button-primary" disabled={isSaving} type="submit">{isSaving ? "Saving..." : "Save Profile"}</button>
            </form>;
        }

        return <form className="dashboard-form" onSubmit={(event) => void save(event)}>
            <h2>Account profile</h2>
            <div className="dashboard-form-row">
                <label>First name<input className="filter-input" required value={profile.user.firstName} onChange={(event) => updateUser("firstName", event.target.value)} /></label>
                <label>Last name<input className="filter-input" required value={profile.user.lastName} onChange={(event) => updateUser("lastName", event.target.value)} /></label>
            </div>
            <label>Email<input className="filter-input" disabled value={profile.user.email} /></label>
            <div className="dashboard-form-row">
                <label>City<input className="filter-input" required value={profile.user.city} onChange={(event) => updateUser("city", event.target.value)} /></label>
                <label>Country<input className="filter-input" required value={profile.user.country} onChange={(event) => updateUser("country", event.target.value)} /></label>
            </div>
            {profile.profile && <section className="dashboard-panel"><h3>Professional profile information</h3><dl>{Object.entries(profile.profile).filter(([key, value]) => key !== "_id" && key !== "user" && key !== "__v" && value !== undefined && value !== null && typeof value !== "object").map(([key, value]) => <div key={key}><dt>{key.replace(/([A-Z])/g, " $1")}</dt><dd>{String(value)}</dd></div>)}</dl></section>}
            {error && <p className="form-error" role="alert">{error}</p>}
            {success && <p className="success-message" role="status">{success}</p>}
            <button className="button button-primary" disabled={isSaving} type="submit">{isSaving ? "Saving..." : "Save Profile"}</button>
        </form>;
    }

    return <div className="dashboard-account-settings">
        <form className="dashboard-form" onSubmit={(event) => void save(event)}>
            <h2>Account settings</h2>
            <label><input checked={preferences.emailNotifications} type="checkbox" onChange={(event) => setPreferences({ ...preferences, emailNotifications: event.target.checked })} /> Email notifications</label>
            <label><input checked={preferences.inAppNotifications} type="checkbox" onChange={(event) => setPreferences({ ...preferences, inAppNotifications: event.target.checked })} /> In-app notifications</label>
            <label>Profile visibility<select className="filter-input" value={preferences.profileVisibility} onChange={(event) => setPreferences({ ...preferences, profileVisibility: event.target.value as Preferences["profileVisibility"] })}><option value="public">Public</option><option value="private">Private</option></select></label>
            {error && <p className="form-error" role="alert">{error}</p>}
            {success && <p className="success-message" role="status">{success}</p>}
            <button className="button button-primary" disabled={isSaving} type="submit">{isSaving ? "Saving..." : "Save Settings"}</button>
        </form>
        <form className="dashboard-form" onSubmit={(event) => void changePassword(event)}>
            <h2>Change password</h2>
            <p className="form-hint">Use your current password to set a new one.</p>
            <label>Current password<input autoComplete="current-password" className="filter-input" maxLength={128} required type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></label>
            <label>New password<input autoComplete="new-password" className="filter-input" minLength={8} maxLength={128} required type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></label>
            <label>Confirm new password<input autoComplete="new-password" className="filter-input" minLength={8} maxLength={128} required type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></label>
            {passwordError && <p className="form-error" role="alert">{passwordError}</p>}
            {passwordSuccess && <p className="success-message" role="status">{passwordSuccess}</p>}
            <button className="button button-primary" disabled={isChangingPassword} type="submit">{isChangingPassword ? "Updating..." : "Update password"}</button>
        </form>
        {role !== "admin" && <form className="dashboard-form account-deactivation-form" onSubmit={(event) => void deactivateAccount(event)}>
            <h2>Deactivate account</h2>
            <p className="form-hint">Your account data will be retained, but you will be signed out and unable to sign in again. Open postings and active or disputed projects must be resolved first.</p>
            <label>Current password<input autoComplete="current-password" className="filter-input" required type="password" value={deactivationPassword} onChange={(event) => setDeactivationPassword(event.target.value)} /></label>
            <label>Type DEACTIVATE to confirm<input className="filter-input" autoCapitalize="characters" required value={deactivationConfirmation} onChange={(event) => setDeactivationConfirmation(event.target.value)} /></label>
            {deactivationError && <p className="form-error" role="alert">{deactivationError}</p>}
            <button className="button button-quiet" disabled={isDeactivating || deactivationConfirmation !== "DEACTIVATE" || !deactivationPassword} type="submit">{isDeactivating ? "Deactivating..." : "Deactivate account"}</button>
        </form>}
        {role === "freelancer" && <section className="dashboard-panel account-payout-panel">
            <div className="dashboard-panel-heading"><div><span className="panel-kicker">Payout setup</span><h2>Bank details</h2></div>{payoutBank?.verified && <span className="profile-verification-badge is-verified">Verified</span>}</div>
            <p className="muted-copy">Your account is verified securely through Paystack. The full account number is retained for payout processing and is never displayed; only its last four digits are shown here.</p>
            {bankState === "loading" && <p className="muted-copy" role="status">Loading bank details...</p>}
            {bankState === "error" && <div><p className="form-error" role="alert">{bankError}</p><button className="button button-quiet" onClick={() => { setBankError(""); setBankState("loading"); setBankLoadAttempt((attempt) => attempt + 1); }} type="button">Retry bank details</button></div>}
            {bankState === "ready" && <>
                {payoutBank && <dl className="account-payout-summary">
                    <div><dt>Bank</dt><dd>{payoutBank.bankName}</dd></div>
                    <div><dt>Account name</dt><dd>{payoutBank.accountName}</dd></div>
                    <div><dt>Account number</dt><dd>{payoutBank.maskedAccountNumber}</dd></div>
                </dl>}
                <form className="account-payout-form" onSubmit={(event) => void saveBankDetails(event)}>
                    <label>Bank<select className="filter-input" required value={bankCode} onChange={(event) => setBankCode(event.target.value)}><option value="" disabled>Select a bank</option>{banks.map((bank) => <option key={bank.code} value={bank.code}>{bank.name}</option>)}</select></label>
                    <label>10-digit account number<input autoComplete="off" className="filter-input" inputMode="numeric" maxLength={10} minLength={10} pattern="[0-9]{10}" required type="text" value={accountNumber} onChange={(event) => setAccountNumber(event.target.value.replace(/\D/g, "").slice(0, 10))} /></label>
                    {bankError && <p className="form-error" role="alert">{bankError}</p>}
                    {bankSuccess && <p className="success-message" role="status">{bankSuccess}</p>}
                    <button className="button button-primary" disabled={isSavingBank || Boolean(bankRetryAt) || !bankCode || accountNumber.length !== 10} type="submit">{isSavingBank ? "Verifying..." : bankRetryAt ? `Retry in ${bankRetrySeconds}s` : payoutBank ? "Verify and update bank details" : "Verify and save bank details"}</button>
                </form>
            </>}
        </section>}
    </div>;
}
