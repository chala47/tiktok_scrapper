import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import SavedFollowUpSelect from "./SavedFollowUpSelect";

export type ApiGroup = "search" | "users" | "videos";
type ResultObject = Record<string, unknown>;
type UserVideoSortKey = "created_at" | "stats.like_count" | "stats.play_count";
type SortDirection = "ascending" | "descending";

type FieldSpec = {
  name: string;
  label: string;
  required?: boolean;
  type?: "text" | "date" | "number" | "select";
  placeholder?: string;
  defaultValue?: string;
  options?: { label: string; value: string }[];
};

type EndpointSpec = {
  path: string;
  label: string;
  description: string;
  fields: FieldSpec[];
};

const API_BASE = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, "") ?? "/api";
const numberFormat = new Intl.NumberFormat();

function formatCount(value: number): string {
  const units = [
    { threshold: 1_000_000_000, suffix: "b" },
    { threshold: 1_000_000, suffix: "m" },
    { threshold: 1_000, suffix: "k" },
  ];
  const unit = units.find(({ threshold }) => Math.abs(value) >= threshold);
  return unit
    ? `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value / unit.threshold)}${unit.suffix}`
    : numberFormat.format(value);
}

const endpointGroups: Record<ApiGroup, EndpointSpec[]> = {
  search: [
    {
      path: "/search/videos",
      label: "Search videos",
      description: "Find videos by keyword, with sort, publish-range, and exact date filters.",
      fields: [
        { name: "query", label: "Keyword", required: true, placeholder: "ethiopian_tik_tok" },
        { name: "sort", label: "Sort", type: "select", defaultValue: "relevance", options: [{ label: "Relevance", value: "relevance" }, { label: "Likes", value: "likes" }] },
        { name: "published", label: "Published within", type: "select", options: [{ label: "Any time", value: "" }, { label: "Day", value: "day" }, { label: "Week", value: "week" }, { label: "Month", value: "month" }, { label: "3 months", value: "3months" }, { label: "6 months", value: "6months" }] },
        { name: "start_date", label: "Posted on or after (optional)", type: "date" },
        { name: "end_date", label: "Posted on or before (optional)", type: "date" },
        { name: "country", label: "Country (optional)", placeholder: "us" },
      ],
    },
    {
      path: "/search/users",
      label: "Search users",
      description: "Search creator accounts and view their profile links and counts.",
      fields: [{ name: "query", label: "Keyword", required: true, placeholder: "creator name" }],
    },
    {
      path: "/search/top",
      label: "Search top",
      description: "Search TikTok’s mixed Top results.",
      fields: [
        { name: "query", label: "Keyword", required: true, placeholder: "ethiopian_tik_tok" },
        { name: "country", label: "Country (optional)", placeholder: "de" },
      ],
    },
    {
      path: "/search/live",
      label: "Search live",
      description: "Search live streams by keyword.",
      fields: [
        { name: "query", label: "Keyword", required: true, placeholder: "music" },
        { name: "country", label: "Country (optional)", placeholder: "de" },
      ],
    },
    {
      path: "/search/suggestions",
      label: "Search suggestions",
      description: "Get suggestions for a search phrase as you type.",
      fields: [
        { name: "query", label: "Keyword", required: true, placeholder: "ethiopian" },
        { name: "country", label: "Country (optional)", placeholder: "us" },
      ],
    },
  ],
  users: [
    {
      path: "/users/profile",
      label: "User profile",
      description: "Get profile details, bio, account flags, and counters.",
      fields: [{ name: "user", label: "Username or profile link", required: true, placeholder: "@tiktok" }],
    },
    {
      path: "/users/resolve",
      label: "Resolve user",
      description: "Resolve a username or profile link to its account identifiers.",
      fields: [{ name: "user", label: "Username or profile link", required: true, placeholder: "@tiktok" }],
    },
    {
      path: "/users/videos",
      label: "User videos",
      description: "List a creator’s posts by sort order and optional inclusive date range.",
      fields: [
        { name: "user", label: "Username or profile link", required: true, placeholder: "@tiktok" },
        { name: "sort", label: "Sort", type: "select", defaultValue: "latest", options: [{ label: "Latest", value: "latest" }, { label: "Popular", value: "popular" }, { label: "Oldest", value: "oldest" }] },
        { name: "country", label: "Country (optional)", placeholder: "us" },
        { name: "start_date", label: "Posted on or after (optional)", type: "date" },
        { name: "end_date", label: "Posted on or before (optional)", type: "date" },
      ],
    },
    {
      path: "/users/reposts",
      label: "User reposts",
      description: "List videos reposted by a creator.",
      fields: [
        { name: "user", label: "Username or profile link", required: true, placeholder: "@tiktok" },
        { name: "country", label: "Country (optional)", placeholder: "us" },
      ],
    },
    {
      path: "/users/followers",
      label: "User followers",
      description: "List followers of a creator.",
      fields: [{ name: "user", label: "Username or profile link", required: true, placeholder: "@tiktok" }],
    },
    {
      path: "/users/following",
      label: "User following",
      description: "List accounts a creator follows.",
      fields: [{ name: "user", label: "Username or profile link", required: true, placeholder: "@tiktok" }],
    },
    {
      path: "/users/playlists",
      label: "User playlists",
      description: "List a creator’s public playlists.",
      fields: [{ name: "user", label: "Username or profile link", required: true, placeholder: "@tiktok" }],
    },
    {
      path: "/users/collections",
      label: "User collections",
      description: "List a creator’s public collections.",
      fields: [{ name: "user", label: "Username or profile link", required: true, placeholder: "@tiktok" }],
    },
  ],
  videos: [
    {
      path: "/videos/details",
      label: "Video details",
      description: "Get details, creator information, stats, and a canonical link.",
      fields: [{ name: "video", label: "Video ID or link", required: true, placeholder: "Paste a TikTok video URL" }],
    },
    {
      path: "/videos/resolve",
      label: "Resolve video",
      description: "Resolve a video or share link to its canonical video details.",
      fields: [{ name: "video", label: "Video ID or link", required: true, placeholder: "Paste a TikTok video URL" }],
    },
    {
      path: "/videos/media",
      label: "Video media",
      description: "Get video renditions, photos, subtitles, and sound media links.",
      fields: [{ name: "video", label: "Video ID or link", required: true, placeholder: "Paste a TikTok video URL" }],
    },
    {
      path: "/videos/related",
      label: "Related videos",
      description: "Find videos TikTok recommends alongside a video.",
      fields: [{ name: "video", label: "Video ID or link", required: true, placeholder: "Paste a TikTok video URL" }],
    },
    {
      path: "/videos/comments",
      label: "Video comments",
      description: "List top-level comments for a video.",
      fields: [{ name: "video", label: "Video ID or link", required: true, placeholder: "Paste a TikTok video URL" }],
    },
    {
      path: "/videos/comment-replies",
      label: "Comment replies",
      description: "List replies under a comment. Provide its comment ID.",
      fields: [
        { name: "video", label: "Video ID or link", required: true, placeholder: "Paste a TikTok video URL" },
        { name: "comment_id", label: "Comment ID", required: true, placeholder: "Comment ID" },
      ],
    },
    {
      path: "/videos/transcript",
      label: "Video transcript",
      description: "Get available captions and timed transcript segments.",
      fields: [
        { name: "video", label: "Video ID or link", required: true, placeholder: "Paste a TikTok video URL" },
        { name: "language", label: "Language (optional)", placeholder: "en" },
      ],
    },
  ],
};

