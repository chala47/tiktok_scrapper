import { useEffect, useState } from "react";

type EntityType = "hashtag" | "profile";
type SavedFollowUp = {
  entity_type: EntityType;
  target: string;
  category?: string;
};

const API_BASE = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, "") ?? "/api";

function isSavedFollowUp(value: unknown, entityType: EntityType): value is SavedFollowUp {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return record.entity_type === entityType &&
    typeof record.target === "string" &&
    (record.category === undefined || typeof record.category === "string");
}

export default function SavedFollowUpSelect({
  entityType,
  onSelect,
  compact = false,
  categoryOnly = false,
  value,
}: {
  entityType: EntityType;
  onSelect: (target: string) => void;
  compact?: boolean;
  categoryOnly?: boolean;
  value?: string;
}) {
  const [targets, setTargets] = useState<SavedFollowUp[]>([]);
  const [selection, setSelection] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    async function loadTargets() {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(
          `${API_BASE}/follow-ups?${new URLSearchParams({ entity_type: entityType })}`,
          { signal: controller.signal },
        );
        const payload: unknown = await response.json().catch(() => null);
        if (!response.ok) {
          const message = typeof payload === "object" && payload !== null &&
            "error" in payload && typeof payload.error === "string"
            ? payload.error
            : `Request failed (${response.status})`;
          throw new Error(message);
        }
        if (!Array.isArray(payload) || !payload.every((item) => isSavedFollowUp(item, entityType))) {
          throw new Error("The API returned an unexpected follow-up response.");
        }
        if (entityType === "profile") {
          setTargets(payload);
        } else {
          setTargets([...new Set(payload.map((item) => item.target))].map((target) => ({
            entity_type: entityType,
            target,
          })));
        }
      } catch (reason) {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setError(reason instanceof Error ? reason.message : "Could not load saved follow-ups.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    void loadTargets();
    return () => controller.abort();
  }, [entityType]);

  useEffect(() => {
    setSelection("");
  }, [entityType, categoryOnly]);

  const title = categoryOnly ? "profile category" : entityType === "hashtag" ? "hashtag" : "profile";
  const categories = entityType === "profile"
    ? [...new Set(targets.map((item) => item.category?.trim()).filter((category): category is string => !!category))]
      .sort((left, right) => left.localeCompare(right))
    : [];
  const profileGroups = entityType === "profile"
    ? [...targets.reduce((groups, item) => {
      const category = item.category?.trim() || "Uncategorized";
      const group = groups.get(category) ?? new Set<string>();
      group.add(item.target);
      groups.set(category, group);
      return groups;
    }, new Map<string, Set<string>>())]
      .sort(([left], [right]) => left.localeCompare(right))
    : [];
  const select = (
    <select
      aria-label={`Choose saved ${title}`}
      value={value ?? selection}
      disabled={loading || (categoryOnly ? categories.length === 0 : targets.length === 0)}
      required={categoryOnly}
      onChange={(event) => {
        const target = event.target.value;
        if (value === undefined) setSelection(categoryOnly ? target : "");
        if (target) onSelect(target);
      }}
    >
      <option value="">
        {loading
          ? "Loading saved items…"
          : categoryOnly
            ? categories.length ? "Select a saved profile category…" : "No saved profile categories"
            : targets.length ? `Select a saved ${title}…` : `No saved ${title}s`}
      </option>
      {categoryOnly
        ? categories.map((category) => <option value={category} key={category}>{category}</option>)
        : entityType === "profile"
        ? profileGroups.map(([category, usernames]) => (
          <optgroup label={category} key={category}>
            {[...usernames].sort((left, right) => left.localeCompare(right)).map((target) => (
              <option value={target} key={`${category}-${target}`}>@{target}</option>
            ))}
          </optgroup>
        ))
        : targets.map(({ target }) => (
          <option value={target} key={target}>#{target}</option>
        ))}
    </select>
  );

  if (compact) {
    return (
      <div className="saved-select-wrap saved-select-compact">
        {select}
        {error && <span className="saved-select-error" role="status">Saved items unavailable: {error}</span>}
      </div>
    );
  }

  return (
    <div className="saved-select-wrap">
      <div className="field saved-select-field">
        <span>Choose saved {title}</span>
        {select}
      </div>
      {error && <span className="saved-select-error" role="status">Saved items unavailable: {error}</span>}
    </div>
  );
}
