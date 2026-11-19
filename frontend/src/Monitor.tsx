import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import SavedFollowUpSelect from "./SavedFollowUpSelect";
import SavedVideos from "./SavedVideos";

type EntityType = "hashtag" | "profile";
type ScheduleFrequency = "daily" | "weekly";
type ScheduledFetch = {
  id: number;
  entity_type: EntityType;
  target: string;
  weekday: number;
  frequency: ScheduleFrequency;
  min_likes: number;
  max_videos: number;
  run_time: string;
  timezone: string;
  enabled: boolean;
  window_start_at: string;
  last_success_at: string | null;
  next_run_at: string;
  created_at: string;
  updated_at: string;
};
type MonitoredVideo = {
  video_id: string;
  link: string | null;
  description: string | null;
  cover: string | null;
  creator: string | null;
  posted_at: string | null;
  like_count: number;
};
type FetchRun = {
  id: number;
  schedule_id: number;
  scheduled_for: string;
  window_start_at: string;
  window_end_at: string;
  started_at: string;
  completed_at: string | null;
  status: "running" | "succeeded" | "failed";
  scanned_count: number;
  saved_count: number;
  error: string | null;
  entity_type: EntityType;
  target: string;
  videos: MonitoredVideo[];
};
type ScheduleForm = {
  entity_type: EntityType;
  target: string;
  weekday: string;
  frequency: ScheduleFrequency;
  min_likes: string;
  max_videos: string;
  run_time: string;
  start_date: string;
};

const API_BASE = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, "") ?? "/api";
const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

function todayLocal(): string {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isSchedule(value: unknown): value is ScheduledFetch {
  if (!isObject(value)) return false;
  return Number.isInteger(value.id) &&
    (value.entity_type === "hashtag" || value.entity_type === "profile") &&
    typeof value.target === "string" &&
    Number.isInteger(value.weekday) &&
    (value.frequency === "daily" || value.frequency === "weekly") &&
    Number.isInteger(value.min_likes) &&
    Number.isInteger(value.max_videos) &&
    typeof value.run_time === "string" &&
    typeof value.timezone === "string" &&
    typeof value.enabled === "boolean" &&
    typeof value.window_start_at === "string" &&
    (value.last_success_at === null || typeof value.last_success_at === "string") &&
    typeof value.next_run_at === "string" &&
    typeof value.created_at === "string" &&
    typeof value.updated_at === "string";
}

function isMonitoredVideo(value: unknown): value is MonitoredVideo {
  return isObject(value) &&
    typeof value.video_id === "string" &&
    (value.link === null || typeof value.link === "string") &&
    (value.description === null || typeof value.description === "string") &&
    (value.cover === null || typeof value.cover === "string") &&
    (value.creator === null || typeof value.creator === "string") &&
    (value.posted_at === null || typeof value.posted_at === "string") &&
    Number.isInteger(value.like_count);
}

function isFetchRun(value: unknown): value is FetchRun {
  return isObject(value) &&
    Number.isInteger(value.id) &&
    Number.isInteger(value.schedule_id) &&
    typeof value.scheduled_for === "string" &&
    typeof value.window_start_at === "string" &&
    typeof value.window_end_at === "string" &&
    typeof value.started_at === "string" &&
    (value.completed_at === null || typeof value.completed_at === "string") &&
    (value.status === "running" || value.status === "succeeded" || value.status === "failed") &&
    Number.isInteger(value.scanned_count) &&
    Number.isInteger(value.saved_count) &&
    (value.error === null || typeof value.error === "string") &&
    (value.entity_type === "hashtag" || value.entity_type === "profile") &&
    typeof value.target === "string" &&
    Array.isArray(value.videos) &&
    value.videos.every(isMonitoredVideo);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, init);
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
    const message = isObject(payload) && typeof payload.error === "string"
      ? payload.error
      : `Request failed (${response.status})`;
    throw new Error(message);
  }
  return payload as T;
}

function localDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function formatLikes(value: number): string {
  return new Intl.NumberFormat().format(value);
}

