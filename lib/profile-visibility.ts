export type ProfileVisibilitySettings = {
    profileVisibility?: "public" | "private";
    emailVisibility?: boolean;
    companyInfoVisibility?: boolean;
};

export function canViewProfile(
    settings: ProfileVisibilitySettings,
    isOwner: boolean,
    isAdmin: boolean,
    hasRelevantRelationship: boolean,
) {
    return settings.profileVisibility !== "private" || isOwner || isAdmin || hasRelevantRelationship;
}

export function canShowProfileEmail(settings: ProfileVisibilitySettings) {
    return settings.profileVisibility !== "private" && settings.emailVisibility === true;
}

export function canShowCompanyInfo(settings: ProfileVisibilitySettings) {
    return settings.companyInfoVisibility !== false;
}
