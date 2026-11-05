"use client";

import Image from "next/image";
import { FormEvent, useEffect, useRef, useState } from "react";
import { ImagePlus, X } from "lucide-react";
import { dashboardNotificationsUpdatedEvent } from "@/lib/dashboard-events";

type Participant = { _id?: string; id?: string; name: string; role: string };
type ConversationSummary = {
    id: string;
    task?: { title?: string } | null;
    participants: Participant[];
    latestMessage?: { body: string } | null;
    unreadCount?: number;
    updatedAt?: string;
};
type ChatMessage = {
    _id?: string;
    id?: string;
    body: string;
    sender: Participant;
    createdAt: string;
    attachments?: MessageImage[];
};
type MessageImage = { fileName: string; url: string; fileType: string; fileSize: number };
type SelectedMessageImage = { file: File; previewUrl: string };

function uploadMessage(conversationId: string, formData: FormData, onProgress: (progress: number) => void) {
    return new Promise<{ message?: ChatMessage; error?: string }>((resolve, reject) => {
        const request = new XMLHttpRequest();
        request.open("POST", `/api/messages/${conversationId}`);
        request.responseType = "json";
        request.upload.addEventListener("progress", (event) => {
            if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
        });
        request.addEventListener("load", () => {
            const result = request.response as { message?: ChatMessage; error?: string } | null;
            if (request.status >= 200 && request.status < 300 && result?.message) resolve(result);
            else reject(new Error(result?.error || "Message could not be sent."));
        });
        request.addEventListener("error", () => reject(new Error("Message upload failed. Check your connection and try again.")));
        request.addEventListener("abort", () => reject(new Error("Message upload was cancelled.")));
        request.send(formData);
    });
}

