export type DashboardRole = "freelancer" | "employer" | "admin";

export type OnboardingStep = {
    id: string;
    title: string;
    description: string;
    href: string;
    linkLabel: string;
};

export type Tutorial = {
    id: string;
    title: string;
    steps: Array<{ title: string; description: string; href: string; linkLabel: string }>;
};

export const onboardingVersion = 1;

export const onboardingSteps: Record<DashboardRole, OnboardingStep[]> = {
    freelancer: [
        { id: "profile", title: "Complete your profile", description: "Add a clear photo, professional title, bio, skills, portfolio links, and availability so clients can assess your fit.", href: "/freelancer/dashboard/profile", linkLabel: "Update profile" },
        { id: "portfolio", title: "Add portfolio work", description: "Add a portfolio URL to your profile so clients can review examples of your work.", href: "/freelancer/dashboard/profile", linkLabel: "Add portfolio" },
        { id: "bank-account", title: "Set up a bank account", description: "Add payout details in account settings. Verification is required for payout eligibility; never share your account details in public profile content.", href: "/freelancer/dashboard/settings", linkLabel: "Set up payouts" },
        { id: "explore-projects", title: "Explore projects", description: "Compare budgets, requirements, and client profiles before choosing an opportunity.", href: "/freelancer/dashboard/jobs", linkLabel: "Browse projects" },
        { id: "first-application", title: "Submit your first application", description: "Write a focused proposal that explains your relevant experience and approach.", href: "/freelancer/dashboard/jobs", linkLabel: "Find a project" },
    ],
    employer: [
        { id: "profile", title: "Complete your client profile", description: "Add a photo, business details, description, and location to help freelancers understand who is hiring.", href: "/client/dashboard/profile", linkLabel: "Update profile" },
        { id: "first-project", title: "Post your first project", description: "Describe the expected work and deliverables, add requirements, and set a realistic budget.", href: "/client/dashboard/post-job", linkLabel: "Post a project" },
        { id: "review-applications", title: "Review applications", description: "Compare proposals, profile details, skills, and portfolios before choosing who to hire.", href: "/client/dashboard/applications", linkLabel: "Review applications" },
        { id: "hire-freelancer", title: "Hire a freelancer", description: "Accept the application that best fits your project. The project will move to funding before work begins.", href: "/client/dashboard/applications", linkLabel: "Choose an applicant" },
        { id: "fund-project", title: "Fund a project", description: "Use the project funding flow and Paystack confirmation before work starts.", href: "/client/dashboard/projects", linkLabel: "View projects" },
    ],
    admin: [
        { id: "review-users", title: "Manage users", description: "Review account status, verification, and profile information using the admin user tools.", href: "/admin/dashboard/users", linkLabel: "Open users" },
        { id: "monitor-projects", title: "Monitor projects", description: "Review project status and related applications from job management.", href: "/admin/dashboard/jobs", linkLabel: "Open jobs" },
        { id: "review-payments", title: "Monitor payments", description: "Inspect provider-verified payment transactions and recorded payout activity.", href: "/admin/dashboard/transactions", linkLabel: "Open transactions" },
        { id: "review-disputes", title: "Monitor disputes", description: "Review evidence, participant updates, and recorded dispute decisions.", href: "/admin/dashboard/disputes", linkLabel: "Open disputes" },
        { id: "review-activity", title: "Review platform activity", description: "Use activity logs and email delivery tools to investigate authorized operational actions.", href: "/admin/dashboard/activity-logs", linkLabel: "Open activity logs" },
    ],
};

