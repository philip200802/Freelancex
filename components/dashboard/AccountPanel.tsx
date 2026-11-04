"use client";

import { FormEvent, useEffect, useState } from "react";

type AccountProfile = {
    user: { firstName: string; lastName: string; name: string; email: string; role: string; country: string; city: string };
    profile?: Record<string, unknown> | null;
};
type Preferences = { emailNotifications: boolean; inAppNotifications: boolean; profileVisibility: "public" | "private" };

export default function AccountPanel({ section }: { section: "profile" | "settings" }) {
    const [profile, setProfile] = useState<AccountProfile | null>(null);
    const [preferences, setPreferences] = useState<Preferences>({ emailNotifications: true, inAppNotifications: true, profileVisibility: "public" });
    const [state, setState] = useState<"loading" | "ready" | "error">("loading");
    const [error, setError] = useState("");
    const [success, setSuccess] = useState("");

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

    async function save(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setError("");
        setSuccess("");
        const endpoint = section === "profile" ? "/api/account/profile" : "/api/account/preferences";
        const method = section === "profile" ? "PATCH" : "PUT";
        const payload = section === "profile" ? {
            firstName: profile?.user.firstName,
            lastName: profile?.user.lastName,
            city: profile?.user.city,
            country: profile?.user.country,
        } : preferences;
        try {
            const response = await fetch(endpoint, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
            const result = await response.json() as { error?: string; user?: AccountProfile["user"] };
            if (!response.ok) throw new Error(result.error || "Changes could not be saved.");
            if (section === "profile" && result.user && profile) setProfile({ ...profile, user: { ...profile.user, ...result.user } });
            setSuccess(section === "profile" ? "Profile saved." : "Settings saved.");
        } catch (saveError) {
            setError(saveError instanceof Error ? saveError.message : "Changes could not be saved.");
        }
    }

    if (state === "loading") return <div className="dashboard-empty" role="status">Loading {section}...</div>;
    if (state === "error") return <div className="dashboard-empty" role="alert">{error}</div>;

    if (section === "profile" && profile) {
        return <form className="dashboard-form" onSubmit={(event) => void save(event)}>
            <h2>Account profile</h2>
            <div className="dashboard-form-row">
                <label>First name<input className="filter-input" required value={profile.user.firstName} onChange={(event) => setProfile({ ...profile, user: { ...profile.user, firstName: event.target.value } })} /></label>
                <label>Last name<input className="filter-input" required value={profile.user.lastName} onChange={(event) => setProfile({ ...profile, user: { ...profile.user, lastName: event.target.value } })} /></label>
            </div>
            <label>Email<input className="filter-input" disabled value={profile.user.email} /></label>
            <div className="dashboard-form-row">
                <label>City<input className="filter-input" required value={profile.user.city} onChange={(event) => setProfile({ ...profile, user: { ...profile.user, city: event.target.value } })} /></label>
                <label>Country<input className="filter-input" required value={profile.user.country} onChange={(event) => setProfile({ ...profile, user: { ...profile.user, country: event.target.value } })} /></label>
            </div>
            {profile.profile && <section className="dashboard-panel"><h3>Professional profile information</h3><dl>{Object.entries(profile.profile).filter(([key, value]) => key !== "_id" && key !== "user" && key !== "__v" && value !== undefined && value !== null && typeof value !== "object").map(([key, value]) => <div key={key}><dt>{key.replace(/([A-Z])/g, " $1")}</dt><dd>{String(value)}</dd></div>)}</dl></section>}
            {error && <p className="form-error" role="alert">{error}</p>}
            {success && <p className="success-message" role="status">{success}</p>}
            <button className="button button-primary" type="submit">Save Profile</button>
        </form>;
    }

    return <form className="dashboard-form" onSubmit={(event) => void save(event)}>
        <h2>Account settings</h2>
        <label><input checked={preferences.emailNotifications} type="checkbox" onChange={(event) => setPreferences({ ...preferences, emailNotifications: event.target.checked })} /> Email notifications</label>
        <label><input checked={preferences.inAppNotifications} type="checkbox" onChange={(event) => setPreferences({ ...preferences, inAppNotifications: event.target.checked })} /> In-app notifications</label>
        <label>Profile visibility<select className="filter-input" value={preferences.profileVisibility} onChange={(event) => setPreferences({ ...preferences, profileVisibility: event.target.value as Preferences["profileVisibility"] })}><option value="public">Public</option><option value="private">Private</option></select></label>
        {error && <p className="form-error" role="alert">{error}</p>}
        {success && <p className="success-message" role="status">{success}</p>}
        <button className="button button-primary" type="submit">Save Settings</button>
    </form>;
}
