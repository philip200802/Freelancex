import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
    isOptionalGithubProfileUrlValid,
    validateFreelancerRegistrationProfile,
} from "../lib/registration-validation.ts";

const loginPage = await readFile(new URL("../app/login/page.tsx", import.meta.url), "utf8");
const registrationWizard = await readFile(new URL("../app/register/RegistrationWizard.tsx", import.meta.url), "utf8");
const registrationRoute = await readFile(new URL("../app/api/auth/register/route.ts", import.meta.url), "utf8");
const registrationStyles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
const submissions = await readFile(new URL("../components/projects/ProjectSubmissions.tsx", import.meta.url), "utf8");
const taskRoute = await readFile(new URL("../app/api/tasks/route.ts", import.meta.url), "utf8");
const applicationRoute = await readFile(new URL("../app/api/tasks/[taskId]/route.ts", import.meta.url), "utf8");
const verificationRoute = await readFile(new URL("../app/api/auth/verify/route.ts", import.meta.url), "utf8");

assert.match(loginPage, /passwordVisible \? "text" : "password"/);
assert.match(loginPage, /aria-label=\{passwordVisible \? "Hide password" : "Show password"\}/);
assert.match(loginPage, /className="password-visibility-toggle"/);
assert.match(loginPage, /onClick=\{\(\) => setPasswordVisible\(\(visible\) => !visible\)\} type="button"/);
assert.match(registrationWizard, /const \[passwordVisible, setPasswordVisible\] = useState\(false\)/);
assert.match(registrationWizard, /const \[confirmPasswordVisible, setConfirmPasswordVisible\] = useState\(false\)/);
assert.match(registrationWizard, /type=\{visible \? "text" : "password"\}/);
assert.match(registrationWizard, /className="password-visibility-toggle"/);
assert.match(registrationWizard, /onClick=\{\(\) => setVisible\(!visible\)\} type="button"/);
assert.match(registrationWizard, /field\("githubUrl", "GitHub URL", "url", false\)/);
assert.match(registrationWizard, /const isRequired = role === "freelancer" \? key !== "githubUrl" : required/);
assert.match(registrationWizard, /imageField\(required = role === "freelancer"\)/);
assert.match(registrationRoute, /validateFreelancerRegistrationProfile\(profileData, Boolean\(profileImage\)\)/);
assert.match(registrationRoute, /!firstName \|\| !lastName \|\| !email \|\| !password[\s\S]*?!termsAccepted/);
assert.match(registrationRoute, /sendVerificationEmail/);
assert.match(registrationWizard, /href="\/terms"/);
assert.match(registrationWizard, /href="\/privacy"/);

assert.equal(isOptionalGithubProfileUrlValid(undefined), true);
assert.equal(isOptionalGithubProfileUrlValid(""), true);
assert.equal(isOptionalGithubProfileUrlValid("  "), true);
assert.equal(isOptionalGithubProfileUrlValid("https://github.com/octocat"), true);
assert.equal(isOptionalGithubProfileUrlValid("http://www.github.com/octocat"), true);
assert.equal(isOptionalGithubProfileUrlValid("not a URL"), false);
assert.equal(isOptionalGithubProfileUrlValid("https://example.com/profile"), false);
assert.equal(isOptionalGithubProfileUrlValid("javascript:alert(1)"), false);

const validFreelancerProfile = {
    professionalTitle: "Designer",
    category: "Design",
    skills: ["Figma"],
    experienceLevel: "Intermediate",
    bio: "A designer profile.",
    workType: "Freelance",
    availability: "Available",
    hourlyRate: 0,
    portfolioUrl: "https://portfolio.example",
    githubUrl: "",
    linkedinUrl: "https://linkedin.com/in/example",
};
assert.equal(validateFreelancerRegistrationProfile(validFreelancerProfile, true), "");
for (const requiredField of Object.keys(validFreelancerProfile).filter((field) => field !== "githubUrl")) {
    assert.notEqual(validateFreelancerRegistrationProfile({ ...validFreelancerProfile, [requiredField]: undefined }, true), "");
}
assert.notEqual(validateFreelancerRegistrationProfile(validFreelancerProfile, false), "");
assert.notEqual(validateFreelancerRegistrationProfile({ ...validFreelancerProfile, githubUrl: "https://example.com/user" }, true), "");
assert.match(taskRoute, /workflowEvent: "job_created_client"/);
assert.doesNotMatch(taskRoute, /new_job_alert|job-alert/);
assert.doesNotMatch(taskRoute, /User\.find\(\{\s*role:\s*"freelancer"/);
assert.match(applicationRoute, /workflowEvent: "freelancer_applied"/);
assert.match(verificationRoute, /sendWelcomeEmail/);

assert.match(registrationStyles, /\.auth-form \.agreement-option\s*\{[^}]*display:\s*flex/s);
assert.match(registrationStyles, /\.agreement-option input\s*\{[^}]*flex-shrink:\s*0/s);
assert.match(submissions, /className="project-submission-agreement"/);
assert.match(submissions, /I understand that FreelanceX deducts a /);
assert.match(submissions, /within 24 hours after client approval, provided my bank account is verified\./);
assert.match(registrationStyles, /\.project-submission-agreement\s*\{[^}]*align-items:\s*flex-start;[^}]*display:\s*flex/s);
assert.match(registrationStyles, /\.project-submission-agreement input\s*\{[^}]*flex-shrink:\s*0/s);

console.log("Registration UI validation passed: accessible password visibility, optional GitHub profile validation, and flex-aligned agreements.");
