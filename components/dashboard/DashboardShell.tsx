"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { Bell, BriefcaseBusiness, CheckCircle2, CreditCard, FileCheck, FileText, LayoutDashboard, LogOut, Mail, MessageCircle, PlusCircle, Search, Settings, ShieldAlert, Star, Tags, UserRound, Users, Wallet, type LucideIcon } from "lucide-react";
import { ReactNode, useEffect, useRef, useState } from "react";
import { startGlobalNavigation } from "@/components/navigation/GlobalNavigationLoader";
import { dashboardNotificationsUpdatedEvent, dashboardProfileImageUpdatedEvent } from "@/lib/dashboard-events";

export type DashboardRole = "freelancer" | "employer" | "admin";
type NavigationItem = { label: string; href: string; icon: LucideIcon };
type DashboardNotification = { _id?: string; id?: string; title: string; body: string; href?: string; readAt?: string | null; createdAt: string };
const navigation: Record<DashboardRole, NavigationItem[]> = {
    freelancer: [
        { label: "Overview", href: "/freelancer/dashboard", icon: LayoutDashboard },
        { label: "Find Jobs", href: "/freelancer/dashboard/jobs", icon: Search },
        { label: "My Applications", href: "/freelancer/dashboard/applications", icon: FileText },
        { label: "My Projects", href: "/freelancer/dashboard/contracts", icon: FileCheck },
        { label: "Disputes", href: "/freelancer/dashboard/disputes", icon: ShieldAlert },
        { label: "Messages", href: "/freelancer/dashboard/messages", icon: MessageCircle },
        { label: "Earnings", href: "/freelancer/dashboard/earnings", icon: Wallet },
        { label: "My Reviews", href: "/freelancer/dashboard/reviews", icon: Star },
        { label: "My Profile", href: "/freelancer/dashboard/profile", icon: UserRound },
        { label: "Settings", href: "/freelancer/dashboard/settings", icon: Settings },
    ],
    employer: [
        { label: "Overview", href: "/client/dashboard", icon: LayoutDashboard },
        { label: "Post a Job", href: "/client/dashboard/post-job", icon: PlusCircle },
        { label: "My Jobs", href: "/client/dashboard/projects", icon: BriefcaseBusiness },
        { label: "Applications", href: "/client/dashboard/applications", icon: FileText },
        { label: "Hired Freelancers", href: "/client/dashboard/freelancers", icon: Users },
        { label: "Active Projects", href: "/client/dashboard/contracts", icon: FileCheck },
        { label: "Disputes", href: "/client/dashboard/disputes", icon: ShieldAlert },
        { label: "Completed Projects", href: "/client/dashboard/completed", icon: CheckCircle2 },
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
        { label: "Bank Accounts", href: "/admin/dashboard/bank-accounts", icon: CreditCard },
        { label: "Freelancer Payouts", href: "/admin/dashboard/payouts", icon: Wallet },
        { label: "Email Delivery", href: "/admin/dashboard/email-delivery", icon: Mail },
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
    const [notifications, setNotifications] = useState<DashboardNotification[]>([]);
    const [profileImage, setProfileImage] = useState("");
    const [profileImageRefresh, setProfileImageRefresh] = useState(0);
    const [notificationState, setNotificationState] = useState<"idle" | "loading" | "ready" | "error">("idle");
    const [notificationUnreadCount, setNotificationUnreadCount] = useState(0);
    const [notificationActionError, setNotificationActionError] = useState("");
    const [notificationRefresh, setNotificationRefresh] = useState(0);
    const profileMenuRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const isOverview = (role === "freelancer" && pathname === "/freelancer/dashboard")
            || (role === "employer" && pathname === "/client/dashboard");
        if (!isOverview) return;
        const refreshDashboard = () => router.refresh();
        window.addEventListener("focus", refreshDashboard);
        const timer = window.setInterval(refreshDashboard, 30_000);
        return () => {
            window.removeEventListener("focus", refreshDashboard);
            window.clearInterval(timer);
        };
    }, [pathname, role, router]);

    useEffect(() => {
        const controller = new AbortController();
        async function loadNotifications() {
            setNotificationState("loading");
            try {
                const response = await fetch("/api/notifications", { cache: "no-store", signal: controller.signal });
                const result = await response.json() as { notifications?: DashboardNotification[]; unreadCount?: number; error?: string };
                if (!response.ok || !Array.isArray(result.notifications) || typeof result.unreadCount !== "number") throw new Error(result.error || "Notifications are unavailable.");
                if (controller.signal.aborted) return;
                setNotifications(result.notifications);
                setNotificationUnreadCount(result.unreadCount);
                setNotificationState("ready");
            } catch {
                if (!controller.signal.aborted) setNotificationState("error");
            }
        }
        void loadNotifications();
        return () => controller.abort();
    }, [pathname, notificationRefresh]);

    useEffect(() => {
        function refreshNotifications() {
            setNotificationRefresh((current) => current + 1);
        }
        window.addEventListener(dashboardNotificationsUpdatedEvent, refreshNotifications);
        window.addEventListener("focus", refreshNotifications);
        return () => {
            window.removeEventListener(dashboardNotificationsUpdatedEvent, refreshNotifications);
            window.removeEventListener("focus", refreshNotifications);
        };
    }, []);

    useEffect(() => {
        const timer = window.setInterval(async () => {
            try {
                const response = await fetch("/api/notifications/unread-count", { cache: "no-store" });
                const result = await response.json() as { unreadCount?: number };
                if (!response.ok || typeof result.unreadCount !== "number") throw new Error("Unread notification count is unavailable.");
                setNotificationUnreadCount(result.unreadCount);
                if (isNotificationsOpen) setNotificationRefresh((current) => current + 1);
            } catch (error) {
                console.error("Notification count could not be refreshed.", error);
            }
        }, 30000);
        return () => window.clearInterval(timer);
    }, [isNotificationsOpen]);

    useEffect(() => {
        if (role === "admin") return;
        const controller = new AbortController();
        async function loadProfileImage() {
            try {
                const response = await fetch("/api/account/profile", { cache: "no-store", signal: controller.signal });
                const result = await response.json() as { profile?: { profileImage?: string }; error?: string };
                if (!response.ok) throw new Error(result.error || "Profile image is unavailable.");
                if (!controller.signal.aborted) setProfileImage(result.profile?.profileImage || "");
            } catch (error) {
                if (!controller.signal.aborted) console.error("Dashboard avatar could not be refreshed.", error);
            }
        }
        void loadProfileImage();
        return () => controller.abort();
    }, [pathname, profileImageRefresh, role]);

    useEffect(() => {
        if (role === "admin") return;
        function refreshProfileImage() {
            setProfileImageRefresh((current) => current + 1);
        }
        window.addEventListener(dashboardProfileImageUpdatedEvent, refreshProfileImage);
        return () => window.removeEventListener(dashboardProfileImageUpdatedEvent, refreshProfileImage);
    }, [role]);

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
        setProfileImage("");
        await fetch("/api/auth/logout", { method: "POST" });
        startGlobalNavigation("/login");
        router.push("/login");
    }

    async function markNotificationRead(notification: DashboardNotification) {
        const id = notification._id || notification.id;
        if (!id || notification.readAt) return;
        setNotificationActionError("");
        try {
            const response = await fetch(`/api/notifications/${id}`, { method: "PATCH", cache: "no-store" });
            if (!response.ok) {
                const result = await response.json() as { error?: string };
                throw new Error(result.error || "Notification could not be marked as read.");
            }
            setNotifications((current) => current.map((item) => (item._id || item.id) === id ? { ...item, readAt: new Date().toISOString() } : item));
            setNotificationUnreadCount((current) => Math.max(0, current - 1));
        } catch (error) {
            setNotificationActionError(error instanceof Error ? error.message : "Notification could not be marked as read.");
        }
    }

    async function markAllNotificationsRead() {
        setNotificationActionError("");
        try {
            const response = await fetch("/api/notifications", { method: "PATCH", cache: "no-store" });
            const result = await response.json() as { error?: string };
            if (!response.ok) throw new Error(result.error || "Notifications could not be marked as read.");
            const readAt = new Date().toISOString();
            setNotifications((current) => current.map((item) => ({ ...item, readAt: item.readAt || readAt })));
            setNotificationUnreadCount(0);
        } catch (error) {
            setNotificationActionError(error instanceof Error ? error.message : "Notifications could not be marked as read.");
        }
    }

    const profileHref = role === "freelancer" ? "/freelancer/dashboard/profile" : role === "employer" ? "/client/dashboard/profile" : "/admin/dashboard";
    const settingsHref = role === "freelancer" ? "/freelancer/dashboard/settings" : role === "employer" ? "/client/dashboard/settings" : "/admin/dashboard/settings";
    const unreadCount = notificationUnreadCount;
    return <div className="dashboard-app">
        <aside className={`dashboard-sidebar${isSidebarOpen ? " is-open" : ""}`}>
            <div className="dashboard-brand"><Link className="logo" href="/"><span className="logo-mark" />FreelanceX</Link><button className="sidebar-close" onClick={() => setIsSidebarOpen(false)} aria-label="Close navigation" type="button">&times;</button></div>
            <div className="dashboard-role">{roleLabels[role]} workspace</div>
            <nav className="dashboard-nav" aria-label={`${roleLabels[role]} dashboard navigation`}>{navigation[role].map((item) => { const Icon = item.icon; const active = pathname === item.href || (item.href !== `/${role === "employer" ? "client" : role}/dashboard` && pathname.startsWith(`${item.href}/`)); return <Link className={active ? "is-active" : ""} href={item.href} key={item.href} onClick={() => setIsSidebarOpen(false)}><Icon aria-hidden="true" size={18} strokeWidth={1.8} /><span>{item.label}</span></Link>; })}</nav>
        </aside>
        <div className="dashboard-main">
            <header className="dashboard-topbar">
                <button className="sidebar-toggle" onClick={() => setIsSidebarOpen(true)} aria-label="Open navigation" type="button">&#9776;</button>
                <div className="dashboard-topbar-actions">
                    <div className="notification-wrap">
                        <button className="notification-button" aria-label={unreadCount ? `Notifications, ${unreadCount} unread` : "Notifications"} aria-expanded={isNotificationsOpen} onClick={() => { const shouldOpen = !isNotificationsOpen; setIsNotificationsOpen(shouldOpen); if (shouldOpen) setNotificationRefresh((current) => current + 1); setIsProfileOpen(false); }} type="button"><Bell aria-hidden="true" size={20} />{unreadCount > 0 && <span aria-hidden="true" className="notification-unread-dot">{unreadCount > 99 ? "99+" : unreadCount}</span>}</button>
                        {isNotificationsOpen && <div className="notification-panel">
                            <div className="notification-panel-heading"><strong>Notifications</strong><span>{unreadCount} unread</span></div>
                            {unreadCount > 0 && <button className="notification-mark-all" onClick={() => void markAllNotificationsRead()} type="button">Mark all as read</button>}
                            {notificationState === "loading" && <div className="notification-empty" role="status">Loading notifications...</div>}
                            {notificationState === "error" && <div className="notification-empty" role="alert">Notifications are unavailable. Close and reopen this panel to retry.</div>}
                            {notificationActionError && <p className="form-error" role="alert">{notificationActionError}</p>}
                            {notificationState === "ready" && notifications.length === 0 && <div className="notification-empty"><Bell aria-hidden="true" size={20} /><p>You&apos;re all caught up.</p><span>New notifications will appear here.</span></div>}
                            {notificationState === "ready" && notifications.map((notification) => {
                                const href = notification.href?.startsWith("/") && !notification.href.startsWith("//")
                                    ? notification.href
                                    : role === "employer" ? "/client/dashboard/notifications" : `/${role}/dashboard/notifications`;
                                return <Link className={`notification-item${notification.readAt ? "" : " is-unread"}`} href={href} key={notification._id || notification.id || notification.createdAt} onClick={() => { void markNotificationRead(notification); setIsNotificationsOpen(false); }}>
                                    <strong>{notification.title}</strong><p>{notification.body}</p><small>{new Date(notification.createdAt).toLocaleString()} | {notification.readAt ? "Read" : "Unread"}</small>
                                </Link>;
                            })}
                            <Link className="notification-view-all" href={role === "employer" ? "/client/dashboard/notifications" : `/${role}/dashboard/notifications`} onClick={() => setIsNotificationsOpen(false)}>View all notifications</Link>
                        </div>}
                    </div>
                    <div className="profile-menu-wrap" ref={profileMenuRef}>
                        <button className="profile-menu-button" onClick={() => { setIsProfileOpen((open) => !open); setIsNotificationsOpen(false); }} aria-expanded={isProfileOpen} type="button"><span className="profile-avatar">{role !== "admin" && profileImage ? <Image alt="" className="profile-avatar-image" height={36} src={profileImage} unoptimized width={36} /> : <span aria-hidden="true">{userName.trim().charAt(0).toUpperCase() || <UserRound size={16} />}</span>}</span><span className="profile-menu-name">{userName}</span></button>
                        {isProfileOpen && <div className="profile-menu"><div className="profile-menu-identity"><span className="profile-avatar">{role !== "admin" && profileImage ? <Image alt="" className="profile-avatar-image" height={36} src={profileImage} unoptimized width={36} /> : <span aria-hidden="true">{userName.trim().charAt(0).toUpperCase() || <UserRound size={16} />}</span>}</span><div><strong>{userName}</strong><span>{userEmail || "Account profile"}</span></div></div><Link href={profileHref} onClick={() => setIsProfileOpen(false)}><UserRound size={16} />View Profile</Link><Link href={settingsHref} onClick={() => setIsProfileOpen(false)}><Settings size={16} />Settings</Link><button onClick={logout} type="button"><LogOut size={16} />Log out</button></div>}
                    </div>
                </div>
            </header>
            <main className="dashboard-content"><div className="dashboard-page-heading"><div><div className="eyebrow">{roleLabels[role]} dashboard</div><h1>{title}</h1><p>{description}</p></div></div>{children}</main>
        </div>
    </div>;
}