const groupTitles: Record<ApiGroup, string> = {
  search: "Search APIs",
  users: "User APIs",
  videos: "Video APIs",
};

function isObject(value: unknown): value is ResultObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSavedVideoRecord(value: unknown): value is { video_id: string } {
  return isObject(value) && typeof value.video_id === "string";
}

function getPath(record: ResultObject, path: string): unknown {
  return path.split(".").reduce<unknown>((current, key) => {
    return isObject(current) ? current[key] : undefined;
  }, record);
}

function displayValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function columnsFor(key: string, rows: unknown[]): string[] {
  const preferred: Record<string, string[]> = {
    videos: ["id", "description", "author.username", "created_at", "stats.like_count", "stats.play_count", "link"],
    users: ["username", "nickname", "follower_count", "like_count", "stats.follower_count", "stats.like_count", "link"],
    comments: ["id", "text", "user.username", "created_at", "like_count", "reply_count", "link"],
    replies: ["id", "text", "user.username", "created_at", "like_count", "reply_count", "link"],
    rooms: ["username", "title", "viewer_count", "like_count", "link"],
    suggestions: ["value"],
    segments: ["start_seconds", "end_seconds", "text"],
  };
  const candidates = preferred[key] ?? [];
  if (rows.some((row) => !isObject(row))) return ["value"];
  const available = candidates.filter((path) =>
    rows.some((row) => isObject(row) && getPath(row, path) !== undefined),
  );
  if (available.length) return available;

  const generic = new Set<string>();
  for (const row of rows) {
    if (!isObject(row)) continue;
    for (const [field, value] of Object.entries(row)) {
      if (value === null || ["string", "number", "boolean"].includes(typeof value)) generic.add(field);
      if (isObject(value)) {
        for (const [nestedField, nestedValue] of Object.entries(value)) {
          if (nestedValue === null || ["string", "number", "boolean"].includes(typeof nestedValue)) {
            generic.add(`${field}.${nestedField}`);
          }
        }
      }
    }
    if (generic.size >= 7) break;
  }
  const genericColumns = [...generic].slice(0, 7);
  return genericColumns.length ? genericColumns : ["value"];
}

