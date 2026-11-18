import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import ApiExplorer from "./ApiExplorer";
import type { ApiGroup } from "./ApiExplorer";
import FollowUps from "./FollowUps";
import Monitor from "./Monitor";
import SavedFollowUpSelect from "./SavedFollowUpSelect";

type Video = {
  id: string;
  link: string | null;
  description: string | null;
  created_at: string | null;
  cover: string | null;
  author: { username: string | null; nickname: string | null } | null;
  stats: { like_count: number | null; play_count: number | null } | null;
};

type VideoPage = {
  videos: Video[];
  next_cursor: string | null;
  has_more: boolean;
};

type SearchCriteria = {
  hashtag: string;
  startDate: string;
  endDate: string;
  minLikes: string;
};

type SortKey = "date" | "likes" | "views";
type SortDirection = "ascending" | "descending";

const API_BASE = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, "") ?? "/api";
const numberFormat = new Intl.NumberFormat();

function isSavedVideo(value: unknown): value is { video_id: string } {
  return typeof value === "object" && value !== null &&
    "video_id" in value && typeof value.video_id === "string";
}

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

function isOptionalString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isOptionalCount(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value));
}

function isVideo(value: unknown): value is Video {
  if (typeof value !== "object" || value === null) return false;
  const video = value as Record<string, unknown>;
  const author = video.author;
  const stats = video.stats;
  return typeof video.id === "string" &&
    isOptionalString(video.link) &&
    isOptionalString(video.description) &&
    isOptionalString(video.created_at) &&
    isOptionalString(video.cover) &&
    (author === null || (
      typeof author === "object" &&
      author !== null &&
      isOptionalString((author as Record<string, unknown>).username) &&
      isOptionalString((author as Record<string, unknown>).nickname)
    )) &&
    (stats === null || (
      typeof stats === "object" &&
      stats !== null &&
      isOptionalCount((stats as Record<string, unknown>).like_count) &&
      isOptionalCount((stats as Record<string, unknown>).play_count)
    ));
}

function videoDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeZone: "UTC" }).format(date);
}

async function fetchVideos(criteria: SearchCriteria, cursor: string | null): Promise<VideoPage> {
  const params = new URLSearchParams({ hashtag: criteria.hashtag });
  if (criteria.startDate) params.set("start_date", criteria.startDate);
  if (criteria.endDate) params.set("end_date", criteria.endDate);
  if (criteria.minLikes) params.set("min_likes", criteria.minLikes);
  if (cursor) params.set("cursor", cursor);

  const response = await fetch(`${API_BASE}/hashtags/videos?${params.toString()}`);
  const payload: unknown = await response.json();

  if (!response.ok) {
    const message =
      typeof payload === "object" && payload !== null && "error" in payload &&
      typeof payload.error === "string"
        ? payload.error
        : `Request failed (${response.status})`;
    throw new Error(message);
  }

  if (
    typeof payload !== "object" ||
    payload === null ||
    !("videos" in payload) ||
    !Array.isArray(payload.videos) ||
    !payload.videos.every(isVideo) ||
    !("next_cursor" in payload) ||
    !(typeof payload.next_cursor === "string" || payload.next_cursor === null) ||
    !("has_more" in payload) ||
    typeof payload.has_more !== "boolean"
  ) {
    throw new Error("The API returned an unexpected response.");
  }

  return {
    videos: payload.videos,
    next_cursor: payload.next_cursor,
    has_more: payload.has_more,
  };
}

