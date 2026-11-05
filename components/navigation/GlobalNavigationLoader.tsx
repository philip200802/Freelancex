"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

const navigationEventName = "freelancex:navigation";
type NavigationEventDetail =
    | { type: "start"; target: string }
    | { type: "cancel"; target: string }
    | { type: "route-start" }
    | { type: "route-complete" };

function dispatchNavigationEvent(detail: NavigationEventDetail) {
    window.dispatchEvent(new CustomEvent<NavigationEventDetail>(navigationEventName, { detail }));
}

function routeKey(url: URL) {
    return `${url.pathname}${url.search}`;
}

export function startGlobalNavigation(target: string) {
    if (typeof window !== "undefined") {
        dispatchNavigationEvent({ type: "start", target: routeKey(new URL(target, window.location.href)) });
    }
}

export function NavigationPendingSignal() {
    useEffect(() => {
        dispatchNavigationEvent({ type: "route-start" });
        return () => dispatchNavigationEvent({ type: "route-complete" });
    }, []);
    return null;
}

export default function GlobalNavigationLoader() {
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const currentRoute = `${pathname}${searchParams.size ? `?${searchParams.toString()}` : ""}`;
    const [visible, setVisible] = useState(false);
    const [exiting, setExiting] = useState(false);
    const visibleRef = useRef(visible);
    const pendingRouteCount = useRef(0);
    const pendingTarget = useRef("");
    const lastRoute = useRef(currentRoute);
    const hideTimer = useRef<number | null>(null);
    const failsafeTimer = useRef<number | null>(null);

    useEffect(() => {
        function clearTimers() {
            if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
            if (failsafeTimer.current !== null) window.clearTimeout(failsafeTimer.current);
            hideTimer.current = null;
            failsafeTimer.current = null;
        }

        function show() {
            if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
            hideTimer.current = null;
            visibleRef.current = true;
            setVisible(true);
            setExiting(false);
            if (failsafeTimer.current !== null) window.clearTimeout(failsafeTimer.current);
            failsafeTimer.current = window.setTimeout(() => {
                pendingTarget.current = "";
                pendingRouteCount.current = 0;
                setExiting(true);
                hideTimer.current = window.setTimeout(() => {
                    visibleRef.current = false;
                    setVisible(false);
                    setExiting(false);
                }, 180);
            }, 15_000);
        }

        function hide() {
            pendingTarget.current = "";
            if (failsafeTimer.current !== null) window.clearTimeout(failsafeTimer.current);
            failsafeTimer.current = null;
            if (!visibleRef.current) return;
            setExiting(true);
            if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
            hideTimer.current = window.setTimeout(() => {
                visibleRef.current = false;
                setVisible(false);
                setExiting(false);
            }, 180);
        }

        function handleNavigationEvent(event: Event) {
            const detail = (event as CustomEvent<NavigationEventDetail>).detail;
            if (detail.type === "start") {
                pendingTarget.current = detail.target;
                show();
                return;
            }
            if (detail.type === "cancel") {
                if (pendingTarget.current === detail.target && pendingRouteCount.current === 0) hide();
                return;
            }
            if (detail.type === "route-start") {
                pendingRouteCount.current += 1;
                show();
                return;
            }
            pendingRouteCount.current = Math.max(0, pendingRouteCount.current - 1);
            if (pendingRouteCount.current === 0) hide();
        }

        function handleClick(event: MouseEvent) {
            if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            const target = event.target;
            if (!(target instanceof Element)) return;
            const anchor = target.closest("a[href]");
            if (!(anchor instanceof HTMLAnchorElement) || anchor.target === "_blank" || anchor.hasAttribute("download")) return;
            const destination = new URL(anchor.href, window.location.href);
            if (destination.origin !== window.location.origin || routeKey(destination) === routeKey(new URL(window.location.href))) return;
            const targetRoute = routeKey(destination);
            dispatchNavigationEvent({ type: "start", target: targetRoute });
            window.setTimeout(() => {
                if (routeKey(new URL(window.location.href)) !== targetRoute) {
                    dispatchNavigationEvent({ type: "cancel", target: targetRoute });
                }
            }, 350);
        }

        function handleSubmit(event: SubmitEvent) {
            const form = event.target;
            if (!(form instanceof HTMLFormElement) || form.method.toLowerCase() !== "get" || form.target === "_blank") return;
            const destination = new URL(form.action, window.location.href);
            if (destination.origin !== window.location.origin || routeKey(destination) === routeKey(new URL(window.location.href))) return;
            dispatchNavigationEvent({ type: "start", target: routeKey(destination) });
        }

        window.addEventListener(navigationEventName, handleNavigationEvent);
        document.addEventListener("click", handleClick);
        document.addEventListener("submit", handleSubmit);
        return () => {
            window.removeEventListener(navigationEventName, handleNavigationEvent);
            document.removeEventListener("click", handleClick);
            document.removeEventListener("submit", handleSubmit);
            clearTimers();
        };
    }, []);

    useEffect(() => {
        if (lastRoute.current === currentRoute) return;
        lastRoute.current = currentRoute;
        const timer = window.setTimeout(() => {
            if (pendingRouteCount.current > 0) return;
            if (!pendingTarget.current || pendingTarget.current === currentRoute) {
                pendingTarget.current = "";
                if (failsafeTimer.current !== null) window.clearTimeout(failsafeTimer.current);
                failsafeTimer.current = null;
                if (visible) {
                    setExiting(true);
                    if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
                    hideTimer.current = window.setTimeout(() => {
                        visibleRef.current = false;
                        setVisible(false);
                        setExiting(false);
                    }, 180);
                }
            }
        }, 120);
        return () => window.clearTimeout(timer);
    }, [currentRoute, visible]);

    if (!visible) return null;
    return (
        <div className={`global-navigation-loader${exiting ? " is-exiting" : ""}`} role="status" aria-label="Loading FreelanceX page">
            <div className="global-navigation-loader-content">
                <span className="global-navigation-brand">FreelanceX</span>
                <span className="global-navigation-spinner" aria-hidden="true" />
            </div>
        </div>
    );
}
