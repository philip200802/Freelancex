import Link from "next/link";

const categories = [
    { icon: "01", title: "Development & IT", description: "Build the thing people need." },
    { icon: "02", title: "Graphics & Design", description: "Make a sharper first impression." },
    { icon: "03", title: "Writing & Content", description: "Give good ideas a clear voice." },
    { icon: "04", title: "Digital Marketing", description: "Turn attention into momentum." },
    { icon: "05", title: "AI & Automation", description: "Create leverage for the work ahead." },
    { icon: "06", title: "Business & Finance", description: "Make confident decisions faster." },
];

const steps = [
    { number: "01", title: "Post a project", description: "Share the outcome, budget, and context. A clear brief attracts better matches." },
    { number: "02", title: "Find the right talent", description: "Review relevant independent professionals and choose the person for the work." },
    { number: "03", title: "Work with confidence", description: "Keep milestones, conversations, and protected payments together from start to finish." },
];

export default function Home() {
    return (
        <main className="page-shell">
            <header className="site-header">
                <Link className="logo" href="/" aria-label="FreelanceX home"><span className="logo-mark" />FreelanceX</Link>
                <nav className="nav-links" aria-label="Main navigation">
                    <Link href="/jobs">Find work</Link>
                    <Link href="/jobs">Hire talent</Link>
                    <Link href="#how-it-works">How it works</Link>
                </nav>
                <div className="header-actions">
                    <Link className="button-quiet" href="/login">Log in</Link>
                    <Link className="button button-primary" href="/register">Get started</Link>
                </div>
            </header>

            <section className="hero">
                <div>
                    <div className="eyebrow">A better way to get work done</div>
                    <h1>Good work deserves a <em>great match.</em></h1>
                    <p className="hero-copy">FreelanceX brings ambitious people and independent talent together, with clear milestones and protected payments from brief to finish.</p>
                    <div className="hero-actions">
                        <Link className="button button-primary" href="/jobs">Explore projects <span aria-hidden="true">&nbsp;&rarr;</span></Link>
                        <Link className="button button-quiet" href="/register">I need a freelancer</Link>
                    </div>
                    <p className="hero-note">No noise. No guesswork. Just a clear path forward.</p>
                </div>
                <div className="hero-art" aria-label="FreelanceX project overview">
                    <div className="art-label">The independent advantage</div>
                    <div className="art-title">Make space for your best work.</div>
                    <div className="art-card"><small>Featured project</small><strong>Brand system for a new kind of bank</strong><span>Funded milestone &nbsp; + &nbsp; ₦240,000</span></div>
                </div>
            </section>

            <section className="stats" aria-label="FreelanceX platform statistics">
                <div className="stat"><strong>12k+</strong><span>independent professionals</span></div>
                <div className="stat"><strong>₦380m</strong><span>work commissioned</span></div>
                <div className="stat"><strong>94%</strong><span>projects completed on time</span></div>
            </section>

            <section className="section" id="how-it-works">
                <div className="section-heading"><h2>Find your next move.</h2><p>From a quick fix to a defining project, find the people who can make it happen.</p></div>
                <div className="category-grid">
                    {categories.map((category) => <Link className="category" href="/jobs" key={category.title}><div className="category-icon">{category.icon}</div><h3>{category.title}</h3><p>{category.description}</p></Link>)}
                </div>
            </section>

            <section className="section workflow-section">
                <div className="section-heading"><h2>Work that stays clear.</h2><p>A simple process for ambitious teams and independent professionals.</p></div>
                <div className="workflow-grid">{steps.map((step) => <article className="workflow-step" key={step.number}><div className="category-icon">{step.number}</div><h3>{step.title}</h3><p>{step.description}</p></article>)}</div>
            </section>

            <footer className="site-footer"><Link className="logo" href="/"><span className="logo-mark" />FreelanceX</Link><nav aria-label="Footer navigation"><Link href="/terms">Terms of Service</Link><Link href="/privacy">Privacy Policy</Link></nav><span>&copy; 2026 FreelanceX</span></footer>
        </main>
    );
}
