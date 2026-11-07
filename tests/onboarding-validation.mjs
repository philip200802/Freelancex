import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { applyOnboardingAction, normalizeOnboardingState, parseOnboardingAction, resetOutdatedOnboarding } from "../lib/onboarding-state.ts";
import User from "../models/User.ts";

const initial = resetOutdatedOnboarding();
assert.deepEqual(initial.completedSteps, []);
assert.deepEqual(initial.tutorialsCompleted, []);
assert.equal(initial.dismissed, false);
assert.equal(initial.welcomeDismissed, false);

const freelancerStep = applyOnboardingAction(initial, "freelancer", {
    action: "complete-step",
    stepId: "profile",
    completed: true,
});
assert.ok("state" in freelancerStep);
assert.deepEqual(freelancerStep.state.completedSteps, ["profile"]);
assert.equal(freelancerStep.state.completed, false);
assert.ok("error" in applyOnboardingAction(initial, "freelancer", {
    action: "complete-step",
    stepId: "review-users",
    completed: true,
}));

let allAdminSteps = initial;
for (const stepId of ["review-users", "monitor-projects", "review-payments", "review-disputes", "review-activity"]) {
    const result = applyOnboardingAction(allAdminSteps, "admin", { action: "complete-step", stepId, completed: true });
    assert.ok("state" in result);
    allAdminSteps = result.state;
}
assert.equal(allAdminSteps.completed, true);

const dismissed = applyOnboardingAction(initial, "employer", { action: "dismiss" });
assert.ok("state" in dismissed);
assert.equal(dismissed.state.dismissed, true);
assert.equal(dismissed.state.welcomeDismissed, true);
const reopened = applyOnboardingAction(dismissed.state, "employer", { action: "reopen" });
assert.ok("state" in reopened);
assert.equal(reopened.state.dismissed, false);

const tutorial = applyOnboardingAction(initial, "freelancer", { action: "complete-tutorial", tutorialId: "apply-project" });
assert.ok("state" in tutorial);
assert.deepEqual(tutorial.state.tutorialsCompleted, ["apply-project"]);
assert.ok("error" in applyOnboardingAction(initial, "freelancer", { action: "complete-tutorial", tutorialId: "admin-review" }));
assert.equal(parseOnboardingAction({ action: "complete-step", stepId: "profile", completed: "yes" }), null);
assert.equal(resetOutdatedOnboarding({ version: 0, dismissed: true }).dismissed, false);
assert.equal(normalizeOnboardingState({ currentStep: "profile" }).currentStep, "profile");

const user = new User({
    name: "Test User",
    firstName: "Test",
    lastName: "User",
    email: "test@example.test",
    passwordHash: "not-a-real-password-hash",
    role: "freelancer",
    country: "Nigeria",
    city: "Lagos",
    termsAcceptedAt: new Date(),
    termsVersion: "test",
    privacyPolicyVersion: "test",
});
assert.deepEqual(user.onboarding.completedSteps, []);
assert.equal(user.onboarding.version, 1);
await user.validate();

const routeSource = await readFile(new URL("../app/api/onboarding/route.ts", import.meta.url), "utf8");
const guideSource = await readFile(new URL("../components/dashboard/OnboardingGuide.tsx", import.meta.url), "utf8");
const helpCenterSource = await readFile(new URL("../components/dashboard/HelpCenter.tsx", import.meta.url), "utf8");
assert.match(routeSource, /getCurrentUser\(\)/);
assert.match(routeSource, /_id: currentUser\.userId, role: currentUser\.role/);
assert.doesNotMatch(routeSource, /body\.userId/);
assert.doesNotMatch(guideSource, /import\s*\{\s*(?:onboardingSteps|tutorials)/);
assert.doesNotMatch(helpCenterSource, /import\s*\{\s*helpArticles/);

console.log("Onboarding validation passed: role-specific steps, persistence defaults, version reset, dismissal, tutorial completion, and authenticated user scoping.");
