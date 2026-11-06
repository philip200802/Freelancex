"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { dashboardNotificationsUpdatedEvent } from "@/lib/dashboard-events";

type DashboardNotification = { _id?: string; id?: string; title: string; body: string; href?: string; readAt?: string | null; createdAt: string };

export default function NotificationsList({ role }: { role: "employer" | "freelancer" | "admin" }) {
    const [notifications, setNotifications] = useState<DashboardNotification[]>([]);
    const [state, setState] = useState<"loading" | "success" | "error">("loading");
    const [error, setError] = useState("");

    useEffect(() => {
        const controller = new AbortController();
        async function load() {
            try {
                const response = await fetch("/api/notifications", { cache: "no-store", signal: controller.signal });
                const result = await response.json() as { notifications?: DashboardNotification[]; error?: string };
                if (!response.ok) throw new Error(result.error || "Notifications are unavailable.");
                if (!Array.isArray(result.notifications)) throw new Error("The notifications response was invalid.");
                if (controller.signal.aborted) return;
                setNotifications(result.notifications);
                setState("success");
            } catch (loadError) {
                if (controller.signal.aborted) return;
                setError(loadError instanceof Error ? loadError.message : "Notifications are unavailable.");
                setState("error");
            }
        }
        void load();
        return () => controller.abort();
    }, []);

    async function markAsRead(notification: DashboardNotification) {
        const id = notification._id || notification.id;
        if (!id || notification.readAt) return;
        try {
            const response = await fetch(`/api/notifications/${id}`, { method: "PATCH", cache: "no-store" });
            if (!response.ok) {
                const result = await response.json() as { error?: string };
                throw new Error(result.error || "Notification could not be marked as read.");
            }
            setNotifications((current) => current.map((item) => (item._id || item.id) === id ? { ...item, readAt: new Date().toISOString() } : item));
            window.dispatchEvent(new Event(dashboardNotificationsUpdatedEvent));
        } catch (actionError) {
            setError(actionError instanceof Error ? actionError.message : "Notification could not be marked as read.");
        }
    }

    async function markAllAsRead() {
        setError("");
        try {
            const response = await fetch("/api/notifications", { method: "PATCH", cache: "no-store" });
            const result = await response.json() as { error?: string };
            if (!response.ok) throw new Error(result.error || "Notifications could not be marked as read.");
            const readAt = new Date().toISOString();
            setNotifications((current) => current.map((item) => ({ ...item, readAt: item.readAt || readAt })));
            window.dispatchEvent(new Event(dashboardNotificationsUpdatedEvent));
        } catch (actionError) {
            setError(actionError instanceof Error ? actionError.message : "Notifications could not be marked as read.");
        }
    }

    if (state === "loading") return <div className="dashboard-empty" role="status">Loading notifications...</div>;
    if (state === "error") return <div className="dashboard-empty" role="alert">{error}</div>;
    if (!notifications.length) return <div className="dashboard-empty"><strong>You&apos;re all caught up.</strong><p>New notifications will appear here.</p></div>;
    return <div className="dashboard-list">
        {error && <p className="form-error" role="alert">{error}</p>}
        {notifications.some((notification) => !notification.readAt) && <div className="notifications-list-actions"><button className="button button-quiet" onClick={() => void markAllAsRead()} type="button">Mark all as read</button></div>}
        {notifications.map((notification) => {
            const href = notification.href?.startsWith("/") && !notification.href.startsWith("//")
                ? notification.href
                : role === "employer" ? "/client/dashboard/notifications" : `/${role}/dashboard/notifications`;
            return <article className={`dashboard-list-row${notification.readAt ? "" : " is-unread"}`} key={notification._id || notification.id || notification.createdAt}>
                <div><strong>{notification.title}</strong><p>{notification.body}</p><time>{new Date(notification.createdAt).toLocaleString()} | {notification.readAt ? "Read" : "Unread"}</time></div>
                <div>{notification.readAt ? <span className="status-badge">Read</span> : <button className="button button-quiet" onClick={() => void markAsRead(notification)} type="button">Mark as read</button>}<Link className="text-link" href={href}>Open</Link></div>
            </article>;
        })}
    </div>;
}