function resultArrays(responses: unknown[]): { key: string; rows: unknown[] }[] {
  const grouped = new Map<string, unknown[]>();
  for (const response of responses) {
    if (!isObject(response)) continue;
    for (const [key, value] of Object.entries(response)) {
      if (!Array.isArray(value)) continue;
      const current = grouped.get(key) ?? [];
      grouped.set(key, [...current, ...value]);
    }
  }
  return [...grouped.entries()].map(([key, rows]) => ({ key, rows }));
}

function formatColumn(path: string): string {
  return path.split(".").map((part) => part.replace(/_/g, " ")).join(" · ").toUpperCase();
}

function renderCell(record: unknown, path: string, mergeVideoLink = false): React.ReactNode {
  const value = path === "value" && !isObject(record) ? record : isObject(record) ? getPath(record, path) : undefined;
  if (mergeVideoLink && path === "id" && isObject(record) && typeof record.link === "string") {
    return <a href={record.link} target="_blank" rel="noreferrer">{displayValue(value)}</a>;
  }
  if (typeof value === "string" && /^https?:\/\//i.test(value)) {
    return <a href={value} target="_blank" rel="noreferrer">Open link</a>;
  }
  if (typeof value === "number" && /(^|\.)(like_count|play_count)$/.test(path)) return formatCount(value);
  return displayValue(value);
}

