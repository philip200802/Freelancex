"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Bell, BriefcaseBusiness, CreditCard, FileCheck, FileText, Files, LayoutDashboard, LogOut, MessageCircle, PlusCircle, Search, Settings, ShieldAlert, Star, Tags, UserRound, Users, Wallet, type LucideIcon } from "lucide-react";
import { ReactNode, useEffect, useRef, useState } from "react";

export type DashboardRole = "freelancer" | "employer" | "admin";
type NavigationItem = { label: string; href: string; icon: LucideIcon };

const navigation: Record<DashboardRole, NavigationItem[]> = {
    freelancer: [
        { label: "Overview", href: "/freelancer/dashboard", icon: LayoutDashboard },
        { label: "Find Jobs", href: "/freelancer/dashboard/jobs", icon: Search },
        { label: "My Proposals", href: "/freelancer/dashboard/proposals", icon: FileText },
        { label: "My Contracts", href: "/freelancer/dashboard/contracts", icon: FileCheck },
        { label: "Messages", href: "/freelancer/dashboard/messages", icon: MessageCircle },
        { label: "Earnings", href: "/freelancer/dashboard/earnings", icon: Wallet },
        { label: "My Reviews", href: "/freelancer/dashboard/reviews", icon: Star },
        { label: "My Profile", href: "/freelancer/dashboard/profile", icon: UserRound },
        { label: "Settings", href: "/freelancer/dashboard/settings", icon: Settings },
    ],
    employer: [
        { label: "Overview", href: "/client/dashboard", icon: LayoutDashboard },
        { label: "Post a Job", href: "/client/dashboard/post-job", icon: PlusCircle },
        { label: "My Jobs", href: "/client/dashboard/jobs", icon: BriefcaseBusiness },
        { label: "Proposals", href: "/client/dashboard/proposals", icon: Files },
        { label: "Hired Freelancers", href: "/client/dashboard/freelancers", icon: Users },
        { label: "My Contracts", href: "/client/dashboard/contracts", icon: FileCheck },
        { label: "Messages", href: "/client/dashboard/messages", icon: MessageCircle },
        { label: "Payments", href: "/client/dashboard/payments", icon: CreditCard },
        { label: "Reviews", href: "/client/dashboard/reviews", icon: Star },
        { label: "My Profile", href: "/client/dashboard/profile", icon: UserRound },
        { label: "Settings", href: "/client/dashboard/settings", icon: Settings },
    ],
    admin: [
        { label: "Overview", href: "/admin/dashboard", icon: LayoutDashboard },
        { label: "Users", href: "/admin/dashboard/users", icon: Users },
        { label: "Jobs", href: "/admin/dashboard/jobs", icon: BriefcaseBusiness },
        { label: "Proposals", href: "/admin/dashboard/proposals", icon: FileText },
        { label: "Contracts", href: "/admin/dashboard/contracts", icon: FileCheck },
        { label: "Transactions", href: "/admin/dashboard/transactions", icon: Wallet },
        { label: "Disputes & Reports", href: "/admin/dashboard/disputes", icon: ShieldAlert },
        { label: "Reviews", href: "/admin/dashboard/reviews", icon: Star },
        { label: "Categories & Skills", href: "/admin/dashboard/categories", icon: Tags },
        { label: "Platform Settings", href: "/admin/dashboard/settings", icon: Settings },
        { label: "Activity Logs", href: "/admin/dashboard/activity-logs", icon: FileText },
    ],
};

const roleLabels: Record<DashboardRole, string> = { freelancer: "Freelancer", employer: "Client", admin: "Admin" };