export default function MessagesPanel({ role }: { role: "employer" | "freelancer" | "admin" }) {
    const [conversations, setConversations] = useState<ConversationSummary[]>([]);
    const [selectedId, setSelectedId] = useState("");
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [message, setMessage] = useState("");
    const [search, setSearch] = useState("");
    const [state, setState] = useState<"loading" | "success" | "error">("loading");
    const [messageState, setMessageState] = useState<"idle" | "loading" | "success" | "error">("idle");
    const [isSending, setIsSending] = useState(false);
    const [uploadProgress, setUploadProgress] = useState(0);
    const [selectedImage, setSelectedImage] = useState<SelectedMessageImage | null>(null);
    const [expandedImage, setExpandedImage] = useState<MessageImage | null>(null);
    const [error, setError] = useState("");
    const imageInputRef = useRef<HTMLInputElement>(null);
    const selectedImageUrl = useRef<string | null>(null);

    useEffect(() => () => {
        if (selectedImageUrl.current) URL.revokeObjectURL(selectedImageUrl.current);
    }, []);

    function selectMessageImage(file: File | null) {
        if (selectedImageUrl.current) URL.revokeObjectURL(selectedImageUrl.current);
        selectedImageUrl.current = file ? URL.createObjectURL(file) : null;
        setSelectedImage(file && selectedImageUrl.current ? { file, previewUrl: selectedImageUrl.current } : null);
    }

    useEffect(() => {
        if (role === "admin") return;
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
    }, [role]);

    useEffect(() => {
        if (!selectedId || role === "admin") return;
        const controller = new AbortController();
        async function loadMessages() {
            setMessageState("loading");
            setError("");
            setMessages([]);
            try {
                const response = await fetch(`/api/messages/${selectedId}`, { cache: "no-store", signal: controller.signal });
                const result = await response.json() as { messages?: ChatMessage[]; error?: string };
                if (!response.ok) throw new Error(result.error || "Messages are unavailable.");
                if (!Array.isArray(result.messages)) throw new Error("The messages response was invalid.");
                if (controller.signal.aborted) return;
                setMessages(result.messages || []);
                setConversations((current) => current.map((conversation) => conversation.id === selectedId ? { ...conversation, unreadCount: 0 } : conversation));
                setMessageState("success");
                window.dispatchEvent(new Event(dashboardNotificationsUpdatedEvent));
            } catch (loadError) {
                if (!controller.signal.aborted) {
                    setError(loadError instanceof Error ? loadError.message : "Messages are unavailable.");
                    setMessageState("error");
                }
            }
        }
        void loadMessages();
        return () => controller.abort();
    }, [role, selectedId]);

    async function sendMessage(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (!selectedId || (!message.trim() && !selectedImage) || isSending) return;
        if (selectedImage && (!["image/jpeg", "image/png", "image/webp"].includes(selectedImage.file.type) || selectedImage.file.size === 0 || selectedImage.file.size > 5 * 1024 * 1024)) {
            setError("Choose a JPG, PNG, or WEBP image no larger than 5 MB.");
            return;
        }
        setError("");
        setIsSending(true);
        setUploadProgress(0);
        try {
            const formData = new FormData();
            formData.set("message", message.trim());
            if (selectedImage) formData.append("image", selectedImage.file);
            const result = await uploadMessage(selectedId, formData, setUploadProgress);
            if (result.message) {
                const sender: Participant = { name: "You", role };
                setMessages((current) => [...current, { ...result.message!, sender }]);
                setConversations((current) => current.map((conversation) => conversation.id === selectedId
                    ? { ...conversation, latestMessage: { body: result.message!.body || (result.message!.attachments?.length ? "Image" : "") }, updatedAt: result.message!.createdAt, unreadCount: 0 }
                    : conversation));
                window.dispatchEvent(new Event(dashboardNotificationsUpdatedEvent));
            }
            setMessage("");
            selectMessageImage(null);
            setUploadProgress(100);
        } catch (sendError) {
            setError(sendError instanceof Error ? sendError.message : "Message could not be sent.");
        } finally {
            setIsSending(false);
        }
    }

    if (role === "admin") return <section className="dashboard-panel" role="alert"><strong>Messages are private to participants.</strong><p>Admin accounts cannot access participant messages.</p></section>;
    if (state === "loading") return <div className="dashboard-empty" role="status">Loading conversations...</div>;
    if (state === "error" && conversations.length === 0) return <div className="dashboard-empty" role="alert"><p>{error}</p></div>;
    if (!conversations.length) return <div className="dashboard-empty"><strong>No conversations yet.</strong><p>Your conversations will appear here when you connect with a client or freelancer.</p></div>;

    const selected = conversations.find((conversation) => conversation.id === selectedId);
    const visibleConversations = conversations.filter((conversation) => {
        const other = conversation.participants.find((participant) => participant.role !== role);
        return `${other?.name || ""} ${conversation.task?.title || ""} ${conversation.latestMessage?.body || ""}`.toLowerCase().includes(search.trim().toLowerCase());
    });
    return <section className={`dashboard-two-column messages-layout${selectedId ? " has-selection" : ""}`}>
        <nav className="dashboard-panel messages-list-panel" aria-label="Conversations">
            <h2>Conversations</h2>
            <label className="visually-hidden" htmlFor="conversation-search">Search conversations</label>
            <input className="filter-input" id="conversation-search" onChange={(event) => setSearch(event.target.value)} placeholder="Search conversations" type="search" value={search} />
            <div className="dashboard-list">{visibleConversations.map((conversation) => {
                const other = conversation.participants.find((participant) => participant.role !== role);
                return <button aria-current={conversation.id === selectedId ? "true" : undefined} className={`dashboard-list-row message-conversation${conversation.id === selectedId ? " is-selected" : ""}`} key={conversation.id} onClick={() => setSelectedId(conversation.id)} type="button">
                    <span><strong>{other?.name || "Project participant"}</strong><span>{conversation.task?.title || "Project"}</span><small>{conversation.latestMessage?.body || "No messages yet"}</small></span>
                    {Boolean(conversation.unreadCount) && <span aria-label={`${conversation.unreadCount} unread messages`} className="message-unread-count">{conversation.unreadCount}</span>}
                </button>;
            })}</div>
            {visibleConversations.length === 0 && <p className="muted-copy">No conversations match your search.</p>}
        </nav>
        <section className="dashboard-panel messages-chat-panel">
            {selectedId ? <>
                <div className="dashboard-panel-heading messages-chat-heading">
                    <button className="button button-quiet messages-back-button" onClick={() => setSelectedId("")} type="button">Back to conversations</button>
                    <div><span className="panel-kicker">{selected?.task?.title || "Project conversation"}</span><h2>{selected?.participants.find((participant) => participant.role !== role)?.name || "Messages"}</h2></div>
                </div>
                <div className="dashboard-list message-history">{messages.map((item) => <article className="dashboard-list-row message-history-item" key={item._id || item.id || item.createdAt}><div><strong>{item.sender.name}</strong>{item.body && <p>{item.body}</p>}{item.attachments?.map((attachment) => <button aria-label={`Open image ${attachment.fileName}`} className="message-image-button" key={attachment.url} onClick={() => setExpandedImage(attachment)} type="button"><Image alt={attachment.fileName} className="message-image-thumbnail" height={220} src={attachment.url} unoptimized width={280} /></button>)}</div><time>{new Date(item.createdAt).toLocaleString()}</time></article>)}</div>
                {messageState === "loading" && <p className="muted-copy" role="status">Loading messages...</p>}
                {!messages.length && messageState === "success" && <p className="muted-copy">No messages in this conversation yet.</p>}
                {error && <p className="form-error" role="alert">{error}</p>}
                <form className="dashboard-form message-compose-form" onSubmit={(event) => void sendMessage(event)}>
                    <label htmlFor="message-body">Send a message</label>
                    <textarea className="filter-input dashboard-textarea" id="message-body" maxLength={5000} value={message} onChange={(event) => setMessage(event.target.value)} />
                    {selectedImage && <div className="message-image-selected"><Image alt="Selected image preview" height={100} src={selectedImage.previewUrl} unoptimized width={140} /><span>{selectedImage.file.name}</span><button aria-label="Remove selected image" className="button button-quiet" disabled={isSending} onClick={() => selectMessageImage(null)} type="button"><X size={16} />Remove</button></div>}
                    <div className="message-compose-actions">
                        <input accept="image/jpeg,image/png,image/webp" className="visually-hidden" disabled={isSending} id="message-image" onChange={(event) => { selectMessageImage(event.target.files?.[0] || null); event.target.value = ""; }} ref={imageInputRef} type="file" />
                        <button className="button button-quiet" disabled={isSending} onClick={() => imageInputRef.current?.click()} type="button"><ImagePlus aria-hidden="true" size={18} />Attach image</button>
                        <button className="button button-primary" disabled={(!message.trim() && !selectedImage) || isSending} type="submit">{isSending ? "Sending..." : "Send message"}</button>
                    </div>
                    {isSending && selectedImage && <div className="project-upload-progress" role="status"><span>Uploading image... {uploadProgress}%</span><progress max="100" value={uploadProgress} /></div>}
                </form>
            </> : <p className="muted-copy">Select a conversation to view messages.</p>}
        </section>
        {expandedImage && <div className="message-image-overlay" onClick={() => setExpandedImage(null)} role="presentation">
            <section aria-label={`Preview ${expandedImage.fileName}`} aria-modal="true" className="message-image-dialog" onClick={(event) => event.stopPropagation()} role="dialog">
                <button aria-label="Close image preview" className="button button-quiet message-image-close" onClick={() => setExpandedImage(null)} type="button"><X size={20} /></button>
                <Image alt={expandedImage.fileName} className="message-image-full" height={900} src={expandedImage.url} unoptimized width={1200} />
            </section>
        </div>}
    </section>;
}