export default function Monitor() {
  const [schedules, setSchedules] = useState<ScheduledFetch[]>([]);
  const [runs, setRuns] = useState<FetchRun[]>([]);
  const [form, setForm] = useState<ScheduleForm>({
    entity_type: "hashtag",
    target: "",
    weekday: String((new Date().getDay() + 6) % 7),
    frequency: "weekly",
    min_likes: "0",
    max_videos: "2",
    run_time: "09:00",
    start_date: todayLocal(),
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busyScheduleId, setBusyScheduleId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function loadMonitor() {
    setLoading(true);
    setError(null);
    try {
      const [schedulePayload, runPayload]: [unknown, unknown] = await Promise.all([
        request("/monitor/schedules"),
        request("/monitor/runs?limit=100"),
      ]);
      if (!Array.isArray(schedulePayload) || !schedulePayload.every(isSchedule)) {
        throw new Error("The API returned an unexpected schedule response.");
      }
      if (!Array.isArray(runPayload) || !runPayload.every(isFetchRun)) {
        throw new Error("The API returned an unexpected monitor-run response.");
      }
      setSchedules(schedulePayload);
      setRuns(runPayload);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load monitor data.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadMonitor();
  }, []);

  async function createSchedule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const target = form.target.trim().replace(form.entity_type === "hashtag" ? /^#+/ : /^@/, "");
    if (!target) {
      setError(`Enter a ${form.entity_type === "hashtag" ? "hashtag" : "profile username"}.`);
      return;
    }
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const created: unknown = await request("/monitor/schedules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          target,
          weekday: Number(form.weekday),
          min_likes: Number(form.min_likes),
          max_videos: Number(form.max_videos),
          timezone: TIMEZONE,
        }),
      });
      if (!isSchedule(created)) throw new Error("The API returned an unexpected schedule response.");
      setSchedules((current) => [created, ...current]);
      setForm((current) => ({ ...current, target: "" }));
      setNotice(`${form.frequency === "daily" ? "Daily" : "Weekly"} schedule created.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not create the schedule.");
    } finally {
      setSaving(false);
    }
  }

  async function toggleSchedule(schedule: ScheduledFetch) {
    setBusyScheduleId(schedule.id);
    setError(null);
    setNotice(null);
    try {
      const updated: unknown = await request(`/monitor/schedules/${schedule.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !schedule.enabled }),
      });
      if (!isSchedule(updated)) throw new Error("The API returned an unexpected schedule response.");
      setSchedules((current) => current.map((item) => item.id === schedule.id ? updated : item));
      setNotice(updated.enabled ? "Schedule resumed." : "Schedule paused.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not update the schedule.");
    } finally {
      setBusyScheduleId(null);
    }
  }

  async function deleteSchedule(schedule: ScheduledFetch) {
    if (!window.confirm(`Delete the schedule for ${schedule.entity_type === "hashtag" ? "#" : "@"}${schedule.target}? Its run history will also be deleted.`)) {
      return;
    }
    setBusyScheduleId(schedule.id);
    setError(null);
    setNotice(null);
    try {
      await request<void>(`/monitor/schedules/${schedule.id}`, { method: "DELETE" });
      setSchedules((current) => current.filter((item) => item.id !== schedule.id));
      setRuns((current) => current.filter((run) => run.schedule_id !== schedule.id));
      setNotice("Schedule deleted.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not delete the schedule.");
    } finally {
      setBusyScheduleId(null);
    }
  }

  return (
    <div className="follow-ups-page monitor-page">
      <section className="intro follow-ups-intro">
        <p className="eyebrow">AUTOMATED VIDEO PICKS</p>
        <h1>Monitor</h1>
        <p className="intro-copy">
          Fetch recent hashtag or profile videos daily or weekly and keep your most-liked picks from each run.
        </p>
      </section>

      <section className="search-panel monitor-schedule-panel" aria-label="Create a fetch schedule">
        <div className="follow-up-panel-heading">
          <div>
            <p className="eyebrow">NEW SCHEDULE</p>
            <h2>Choose what to monitor</h2>
          </div>
        </div>
        <form onSubmit={createSchedule}>
          <div className="monitor-schedule-grid">
            <label className="field">
              <span>Type</span>
              <select
                value={form.entity_type}
                onChange={(event) => setForm((current) => ({
                  ...current,
                  entity_type: event.target.value as EntityType,
                  target: "",
                }))}
              >
                <option value="hashtag">Hashtag</option>
                <option value="profile">Profile</option>
              </select>
            </label>
            <label className="field">
              <span>{form.entity_type === "hashtag" ? "Hashtag" : "Username"}</span>
              <div className="monitor-target-control">
                <SavedFollowUpSelect
                  entityType={form.entity_type}
                  compact
                  onSelect={(target) => setForm((current) => ({ ...current, target }))}
                />
                <input
                  value={form.target}
                  onChange={(event) => setForm((current) => ({ ...current, target: event.target.value }))}
                  placeholder={form.entity_type === "hashtag" ? "dance" : "creator"}
                  required
                />
              </div>
            </label>
            <label className="field">
              <span>Repeat</span>
              <select
                value={form.frequency}
                onChange={(event) => setForm((current) => ({
                  ...current,
                  frequency: event.target.value as ScheduleFrequency,
                }))}
              >
                <option value="daily">Every day</option>
                <option value="weekly">Every week</option>
              </select>
            </label>
            {form.frequency === "weekly" && <label className="field">
              <span>Day of week</span>
              <select
                value={form.weekday}
                onChange={(event) => setForm((current) => ({ ...current, weekday: event.target.value }))}
              >
                {WEEKDAYS.map((day, index) => <option value={index} key={day}>{day}</option>)}
              </select>
            </label>}
            <label className="field">
              <span>At ({TIMEZONE})</span>
              <input
                type="time"
                value={form.run_time}
                onChange={(event) => setForm((current) => ({ ...current, run_time: event.target.value }))}
                required
              />
            </label>
            <label className="field">
              <span>Minimum likes</span>
              <input
                type="number"
                min="0"
                step="1"
                value={form.min_likes}
                onChange={(event) => setForm((current) => ({ ...current, min_likes: event.target.value }))}
                required
              />
            </label>
            <label className="field">
              <span>Videos to save per run</span>
              <input
                type="number"
                min="1"
                max="100"
                step="1"
                value={form.max_videos}
                onChange={(event) => setForm((current) => ({ ...current, max_videos: event.target.value }))}
                required
              />
            </label>
            <label className="field">
              <span>Start scanning from</span>
              <input
                type="date"
                value={form.start_date}
                onChange={(event) => setForm((current) => ({ ...current, start_date: event.target.value }))}
                required
              />
            </label>
            <button className="search-button monitor-create-button" type="submit" disabled={saving}>
              {saving ? "Creating…" : "Create schedule"} <span aria-hidden="true">+</span>
            </button>
          </div>
          <p className="endpoint-description">
            Each run scans from the selected start date, then from the previous successful run, and saves up to the selected number of videos.
          </p>
        </form>
      </section>

      {error && <p className="error-message follow-up-message" role="alert">{error}</p>}
      {notice && !error && <p className="success-message follow-up-message" role="status">{notice}</p>}

      <section className="results-section follow-up-results">
        <div className="results-heading follow-up-results-heading">
          <div>
            <p className="eyebrow">YOUR AUTOMATIONS</p>
            <h2>Schedules</h2>
          </div>
          <div className="monitor-heading-actions">
            <span className="result-count">{schedules.length} {schedules.length === 1 ? "schedule" : "schedules"}</span>
            <button className="refresh-button" type="button" onClick={() => void loadMonitor()} disabled={loading}>
              {loading ? "Loading…" : "↻ Refresh"}
            </button>
          </div>
        </div>
        {loading ? (
          <div className="follow-up-empty">Loading schedules…</div>
        ) : schedules.length ? (
          <div className="follow-up-list">
            {schedules.map((schedule) => (
              <article className={`follow-up-card monitor-schedule-card${schedule.enabled ? "" : " is-done"}`} key={schedule.id}>
                <div className="follow-up-card-main">
                  <span className={`entity-badge ${schedule.entity_type}`}>
                    {schedule.entity_type === "hashtag" ? "#" : "@"} {schedule.entity_type}
                  </span>
                  <h3>{schedule.entity_type === "hashtag" ? "#" : "@"}{schedule.target}</h3>
                  <p className="follow-up-note">
                    {schedule.frequency === "daily"
                      ? `Every day at ${schedule.run_time}`
                      : `Every ${WEEKDAYS[schedule.weekday]} at ${schedule.run_time}`} ({schedule.timezone})
                  </p>
                  <p className="follow-up-note">Minimum likes: {formatLikes(schedule.min_likes)}</p>
                  <p className="follow-up-note">Save up to {schedule.max_videos} {schedule.max_videos === 1 ? "video" : "videos"} per run</p>
                  <p className="follow-up-due">
                    Next: {localDateTime(schedule.next_run_at)}
                    {schedule.last_success_at && <> · Last success: {localDateTime(schedule.last_success_at)}</>}
                  </p>
                </div>
                <div className="follow-up-card-actions">
                  <button
                    className="small-action"
                    type="button"
                    disabled={busyScheduleId === schedule.id}
                    onClick={() => void toggleSchedule(schedule)}
                  >
                    {busyScheduleId === schedule.id ? "Saving…" : schedule.enabled ? "Pause" : "Resume"}
                  </button>
                  <button
                    className="small-action delete-action"
                    type="button"
                    disabled={busyScheduleId === schedule.id}
                    onClick={() => void deleteSchedule(schedule)}
                  >
                    Delete
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="follow-up-empty">
            <strong>No schedules yet</strong>
            <span>Add a hashtag or profile above to start collecting video picks.</span>
          </div>
        )}
      </section>

      <section className="results-section follow-up-results">
        <div className="results-heading follow-up-results-heading">
          <div>
            <p className="eyebrow">MOST LIKED IN EACH WINDOW</p>
            <h2>Scheduled picks</h2>
          </div>
          <span className="result-count">Latest {runs.length} runs</span>
        </div>
        {runs.length ? (
          <div className="follow-up-list">
            {runs.map((run) => (
              <article className="follow-up-card monitor-run-card" key={run.id}>
                <div className="follow-up-card-main">
                  <span className={`entity-badge ${run.entity_type}`}>
                    {run.entity_type === "hashtag" ? "#" : "@"} {run.target}
                  </span>
                  <h3>{localDateTime(run.started_at)}</h3>
                  <p className="follow-up-note">
                    {run.status === "succeeded"
                      ? `Scanned ${run.scanned_count} videos · saved ${run.saved_count}`
                      : run.status === "running" ? "Fetch in progress…" : `Failed: ${run.error || "Unknown error"}`}
                  </p>
                  {run.videos.length > 0 && (
                    <div className="monitor-picks">
                      {run.videos.map((video) => (
                        <div className="monitor-pick" key={video.video_id}>
                          {video.cover
                            ? <img className="video-cover" src={video.cover} alt="" loading="lazy" />
                            : <span className="video-cover cover-placeholder" aria-hidden="true">▶</span>}
                          <div className="follow-up-card-main">
                            <h3>
                              {video.link
                                ? <a href={video.link} target="_blank" rel="noreferrer">
                                  {video.description || `Video ${video.video_id}`}
                                </a>
                                : video.description || `Video ${video.video_id}`}
                            </h3>
                            {video.creator && <p className="follow-up-note">@{video.creator}</p>}
                            <p className="follow-up-due">{formatLikes(video.like_count)} likes</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="follow-up-empty">
            <strong>No scheduled runs yet</strong>
            <span>Results will appear after a schedule runs.</span>
          </div>
        )}
      </section>

      <SavedVideos />
      <footer>Scheduled fetching runs while the scraper server is running. Manual bookmarks remain available below.</footer>
    </div>
  );
}