function userVideoSortValue(row: unknown, key: UserVideoSortKey): number | null {
  if (!isObject(row)) return null;
  const value = getPath(row, key);
  if (key === "created_at" && typeof value === "string") {
    const timestamp = Date.parse(value);
    return Number.isNaN(timestamp) ? null : timestamp;
  }
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isUserVideoSortKey(value: string): value is UserVideoSortKey {
  return value === "created_at" || value === "stats.like_count" || value === "stats.play_count";
}

function userVideoColumnLabel(path: string): string {
  const labels: Record<string, string> = {
    id: "ID",
    description: "VIDEO",
    "author.username": "CREATOR",
    created_at: "DATE",
    "stats.like_count": "LIKES",
    "stats.play_count": "PLAYS",
  };
  return labels[path] ?? formatColumn(path);
}

function flattenDetails(record: ResultObject, prefix = "", depth = 0): [string, unknown][] {
  const details: [string, unknown][] = [];
  for (const [key, value] of Object.entries(record)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (Array.isArray(value)) details.push([path, `${value.length} items`]);
    else if (isObject(value) && depth < 2) details.push(...flattenDetails(value, path, depth + 1));
    else details.push([path, value]);
  }
  return details;
}

export default function ApiExplorer({ group }: { group: ApiGroup }) {
  const endpoints = endpointGroups[group];
  const [endpointPath, setEndpointPath] = useState(endpoints[0].path);
  const endpoint = endpoints.find(({ path }) => path === endpointPath) ?? endpoints[0];
  const [values, setValues] = useState<Record<string, string>>({});
  const [submittedValues, setSubmittedValues] = useState<Record<string, string> | null>(null);
  const [responses, setResponses] = useState<unknown[]>([]);
  const [userVideoSort, setUserVideoSort] = useState<{
    key: UserVideoSortKey;
    direction: SortDirection;
  } | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedVideoIds, setSavedVideoIds] = useState<Set<string>>(new Set());
  const [savingVideoIds, setSavingVideoIds] = useState<Set<string>>(new Set());
  const [savedVideosLoading, setSavedVideosLoading] = useState(group === "users");
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (group !== "users") return;
    let active = true;
    setSavedVideosLoading(true);

    async function loadSavedVideos() {
      try {
        const response = await fetch(`${API_BASE}/saved-videos`);
        const payload: unknown = await response.json().catch(() => null);
        if (!response.ok) {
          const message = isObject(payload) && typeof payload.error === "string"
            ? payload.error
            : `Request failed (${response.status})`;
          throw new Error(message);
        }
        if (!Array.isArray(payload) || !payload.every(isSavedVideoRecord)) {
          throw new Error("The API returned an unexpected saved-video response.");
        }
        if (active) setSavedVideoIds(new Set(payload.map((item) => item.video_id)));
      } catch (reason) {
        if (active) {
          setSaveError(reason instanceof Error ? reason.message : "Could not load saved videos.");
        }
      } finally {
        if (active) {
          setSavedVideosLoading(false);
        }
      }
    }

    void loadSavedVideos();
    return () => {
      active = false;
    };
  }, [group]);

  function chooseEndpoint(path: string) {
    setEndpointPath(path);
    setValues({});
    setSubmittedValues(null);
    setResponses([]);
    setCursor(null);
    setError(null);
  }

  function toggleUserVideoSort(key: UserVideoSortKey) {
    setUserVideoSort((current) => ({
      key,
      direction: current?.key === key && current.direction === "descending"
        ? "ascending"
        : "descending",
    }));
  }

  async function requestPage(query: Record<string, string>, nextCursor: string | null): Promise<unknown> {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value) params.set(key, value);
    }
    if (nextCursor) params.set("cursor", nextCursor);

    const response = await fetch(`${API_BASE}${endpoint.path}?${params.toString()}`);
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const message = isObject(payload) && typeof payload.error === "string"
        ? payload.error
        : `Request failed (${response.status})`;
      throw new Error(message);
    }
    return payload;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setResponses([]);
    setCursor(null);
    setSubmittedValues(values);
    try {
      const payload = await requestPage(values, null);
      setResponses([payload]);
      if (isObject(payload) && payload.has_more === true && typeof payload.next_cursor === "string") {
        setCursor(payload.next_cursor);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The request failed.");
    } finally {
      setLoading(false);
    }
  }

  async function loadMore() {
    if (!submittedValues || !cursor || loading) return;
    setLoading(true);
    setError(null);
    try {
      const payload = await requestPage(submittedValues, cursor);
      setResponses((current) => [...current, payload]);
      if (isObject(payload) && payload.has_more === true && typeof payload.next_cursor === "string") {
        setCursor(payload.next_cursor);
      } else {
        setCursor(null);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load the next page.");
    } finally {
      setLoading(false);
    }
  }

  async function toggleSavedVideo(row: unknown) {
    if (!isObject(row) || typeof row.id !== "string") return;
    const videoId = row.id;
    setSavingVideoIds((current) => new Set(current).add(videoId));
    setSaveError(null);
    try {
      const saved = savedVideoIds.has(videoId);
      const author = isObject(row.author) ? row.author : null;
      const creator = typeof author?.username === "string"
        ? author.username
        : typeof author?.nickname === "string" ? author.nickname : null;
      const submittedUser = submittedValues?.user?.trim() ?? "";
      const sourceHandle = typeof author?.username === "string"
        ? author.username
        : submittedUser.match(/@([^/?]+)/)?.[1] ??
          submittedUser.replace(/\/+$/, "").split("/").pop()?.replace(/^@/, "") ?? "";
      const response = await fetch(
        `${API_BASE}/saved-videos${saved ? `/${encodeURIComponent(videoId)}` : ""}`,
        saved
          ? { method: "DELETE" }
          : {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                video_id: videoId,
                hashtag: `@${sourceHandle}`,
                link: typeof row.link === "string" ? row.link : null,
                description: typeof row.description === "string" ? row.description : null,
                cover: typeof row.cover === "string" ? row.cover : null,
                creator,
                posted_at: typeof row.created_at === "string" ? row.created_at : null,
              }),
            },
      );
      if (!response.ok) {
        const payload: unknown = await response.json().catch(() => null);
        const message = isObject(payload) && typeof payload.error === "string"
          ? payload.error
          : `Request failed (${response.status})`;
        throw new Error(message);
      }
      if (saved) {
        setSavedVideoIds((current) => {
          const updated = new Set(current);
          updated.delete(videoId);
          return updated;
        });
      } else {
        const payload: unknown = await response.json();
        if (!isObject(payload) || payload.video_id !== videoId) {
          throw new Error("The API returned an unexpected saved-video response.");
        }
        setSavedVideoIds((current) => new Set(current).add(videoId));
      }
    } catch (reason) {
      setSaveError(reason instanceof Error ? reason.message : "Could not update the saved video.");
    } finally {
      setSavingVideoIds((current) => {
        const updated = new Set(current);
        updated.delete(videoId);
        return updated;
      });
    }
  }

  const arrays = resultArrays(responses);
  const detailRecords = responses.filter(isObject).filter((response) =>
    !("next_cursor" in response) && !("has_more" in response),
  );
  const resultCount = arrays.reduce((total, array) => total + array.rows.length, 0) + detailRecords.length;

  return (
    <section className="api-explorer">
      <div className="intro api-intro">
        <p className="eyebrow">{groupTitles[group].toUpperCase()}</p>
        <h1>{groupTitles[group]}</h1>
        <p className="intro-copy">Choose an endpoint, enter its parameters, and inspect results in a table.</p>
      </div>

      <section className="search-panel" aria-label={`${groupTitles[group]} request`}>
        <form onSubmit={submit}>
          <div className="api-form-grid">
            <label className="field">
              <span>Endpoint</span>
              <select value={endpointPath} onChange={(event) => chooseEndpoint(event.target.value)}>
                {endpoints.map((option) => (
                  <option value={option.path} key={option.path}>{option.label}</option>
                ))}
              </select>
            </label>
            {endpoint.fields.map((field) => (
              <label className="field" key={field.name}>
                <span>{field.label}</span>
                {field.type === "select" ? (
                  <select
                    value={values[field.name] ?? field.defaultValue ?? ""}
                    onChange={(event) => setValues((current) => ({ ...current, [field.name]: event.target.value }))}
                  >
                    {field.options?.map((option) => (
                      <option value={option.value} key={option.value}>{option.label}</option>
                    ))}
                  </select>
                ) : group === "users" && field.name === "user" ? (
                  <div className="api-user-input">
                    <SavedFollowUpSelect
                      key={`${endpoint.path}-${field.name}-saved`}
                      entityType="profile"
                      compact
                      onSelect={(target) => setValues((current) => ({ ...current, [field.name]: target }))}
                    />
                    <input
                      type={field.type ?? "text"}
                      value={values[field.name] ?? ""}
                      onChange={(event) => setValues((current) => ({ ...current, [field.name]: event.target.value }))}
                      placeholder={field.placeholder}
                      required={field.required}
                    />
                  </div>
                ) : (
                  <>
                    <input
                      type={field.type ?? "text"}
                      min={field.type === "number" ? "0" : undefined}
                      value={values[field.name] ?? ""}
                      onChange={(event) => setValues((current) => ({ ...current, [field.name]: event.target.value }))}
                      placeholder={field.placeholder}
                      required={field.required}
                    />
                  </>
                )}
              </label>
            ))}
            <button className="search-button" type="submit" disabled={loading}>
              {loading ? "Loading..." : "Run API"}
              <span aria-hidden="true">→</span>
            </button>
          </div>
          <p className="endpoint-description">{endpoint.description}</p>
          {error && <p className="error-message" role="alert">{error}</p>}
        </form>
      </section>

      <section className="results-section api-results" aria-live="polite">
        <div className="results-heading">
          <div>
            <p className="eyebrow">API RESPONSE</p>
            <h2>{endpoint.label}</h2>
          </div>
          {responses.length > 0 && <span className="result-count">{resultCount.toLocaleString()} results loaded</span>}
        </div>
        {saveError && group === "users" && <p className="error-message" role="alert">{saveError}</p>}

        {arrays.map(({ key, rows }) => {
          const columns = columnsFor(key, rows);
          const isUserVideosTable = group === "users" && key === "videos";
          const tableColumns = isUserVideosTable ? columns.filter((column) => column !== "link") : columns;
          const tableRows = isUserVideosTable && userVideoSort
            ? rows.map((row, index) => ({ row, index }))
              .sort((left, right) => {
                const leftValue = userVideoSortValue(left.row, userVideoSort.key);
                const rightValue = userVideoSortValue(right.row, userVideoSort.key);
                if (leftValue === null) {
                  return rightValue === null ? left.index - right.index : 1;
                }
                if (rightValue === null) return -1;
                const difference = leftValue - rightValue;
                return (userVideoSort.direction === "ascending" ? difference : -difference) ||
                  left.index - right.index;
              })
              .map(({ row }) => row)
            : rows;
          return (
            <section className="api-result-group" key={key}>
              <h3>{key.replace(/_/g, " ")} <span>{rows.length.toLocaleString()}</span></h3>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>{tableColumns.map((column) => {
                      const sortableKey = isUserVideosTable && isUserVideoSortKey(column) ? column : null;
                      const header = isUserVideosTable ? userVideoColumnLabel(column) : formatColumn(column);
                      return (
                        <th
                          key={column}
                          className={sortableKey === "stats.like_count" || sortableKey === "stats.play_count" ? "numeric" : undefined}
                          aria-sort={sortableKey && userVideoSort?.key === sortableKey
                            ? userVideoSort.direction
                            : sortableKey ? "none" : undefined}
                        >
                          {sortableKey ? (
                            <button className="sort-button" type="button" onClick={() => toggleUserVideoSort(sortableKey)}>
                              {header}
                              <span aria-hidden="true">
                                {userVideoSort?.key === sortableKey
                                  ? userVideoSort.direction === "ascending" ? "↑" : "↓"
                                  : "↕"}
                              </span>
                            </button>
                          ) : header}
                        </th>
                      );
                    })}{isUserVideosTable && <th>SAVE</th>}</tr>
                  </thead>
                  <tbody>
                    {tableRows.length ? tableRows.map((row, index) => (
                      <tr key={isObject(row) ? String(row.id ?? row.username ?? index) : `${key}-${index}`}>
                        {tableColumns.map((column) => <td key={column} className={column === "stats.like_count" || column === "stats.play_count" ? "numeric" : undefined}>{renderCell(row, column, isUserVideosTable)}</td>)}
                        {isUserVideosTable && (
                          <td>
                            <button
                              className={`small-action${isObject(row) && typeof row.id === "string" && savedVideoIds.has(row.id) ? " primary-action" : ""}`}
                              type="button"
                              disabled={savedVideosLoading || !isObject(row) || typeof row.id !== "string" || savingVideoIds.has(row.id)}
                              aria-pressed={isObject(row) && typeof row.id === "string" ? savedVideoIds.has(row.id) : undefined}
                              onClick={() => void toggleSavedVideo(row)}
                            >
                              {isObject(row) && typeof row.id === "string" && savingVideoIds.has(row.id)
                                ? "Saving…"
                                : isObject(row) && typeof row.id === "string" && savedVideoIds.has(row.id)
                                  ? "Saved"
                                  : "Save"}
                            </button>
                          </td>
                        )}
                      </tr>
                    )) : (
                      <tr><td className="empty-state" colSpan={Math.max(tableColumns.length + (isUserVideosTable ? 1 : 0), 1)}>No results returned.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          );
        })}

        {detailRecords.map((record, index) => (
          <div className="table-wrap detail-table-wrap" key={`detail-${index}`}>
            <table className="detail-table">
              <thead><tr><th>FIELD</th><th>VALUE</th></tr></thead>
              <tbody>
                {flattenDetails(record).map(([key, value]) => (
                  <tr key={key}>
                    <td>{formatColumn(key)}</td>
                    <td>{typeof value === "string" && /^https?:\/\//i.test(value)
                      ? <a href={value} target="_blank" rel="noreferrer">Open link</a>
                      : typeof value === "number" && /(^|\.)(like_count|play_count)$/.test(key)
                        ? formatCount(value)
                        : displayValue(value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}

        {!responses.length && !loading && (
          <div className="table-wrap"><div className="empty-state">Choose an endpoint and run a request to see results.</div></div>
        )}
        {loading && !responses.length && (
          <div className="table-wrap"><div className="empty-state">Requesting API…</div></div>
        )}
        {cursor && (
          <div className="load-more-row">
            <button className="load-more-button" type="button" onClick={loadMore} disabled={loading}>
              {loading ? "Loading…" : "Load more"}
            </button>
          </div>
        )}
      </section>
    </section>
  );
}
