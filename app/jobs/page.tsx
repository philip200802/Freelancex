import Link from "next/link";
import JobBoard from "./JobBoard";

export default function JobsPage() {
    return <main className="page-shell"><header className="site-header"><Link className="logo" href="/" aria-label="FreelanceX home"><span className="logo-mark" />FreelanceX</Link><nav className="nav-links" aria-label="Main navigation"><Link href="/jobs">Find work</Link><Link href="/jobs">Hire talent</Link><Link href="/#how-it-works">How it works</Link></nav><div className="header-actions"><Link className="button-quiet" href="/login">Log in</Link><Link className="button button-primary" href="/register">Post a project</Link></div></header><section className="page-header"><div className="page-header-inner"><div className="eyebrow">Open projects</div><h1>Work worth doing.</h1><p className="hero-copy">Browse projects from teams looking for thoughtful, capable people.</p></div></section><JobBoard /></main>;
}
