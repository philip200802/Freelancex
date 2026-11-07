import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { connectToDatabase } from "@/lib/mongodb";
import { onboardingSteps, tutorials } from "@/lib/onboarding-content";
import { applyOnboardingAction, normalizeOnboardingState, parseOnboardingAction, resetOutdatedOnboarding } from "@/lib/onboarding-state";
import User from "@/models/User";

export async function GET() {
    const currentUser = await getCurrentUser();
    if (!currentUser) return NextResponse.json({ error: "Authentication required." }, { status: 401 });

    await connectToDatabase();
    const user = await User.findById(currentUser.userId).select("role onboarding").lean();
    if (!user || user.role !== currentUser.role) return NextResponse.json({ error: "Account is unavailable." }, { status: 404 });

    return NextResponse.json({
        role: user.role,
        onboarding: resetOutdatedOnboarding(user.onboarding),
        steps: onboardingSteps[currentUser.role],
        tutorials: tutorials[currentUser.role],
    });
}

export async function PATCH(request: Request) {
    const currentUser = await getCurrentUser();
    if (!currentUser) return NextResponse.json({ error: "Authentication required." }, { status: 401 });

    let body: unknown;
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: "A valid onboarding action is required." }, { status: 400 });
    }
    const action = parseOnboardingAction(body);
    if (!action) return NextResponse.json({ error: "A valid onboarding action is required." }, { status: 400 });
    await connectToDatabase();
    const user = await User.findOne({ _id: currentUser.userId, role: currentUser.role }).select("onboarding");
    if (!user) return NextResponse.json({ error: "Account is unavailable." }, { status: 404 });

    const result = applyOnboardingAction(resetOutdatedOnboarding(user.onboarding), currentUser.role, action);
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });

    user.set("onboarding", normalizeOnboardingState(result.state));
    await user.save();
    return NextResponse.json({ onboarding: result.state });
}
