"use client";

import { useEffect, useState } from "react";

type Review = {
    id: string;
    project: string;
    client: string;
    freelancer: string;
    rating: number;
    comment: string;
    createdAt: string;
};

type Pagination = { page: number; limit: number; total: number; totalPages: number };

export default function AdminReviewsPage() {
    const [reviews, setReviews] = useState<Review[]>([]);
    const [pagination, setPagination] = useState<Pagination>({ page: 1, limit: 20, total: 0, totalPages: 1 });
    const [query, setQuery] = useState("");
    const [draftQuery, setDraftQuery] = useState("");
    const [page, setPage] = useState(1);
    const [retry, setRetry] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    useEffect(() => {
        const controller = new AbortController();
        async function loadReviews() {
            setLoading(true);
            setError("");
            try {
                const params = new URLSearchParams({ q: query, page: String(page), limit: String(pagination.limit) });
                const response = await fetch(`/api/admin/reviews?${params}`, { cache: "no-store", signal: controller.signal });
                const result = await response.json() as { reviews?: Review[]; pagination?: Pagination; error?: string };
                if (!response.ok || !Array.isArray(result.reviews) || !result.pagination) {
                    throw new Error(result.error || "Reviews could not be loaded.");
                }
                if (controller.signal.aborted) return;
                setReviews(result.reviews);
                setPagination(result.pagination);
                if (page > result.pagination.totalPages) setPage(result.pagination.totalPages);
            } catch (loadError) {
                if (!controller.signal.aborted) setError(loadError instanceof Error ? loadError.message : "Reviews could not be loaded.");
            } finally {
                if (!controller.signal.aborted) setLoading(false);
            }
        }
        void loadReviews();
        return () => controller.abort();
    }, [page, pagination.limit, query, retry]);

    function search(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setPage(1);
        setQuery(draftQuery.trim());
    }

    return <section aria-label="Project reviews" className="admin-activity">
        <form className="admin-review-search" onSubmit={search}>
            <label>Search reviews<input className="filter-input" maxLength={120} onChange={(event) => setDraftQuery(event.target.value)} placeholder="Participant or review text" value={draftQuery} /></label>
            <button className="button button-primary" type="submit">Search</button>
        </form>
        <section aria-live="polite" className="dashboard-panel">
            <div className="dashboard-table-heading"><span>{loading ? "Loading reviews..." : `${pagination.total} reviews`}</span></div>
            {loading ? <div aria-label="Loading reviews" className="activity-loading-list" role="status">{Array.from({ length: 5 }, (_, index) => <div className="activity-loading-row" key={index}><span /><span /><span /></div>)}<span className="sr-only">Loading reviews...</span></div>
                : error ? <div className="admin-activity-error" role="alert"><p>{error}</p><button className="button button-quiet" onClick={() => setRetry((current) => current + 1)} type="button">Retry</button></div>
                    : reviews.length === 0 ? <div className="dashboard-empty"><strong>No reviews found.</strong><p>Persisted reviews for completed projects will appear here.</p></div>
                        : <div className="dashboard-table">{reviews.map((review) => <article className="dashboard-table-row admin-review-row" key={review.id}>
                            <div><strong>{review.project} · {review.rating}/5</strong><span>Client: {review.client} · Freelancer: {review.freelancer}</span><p>{review.comment}</p></div>
                            <time dateTime={review.createdAt}>{new Date(review.createdAt).toLocaleDateString()}</time>
                        </article>)}</div>}
        </section>
        {!loading && !error && pagination.totalPages > 1 && <nav aria-label="Review pages" className="admin-activity-pagination">
            <button className="button button-quiet" disabled={page <= 1} onClick={() => setPage((current) => current - 1)} type="button">Previous</button>
            <span>Page {page} of {pagination.totalPages}</span>
            <button className="button button-quiet" disabled={page >= pagination.totalPages} onClick={() => setPage((current) => current + 1)} type="button">Next</button>
        </nav>}
    </section>;
}
