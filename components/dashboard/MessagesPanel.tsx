"use client";

import { FormEvent, useEffect, useState } from "react";

type Participant = { _id?: string; id?: string; name: string; role: string };
type ConversationSummary = {
    id: string;
    task?: { title?: string } | null;
    participants: Participant[];
    latestMessage?: { body: string } | null;
};
type ChatMessage = {
    _id?: string;
    id?: string;
    body: string;
    sender: Participant;
    createdAt: string;
};

export default function MessagesPanel({ role }: { role: "employer" | "freelancer" | "admin" }) {
    const [conversations, setConversations] = useState<ConversationSummary[]>([]);
    const [selectedId, setSelectedId] = useState("");
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [message, setMessage] = useState("");
    const [state, setState] = useState<"loading" | "success" | "error">("loading");
    const [error, setError] = useState("");

    useEffect(() => {
        const controller = new AbortController();
        async function loadConversations() {
            try {
                const response = await fetch("/api/messages", { cache: "no-store", signal: controller.signal });
                const result = await response.json() as { conversations?: ConversationSummary[]; error?: string };
                if (!response.ok) throw new Error(result.error || "Conversations are unavailable.");
                if (!Array.isArray(result.conversations)) throw new Error("The conversations response was invalid.");
                if (controller.signal.aborted) return;
                setConversations(result.conversations);
                setSelectedId((current) => current || result.conversations?.[0]?.id || "");
                setState("success");
            } catch (loadError) {
                if (controller.signal.aborted) return;
                setError(loadError instanceof Error ? loadError.message : "Conversations are unavailable.");
                setState("error");
            }
        }
        void loadConversations();
        return () => controller.abort();
    }, []);

    useEffect(() => {
        if (!selectedId) return;
        const controller = new AbortController();
        async function loadMessages() {
            try {
                const response = await fetch(`/api/messages/${selectedId}`, { cache: "no-store", signal: controller.signal });
                const result = await response.json() as { messages?: ChatMessage[]; error?: string };
                if (!response.ok) throw new Error(result.error || "Messages are unavailable.");
                if (controller.signal.aborted) return;
                setMessages(result.messages || []);
            } catch (loadError) {
                if (!controller.signal.aborted) setError(loadError instanceof Error ? loadError.message : "Messages are unavailable.");
            }
        }
        void loadMessages();
        return () => controller.abort();
    }, [selectedId]);

    async function sendMessage(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (!selectedId || !message.trim()) return;
        setError("");
        try {
            const response = await fetch(`/api/messages/${selectedId}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ message }),
            });
            const result = await response.json() as { message?: { id: string; body: string; createdAt: string }; error?: string };
            if (!response.ok) throw new Error(result.error || "Message could not be sent.");
            if (result.message) {
                const sender: Participant = { name: "You", role };
                setMessages((current) => [...current, { ...result.message!, sender }]);
                setConversations((current) => current.map((conversation) => conversation.id === selectedId
                    ? { ...conversation, latestMessage: { body: result.message!.body } }
                    : conversation));
            }
            setMessage("");
        } catch (sendError) {
            setError(sendError instanceof Error ? sendError.message : "Message could not be sent.");
        }
    }

    if (state === "loading") return <div className="dashboard-empty" role="status">Loading conversations...</div>;
    if (state === "error" && conversations.length === 0) return <div className="dashboard-empty" role="alert"><p>{error}</p></div>;
    if (!conversations.length) return <div className="dashboard-empty"><strong>No conversations yet.</strong><p>Your conversations will appear here when you connect with a client or freelancer.</p></div>;

    const selected = conversations.find((conversation) => conversation.id === selectedId);
    return <section className="dashboard-two-column">
        <nav className="dashboard-panel" aria-label="Conversations">
            <h2>Conversations</h2>
            <div className="dashboard-list">{conversations.map((conversation) => {
                const other = conversation.participants.find((participant) => participant.role !== role);
                return <button className="dashboard-list-row" key={conversation.id} onClick={() => setSelectedId(conversation.id)} type="button">
                    <span><strong>{other?.name || "Project participant"}</strong><span>{conversation.task?.title || "Project"}</span><small>{conversation.latestMessage?.body || "No messages yet"}</small></span>
                </button>;
            })}</div>
        </nav>
        <section className="dashboard-panel">
            <div className="dashboard-panel-heading"><div><span className="panel-kicker">{selected?.task?.title || "Project conversation"}</span><h2>{selected?.participants.find((participant) => participant.role !== role)?.name || "Messages"}</h2></div></div>
            <div className="dashboard-list">{messages.map((item) => <article className="dashboard-list-row" key={item._id || item.id || item.createdAt}><div><strong>{item.sender.name}</strong><p>{item.body}</p></div><time>{new Date(item.createdAt).toLocaleString()}</time></article>)}</div>
            {!messages.length && <p className="muted-copy">No messages in this conversation yet.</p>}
            {error && <p className="form-error" role="alert">{error}</p>}
            {role !== "admin" && <form className="dashboard-form" onSubmit={(event) => void sendMessage(event)}><label htmlFor="message-body">Send a message</label><textarea className="filter-input dashboard-textarea" id="message-body" maxLength={5000} required value={message} onChange={(event) => setMessage(event.target.value)} /><button className="button button-primary" disabled={!message.trim()} type="submit">Send message</button></form>}
        </section>
    </section>;
}
