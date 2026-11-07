import { onboardingSteps, onboardingVersion, tutorials } from "./onboarding-content.ts";
import type { DashboardRole } from "@/lib/onboarding-content";

export type OnboardingAction =
    | { action: "complete-step"; stepId: string; completed: boolean }
    | { action: "set-step"; stepId: string }
    | { action: "dismiss" | "reopen" | "dismiss-welcome" }
    | { action: "complete-tutorial"; tutorialId: string };

export type OnboardingState = {
    version: number;
    completedSteps: string[];
    currentStep: string;
    dismissed: boolean;
    welcomeDismissed: boolean;
    completed: boolean;
    tutorialsCompleted: string[];
};

export function parseOnboardingAction(value: unknown): OnboardingAction | null {
    if (!value || typeof value !== "object" || !("action" in value) || typeof value.action !== "string") return null;
    const record = value as Record<string, unknown>;
    if (record.action === "complete-step" && typeof record.stepId === "string" && typeof record.completed === "boolean") {
        return { action: "complete-step", stepId: record.stepId, completed: record.completed };
    }
    if (record.action === "set-step" && typeof record.stepId === "string") return { action: "set-step", stepId: record.stepId };
    if (record.action === "dismiss" || record.action === "reopen" || record.action === "dismiss-welcome") return { action: record.action };
    if (record.action === "complete-tutorial" && typeof record.tutorialId === "string") {
        return { action: "complete-tutorial", tutorialId: record.tutorialId };
    }
    return null;
}

export function normalizeOnboardingState(value?: Partial<OnboardingState> | null): OnboardingState {
    return {
        version: typeof value?.version === "number" ? value.version : onboardingVersion,
        completedSteps: Array.isArray(value?.completedSteps) ? value.completedSteps : [],
        currentStep: typeof value?.currentStep === "string" ? value.currentStep : "",
        dismissed: value?.dismissed === true,
        welcomeDismissed: value?.welcomeDismissed === true,
        completed: value?.completed === true,
        tutorialsCompleted: Array.isArray(value?.tutorialsCompleted) ? value.tutorialsCompleted : [],
    };
}

export function resetOutdatedOnboarding(value?: Partial<OnboardingState> | null): OnboardingState {
    const state = normalizeOnboardingState(value);
    if (state.version === onboardingVersion) return state;
    return normalizeOnboardingState();
}

export function applyOnboardingAction(
    state: OnboardingState,
    role: DashboardRole,
    action: OnboardingAction,
): { state: OnboardingState } | { error: string } {
    const roleSteps = onboardingSteps[role];
    const stepIds = new Set(roleSteps.map((step) => step.id));
    const tutorialIds = new Set(tutorials[role].map((tutorial) => tutorial.id));
    const updated = { ...state, completedSteps: [...state.completedSteps], tutorialsCompleted: [...state.tutorialsCompleted] };

    if (action.action === "complete-step") {
        if (!stepIds.has(action.stepId)) return { error: "That onboarding step is not available for your account." };
        updated.completedSteps = action.completed
            ? [...new Set([...updated.completedSteps, action.stepId])]
            : updated.completedSteps.filter((id) => id !== action.stepId);
        updated.currentStep = action.stepId;
        updated.completed = roleSteps.every((step) => updated.completedSteps.includes(step.id));
        if (!updated.completed) updated.dismissed = false;
    } else if (action.action === "set-step") {
        if (!stepIds.has(action.stepId)) return { error: "That onboarding step is not available for your account." };
        updated.currentStep = action.stepId;
    } else if (action.action === "dismiss") {
        updated.dismissed = true;
        updated.welcomeDismissed = true;
    } else if (action.action === "reopen") {
        updated.dismissed = false;
    } else if (action.action === "dismiss-welcome") {
        updated.welcomeDismissed = true;
    } else if (action.action === "complete-tutorial") {
        if (!tutorialIds.has(action.tutorialId)) return { error: "That tutorial is not available for your account." };
        updated.tutorialsCompleted = [...new Set([...updated.tutorialsCompleted, action.tutorialId])];
    }

    return { state: updated };
}
