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
    createdAt: string;
    updatedAt: string;
};
type AccountProfile = { user: AccountUser; profile: Record<string, unknown> | null };
type Preferences = { emailNotifications: boolean; inAppNotifications: boolean; profileVisibility: "public" | "private"; emailVisibility: boolean; companyInfoVisibility: boolean };
type PaystackBankOption = { name: string; code: string };
type PayoutBankDetails = {
    bankCode: string;
    bankName: string;
    accountName: string;
    maskedAccountNumber: string;
    verifiedAt: string | null;
    verified: boolean;
};

function deduplicateBanksByCode(banks: PaystackBankOption[]) {
    const uniqueBanks = new Map<string, PaystackBankOption>();
    for (const bank of banks) {
        if (typeof bank.code !== "string" || !bank.code.trim() || typeof bank.name !== "string" || !bank.name.trim()) continue;
        if (!uniqueBanks.has(bank.code)) uniqueBanks.set(bank.code, bank);
    }
    return [...uniqueBanks.values()];
}

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

function formatAccountDate(value: string) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "Unavailable" : new Intl.DateTimeFormat(undefined, { dateStyle: "long" }).format(date);
}

function safeWebsite(value: string) {
    try {
        const url = new URL(value);
        return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : "";
    } catch {
        return "";
    }
}

async function fetchGetWithRetry(url: string, signal: AbortSignal) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
            const response = await fetch(url, { cache: "no-store", signal });
            if (response.status < 500 || attempt === 2) return response;
        } catch (error) {
            if (signal.aborted || attempt === 2) throw error;
        }
        await new Promise<void>((resolve, reject) => {
            let timeout = 0;
            const onAbort = () => {
                window.clearTimeout(timeout);
                signal.removeEventListener("abort", onAbort);
                reject(new DOMException("The request was aborted.", "AbortError"));
            };
            timeout = window.setTimeout(() => {
                signal.removeEventListener("abort", onAbort);
                resolve();
            }, 300 * (attempt + 1));
            signal.addEventListener("abort", onAbort, { once: true });
        });
    }
    throw new Error("Account data is unavailable.");
}

