import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import Application from "../models/Application.ts";

const indexes = Application.schema.indexes();
assert.ok(indexes.some(([keys, options]) =>
    keys.task === 1 && keys.freelancer === 1 && options.unique === true));
assert.ok(!indexes.some(([keys, options]) =>
    options.unique === true && Object.keys(keys).length === 1 && keys.task === 1));
assert.equal(Application.schema.path("freelancer").options.required, true);

const applicationRoute = await readFile(new URL("../app/api/tasks/[taskId]/route.ts", import.meta.url), "utf8");
const submissionHelper = await readFile(new URL("../lib/application-submission.ts", import.meta.url), "utf8");
const clientListingRoute = await readFile(new URL("../app/api/applications/route.ts", import.meta.url), "utf8");
const reviewRoute = await readFile(new URL("../app/api/applications/[applicationId]/route.ts", import.meta.url), "utf8");
const clientUi = await readFile(new URL("../components/dashboard/ApplicationList.tsx", import.meta.url), "utf8");
const indexMigration = await readFile(new URL("../scripts/migrate-application-index.mjs", import.meta.url), "utf8");
const dashboardShell = await readFile(new URL("../components/dashboard/DashboardShell.tsx", import.meta.url), "utf8");
const helpPage = await readFile(new URL("../app/help/page.tsx", import.meta.url), "utf8");
const submissionHandler = applicationRoute.slice(
    applicationRoute.indexOf("export async function POST"),
    applicationRoute.indexOf("export async function PATCH"),
);

assert.match(submissionHandler, /currentUser\.role !== "freelancer"/);
assert.match(submissionHandler, /Application\.findOne\(\{ task: taskId, freelancer: currentUser\.userId \}\)/);
assert.match(submissionHandler, /existingTask\.status !== "open"/);
assert.doesNotMatch(submissionHandler, /existingTask\.freelancer\)/);
assert.match(submissionHandler, /freelancerId: currentUser\.userId/);
assert.match(submissionHelper, /Application\.create\(\[\{[\s\S]*?freelancer: freelancerId/);
assert.match(submissionHelper, /Task\.findOneAndUpdate\(\s*\{\s*_id: taskId,\s*status: "open",\s*isDeleted: \{ \$ne: true \},\s*employer: \{ \$ne: freelancerId \}\s*\}/);
assert.match(submissionHelper, /maxTransactionAttempts = 8/);
assert.match(submissionHelper, /maxNonConflictAttempts = 2/);
assert.match(submissionHelper, /const applicationId = new mongoose\.Types\.ObjectId\(\)/);
assert.doesNotMatch(submissionHandler, /\$set:\s*\{\s*status:/);
assert.match(submissionHandler, /You have already applied to this project/);
assert.match(submissionHandler, /keyPattern/);
assert.match(clientListingRoute, /\{ employer: user\.userId \}/);
assert.match(clientListingRoute, /\{ freelancer: user\.userId \}/);
assert.match(clientListingRoute, /\.populate\("freelancer", "name"\)/);
assert.match(reviewRoute, /Application\.findOne\(\{ _id: applicationId, employer: user\.userId, status: "pending" \}\)/);
assert.match(reviewRoute, /_id:\s*\{\s*\$ne:\s*application\._id\s*\},[\s\S]*?status:\s*"pending"/);
assert.match(reviewRoute, /\{ status: "rejected" \}/);
assert.match(clientUi, /application\._id \|\| application\.id/);
assert.match(clientUi, /item\._id === id \|\| item\.id === id/);
assert.match(indexMigration, /\$group:[\s\S]*?task: "\$task"[\s\S]*?freelancer: "\$freelancer"/);
assert.match(indexMigration, /process\.exitCode = 1/);
assert.match(indexMigration, /No application records were deleted/);
assert.doesNotMatch(dashboardShell, /OnboardingGuide/);
assert.match(helpPage, /<OnboardingGuide/);

console.log("Application validation passed: compound per-freelancer uniqueness, owner-scoped listing/review, per-application decisions, safe index migration, and Help-only onboarding mount.");
