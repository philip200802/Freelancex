"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { HelpArticle } from "@/lib/onboarding-content";
import type { DashboardRole } from "@/components/dashboard/DashboardShell";

function articleHref(article: HelpArticle, role: DashboardRole) {
    if (article.id === "projects") return role === "employer" ? "/client/dashboard/post-job" : "/freelancer/dashboard/jobs";
    if (article.id === "applications") return role === "employer" ? "/client/dashboard/applications" : "/freelancer/dashboard/applications";
    if (article.id === "contracts") return role === "employer" ? "/client/dashboard/contracts" : "/freelancer/dashboard/contracts";
    if (article.id === "payments") return role === "admin" ? "/admin/dashboard/transactions" : "/client/dashboard/payments";
    if (article.id === "payouts") return role === "admin" ? "/admin/dashboard/payouts" : "/freelancer/dashboard/earnings";
    if (article.id === "disputes") return role === "employer" ? "/client/dashboard/disputes" : "/freelancer/dashboard/disputes";
    if (article.id === "account-settings") return role === "employer" ? "/client/dashboard/settings" : role === "freelancer" ? "/freelancer/dashboard/settings" : "/admin/dashboard/settings";
    if (article.id === "notifications" || article.id === "faq-missing-email") return role === "employer" ? "/client/dashboard/notifications" : role === "freelancer" ? "/freelancer/dashboard/notifications" : "/admin/dashboard/email-delivery";
    if (article.id === "faq-project-approval") return "/freelancer/dashboard/earnings";
    return article.href;
}

export default function HelpCenter({ role, initialTopic, articles }: { role: DashboardRole; initialTopic?: string; articles: HelpArticle[] }) {
    const [query, setQuery] = useState("");
    const [category, setCategory] = useState("");
    const categories = useMemo(() => [...new Set(articles.map((article) => article.category))], [articles]);
    const matchingArticles = useMemo(() => {
        const normalizedQuery = query.trim().toLowerCase();
        return articles.filter((article) => {
            if (category && article.category !== category) return false;
            if (!normalizedQuery) return true;
            const searchable = [article.title, article.category, article.summary, ...article.steps].join(" ").toLowerCase();
            return searchable.includes(normalizedQuery);
        });
    }, [articles, category, query]);
    const focusArticleId = articles.some((article) => article.id === initialTopic) ? initialTopic : "";

    useEffect(() => {
        if (!focusArticleId) return;
        const article = document.getElementById(`help-${focusArticleId}`);
        article?.scrollIntoView({ block: "nearest" });
    }, [focusArticleId]);

    return <section className="help-center">
        <div className="help-center-intro"><div><span className="eyebrow">{role === "admin" ? "Administrator resources" : "FreelanceX support"}</span><h2>How can we help?</h2><p>Search role-specific guidance for projects, applications, payments, payouts, and account settings.</p></div><Link className="button button-outline" href={role === "admin" ? "/admin/dashboard" : role === "employer" ? "/client/dashboard" : "/freelancer/dashboard"}>Back to dashboard</Link></div>
        <div className="help-center-filters">
            <label className="help-search"><span className="sr-only">Search help articles</span><input onChange={(event) => setQuery(event.target.value)} placeholder="Search guides and frequently asked questions" type="search" value={query} /></label>
            <label className="help-category-filter"><span className="sr-only">Filter help category</span><select onChange={(event) => setCategory(event.target.value)} value={category}><option value="">All topics</option>{categories.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
        </div>
        {matchingArticles.length === 0 ? <div className="help-empty"><h3>No matching articles</h3><p>Try a different search term or choose another topic.</p></div> : <div className="help-article-grid">
            {matchingArticles.map((article) => <article className={`help-article${focusArticleId === article.id ? " is-highlighted" : ""}`} id={`help-${article.id}`} key={article.id} tabIndex={-1}>
                <span className="help-article-category">{article.category}</span><h3>{article.title}</h3><p>{article.summary}</p>
                <ol>{article.steps.map((step) => <li key={step}>{step}</li>)}</ol>
                <div className="help-article-footer"><Link href={articleHref(article, role)}>{article.linkLabel}</Link><Link href={`/help?topic=${article.id}`}>Article link</Link></div>
                <div className="help-related"><span>Related articles</span>{articles.filter((related) => related.id !== article.id && related.category !== article.category).slice(0, 2).map((related) => <Link href={`/help?topic=${related.id}`} key={related.id}>{related.title}</Link>)}</div>
            </article>)}
        </div>}
    </section>;
}
