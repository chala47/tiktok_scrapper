import { useEffect, useState } from "react";
import type { FormEvent } from "react";

type EntityType = "hashtag" | "profile";
type FollowUpStatus = "open" | "done";
type FollowUp = {
  id: number;
  entity_type: EntityType;
  target: string;
  note: string;
  category: string;
  status: FollowUpStatus;
  due_date: string | null;
  created_at: string;
  updated_at: string;
};
type Filter = "all" | EntityType;
type StatusFilter = "all" | FollowUpStatus;
type FollowUpInput = {
  entity_type: EntityType;
  target: string;
  note: string;
  category: string;
  due_date: string;
};

const API_BASE = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, "") ?? "/api";
const PROFILE_CATEGORIES = [
  "persona",
  "meme",
  "Sports",
  "Comedy",
  "Education",
  "Dance",
  "Music",
  "Beauty & Fashion",
  "Food",
  "Travel",
  "Gaming",
  "Lifestyle",
  "News",
];

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, init);
  if (response.status === 204) return undefined as T;

  const body = await response.text();
  let payload: unknown = null;
  if (body) {
    try {
      payload = JSON.parse(body);
    } catch {
      if (response.ok) throw new Error("The API returned an unexpected response.");
    }
  }
  if (!response.ok) {
    const message =
      typeof payload === "object" && payload !== null && "error" in payload &&
      typeof payload.error === "string"
        ? payload.error
        : `Request failed (${response.status})`;
    throw new Error(message);
  }
  return payload as T;
}

function isFollowUp(value: unknown): value is FollowUp {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  return Number.isInteger(item.id) &&
    (item.entity_type === "hashtag" || item.entity_type === "profile") &&
    typeof item.target === "string" &&
    typeof item.note === "string" &&
    typeof item.category === "string" &&
    (item.status === "open" || item.status === "done") &&
    (item.due_date === null || typeof item.due_date === "string") &&
    typeof item.created_at === "string" &&
    typeof item.updated_at === "string";
}

function dateLabel(value: string | null): string {
  if (!value) return "No due date";
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date);
}

function targetLabel(item: Pick<FollowUp, "entity_type" | "target">): string {
  return item.entity_type === "hashtag" ? `#${item.target}` : `@${item.target}`;
}

