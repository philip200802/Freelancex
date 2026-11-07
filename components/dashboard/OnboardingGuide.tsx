"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { OnboardingStep, Tutorial } from "@/lib/onboarding-content";
import type { DashboardRole } from "@/components/dashboard/DashboardShell";

type OnboardingState = {
    version: number;
    completedSteps: string[];
    currentStep: string;
    dismissed: boolean;
    welcomeDismissed: boolean;
    completed: boolean;
    tutorialsCompleted: string[];
};

type ApiResult = { onboarding?: OnboardingState; error?: string; role?: DashboardRole; steps?: OnboardingStep[]; tutorials?: Tutorial[] };

export default function OnboardingGuide({ role, userName }: { role: DashboardRole; userName: string }) {
    const router = useRouter();
    const [steps, setSteps] = useState<OnboardingStep[]>([]);
    const [roleTutorials, setRoleTutorials] = useState<Tutorial[]>([]);
    const [state, setState] = useState<OnboardingState | null>(null);
    const [isWelcomeOpen, setIsWelcomeOpen] = useState(false);
    const [isGuideOpen, setIsGuideOpen] = useState(false);
    const [selectedTutorial, setSelectedTutorial] = useState<Tutorial | null>(null);
    const [tutorialStep, setTutorialStep] = useState(0);
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [refresh, setRefresh] = useState(0);

    useEffect(() => {
        const controller = new AbortController();
        async function load() {
            setLoading(true);
            setError("");
            try {
                const response = await fetch("/api/onboarding", { cache: "no-store", signal: controller.signal });
                const result = await response.json() as ApiResult;
                if (!response.ok || !result.onboarding || result.role !== role || !Array.isArray(result.steps) || !Array.isArray(result.tutorials)) throw new Error(result.error || "Onboarding information is unavailable.");
                if (controller.signal.aborted) return;
                setState(result.onboarding);
                setSteps(result.steps);
                setRoleTutorials(result.tutorials);
                setIsWelcomeOpen(!result.onboarding.welcomeDismissed && !result.onboarding.completed);
                setIsGuideOpen(result.onboarding.welcomeDismissed && !result.onboarding.dismissed && !result.onboarding.completed);
            } catch (loadError) {
                if (!controller.signal.aborted) setError(loadError instanceof Error ? loadError.message : "Onboarding information is unavailable.");
            } finally {
                if (!controller.signal.aborted) setLoading(false);
            }
        }
        void load();
        return () => controller.abort();
    }, [refresh, role]);

    useEffect(() => {
        const href = selectedTutorial?.steps[tutorialStep]?.href;
        if (!href) return;
        const target = Array.from(document.querySelectorAll<HTMLElement>("[data-onboarding-target]"))
            .find((element) => element.dataset.onboardingTarget === href);
        target?.classList.add("onboarding-tour-highlight");
        return () => target?.classList.remove("onboarding-tour-highlight");
    }, [selectedTutorial, tutorialStep]);

    const completedCount = useMemo(() => steps.filter((step) => state?.completedSteps.includes(step.id)).length, [steps, state]);
    const progress = Math.round(completedCount / steps.length * 100);

    async function update(payload: Record<string, string | boolean>) {
        setSaving(true);
        setError("");
        try {
            const response = await fetch("/api/onboarding", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });
            const result = await response.json() as ApiResult;
            if (!response.ok || !result.onboarding) throw new Error(result.error || "Onboarding progress could not be saved.");
            setState(result.onboarding);
            return result.onboarding;
        } catch (updateError) {
            setError(updateError instanceof Error ? updateError.message : "Onboarding progress could not be saved.");
            return null;
        } finally {
            setSaving(false);
        }
    }

    async function openGuide() {
        if (state?.dismissed) {
            const nextState = await update({ action: "reopen" });
            if (!nextState) return;
        }
        setIsWelcomeOpen(false);
        setIsGuideOpen(true);
    }

    async function dismissWelcome(): Promise<OnboardingState | null> {
        const nextState = await update({ action: "dismiss-welcome" });
        if (!nextState) return null;
        setIsWelcomeOpen(false);
        setIsGuideOpen(true);
        return nextState;
    }

    async function dismissGuide() {
        const nextState = await update({ action: "dismiss" });
        if (nextState) setIsGuideOpen(false);
    }

    async function toggleStep(stepId: string, completed: boolean) {
        await update({ action: "complete-step", stepId, completed });
    }

    async function startTutorial(tutorial: Tutorial) {
        const nextState = await update({ action: "set-step", stepId: state?.currentStep && steps.some((step) => step.id === state.currentStep) ? state.currentStep : steps[0].id });
        if (!nextState) return;
        setSelectedTutorial(tutorial);
        setTutorialStep(0);
    }

    async function finishTutorial(tutorial: Tutorial) {
        const nextState = await update({ action: "complete-tutorial", tutorialId: tutorial.id });
        if (nextState) setSelectedTutorial(null);
    }

    if (loading) return null;
    if (error && !state) return <section className="onboarding-error" role="alert"><p>{error}</p><button className="button button-outline" onClick={() => setRefresh((value) => value + 1)} type="button">Retry</button></section>;
    if (!state || state.completed) return null;

    const primaryStep = steps.find((step) => step.id === state.currentStep) || steps[0];
    const intro = role === "freelancer"
        ? "Find exciting projects, build your professional profile, and manage your work in one place."
        : role === "employer"
            ? "Find talented professionals, manage projects, and keep your work moving in one place."
            : "Use the administrator workspace to monitor activity and keep FreelanceX trustworthy.";
    const greeting = userName.trim().split(/\s+/)[0] || "there";

    return <section className="onboarding-widget" aria-label="Getting started guide">
        {error && <p className="onboarding-inline-error" role="alert">{error}</p>}
        {!state.dismissed && !isGuideOpen && !isWelcomeOpen && <button className="onboarding-reopen" onClick={() => void openGuide()} type="button">Continue getting started</button>}
        {state.dismissed && <button className="onboarding-reopen" onClick={() => void openGuide()} type="button">Reopen getting-started guide</button>}
        {isWelcomeOpen && <div className="onboarding-welcome">
            <div><span className="eyebrow">Welcome to FreelanceX</span><h2>Welcome, {greeting}!</h2><p>{intro}</p></div>
            <div className="onboarding-welcome-actions">
                <button className="button button-primary" disabled={saving} onClick={() => { void dismissWelcome(); }} type="button">Get Started</button>
                <button className="button button-outline" disabled={saving} onClick={() => { void dismissWelcome().then((nextState) => { if (nextState) router.push(primaryStep.href); }); }} type="button">Explore FreelanceX</button>
                <button className="onboarding-text-button" disabled={saving} onClick={() => { void update({ action: "dismiss" }).then((nextState) => { if (nextState) setIsWelcomeOpen(false); }); }} type="button">Skip for Now</button>
            </div>
        </div>}
        {isGuideOpen && <div className="onboarding-panel">
            <div className="onboarding-panel-header">
                <div><span className="eyebrow">{role === "employer" ? "Client" : role === "admin" ? "Administrator" : "Freelancer"} guide</span><h2>Getting started</h2></div>
                <div className="onboarding-panel-actions"><Link href="/help">Help Center</Link><button className="onboarding-text-button" disabled={saving} onClick={() => { void dismissGuide(); }} type="button">Dismiss</button></div>
            </div>
            <div className="onboarding-progress" aria-label={`${progress}% complete`}><div className="onboarding-progress-label"><span>{completedCount} of {steps.length} steps complete</span><strong>{progress}%</strong></div><div className="onboarding-progress-track"><span style={{ width: `${progress}%` }} /></div></div>
            <div className="onboarding-step-list">
                {steps.map((step, index) => {
                    const completed = state.completedSteps.includes(step.id);
                    return <article className={`onboarding-step${state.currentStep === step.id ? " is-current" : ""}`} key={step.id}>
                        <label className="onboarding-step-check"><input checked={completed} disabled={saving} onChange={(event) => void toggleStep(step.id, event.target.checked)} type="checkbox" /><span>{index + 1}</span></label>
                        <div className="onboarding-step-content"><h3>{step.title}</h3><p>{step.description}</p><Link href={step.href} onClick={() => { void update({ action: "set-step", stepId: step.id }); }}>{step.linkLabel}</Link></div>
                        <button className="onboarding-step-continue" disabled={saving} onClick={() => { void update({ action: "set-step", stepId: step.id }); router.push(step.href); }} type="button">Continue</button>
                    </article>;
                })}
            </div>
            <div className="onboarding-tutorials">
                <div><span className="eyebrow">Optional walkthroughs</span><h3>Learn by doing</h3></div>
                <div className="onboarding-tutorial-list">{roleTutorials.map((tutorial) => <button className="onboarding-tutorial-button" key={tutorial.id} onClick={() => void startTutorial(tutorial)} type="button">{tutorial.title}<span>{state.tutorialsCompleted.includes(tutorial.id) ? "Completed · Restart" : "Start walkthrough"}</span></button>)}</div>
            </div>
        </div>}
        {selectedTutorial && <div className="onboarding-tutorial" aria-live="polite">
            <div className="onboarding-tutorial-heading"><div><span className="eyebrow">Guided walkthrough</span><h2>{selectedTutorial.title}</h2></div><button className="onboarding-text-button" onClick={() => setSelectedTutorial(null)} type="button">Exit</button></div>
            <div className="onboarding-tutorial-step"><span>Step {tutorialStep + 1} of {selectedTutorial.steps.length}</span><h3>{selectedTutorial.steps[tutorialStep].title}</h3><p>{selectedTutorial.steps[tutorialStep].description}</p><Link className="button button-outline" href={selectedTutorial.steps[tutorialStep].href} rel="noreferrer" target="_blank">{selectedTutorial.steps[tutorialStep].linkLabel}</Link></div>
            <div className="onboarding-tutorial-controls"><button className="button button-outline" disabled={tutorialStep === 0 || saving} onClick={() => setTutorialStep((value) => value - 1)} type="button">Back</button>{tutorialStep < selectedTutorial.steps.length - 1
                ? <button className="button button-primary" disabled={saving} onClick={() => setTutorialStep((value) => value + 1)} type="button">Next</button>
                : <button className="button button-primary" disabled={saving} onClick={() => void finishTutorial(selectedTutorial)} type="button">Finish</button>}</div>
        </div>}
    </section>;
}