export default function AccountPanel({ section, role }: { section: "profile" | "settings"; role: "freelancer" | "employer" | "admin" }) {
    const router = useRouter();
    const [profile, setProfile] = useState<AccountProfile | null>(null);
    const [savedProfile, setSavedProfile] = useState<AccountProfile | null>(null);
    const [isEditing, setIsEditing] = useState(false);
    const [loadAttempt, setLoadAttempt] = useState(0);
    const [preferences, setPreferences] = useState<Preferences>({ emailNotifications: true, inAppNotifications: true, profileVisibility: "public", emailVisibility: false, companyInfoVisibility: true });
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
    const profileSaveInFlight = useRef(false);

    useEffect(() => {
        const controller = new AbortController();
        async function load() {
            try {
                if (section === "profile") {
                    const response = await fetchGetWithRetry("/api/account/profile", controller.signal);
                    const result = await response.json() as AccountProfile & { error?: string };
                    if (!response.ok) throw new Error(result.error || "Profile is unavailable.");
                    if (!controller.signal.aborted) {
                        setProfile(result);
                        setSavedProfile(result);
                    }
                } else {
                    const response = await fetchGetWithRetry("/api/account/preferences", controller.signal);
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
    }, [loadAttempt, section]);

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
                const uniqueBanks = deduplicateBanksByCode(banksResult.banks);
                setBanks(uniqueBanks);
                setPayoutBank(detailsResult.bankDetails || null);
                const savedBankCode = detailsResult.bankDetails?.bankCode;
                setBankCode(uniqueBanks.some((bank) => bank.code === savedBankCode)
                    ? savedBankCode || ""
                    : uniqueBanks[0]?.code || "");
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

    function updateUser(field: "firstName" | "lastName" | "email" | "city" | "country", value: string) {
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
            setSelectedImage(null);
            setImagePreview("");
            event.target.value = "";
            return;
        }
        if (file.size === 0 || file.size > 5 * 1024 * 1024) {
            setError("Choose a profile image that is larger than 0 bytes and no more than 5 MB.");
            setSelectedImage(null);
            setImagePreview("");
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
        if (profileSaveInFlight.current) return;
        profileSaveInFlight.current = true;
        setError("");
        setSuccess("");
        setIsSaving(true);
        const isFreelancerProfile = section === "profile" && profile?.user.role === "freelancer";
        const isEmployerProfile = section === "profile" && profile?.user.role === "employer";
        const endpoint = section === "profile" ? "/api/account/profile" : "/api/account/preferences";
        const method = section === "profile" ? "PATCH" : "PUT";
        try {
            let response: Response;
            if ((isFreelancerProfile || isEmployerProfile) && profile) {
                const userData = {
                    firstName: profile.user.firstName,
                    lastName: profile.user.lastName,
                    email: profile.user.email,
                    city: profile.user.city,
                    country: profile.user.country,
                };
                const currentProfile = profile.profile || {};
                const profileData: Record<string, unknown> = {};
                if (isFreelancerProfile) {
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
                } else {
                    for (const field of ["accountType", "companyName", "industry", "companyDescription", "companyWebsite", "companySize", "position", "hiringFrequency", "hiringPurpose"] as const) {
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
            const result = await response.json() as { error?: string; emailVerificationRequired?: boolean; emailVerificationSent?: boolean; user?: Partial<AccountUser>; profile?: Record<string, unknown> | null };
            if (!response.ok) throw new Error(result.error || "Changes could not be saved.");
            if (section === "profile" && result.user && profile) {
                const updatedProfile = { ...profile, user: { ...profile.user, ...result.user }, ...(result.profile ? { profile: result.profile } : {}) };
                setProfile(updatedProfile);
                setSavedProfile(updatedProfile);
            }
            if ((isFreelancerProfile || isEmployerProfile) && selectedImage) {
                window.dispatchEvent(new Event(dashboardProfileImageUpdatedEvent));
            }
            if (section === "profile") router.refresh();
            setSelectedImage(null);
            setImagePreview("");
            setIsEditing(false);
            setSuccess(result.emailVerificationRequired
                ? result.emailVerificationSent
                    ? "Profile saved. Verify your new email address using the link sent to your inbox."
                    : "Profile saved, but the verification email could not be sent. Use Resend verification email to try again."
                : section === "profile" ? "Profile saved." : "Settings saved.");
        } catch (saveError) {
            setError(saveError instanceof Error ? saveError.message : "Changes could not be saved.");
        } finally {
            profileSaveInFlight.current = false;
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
                const retryAfter = response.headers.get("Retry-After");
                const retryAfterSeconds = retryAfter ? Number(retryAfter) : Number.NaN;
                const retryAtFromHeader = retryAfter && Number.isFinite(retryAfterSeconds)
                    ? Date.now() + retryAfterSeconds * 1000
                    : retryAfter
                        ? Date.parse(retryAfter)
                        : Number.NaN;
                const retryAtFromResponse = result.retryAt ? Date.parse(result.retryAt) : Number.NaN;
                const retryAt = Number.isFinite(retryAtFromHeader) && retryAtFromHeader > Date.now()
                    ? retryAtFromHeader
                    : Number.isFinite(retryAtFromResponse) && retryAtFromResponse > Date.now()
                        ? retryAtFromResponse
                        : null;
                setBankRetryAt(retryAt);
                throw new Error(result.error || "Paystack is temporarily limiting bank verification. Please wait before trying again.");
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
    if (state === "error") return <div className="dashboard-empty" role="alert">{error}<button className="button button-quiet" onClick={() => { setError(""); setState("loading"); setLoadAttempt((attempt) => attempt + 1); }} type="button">Retry</button></div>;

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

        const clientProfile = profile.profile || {};
        const avatar = imagePreview || profileText(clientProfile, "profileImage");
        const companyWebsite = safeWebsite(profileText(clientProfile, "companyWebsite"));
        const hiringCategories = Array.isArray(clientProfile.hiringCategories) ? clientProfile.hiringCategories.join(", ") : "";
        const companySize = profileText(clientProfile, "companySize");
        if (!isEditing) {
            return <div className="client-profile-page">
                <div className="dashboard-toolbar">
                    <div><h2>Account Profile</h2><p className="form-hint">Your account and professional information.</p></div>
                    <button className="button button-primary" onClick={() => { setError(""); setSuccess(""); setIsEditing(true); }} type="button">Edit Profile</button>
                </div>
                {!profile.user.isVerified && <div className="profile-verification-notice">
                    <span>Your email address is not verified. Verify it to keep your account secure.</span>
                    <button className="button button-quiet" disabled={isResendingVerification} onClick={() => void resendVerification()} type="button">
                        {isResendingVerification ? "Sending..." : "Resend verification email"}
                    </button>
                </div>}
                {error && <p className="form-error" role="alert">{error}</p>}
                {success && <p className="success-message" role="status">{success}</p>}
                <div className="client-profile-grid">
                    <section className="dashboard-panel">
                        <h3>Account Profile</h3>
                        <div className="client-profile-identity">
                            {avatar
                                ? <Image className="profile-image-preview" src={avatar} alt={`${profile.user.name} profile`} width={82} height={82} unoptimized />
                                : <div className="profile-image-placeholder" aria-hidden="true">{profile.user.firstName.charAt(0).toUpperCase()}</div>}
                            <strong>{profile.user.name}</strong>
                        </div>
                        <dl className="client-profile-details">
                            <div><dt>First name</dt><dd>{profile.user.firstName || "Not provided"}</dd></div>
                            <div><dt>Last name</dt><dd>{profile.user.lastName || "Not provided"}</dd></div>
                            <div><dt>Email</dt><dd>{profile.user.email || "Not provided"}</dd></div>
                            <div><dt>City</dt><dd>{profile.user.city || "Not provided"}</dd></div>
                            <div><dt>Country</dt><dd>{profile.user.country || "Not provided"}</dd></div>
                            <div><dt>Account created</dt><dd>{formatAccountDate(profile.user.createdAt)}</dd></div>
                            <div><dt>Last updated</dt><dd>{formatAccountDate(profile.user.updatedAt)}</dd></div>
                        </dl>
                    </section>
                    <section className="dashboard-panel">
                        <h3>Professional Profile Information</h3>
                        <dl className="client-profile-details">
                            <div><dt>Account type</dt><dd>{profileText(clientProfile, "accountType") || "Not provided"}</dd></div>
                            <div><dt>Company name</dt><dd>{profileText(clientProfile, "companyName") || "Not provided"}</dd></div>
                            <div><dt>Industry</dt><dd>{profileText(clientProfile, "industry") || "Not provided"}</dd></div>
                            <div><dt>Business description</dt><dd>{profileText(clientProfile, "companyDescription") || "Not provided"}</dd></div>
                            <div><dt>Company website</dt><dd>{companyWebsite ? <a href={companyWebsite} rel="noreferrer" target="_blank">{profileText(clientProfile, "companyWebsite")}</a> : "Not provided"}</dd></div>
                            <div><dt>Company size</dt><dd>{companySize ? `${companySize} employees` : "Not provided"}</dd></div>
                            <div><dt>Position</dt><dd>{profileText(clientProfile, "position") || "Not provided"}</dd></div>
                            <div><dt>Hiring frequency</dt><dd>{profileText(clientProfile, "hiringFrequency") || "Not provided"}</dd></div>
                            <div><dt>Hiring categories</dt><dd>{hiringCategories || "Not provided"}</dd></div>
                            <div className="client-profile-purpose"><dt>Hiring purpose</dt><dd>{profileText(clientProfile, "hiringPurpose") || "Not provided"}</dd></div>
                        </dl>
                    </section>
                </div>
            </div>;
        }

        return <form className="dashboard-form client-profile-form" onSubmit={(event) => void save(event)}>
            <div className="dashboard-form-heading">
                <div><h2>Edit Profile</h2><p className="form-hint">Update your account and professional information.</p></div>
            </div>
            <div className="profile-image-field">
                <span className="filter-label">Profile image</span>
                <div className="profile-image-row">
                    {avatar
                        ? <Image className="profile-image-preview" src={avatar} alt="Profile preview" width={82} height={82} unoptimized />
                        : <div className="profile-image-placeholder" aria-hidden="true">{profile.user.firstName.charAt(0).toUpperCase()}</div>}
                    <label className="profile-image-upload">Choose an image<input accept="image/jpeg,image/png,image/webp" className="filter-input" onChange={handleImageChange} type="file" /><span className="form-hint">JPG, PNG, or WEBP; up to 5 MB.</span></label>
                </div>
            </div>
            <section className="dashboard-panel">
                <h3>Account Profile</h3>
                <div className="dashboard-form-row">
                    <label>First name<input autoComplete="given-name" className="filter-input" maxLength={120} required value={profile.user.firstName} onChange={(event) => updateUser("firstName", event.target.value)} /></label>
                    <label>Last name<input autoComplete="family-name" className="filter-input" maxLength={120} required value={profile.user.lastName} onChange={(event) => updateUser("lastName", event.target.value)} /></label>
                </div>
                <label>Email<input autoComplete="email" className="filter-input" maxLength={254} required type="email" value={profile.user.email} onChange={(event) => updateUser("email", event.target.value)} /><span className="form-hint">Changing your email requires verification at the new address.</span></label>
                <div className="dashboard-form-row">
                    <label>City<input autoComplete="address-level2" className="filter-input" maxLength={120} required value={profile.user.city} onChange={(event) => updateUser("city", event.target.value)} /></label>
                    <label>Country<input autoComplete="country-name" className="filter-input" maxLength={120} required value={profile.user.country} onChange={(event) => updateUser("country", event.target.value)} /></label>
                </div>
            </section>
            <section className="dashboard-panel client-company-fields">
                <h3>Professional Profile Information</h3>
                <label>Account type<select className="filter-input" required value={profileText(clientProfile, "accountType")} onChange={(event) => updateProfessionalProfile("accountType", event.target.value)}><option value="">Select account type</option><option>Individual</option><option>Company</option></select></label>
                <div className="dashboard-form-row">
                    <label>Company name<input className="filter-input" maxLength={500} value={profileText(clientProfile, "companyName")} onChange={(event) => updateProfessionalProfile("companyName", event.target.value)} /></label>
                    <label>Industry<input className="filter-input" maxLength={500} value={profileText(clientProfile, "industry")} onChange={(event) => updateProfessionalProfile("industry", event.target.value)} /></label>
                </div>
                <div className="dashboard-form-row">
                    <label>Company website<input className="filter-input" maxLength={500} placeholder="https://" type="url" value={profileText(clientProfile, "companyWebsite")} onChange={(event) => updateProfessionalProfile("companyWebsite", event.target.value)} /></label>
                    <label>Company size<input className="filter-input" max={1_000_000_000} min={1} step={1} type="number" value={companySize} onChange={(event) => updateProfessionalProfile("companySize", event.target.value)} /></label>
                </div>
                <label>Business description<textarea className="filter-input dashboard-textarea" maxLength={5000} value={profileText(clientProfile, "companyDescription")} onChange={(event) => updateProfessionalProfile("companyDescription", event.target.value)} /></label>
                <div className="dashboard-form-row">
                    <label>Position<input className="filter-input" maxLength={500} value={profileText(clientProfile, "position")} onChange={(event) => updateProfessionalProfile("position", event.target.value)} /></label>
                    <label>Hiring frequency<select className="filter-input" required value={profileText(clientProfile, "hiringFrequency")} onChange={(event) => updateProfessionalProfile("hiringFrequency", event.target.value)}><option value="">Select hiring frequency</option><option>Occasionally</option><option>Monthly</option><option>Frequently</option><option>For ongoing projects</option></select></label>
                </div>
                <label>Hiring purpose<textarea className="filter-input dashboard-textarea" maxLength={5000} value={profileText(clientProfile, "hiringPurpose")} onChange={(event) => updateProfessionalProfile("hiringPurpose", event.target.value)} /></label>
            </section>
            {error && <p className="form-error" role="alert">{error}</p>}
            {success && <p className="success-message" role="status">{success}</p>}
            <div className="client-profile-actions">
                <button className="button button-primary" disabled={isSaving} type="submit">{isSaving ? "Saving..." : "Save Changes"}</button>
                <button className="button button-quiet" disabled={isSaving} onClick={() => {
                    if (savedProfile) setProfile(savedProfile);
                    setSelectedImage(null);
                    setImagePreview("");
                    setError("");
                    setSuccess("");
                    setIsEditing(false);
                }} type="button">Cancel</button>
            </div>
        </form>;
    }

    return <div className="dashboard-account-settings">
        <form className="dashboard-form" onSubmit={(event) => void save(event)}>
            <h2>Account settings</h2>
            <label><input checked={preferences.emailNotifications} type="checkbox" onChange={(event) => setPreferences({ ...preferences, emailNotifications: event.target.checked })} /> Email notifications</label>
            <label><input checked={preferences.inAppNotifications} type="checkbox" onChange={(event) => setPreferences({ ...preferences, inAppNotifications: event.target.checked })} /> In-app notifications</label>
            <label>Profile visibility<select className="filter-input" value={preferences.profileVisibility} onChange={(event) => setPreferences({ ...preferences, profileVisibility: event.target.value as Preferences["profileVisibility"] })}><option value="public">Public</option><option value="private">Private</option></select></label>
            <label><input checked={preferences.emailVisibility} type="checkbox" onChange={(event) => setPreferences({ ...preferences, emailVisibility: event.target.checked })} /> Show my email on my public profile</label>
            {role === "employer" && <label><input checked={preferences.companyInfoVisibility} type="checkbox" onChange={(event) => setPreferences({ ...preferences, companyInfoVisibility: event.target.checked })} /> Show my company information on my public profile</label>}
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
                    <button aria-busy={isSavingBank} className="button button-primary" disabled={isSavingBank || Boolean(bankRetryAt) || !bankCode || accountNumber.length !== 10} type="submit">{isSavingBank ? "Verifying..." : bankRetryAt ? `Retry in ${bankRetrySeconds}s` : payoutBank ? "Verify and update bank details" : "Verify and save bank details"}</button>
                </form>
            </>}
        </section>}
    </div>;
}