export default function DashboardShell({ role, userName, userEmail, title, description, children }: { role: DashboardRole; userName: string; userEmail?: string; title: string; description: string; children: ReactNode }) {
    const pathname = usePathname();
    const router = useRouter();
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const [isProfileOpen, setIsProfileOpen] = useState(false);
    const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
    const profileMenuRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        function closeMenus(event: MouseEvent) {
            if (profileMenuRef.current && !profileMenuRef.current.contains(event.target as Node)) setIsProfileOpen(false);
        }
        function closeOnEscape(event: KeyboardEvent) { if (event.key === "Escape") { setIsProfileOpen(false); setIsNotificationsOpen(false); } }
        document.addEventListener("mousedown", closeMenus);
        document.addEventListener("keydown", closeOnEscape);
        return () => { document.removeEventListener("mousedown", closeMenus); document.removeEventListener("keydown", closeOnEscape); };
    }, []);

    async function logout() {
        await fetch("/api/auth/logout", { method: "POST" });
        router.push("/login");
    }

    const profileHref = role === "freelancer" ? "/freelancer/dashboard/profile" : role === "employer" ? "/client/dashboard/profile" : "/admin/dashboard";
    const settingsHref = role === "freelancer" ? "/freelancer/dashboard/settings" : role === "employer" ? "/client/dashboard/settings" : "/admin/dashboard/settings";
    return <div className="dashboard-app"><aside className={`dashboard-sidebar${isSidebarOpen ? " is-open" : ""}`}><div className="dashboard-brand"><Link className="logo" href="/"><span className="logo-mark" />FreelanceX</Link><button className="sidebar-close" onClick={() => setIsSidebarOpen(false)} aria-label="Close navigation" type="button">&times;</button></div><div className="dashboard-role">{roleLabels[role]} workspace</div><nav className="dashboard-nav" aria-label={`${roleLabels[role]} dashboard navigation`}>{navigation[role].map((item) => { const Icon = item.icon; const active = pathname === item.href || (item.href !== `/${role === "employer" ? "client" : role}/dashboard` && pathname.startsWith(`${item.href}/`)); return <Link className={active ? "is-active" : ""} href={item.href} key={item.href} onClick={() => setIsSidebarOpen(false)}><Icon aria-hidden="true" size={18} strokeWidth={1.8} /><span>{item.label}</span></Link>; })}</nav></aside><div className="dashboard-main"><header className="dashboard-topbar"><button className="sidebar-toggle" onClick={() => setIsSidebarOpen(true)} aria-label="Open navigation" type="button">&#9776;</button><div className="dashboard-search"><Search aria-hidden="true" size={17} /><input aria-label="Search dashboard" placeholder="Search" /></div><div className="dashboard-topbar-actions"><div className="notification-wrap"><button className="notification-button" aria-label="Notifications" aria-expanded={isNotificationsOpen} onClick={() => { setIsNotificationsOpen((open) => !open); setIsProfileOpen(false); }} type="button"><Bell aria-hidden="true" size={20} /> </button>{isNotificationsOpen && <div className="notification-panel"><div className="notification-panel-heading"><strong>Notifications</strong><span>0 unread</span></div><div className="notification-empty"><Bell aria-hidden="true" size={20} /><p>No notifications yet.</p><span>Updates about your work will appear here.</span></div></div>}</div><div className="profile-menu-wrap" ref={profileMenuRef}><button className="profile-menu-button" onClick={() => { setIsProfileOpen((open) => !open); setIsNotificationsOpen(false); }} aria-expanded={isProfileOpen} type="button"><span className="profile-avatar"><UserRound aria-hidden="true" size={16} /></span><span className="profile-menu-name">{userName}</span></button>{isProfileOpen && <div className="profile-menu"><div className="profile-menu-identity"><span className="profile-avatar"><UserRound aria-hidden="true" size={16} /></span><div><strong>{userName}</strong><span>{userEmail || "Account profile"}</span></div></div><Link href={profileHref} onClick={() => setIsProfileOpen(false)}><UserRound size={16} />View Profile</Link><Link href={settingsHref} onClick={() => setIsProfileOpen(false)}><Settings size={16} />Settings</Link><button onClick={logout} type="button"><LogOut size={16} />Log out</button></div>}</div></div></header><main className="dashboard-content"><div className="dashboard-page-heading"><div><div className="eyebrow">{roleLabels[role]} dashboard</div><h1>{title}</h1><p>{description}</p></div></div>{children}</main></div></div>;
}
