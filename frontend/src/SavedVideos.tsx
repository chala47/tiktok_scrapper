import { useEffect, useState } from "react";

type SavedVideo = {
  video_id: string;
  hashtag: string;
  link: string | null;
  description: string | null;
  cover: string | null;
  creator: string | null;
  posted_at: string | null;
  saved_at: string;
};

const API_BASE = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, "") ?? "/api";

function isSavedVideo(value: unknown): value is SavedVideo {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  return typeof item.video_id === "string" &&
    typeof item.hashtag === "string" &&
    (item.link === null || typeof item.link === "string") &&
    (item.description === null || typeof item.description === "string") &&
    (item.cover === null || typeof item.cover === "string") &&
    (item.creator === null || typeof item.creator === "string") &&
    (item.posted_at === null || typeof item.posted_at === "string") &&
    typeof item.saved_at === "string";
}

export default function SavedVideos() {
  const [videos, setVideos] = useState<SavedVideo[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyVideoId, setBusyVideoId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadVideos() {
    setLoading(true);
    setError(null);
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
      setVideos(payload);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load saved videos.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadVideos();
  }, []);

  async function removeVideo(videoId: string) {
    setBusyVideoId(videoId);
    setError(null);
    try {
      const response = await fetch(`${API_BASE}/saved-videos/${encodeURIComponent(videoId)}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const payload: unknown = await response.json().catch(() => null);
        const message = typeof payload === "object" && payload !== null &&
          "error" in payload && typeof payload.error === "string"
          ? payload.error
          : `Request failed (${response.status})`;
        throw new Error(message);
      }
      setVideos((current) => current.filter((video) => video.video_id !== videoId));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not remove the saved video.");
    } finally {
      setBusyVideoId(null);
    }
  }

  return (
    <section className="results-section saved-videos-section" aria-live="polite">
      <div className="results-heading follow-up-results-heading">
        <div>
          <p className="eyebrow">BOOKMARKED FOR LATER</p>
          <h2>Saved videos</h2>
        </div>
        <span className="result-count">{videos.length} {videos.length === 1 ? "video" : "videos"}</span>
      </div>
      {error && <p className="error-message follow-up-message" role="alert">{error}</p>}
      {loading ? (
        <div className="follow-up-empty">Loading saved videos…</div>
      ) : error ? (
        <div className="follow-up-empty">
          <strong>Couldn’t load saved videos</strong>
          <span>Check that the backend is running, then try again.</span>
          <button className="small-action" type="button" onClick={() => void loadVideos()}>Try again</button>
        </div>
      ) : videos.length ? (
        <div className="follow-up-list">
          {videos.map((video) => (
            <article className="follow-up-card saved-video-card" key={video.video_id}>
              <div className="saved-video-main">
                {video.cover
                  ? <img className="video-cover" src={video.cover} alt="" loading="lazy" />
                  : <span className="video-cover cover-placeholder" aria-hidden="true">▶</span>}
                <div className="follow-up-card-main">
                  <span className={`entity-badge ${video.hashtag.startsWith("@") ? "profile" : "hashtag"}`}>
                    {video.hashtag.startsWith("@") ? video.hashtag : `# ${video.hashtag}`}
                  </span>
                  <h3>
                    {video.link
                      ? <a href={video.link} target="_blank" rel="noreferrer">{video.description || "Open TikTok video"}</a>
                      : video.description || "Video description unavailable"}
                  </h3>
                  {video.creator && <p className="follow-up-note">@{video.creator}</p>}
                  <p className="follow-up-due">Video ID {video.video_id}</p>
                </div>
              </div>
              <button
                className="small-action delete-action"
                type="button"
                disabled={busyVideoId === video.video_id}
                onClick={() => void removeVideo(video.video_id)}
              >
                {busyVideoId === video.video_id ? "Removing…" : "Remove"}
              </button>
            </article>
          ))}
        </div>
      ) : (
        <div className="follow-up-empty">
          <strong>No videos saved yet</strong>
          <span>Save a video from hashtag search to revisit it here.</span>
        </div>
      )}
    </section>
  );
}
