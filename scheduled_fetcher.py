"""Runs saved hashtag/profile video schedules in the API process."""
from datetime import datetime, timezone
import threading
import time

import follow_ups
from tiktok import discovery, users
from tiktok.fetch import TikTokUpstreamError

POLL_SECONDS = 30
MAX_PAGES_PER_SCHEDULE = 1000
DNS_RETRY_INTERVAL_SECONDS = 30
DNS_RETRY_WINDOW_SECONDS = 300


def _parse_timestamp(value):
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _video_in_window(video, start, end):
    created_at = _parse_timestamp(video.get("created_at"))
    return created_at is not None and start < created_at <= end


def _call_with_dns_retry(call, schedule_id, *, monotonic=time.monotonic, sleep=time.sleep):
    deadline = None
    while True:
        try:
            return call()
        except TikTokUpstreamError as error:
            message = str(error).lower()
            if "dnserror" not in message and "dns error" not in message:
                raise
            now = monotonic()
            if deadline is None:
                deadline = now + DNS_RETRY_WINDOW_SECONDS
            remaining = deadline - now
            if remaining <= 0:
                raise
            delay = min(DNS_RETRY_INTERVAL_SECONDS, remaining)
            print(
                f"Scheduled fetch {schedule_id} hit a DNS error; "
                f"retrying in {delay:g}s for up to {remaining:g}s."
            )
            sleep(delay)


def _fetch_window(schedule, start, end):
    cursor = None
    seen_cursors = set()
    videos = {}
    pages = 0
    start_date = start.date().isoformat()
    end_date = end.date().isoformat()

    while True:
        if pages >= MAX_PAGES_PER_SCHEDULE:
            raise RuntimeError(
                f"fetch exceeded the {MAX_PAGES_PER_SCHEDULE}-page safety limit"
            )
        if schedule["entity_type"] == "hashtag":
            page = _call_with_dns_retry(
                lambda: discovery.get_hashtag_posts(
                    schedule["target"],
                    cursor=cursor,
                    start_date=start_date,
                    end_date=end_date,
                ),
                schedule["id"],
            )
        else:
            page = _call_with_dns_retry(
                lambda: users.get_posts(
                    {"username": schedule["target"]},
                    sort="latest",
                    cursor=cursor,
                    start_date=start_date,
                    end_date=end_date,
                ),
                schedule["id"],
            )
        pages += 1

        for video in page["videos"]:
            video_id = video.get("id")
            if not isinstance(video_id, str) or not _video_in_window(video, start, end):
                continue
            previous = videos.get(video_id)
            current_likes = (video.get("stats") or {}).get("like_count")
            previous_likes = ((previous or {}).get("stats") or {}).get("like_count")
            if previous is None or (
                isinstance(current_likes, int) and
                (not isinstance(previous_likes, int) or current_likes > previous_likes)
            ):
                videos[video_id] = video

        if not page["has_more"]:
            break
        cursor = page["next_cursor"]
        if not cursor or cursor in seen_cursors:
            raise RuntimeError("TikTok pagination returned a missing or repeated cursor")
        seen_cursors.add(cursor)

    return list(videos.values())


def _rank_videos(videos, min_likes=0, max_videos=2):
    eligible = []
    for video in videos:
        stats = video.get("stats") or {}
        like_count = stats.get("like_count")
        if (
            isinstance(like_count, bool) or
            not isinstance(like_count, int) or
            like_count < min_likes
        ):
            continue
        author = video.get("author")
        eligible.append({
            "video_id": video["id"],
            "link": video.get("link"),
            "description": video.get("description"),
            "cover": video.get("cover"),
            "creator": (
                author.get("username") or author.get("nickname")
                if isinstance(author, dict)
                else None
            ),
            "posted_at": video.get("created_at"),
            "like_count": like_count,
        })
    eligible.sort(
        key=lambda video: (
            -video["like_count"],
            video["posted_at"] or "",
            video["video_id"],
        )
    )
    return eligible[:max_videos]


def execute_schedule(schedule):
    start = _parse_timestamp(schedule["window_start_at"])
    end = _parse_timestamp(schedule["window_end_at"])
    if start is None or end is None or start >= end:
        raise ValueError("scheduled fetch window is invalid")

    candidates = _fetch_window(schedule, start, end)
    winners = _rank_videos(candidates, schedule["min_likes"], schedule["max_videos"])
    return follow_ups.finish_fetch_run(
        schedule["run_id"],
        schedule["id"],
        "succeeded",
        len(candidates),
        videos=winners,
        completed_at=datetime.now(timezone.utc).isoformat(timespec="seconds"),
        window_end_at=schedule["window_end_at"],
    )


def run_due_schedules_once():
    schedules = follow_ups.claim_due_fetch_schedules()
    for schedule in schedules:
        try:
            execute_schedule(schedule)
        except Exception as error:
            message = f"{type(error).__name__}: {error}"
            follow_ups.finish_fetch_run(
                schedule["run_id"],
                schedule["id"],
                "failed",
                0,
                error=message,
            )
            print(f"Scheduled fetch {schedule['id']} failed: {message}")
    return len(schedules)


class ScheduleWorker:
    def __init__(self):
        self._stop = threading.Event()
        self._thread = None

    def start(self):
        if self._thread and self._thread.is_alive():
            return
        follow_ups.recover_interrupted_fetch_runs()
        self._thread = threading.Thread(
            target=self._run,
            name="scheduled-video-fetcher",
            daemon=True,
        )
        self._thread.start()

    def stop(self):
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=5)

    def _run(self):
        while not self._stop.is_set():
            try:
                run_due_schedules_once()
            except Exception as error:
                print(f"Scheduled fetch worker failed: {type(error).__name__}: {error}")
            self._stop.wait(POLL_SECONDS)
