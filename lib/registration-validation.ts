export function isOptionalGithubProfileUrlValid(value: unknown) {
    if (value === undefined || value === null || value === "") return true;
    if (typeof value !== "string") return false;

    const trimmedValue = value.trim();
    if (!trimmedValue) return true;

    try {
        const url = new URL(trimmedValue);
        return (url.protocol === "https:" || url.protocol === "http:")
            && (url.hostname === "github.com" || url.hostname === "www.github.com")
            && url.pathname.split("/").filter(Boolean).length > 0
            && !url.username
            && !url.password;
    } catch {
        return false;
    }
}

function isHttpUrl(value: unknown) {
    if (typeof value !== "string" || !value.trim()) return false;
    try {
        const url = new URL(value.trim());
        return (url.protocol === "https:" || url.protocol === "http:")
            && Boolean(url.hostname)
            && !url.username
            && !url.password;
    } catch {
        return false;
    }
}

export function validateFreelancerRegistrationProfile(
    profileData: Record<string, unknown>,
    hasProfileImage: boolean,
) {
    if (!String(profileData.professionalTitle || "").trim()
        || !String(profileData.category || "").trim()
        || !Array.isArray(profileData.skills)
        || profileData.skills.length === 0
        || profileData.skills.some((skill) => typeof skill !== "string" || !skill.trim())
        || !String(profileData.bio || "").trim()
        || !["Beginner", "Intermediate", "Expert"].includes(String(profileData.experienceLevel))
        || !["Freelance", "Contract", "Part-time"].includes(String(profileData.workType))
        || !["Available", "Busy", "Not currently available"].includes(String(profileData.availability))) {
        return "Complete the freelancer profile with valid experience, work type, and availability values.";
    }

    if (typeof profileData.hourlyRate !== "number" || !Number.isFinite(profileData.hourlyRate) || profileData.hourlyRate < 0) {
        return "Enter a valid hourly rate.";
    }
    if (!isHttpUrl(profileData.portfolioUrl) || !isHttpUrl(profileData.linkedinUrl)) {
        return "Enter valid portfolio and LinkedIn URLs.";
    }
    if (!isOptionalGithubProfileUrlValid(profileData.githubUrl)) {
        return "Enter a valid GitHub profile URL or leave the field blank.";
    }
    if (!hasProfileImage) {
        return "Add a profile image to complete your freelancer registration.";
    }
    return "";
}