export default function FollowUps() {
  const [items, setItems] = useState<FollowUp[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("open");
  const [form, setForm] = useState<FollowUpInput>({
    entity_type: "hashtag",
    target: "",
    note: "",
    category: "",
    due_date: "",
  });
  const [editing, setEditing] = useState<(FollowUpInput & { id: number }) | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const profileCategories = [...new Set(
    items
      .filter((item) => item.entity_type === "profile" && item.category)
      .map((item) => item.category),
  )].sort((left, right) => left.localeCompare(right));
  const visibleItems = items.filter((item) => {
    if (filter !== "profile" || categoryFilter === "all") return true;
    return categoryFilter === "uncategorized"
      ? !item.category
      : item.category === categoryFilter.slice("category:".length);
  });

  async function loadItems() {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    if (filter !== "all") params.set("entity_type", filter);
    if (statusFilter !== "all") params.set("status", statusFilter);
    try {
      const payload: unknown = await request(`/follow-ups${params.size ? `?${params}` : ""}`);
      if (!Array.isArray(payload) || !payload.every(isFollowUp)) {
        throw new Error("The API returned an unexpected follow-up response.");
      }
      setItems(payload);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load follow-ups.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadItems();
  }, [filter, statusFilter]);

  function changeForm(field: keyof FollowUpInput, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function createFollowUp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const target = form.target.trim().replace(/^#+|^@/, "");
    if (!target) {
      setError(`Enter a ${form.entity_type === "hashtag" ? "hashtag" : "profile username"}.`);
      return;
    }
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const created: unknown = await request("/follow-ups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          target,
          category: form.entity_type === "profile" ? form.category : "",
        }),
      });
      if (!isFollowUp(created)) throw new Error("The API returned an unexpected follow-up response.");
      setForm((current) => ({ ...current, target: "", note: "", category: "", due_date: "" }));
      setNotice("Follow-up added.");
      if (filter !== "all" && filter !== created.entity_type) setFilter("all");
      else if (statusFilter === "done") setStatusFilter("all");
      else await loadItems();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not add follow-up.");
    } finally {
      setSaving(false);
    }
  }

  async function updateFollowUp(id: number, patch: Partial<FollowUpInput> | { status: FollowUpStatus }) {
    setBusyId(id);
    setError(null);
    setNotice(null);
    try {
      const updated: unknown = await request(`/follow-ups/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!isFollowUp(updated)) throw new Error("The API returned an unexpected follow-up response.");
      setNotice(updated.status === "done" ? "Follow-up completed." : "Follow-up updated.");
      if (statusFilter !== "all" && statusFilter !== updated.status) {
        await loadItems();
      } else {
        setItems((current) => current.map((item) => item.id === id ? updated : item));
      }
      setEditing(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not update follow-up.");
    } finally {
      setBusyId(null);
    }
  }

  async function deleteFollowUp(item: FollowUp) {
    if (!window.confirm(`Delete the follow-up for ${targetLabel(item)}?`)) return;
    setBusyId(item.id);
    setError(null);
    setNotice(null);
    try {
      await request<void>(`/follow-ups/${item.id}`, { method: "DELETE" });
      setItems((current) => current.filter((entry) => entry.id !== item.id));
      setNotice("Follow-up deleted.");
      setEditing(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not delete follow-up.");
    } finally {
      setBusyId(null);
    }
  }

  function beginEdit(item: FollowUp) {
    setEditing({
      id: item.id,
      entity_type: item.entity_type,
      target: item.target,
      note: item.note,
      category: item.category,
      due_date: item.due_date ?? "",
    });
    setError(null);
    setNotice(null);
  }

  async function saveEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    const target = editing.target.trim().replace(/^#+|^@/, "");
    if (!target) {
      setError("Target cannot be empty.");
      return;
    }
    await updateFollowUp(editing.id, {
      target,
      note: editing.note,
      category: editing.entity_type === "profile" ? editing.category : "",
      due_date: editing.due_date,
    });
  }

  return (
    <div className="follow-ups-page">
      <datalist id="profile-category-suggestions">
        {PROFILE_CATEGORIES.map((category) => <option value={category} key={category} />)}
      </datalist>
      <section className="intro follow-ups-intro">
        <p className="eyebrow">KEEP YOUR RESEARCH MOVING</p>
        <h1>Follow-ups</h1>
        <p className="intro-copy">Save hashtags and profiles to revisit, add a reminder, and track what’s done.</p>
      </section>

      <section className="search-panel follow-up-create" aria-label="Add a follow-up">
        <div className="follow-up-panel-heading">
          <div>
            <p className="eyebrow">NEW REMINDER</p>
            <h2>Add a follow-up</h2>
          </div>
        </div>
        <form onSubmit={createFollowUp}>
          <div className="follow-up-form-grid">
            <label className="field">
              <span>Type</span>
              <select value={form.entity_type} onChange={(event) => changeForm("entity_type", event.target.value)}>
                <option value="hashtag">Hashtag</option>
                <option value="profile">Profile</option>
              </select>
            </label>
            <label className="field">
              <span>{form.entity_type === "hashtag" ? "Hashtag" : "Username"}</span>
              <input
                value={form.target}
                onChange={(event) => changeForm("target", event.target.value)}
                placeholder={form.entity_type === "hashtag" ? "dance" : "creator"}
                required
              />
            </label>
            <label className="field">
              <span>Due date <span className="optional-label">OPTIONAL</span></span>
              <input type="date" value={form.due_date} onChange={(event) => changeForm("due_date", event.target.value)} />
            </label>
            <button className="search-button follow-up-add-button" type="submit" disabled={saving}>
              {saving ? "Saving…" : "Add follow-up"} <span aria-hidden="true">+</span>
            </button>
            {form.entity_type === "profile" && (
              <label className="field follow-up-category-field">
                <span>Category <span className="optional-label">OPTIONAL</span></span>
                <input
                  list="profile-category-suggestions"
                  value={form.category}
                  onChange={(event) => changeForm("category", event.target.value)}
                  placeholder="e.g. Sports or Comedy"
                  maxLength={80}
                />
              </label>
            )}
            <label className="field follow-up-note-field">
              <span>Note <span className="optional-label">OPTIONAL</span></span>
              <input
                value={form.note}
                onChange={(event) => changeForm("note", event.target.value)}
                placeholder="What should you check?"
                maxLength={2000}
              />
            </label>
          </div>
        </form>
      </section>

      <div className="follow-up-toolbar" aria-label="Follow-up views">
        <div className="follow-up-filter-group" aria-label="Saved items">
          {([
            ["all", "All"],
            ["hashtag", "Hashtags"],
            ["profile", "Profiles"],
          ] as const).map(([value, label]) => (
            <button
              className={`filter-chip${filter === value ? " selected" : ""}`}
              key={value}
              type="button"
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
            >
              {label}
            </button>
          ))}
        </div>
        {filter === "profile" && (
          <label className="follow-up-category-filter">
            <span className="visually-hidden">Filter profiles by category</span>
            <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
              <option value="all">All categories</option>
              {items.some((item) => item.entity_type === "profile" && !item.category) && (
                <option value="uncategorized">Uncategorized</option>
              )}
              {profileCategories.map((category) => (
                <option value={`category:${category}`} key={category}>{category}</option>
              ))}
            </select>
          </label>
        )}
        <label className="follow-up-status-filter">
          <span className="visually-hidden">Status</span>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}>
            <option value="open">Open</option>
            <option value="done">Completed</option>
            <option value="all">All statuses</option>
          </select>
        </label>
        <button className="refresh-button" type="button" onClick={() => void loadItems()} disabled={loading}>
          {loading ? "Loading…" : "↻ Refresh"}
        </button>
      </div>

      <section className="results-section follow-up-results" aria-live="polite">
          <div className="results-heading follow-up-results-heading">
            <div>
              <p className="eyebrow">YOUR LIST</p>
              <h2>Saved follow-ups</h2>
            </div>
            <span className="result-count">{visibleItems.length} {visibleItems.length === 1 ? "follow-up" : "follow-ups"}</span>
          </div>

          {error && <p className="error-message follow-up-message" role="alert">{error}</p>}
          {notice && !error && <p className="success-message follow-up-message" role="status">{notice}</p>}

          {loading ? (
            <div className="follow-up-empty">Loading follow-ups…</div>
          ) : visibleItems.length ? (
            <div className="follow-up-list">
              {visibleItems.map((item) => (
              <article className={`follow-up-card${item.status === "done" ? " is-done" : ""}`} key={item.id}>
                {editing?.id === item.id ? (
                  <form className="follow-up-edit-form" onSubmit={saveEdit}>
                    <label className="field">
                      <span>{editing.entity_type === "hashtag" ? "Hashtag" : "Username"}</span>
                      <input
                        value={editing.target}
                        onChange={(event) => setEditing({ ...editing, target: event.target.value })}
                        required
                      />
                    </label>
                    <label className="field">
                      <span>Due date</span>
                      <input
                        type="date"
                        value={editing.due_date}
                        onChange={(event) => setEditing({ ...editing, due_date: event.target.value })}
                      />
                    </label>
                    {editing.entity_type === "profile" && (
                      <label className="field">
                        <span>Category</span>
                        <input
                          list="profile-category-suggestions"
                          value={editing.category}
                          onChange={(event) => setEditing({ ...editing, category: event.target.value })}
                          maxLength={80}
                        />
                      </label>
                    )}
                    <label className="field follow-up-edit-note">
                      <span>Note</span>
                      <input
                        value={editing.note}
                        onChange={(event) => setEditing({ ...editing, note: event.target.value })}
                        maxLength={2000}
                      />
                    </label>
                    <div className="follow-up-actions">
                      <button className="small-action primary-action" type="submit" disabled={busyId === item.id}>
                        {busyId === item.id ? "Saving…" : "Save"}
                      </button>
                      <button className="small-action" type="button" onClick={() => setEditing(null)}>Cancel</button>
                    </div>
                  </form>
                ) : error ? (
                  <div className="follow-up-empty">
                    <strong>Couldn’t load your follow-ups</strong>
                    <span>Check that the backend is running, then try refreshing.</span>
                  </div>
                ) : (
                  <>
                    <div className="follow-up-card-main">
                      <span className={`entity-badge ${item.entity_type}`}>
                        {item.entity_type === "hashtag" ? "#" : "@"} {item.entity_type}
                      </span>
                      {item.entity_type === "profile" && item.category && (
                        <span className="entity-badge profile-category">{item.category}</span>
                      )}
                      <h3>{targetLabel(item)}</h3>
                      {item.note && <p className="follow-up-note">{item.note}</p>}
                      <p className={`follow-up-due${item.due_date ? " has-date" : ""}`}>
                        <span aria-hidden="true">◷</span> {dateLabel(item.due_date)}
                      </p>
                    </div>
                    <div className="follow-up-card-actions">
                      <button
                        className={`small-action${item.status === "open" ? " primary-action" : ""}`}
                        type="button"
                        disabled={busyId === item.id}
                        onClick={() => void updateFollowUp(item.id, { status: item.status === "open" ? "done" : "open" })}
                      >
                        {busyId === item.id ? "Saving…" : item.status === "open" ? "Mark done" : "Reopen"}
                      </button>
                      <button className="small-action" type="button" onClick={() => beginEdit(item)}>Edit</button>
                      <button
                        className="small-action delete-action"
                        type="button"
                        disabled={busyId === item.id}
                        onClick={() => void deleteFollowUp(item)}
                      >
                        Delete
                      </button>
                    </div>
                  </>
                )}
              </article>
              ))}
            </div>
          ) : (
            <div className="follow-up-empty">
              <span className="follow-up-empty-icon" aria-hidden="true">✓</span>
              <strong>
                {categoryFilter !== "all"
                  ? "No profiles in this category"
                  : statusFilter === "done" ? "Nothing completed yet" : "No follow-ups here yet"}
              </strong>
              <span>
                {categoryFilter !== "all"
                  ? "Choose another category or add a profile with this category."
                  : "Add a hashtag or profile above to keep it on your radar."}
              </span>
            </div>
          )}
      </section>
      <footer>Your follow-ups are saved locally in the scraper’s SQLite database.</footer>
    </div>
  );
}
