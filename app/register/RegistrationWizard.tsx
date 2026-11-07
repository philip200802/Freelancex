"use client";

import Link from "next/link";
import Image from "next/image";
import { ChangeEvent, FormEvent, useEffect, useState } from "react";
import { Eye, EyeOff } from "lucide-react";

type Role = "employer" | "freelancer";
const experienceLevels = ["Beginner", "Intermediate", "Expert"];
const workTypes = ["Freelance", "Contract", "Part-time"];
const availabilityOptions = ["Available", "Busy", "Not currently available"];
const accountTypes = ["Individual", "Company"];
const hiringFrequencies = ["Occasionally", "Monthly", "Frequently", "For ongoing projects"];

export default function RegistrationWizard({ role }: { role: Role }) {
    const [step, setStep] = useState(1);
    const [form, setForm] = useState<Record<string, string | boolean>>({ role, accountType: "", experienceLevel: "", workType: "", availability: "", hiringFrequency: "", termsAccepted: false });
    const [error, setError] = useState("");
    const [message, setMessage] = useState("");
    const [verificationEmailPending, setVerificationEmailPending] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [profileImage, setProfileImage] = useState<File | null>(null);
    const [profileImagePreview, setProfileImagePreview] = useState("");
    const [passwordVisible, setPasswordVisible] = useState(false);
    const [confirmPasswordVisible, setConfirmPasswordVisible] = useState(false);
    const update = (key: string, value: string | boolean) => setForm((current) => ({ ...current, [key]: value }));

    useEffect(() => () => { if (profileImagePreview) URL.revokeObjectURL(profileImagePreview); }, [profileImagePreview]);

    function handleImageChange(event: ChangeEvent<HTMLInputElement>) {
        const file = event.target.files?.[0];
        if (!file) return;
        if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) { setError("Profile image must be JPG, JPEG, PNG, or WEBP."); event.target.value = ""; return; }
        if (file.size > 5 * 1024 * 1024) { setError("Profile image must be 5 MB or smaller."); event.target.value = ""; return; }
        setError("");
        setProfileImage(file);
        setProfileImagePreview(URL.createObjectURL(file));
    }

    function validateCurrentStep() {
        const required = step === 1 ? ["firstName", "lastName", "email", "password", "confirmPassword", "country", "city"] : step === 2 ? role === "freelancer" ? ["professionalTitle", "category", "skills", "experienceLevel", "bio", "hourlyRate", "portfolioUrl", "linkedinUrl"] : ["accountType", "hiringCategories", "hiringFrequency"] : [];
        const missing = required.some((key) => !String(form[key] || "").trim());
        if (missing) { setError("Complete the required fields before continuing."); return false; }
        if (step === 2 && role === "freelancer" && !profileImage) { setError("Add a profile image to complete your freelancer profile."); return false; }
        if (step === 2 && role === "freelancer" && (!Number.isFinite(Number(form.hourlyRate)) || Number(form.hourlyRate) < 0)) { setError("Enter a valid hourly rate."); return false; }
        if (step === 1 && form.password !== form.confirmPassword) { setError("Passwords do not match."); return false; }
        if (step === 2 && role === "employer" && form.accountType === "Company" && (!form.companyName || !form.industry || !form.companySize || !form.position)) { setError("Complete the required company information."); return false; }
        setError(""); return true;
    }

    function nextStep() { if (validateCurrentStep()) setStep((current) => current + 1); }

    async function handleSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (!validateCurrentStep() || !form.termsAccepted) { setError("Accept the Terms of Service and Privacy Policy to create your account."); return; }
        setIsSubmitting(true); setError("");
        const account = { ...form };
        delete account.role;
        delete account.termsAccepted;
        const payload = new FormData();
        Object.entries(account).forEach(([key, value]) => payload.append(key, String(value)));
        payload.append("role", role);
        payload.append("termsAccepted", "true");
        payload.append("profileData", JSON.stringify(role === "freelancer" ? { professionalTitle: form.professionalTitle, category: form.category, skills: String(form.skills).split(",").map((skill) => skill.trim()).filter(Boolean), experienceLevel: form.experienceLevel, bio: form.bio, workType: form.workType, availability: form.availability, hourlyRate: Number(form.hourlyRate), portfolioUrl: form.portfolioUrl, githubUrl: form.githubUrl, linkedinUrl: form.linkedinUrl } : { accountType: form.accountType, companyName: form.companyName, industry: form.industry, companyWebsite: form.companyWebsite, companySize: form.companySize, position: form.position, occupation: form.occupation, hiringCategories: String(form.hiringCategories).split(",").map((category) => category.trim()).filter(Boolean), hiringFrequency: form.hiringFrequency, hiringPurpose: form.hiringPurpose }));
        if (profileImage) payload.append("profileImage", profileImage);
        try {
            const response = await fetch("/api/auth/register", { method: "POST", body: payload });
            const result = await response.json() as { message?: string; error?: string; code?: string };
            if (!response.ok && result.code !== "verification_email_failed") { setError(result.error || "Unable to create your account."); return; }
            if (result.code === "verification_email_failed") setVerificationEmailPending(true);
            setMessage(result.message || "Your FreelanceX account has been created successfully. Check your email to verify your account and complete registration.");
        } catch { setError("Unable to reach FreelanceX. Please try again."); } finally { setIsSubmitting(false); }
    }

    async function resendVerification() {
        setError("");
        try {
            const response = await fetch("/api/auth/resend-verification", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: form.email }) });
            const result = await response.json() as { message?: string; error?: string };
            if (!response.ok) { setError(result.error || "Unable to resend the verification email."); return; }
            setVerificationEmailPending(false);
            setMessage(result.message || "A new verification email has been sent.");
        } catch { setError("Unable to reach FreelanceX. Please try again."); }
    }

    function field(key: string, label: string, type = "text", required = true) {
        const isRequired = role === "freelancer" ? key !== "githubUrl" : required;
        const displayedLabel = role === "freelancer" && key === "githubUrl" ? `${label} (optional)` : label;
        return <label>{displayedLabel}<input className="filter-input" value={String(form[key] || "")} onChange={(event) => update(key, event.target.value)} required={isRequired} type={type} /></label>;
    }
    function passwordField(key: "password" | "confirmPassword", label: string, visible: boolean, setVisible: (visible: boolean) => void, autoComplete: string) {
        return <label>{label}<span className="password-input-wrap"><input autoComplete={autoComplete} className="filter-input" minLength={8} required type={visible ? "text" : "password"} value={String(form[key] || "")} onChange={(event) => update(key, event.target.value)} /><button aria-label={visible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`} aria-pressed={visible} className="password-visibility-toggle" onClick={() => setVisible(!visible)} type="button">{visible ? <EyeOff aria-hidden="true" size={18} /> : <Eye aria-hidden="true" size={18} />}</button></span></label>;
    }
    function selectField(key: string, label: string, options: string[]) { return <label>{label}<select className="filter-input" value={String(form[key] || "")} onChange={(event) => update(key, event.target.value)} required><option value="">Select {label.toLowerCase()}</option>{options.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>; }
    function imageField(required = role === "freelancer") { return <div className="profile-image-field"><span className="filter-label">{required ? "Profile image" : "Profile image (optional)"}</span><div className="profile-image-row">{profileImagePreview ? <Image className="profile-image-preview" src={profileImagePreview} alt="Selected profile preview" width={82} height={82} unoptimized /> : <div className="profile-image-placeholder">Add image</div>}<div><input accept="image/jpeg,image/png,image/webp" className="filter-input" onChange={handleImageChange} required={required} type="file" />{profileImage && <button className="button button-quiet" onClick={() => { setProfileImage(null); setProfileImagePreview(""); }} type="button">Remove image</button>}</div></div></div>; }

    return <main className="page-shell"><header className="site-header"><Link className="logo" href="/"><span className="logo-mark" />FreelanceX</Link><Link className="button-quiet" href="/login">Already have an account?</Link></header><section className="auth-wrap"><div className="auth-card registration-card"><div className="eyebrow">{role === "freelancer" ? "Freelancer registration" : "Employer registration"}</div><h1>{step === 1 ? "Start with the basics." : step === 2 ? "Shape your profile." : "Review and agree."}</h1><p className="muted-copy">Step {step} of 3</p><form className="auth-form" onSubmit={step === 3 ? handleSubmit : (event) => { event.preventDefault(); nextStep(); }}>{step === 1 && <>{field("firstName", "First name")}{field("lastName", "Last name")}{field("email", "Email address", "email")}{passwordField("password", "Password", passwordVisible, setPasswordVisible, "new-password")}{passwordField("confirmPassword", "Confirm password", confirmPasswordVisible, setConfirmPasswordVisible, "new-password")}{field("country", "Country")}{field("city", "City")}</>}{step === 2 && role === "freelancer" && <>{field("professionalTitle", "Professional title")}{selectField("category", "Main category", ["Web Development", "Mobile Development", "UI/UX Design", "Graphics Design", "Writing and Translation", "Digital Marketing", "Data Analysis", "Video Editing", "Virtual Assistance"])}{field("skills", "Skills", "text")}{selectField("experienceLevel", "Experience level", experienceLevels)}{field("bio", "Professional biography", "text")}{selectField("workType", "Preferred work type", workTypes)}{selectField("availability", "Availability", availabilityOptions)}{field("hourlyRate", "Hourly rate (NGN)", "number", false)}{field("portfolioUrl", "Portfolio URL", "url", false)}{field("githubUrl", "GitHub URL", "url", false)}{field("linkedinUrl", "LinkedIn URL", "url", false)}{imageField()}</>}{step === 2 && role === "employer" && <>{selectField("accountType", "Account type", accountTypes)}{form.accountType === "Company" ? <>{field("companyName", "Company name")}{field("industry", "Industry")}{field("companySize", "Company size")}{field("position", "Your position")}{field("companyWebsite", "Company website", "url", false)}</> : field("occupation", "Occupation", "text", false)}{field("hiringCategories", "Services or categories needed")}{selectField("hiringFrequency", "Hiring frequency", hiringFrequencies)}{field("hiringPurpose", "Hiring purpose", "text", false)}{imageField()}</>}{step === 3 && <><p className="muted-copy">Review the <Link className="form-link" href="/terms" target="_blank">Terms of Service</Link> and <Link className="form-link" href="/privacy" target="_blank">Privacy Policy</Link> before creating your account.</p><label className="agreement-option" htmlFor="termsAccepted"><input checked={Boolean(form.termsAccepted)} id="termsAccepted" onChange={(event) => update("termsAccepted", event.target.checked)} type="checkbox" /><span>I have read and agree to the Terms of Service and acknowledge the Privacy Policy.</span></label></>}{message && <p className="success-message" role="status">{message}</p>}{verificationEmailPending && <button className="button button-quiet" onClick={resendVerification} type="button">Resend verification email</button>}{error && <p className="form-error" role="alert">{error}</p>}<div className="wizard-actions">{step > 1 && <button className="button button-quiet" onClick={() => setStep((current) => current - 1)} type="button">Back</button>}{step < 3 ? <button className="button button-primary" type="submit">Continue</button> : <button className="button button-primary" disabled={isSubmitting || Boolean(message) || !form.termsAccepted} type="submit">{isSubmitting ? "Creating account..." : "Create account"}</button>}</div></form></div></section></main>;
}