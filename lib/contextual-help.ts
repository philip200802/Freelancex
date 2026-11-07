import type { DashboardRole } from "@/components/dashboard/DashboardShell";

export function contextualHelpTopic(pathname: string, role?: DashboardRole) {
    if (pathname.includes("disputes")) return role === "admin" ? "admin-operations" : "disputes";
    if (role === "admin" && /jobs|contracts|projects|applications|proposals/.test(pathname)) return "admin-users";
    if (pathname.includes("payout") || pathname.includes("earnings")) return "payouts";
    if (pathname.includes("bank-accounts")) return "bank-verification";
    if (pathname.includes("transaction") || pathname.includes("payments")) return "payments";
    if (pathname.includes("application") || pathname.includes("proposal")) return "applications";
    if (pathname.includes("contract") || pathname.includes("project")) return "contracts";
    if (pathname.includes("jobs") || pathname.includes("post-job")) return "projects";
    if (pathname.includes("profile")) return role === "employer" ? "client-profile" : role === "admin" ? "admin-users" : "freelancer-profile";
    if (pathname.includes("settings")) return "account-settings";
    if (pathname.includes("email-delivery") || pathname.includes("activity-logs")) return "admin-operations";
    if (pathname.includes("users")) return "admin-users";
    return "getting-started";
}