export const tutorials: Record<DashboardRole, Tutorial[]> = {
    freelancer: [
        { id: "apply-project", title: "Apply for a project", steps: [
            { title: "Browse open projects", description: "Review the project brief and budget, then open a project that matches your skills.", href: "/freelancer/dashboard/jobs", linkLabel: "Browse projects" },
            { title: "Review the client and requirements", description: "Check the client profile, scope, deliverables, and timeline before applying.", href: "/freelancer/dashboard/jobs", linkLabel: "View projects" },
            { title: "Write a focused proposal", description: "Explain your relevant experience, your approach, and any clarifying questions.", href: "/freelancer/dashboard/applications", linkLabel: "Track applications" },
        ] },
        { id: "submit-work", title: "Submit work and receive payment", steps: [
            { title: "Check project status", description: "Work begins after the client accepts your application and funding is confirmed.", href: "/freelancer/dashboard/contracts", linkLabel: "View projects" },
            { title: "Submit deliverables", description: "Use the project submission controls to share completed work and supporting links.", href: "/freelancer/dashboard/contracts", linkLabel: "Open project work" },
            { title: "Understand payout timing", description: "Approval records completion. Payout processing is manual and depends on a verified bank account; it is not an instant bank transfer.", href: "/freelancer/dashboard/settings", linkLabel: "Review payout setup" },
        ] },
    ],
    employer: [
        { id: "post-hire-fund", title: "Post, hire, and fund a project", steps: [
            { title: "Write a clear project brief", description: "Describe deliverables, requirements, timeline, and budget before publishing.", href: "/client/dashboard/post-job", linkLabel: "Post a project" },
            { title: "Compare applications", description: "Review each proposal alongside the freelancer profile and portfolio.", href: "/client/dashboard/applications", linkLabel: "Review applications" },
            { title: "Accept and fund", description: "Accept the freelancer, then use the project funding flow. Work proceeds after payment is confirmed.", href: "/client/dashboard/projects", linkLabel: "Open projects" },
        ] },
        { id: "review-work", title: "Review and approve work", steps: [
            { title: "Open the project", description: "Review the submission and compare it with the agreed project requirements.", href: "/client/dashboard/contracts", linkLabel: "Open active projects" },
            { title: "Approve or request revisions", description: "Approve work that meets the brief or use the revision action to explain what still needs attention.", href: "/client/dashboard/contracts", linkLabel: "Review submissions" },
            { title: "Report an unresolved issue", description: "If project concerns cannot be resolved, use the project dispute controls and provide relevant evidence.", href: "/client/dashboard/disputes", linkLabel: "Review disputes" },
        ] },
    ],
    admin: [
        { id: "admin-review", title: "Review a platform issue", steps: [
            { title: "Review the affected record", description: "Open the relevant user, job, transaction, payout, or dispute record.", href: "/admin/dashboard", linkLabel: "Open admin dashboard" },
            { title: "Check supporting activity", description: "Use activity logs and email delivery records to understand prior actions and communication.", href: "/admin/dashboard/activity-logs", linkLabel: "Review activity logs" },
            { title: "Record an authorized action", description: "Use the relevant admin workflow and ensure the reason or decision is recorded where required.", href: "/admin/dashboard/disputes", linkLabel: "Open admin tools" },
        ] },
    ],
};

export type HelpArticle = {
    id: string;
    category: string;
    title: string;
    summary: string;
    steps: string[];
    href: string;
    linkLabel: string;
    roles: DashboardRole[];
};

const allRoles: DashboardRole[] = ["freelancer", "employer", "admin"];
const clientsAndFreelancers: DashboardRole[] = ["freelancer", "employer"];