export default function App() {
  const [activeSection, setActiveSection] = useState<"hashtags" | "followups" | "monitor" | ApiGroup>("hashtags");
  const [hashtag, setHashtag] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [minLikes, setMinLikes] = useState("");
  const [criteria, setCriteria] = useState<SearchCriteria | null>(null);
  const [videos, setVideos] = useState<Video[]>([]);
  const [sort, setSort] = useState<{ key: SortKey; direction: SortDirection } | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedVideoIds, setSavedVideoIds] = useState<Set<string>>(new Set());
  const [savingVideoIds, setSavingVideoIds] = useState<Set<string>>(new Set());

  const sortedVideos = sort
    ? videos
      .map((video, index) => ({ video, index }))
      .sort((left, right) => {
        const leftValue = sort.key === "date"
          ? left.video.created_at ? Date.parse(left.video.created_at) : null
          : sort.key === "likes"
            ? left.video.stats?.like_count ?? null
            : left.video.stats?.play_count ?? null;
        const rightValue = sort.key === "date"
          ? right.video.created_at ? Date.parse(right.video.created_at) : null
          : sort.key === "likes"
            ? right.video.stats?.like_count ?? null
            : right.video.stats?.play_count ?? null;

        if (leftValue === null || Number.isNaN(leftValue)) {
          return rightValue === null || Number.isNaN(rightValue) ? left.index - right.index : 1;
        }
        if (rightValue === null || Number.isNaN(rightValue)) return -1;

        const difference = leftValue - rightValue;
        return (sort.direction === "ascending" ? difference : -difference) ||
          left.index - right.index;
      })
      .map(({ video }) => video)
    : videos;

  function toggleSort(key: SortKey) {
    setSort((current) => ({
      key,
      direction: current?.key === key && current.direction === "descending"
        ? "ascending"
        : "descending",
    }));
  }

  useEffect(() => {
    async function loadSavedVideos() {
      try {
        const response = await fetch(`${API_BASE}/saved-videos`);
        const payload: unknown = await response.json();
        if (!response.ok) {
          const message = typeof payload === "object" && payload !== null &&
            "error" in payload && typeof payload.error === "string"
            ? payload.error
            : `Request failed (${response.status})`;
          throw new Error(message);
        }
        if (!Array.isArray(payload) || !payload.every(isSavedVideo)) {
          throw new Error("The API returned an unexpected saved-video response.");
        }
        setSavedVideoIds(new Set(payload.map((video) => video.video_id)));
      } catch (reason) {
        setSaveError(reason instanceof Error ? reason.message : "Could not load saved videos.");
      }
    }

    void loadSavedVideos();
  }, []);

  async function toggleSavedVideo(video: Video) {
    setSavingVideoIds((current) => new Set(current).add(video.id));
    setSaveError(null);
    try {
      const saved = savedVideoIds.has(video.id);
      const response = await fetch(
        `${API_BASE}/saved-videos${saved ? `/${encodeURIComponent(video.id)}` : ""}`,
        saved
          ? { method: "DELETE" }
          : {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                video_id: video.id,
                hashtag: criteria?.hashtag ?? "",
                link: video.link,
                description: video.description,
                cover: video.cover,
                creator: video.author?.username ?? video.author?.nickname ?? null,
                posted_at: video.created_at,
              }),
            },
      );
      if (!response.ok) {
        const payload: unknown = await response.json().catch(() => null);
        const message = typeof payload === "object" && payload !== null &&
          "error" in payload && typeof payload.error === "string"
          ? payload.error
          : `Request failed (${response.status})`;
        throw new Error(message);
      }
      if (saved) {
        setSavedVideoIds((current) => {
          const updated = new Set(current);
          updated.delete(video.id);
          return updated;
        });
      } else {
        const payload: unknown = await response.json();
        if (!isSavedVideo(payload)) {
          throw new Error("The API returned an unexpected saved-video response.");
        }
        setSavedVideoIds((current) => new Set(current).add(video.id));
      }
    } catch (reason) {
      setSaveError(reason instanceof Error ? reason.message : "Could not update the saved video.");
    } finally {
      setSavingVideoIds((current) => {
        const updated = new Set(current);
        updated.delete(video.id);
        return updated;
      });
    }
  }

  async function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanHashtag = hashtag.trim().replace(/^#+/, "");
    if (!cleanHashtag) {
      setError("Enter a hashtag to search.");
      return;
    }
    if (startDate && endDate && startDate > endDate) {
      setError("The end date must be on or after the start date.");
      return;
    }

    const searchCriteria = { hashtag: cleanHashtag, startDate, endDate, minLikes };
    setCriteria(searchCriteria);
    setVideos([]);
    setCursor(null);
    setHasMore(false);
    setError(null);
    setLoading(true);
    try {
      const page = await fetchVideos(searchCriteria, null);
      setVideos(page.videos);
      setCursor(page.next_cursor);
      setHasMore(page.has_more);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The search failed.");
    } finally {
      setLoading(false);
    }
  }

  async function loadMore() {
    if (!criteria || !cursor || loading) return;
    setError(null);
    setLoading(true);
    try {
      const page = await fetchVideos(criteria, cursor);
      setVideos((current) => [...current, ...page.videos]);
      setCursor(page.next_cursor);
      setHasMore(page.has_more);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load more videos.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="page-shell">
      <header className="page-header">
        <a className="brand" href="/" aria-label="TikTok scraper home">
          <span className="brand-mark">T</span>
          <span>SCRAPER<span className="brand-dot">.</span></span>
        </a>
        <span className="header-label">
          {activeSection === "hashtags"
            ? "HASHTAG RESEARCH"
            : activeSection === "followups"
              ? "FOLLOW-UP TRACKER"
              : activeSection === "monitor"
                ? "SAVED VIDEO MONITOR"
                : `${activeSection.toUpperCase()} APIS`}
        </span>
      </header>

      <div className="workspace">
        <aside className="sidebar" aria-label="Workspace navigation">
          <p className="sidebar-label">WORKSPACE</p>
          <nav>
            <button
              className={`nav-item${activeSection === "hashtags" ? " active" : ""}`}
              type="button"
              onClick={() => setActiveSection("hashtags")}
              aria-current={activeSection === "hashtags" ? "page" : undefined}
            >
              <span className="nav-icon">#</span>
              <span>Hashtags</span>
            </button>
            <button
              className={`nav-item${activeSection === "followups" ? " active" : ""}`}
              type="button"
              onClick={() => setActiveSection("followups")}
              aria-current={activeSection === "followups" ? "page" : undefined}
            >
              <span className="nav-icon" aria-hidden="true">✓</span>
              <span>Follow-ups</span>
            </button>
            <button
              className={`nav-item${activeSection === "monitor" ? " active" : ""}`}
              type="button"
              onClick={() => setActiveSection("monitor")}
              aria-current={activeSection === "monitor" ? "page" : undefined}
            >
              <span className="nav-icon" aria-hidden="true">◉</span>
              <span>Monitor</span>
            </button>
            <p className="sidebar-label api-nav-label">API EXPLORER</p>
            {([
              ["search", "Search"],
              ["users", "Users"],
              ["videos", "Videos"],
            ] as const).map(([section, label]) => (
              <button
                className={`nav-item${activeSection === section ? " active" : ""}`}
                type="button"
                key={section}
                onClick={() => setActiveSection(section)}
                aria-current={activeSection === section ? "page" : undefined}
              >
                <span className="nav-icon">{section === "search" ? "⌕" : section === "users" ? "@" : "▶"}</span>
                <span>{label}</span>
                <span className="nav-chevron">›</span>
              </button>
            ))}
          </nav>
          <div className="sidebar-footer">
            <span className="status-dot" />
            <span>Local API</span>
            <code>localhost:8000</code>
          </div>
        </aside>

        <div className="workspace-main">
          {activeSection === "followups" ? (
            <FollowUps />
          ) : activeSection === "monitor" ? (
            <Monitor />
          ) : activeSection !== "hashtags" ? (
            <ApiExplorer key={activeSection} group={activeSection} />
          ) : (
            <>
              <section className="intro">
                <p className="eyebrow">DISCOVER WHAT'S TRENDING</p>
                <h1>Hashtag video search</h1>
                <p className="intro-copy">
                  Search TikTok hashtag videos and narrow results by posting date and likes.
                </p>
              </section>

              <section className="search-panel" aria-label="Search filters">
                <form onSubmit={submitSearch}>
          <div className="form-grid">
            <label className="field hashtag-field">
              <span>Hashtag</span>
              <div className="hashtag-combined-control">
                <SavedFollowUpSelect entityType="hashtag" compact onSelect={setHashtag} />
                <div className="hashtag-input">
                  <span aria-hidden="true">#</span>
                  <input
                    value={hashtag}
                    onChange={(event) => setHashtag(event.target.value)}
                    placeholder="ethiopian_tik_tok"
                    aria-label="Hashtag"
                    required
                  />
                </div>
              </div>
            </label>
            <label className="field">
              <span>Posted from</span>
              <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
            </label>
            <label className="field">
              <span>Posted to</span>
              <input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
            </label>
            <label className="field">
              <span>Minimum likes</span>
              <input
                type="number"
                min="0"
                step="1"
                inputMode="numeric"
                value={minLikes}
                onChange={(event) => setMinLikes(event.target.value)}
                placeholder="Any"
              />
            </label>
            <button className="search-button" type="submit" disabled={loading}>
              {loading && !videos.length ? "Searching..." : "Search videos"}
              <span aria-hidden="true">→</span>
            </button>
          </div>
                  {error && <p className="error-message" role="alert">{error}</p>}
                </form>
              </section>

              <section className="results-section" aria-live="polite">
        <div className="results-heading">
          <div>
            <p className="eyebrow">SEARCH RESULTS</p>
            <h2>{criteria ? `#${criteria.hashtag}` : "Your results"}</h2>
          </div>
          {criteria && <span className="result-count">{numberFormat.format(videos.length)} videos loaded</span>}
        </div>

        {saveError && <p className="error-message" role="alert">{saveError}</p>}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">VIDEO</th>
                <th scope="col">CREATOR</th>
                <th scope="col" aria-sort={sort?.key === "date" ? sort.direction : "none"}>
                  <button className="sort-button" type="button" onClick={() => toggleSort("date")}>
                    POSTED <span aria-hidden="true">{sort?.key === "date" ? sort.direction === "ascending" ? "↑" : "↓" : "↕"}</span>
                  </button>
                </th>
                <th scope="col" className="numeric" aria-sort={sort?.key === "likes" ? sort.direction : "none"}>
                  <button className="sort-button" type="button" onClick={() => toggleSort("likes")}>
                    LIKES <span aria-hidden="true">{sort?.key === "likes" ? sort.direction === "ascending" ? "↑" : "↓" : "↕"}</span>
                  </button>
                </th>
                <th scope="col" className="numeric" aria-sort={sort?.key === "views" ? sort.direction : "none"}>
                  <button className="sort-button" type="button" onClick={() => toggleSort("views")}>
                    VIEWS <span aria-hidden="true">{sort?.key === "views" ? sort.direction === "ascending" ? "↑" : "↓" : "↕"}</span>
                  </button>
                </th>
                <th scope="col">DOWNLOAD</th>
                <th scope="col">SAVE FOR LATER</th>
              </tr>
            </thead>
            <tbody>
              {sortedVideos.map((video) => (
                <tr key={video.id}>
                  <td>
                    <div className="video-cell">
                      {video.cover ? (
                        <img className="video-cover" src={video.cover} alt="" loading="lazy" />
                      ) : (
                        <span className="video-cover cover-placeholder" aria-hidden="true">▶</span>
                      )}
                      <div className="video-description">
                        {video.link ? (
                          <a href={video.link} target="_blank" rel="noreferrer">
                            {video.description || "Open TikTok video"}
                          </a>
                        ) : (
                          <span>{video.description || "Video description unavailable"}</span>
                        )}
                        <span className="video-id">ID {video.id}</span>
                      </div>
                    </div>
                  </td>
                  <td>{video.author?.username ? `@${video.author.username}` : video.author?.nickname || "—"}</td>
                  <td>{videoDate(video.created_at)}</td>
                  <td className="numeric">{video.stats?.like_count == null ? "—" : formatCount(video.stats.like_count)}</td>
                  <td className="numeric">{video.stats?.play_count == null ? "—" : formatCount(video.stats.play_count)}</td>
                  <td>
                    <a className="download-button" href={`${API_BASE}/videos/download?video=${encodeURIComponent(video.id)}`}>
                      Download MP4
                    </a>
                  </td>
                  <td>
                    <button
                      className={`small-action${savedVideoIds.has(video.id) ? " primary-action" : ""}`}
                      type="button"
                      disabled={savingVideoIds.has(video.id)}
                      aria-pressed={savedVideoIds.has(video.id)}
                      onClick={() => void toggleSavedVideo(video)}
                    >
                      {savingVideoIds.has(video.id)
                        ? "Saving…"
                        : savedVideoIds.has(video.id) ? "Saved" : "Save for later"}
                    </button>
                  </td>
                </tr>
              ))}
              {!videos.length && !loading && (
                <tr>
                  <td className="empty-state" colSpan={7}>
                    {criteria ? "No videos matched this search. Try adjusting the filters." : "Search a hashtag to see videos here."}
                  </td>
                </tr>
              )}
              {loading && !videos.length && (
                <tr><td className="empty-state" colSpan={7}>Loading hashtag videos…</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {hasMore && cursor && (
          <div className="load-more-row">
            <button className="load-more-button" type="button" onClick={loadMore} disabled={loading}>
              {loading ? "Loading…" : "Load more videos"}
            </button>
          </div>
        )}
              </section>

              <footer>Data provided by your local TikTok Scraper API.</footer>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