export const helpArticles: HelpArticle[] = [
    { id: "getting-started", category: "Getting Started", title: "How FreelanceX works", summary: "FreelanceX connects clients and freelancers through project applications, funded work, submissions, and reviews.", steps: ["Complete your profile and account settings.", "Clients post projects; freelancers apply with proposals.", "Accepted projects move through funding, delivery, review, and completion.", "Use dashboard messages and notifications to follow updates."], href: "/help", linkLabel: "Explore Help Center", roles: allRoles },
    { id: "client-profile", category: "Client Guide", title: "Complete a client profile", summary: "Share professional business information that helps freelancers understand your organization.", steps: ["Open My Profile.", "Add a profile image, company details, business description, and location.", "Choose public/private profile and company visibility in Settings."], href: "/client/dashboard/profile", linkLabel: "Edit client profile", roles: ["employer"] },
    { id: "freelancer-profile", category: "Freelancer Guide", title: "Build a strong freelancer profile", summary: "A complete profile helps clients evaluate relevant experience and work samples.", steps: ["Add a professional image, title, and clear bio.", "List relevant skills, experience, and availability.", "Add a portfolio link and keep visibility settings up to date."], href: "/freelancer/dashboard/profile", linkLabel: "Edit freelancer profile", roles: ["freelancer"] },
    { id: "projects", category: "Projects", title: "Browse or post a project", summary: "Clear scope, deliverables, requirements, and budget reduce confusion throughout a project.", steps: ["Clients create projects from Post a Job and provide requirements and budget.", "Freelancers browse open projects, review client profiles, and apply.", "Project status and details are available from the dashboard."], href: "/freelancer/dashboard/jobs", linkLabel: "Browse projects", roles: clientsAndFreelancers },
    { id: "applications", category: "Applications", title: "Application statuses and decisions", summary: "Applications show whether a proposal is pending, accepted, or rejected.", steps: ["Freelancers submit a proposal from an open project.", "Clients compare applications and may accept or reject a proposal.", "Accepted work proceeds to the project funding flow; updates appear in the dashboard and notifications."], href: "/client/dashboard/applications", linkLabel: "Review applications", roles: clientsAndFreelancers },
    { id: "contracts", category: "Contracts", title: "Work through a project", summary: "Follow project status and use the project workspace to communicate and submit work.", steps: ["Review project requirements before starting.", "Use project messages to clarify scope.", "Submit deliverables through the project workflow.", "Clients can approve a submission or request revisions."], href: "/client/dashboard/contracts", linkLabel: "Open active projects", roles: clientsAndFreelancers },
    { id: "payments", category: "Payments", title: "Project funding and transactions", summary: "Funding uses Paystack, and project work proceeds after payment confirmation.", steps: ["Open the project funding action after an application is accepted.", "Complete payment through Paystack.", "Wait for platform verification before treating the project as funded.", "Review recorded payment activity in the dashboard."], href: "/client/dashboard/payments", linkLabel: "View payments", roles: ["employer", "admin"] },
    { id: "payouts", category: "Freelancer Payouts", title: "Understand freelancer payouts", summary: "Payout amounts reflect gross project value, platform commission, and freelancer net.", steps: ["Keep a payout bank account verified for eligibility.", "Review gross, commission, and net amounts shown in payout records.", "A client approval does not mean an instant bank transfer; payout processing is manual.", "Use payout status to follow processing and completion."], href: "/freelancer/dashboard/settings", linkLabel: "Review payout setup", roles: ["freelancer", "admin"] },
    { id: "bank-verification", category: "Bank Verification", title: "Verify payout bank details", summary: "Bank details are private and verification is required before payout eligibility.", steps: ["Open Account Settings and add bank details.", "Complete the verification flow and follow any correction guidance shown.", "Do not share full bank details in profile text, messages, or proposals."], href: "/freelancer/dashboard/settings", linkLabel: "Open bank settings", roles: ["freelancer", "admin"] },
    { id: "disputes", category: "Disputes", title: "Handle a project dispute", summary: "Disputes provide a place to share evidence and respond to administrator requests.", steps: ["Open the project dispute controls when an issue cannot be resolved directly.", "Describe the concern and add relevant evidence links.", "Check dispute status and respond to administrator requests.", "Payouts remain subject to the dispute workflow while a dispute is active."], href: "/client/dashboard/disputes", linkLabel: "Open disputes", roles: clientsAndFreelancers },
    { id: "account-settings", category: "Account Settings", title: "Manage visibility and notifications", summary: "Your settings control professional profile visibility and notification preferences.", steps: ["Choose public or private profile visibility.", "Email visibility is opt-in; company visibility is configurable for clients.", "In-app and email notification preferences can be managed separately."], href: "/client/dashboard/settings", linkLabel: "Open settings", roles: allRoles },
    { id: "notifications", category: "Account Settings", title: "In-app and email notifications", summary: "FreelanceX provides in-app and email notices for important account and project events.", steps: ["Use the dashboard bell to review in-app notifications.", "Check account settings for email notification preferences.", "Email provider acceptance does not guarantee delivery to your inbox; check spam and account email verification."], href: "/client/dashboard/notifications", linkLabel: "View notifications", roles: allRoles },
    { id: "faq-project-approval", category: "Frequently Asked Questions", title: "Does project approval send an instant payout?", summary: "No. Project approval records completion, but payout processing is manual and depends on account eligibility.", steps: ["Confirm the project is complete in the project workflow.", "Ensure your bank account is verified and eligible.", "Follow the payout status; approval is not an automatic bank transfer."], href: "/freelancer/dashboard/earnings", linkLabel: "View earnings", roles: ["freelancer"] },
    { id: "faq-missing-email", category: "Frequently Asked Questions", title: "Why did an email notification not arrive?", summary: "A provider accepting an email does not guarantee delivery to your inbox.", steps: ["Check your email address and notification preferences.", "Check spam, junk, or filtered folders.", "Review in-app notifications for updates that have already reached your account."], href: "/client/dashboard/notifications", linkLabel: "View notifications", roles: allRoles },
    { id: "admin-users", category: "Administrator Guide", title: "Manage users and projects", summary: "Admin workspaces provide user and job records for platform oversight.", steps: ["Review account status and verification from Users.", "Review project information and activity from Jobs.", "Use recorded admin workflows for changes requiring authorization."], href: "/admin/dashboard/users", linkLabel: "Open user management", roles: ["admin"] },
    { id: "admin-finance", category: "Administrator Guide", title: "Monitor transactions and payouts", summary: "Admin transaction and payout pages show recorded provider-verified or manually recorded financial activity.", steps: ["Review verified transaction records.", "Check payout bank verification and eligibility.", "Only record a payout after an administrator manually completes the transfer."], href: "/admin/dashboard/payouts", linkLabel: "Open payout management", roles: ["admin"] },
    { id: "admin-operations", category: "Administrator Guide", title: "Disputes, email delivery, and activity logs", summary: "Use admin operations tools to review disputes, workflow email status, and recorded actions.", steps: ["Review dispute evidence and history.", "Check email delivery status when users report missing notices.", "Consult activity logs when investigating administrative changes."], href: "/admin/dashboard/disputes", linkLabel: "Open dispute management", roles: ["admin"] },
];
