"""SQLite persistence for manual hashtag and profile follow-ups."""
from contextlib import contextmanager
from datetime import date, datetime, time, timedelta, timezone
import os
import sqlite3
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

DB_PATH = os.environ.get(
    "FOLLOW_UPS_DB_PATH",
    os.path.join(os.path.dirname(__file__), "data", "followups.sqlite3"),
)

_STATUSES = {"open", "done"}
_ENTITY_TYPES = {"hashtag", "profile"}
_CREATE_FIELDS = {"entity_type", "target", "note", "status", "due_date", "category"}
_UPDATE_FIELDS = {"target", "note", "status", "due_date", "category"}
_SAVED_VIDEO_FIELDS = {
    "video_id", "hashtag", "link", "description", "cover", "creator", "posted_at",
}
_FETCH_SCHEDULE_FIELDS = {
    "entity_type", "target", "weekday", "run_time", "timezone", "start_date",
    "frequency", "min_likes", "max_videos",
}
MAX_SCHEDULED_VIDEOS = 100


@contextmanager
def _database():
    path = os.path.abspath(DB_PATH)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    connection = sqlite3.connect(path, timeout=10)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    try:
        with connection:
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS follow_ups (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    entity_type TEXT NOT NULL CHECK (entity_type IN ('hashtag', 'profile')),
                    target TEXT NOT NULL,
                    note TEXT NOT NULL DEFAULT '',
                    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done')),
                    due_date TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
                """
            )
            columns = {
                row["name"]
                for row in connection.execute("PRAGMA table_info(follow_ups)")
            }
            if "category" not in columns:
                connection.execute(
                    "ALTER TABLE follow_ups ADD COLUMN category TEXT NOT NULL DEFAULT ''"
                )
            connection.execute(
                "CREATE INDEX IF NOT EXISTS follow_ups_status_due_date "
                "ON follow_ups (status, due_date)"
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS saved_videos (
                    video_id TEXT PRIMARY KEY,
                    hashtag TEXT NOT NULL,
                    link TEXT,
                    description TEXT,
                    cover TEXT,
                    creator TEXT,
                    posted_at TEXT,
                    saved_at TEXT NOT NULL
                )
                """
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS fetch_schedules (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    entity_type TEXT NOT NULL CHECK (entity_type IN ('hashtag', 'profile')),
                    target TEXT NOT NULL,
                    weekday INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
                    frequency TEXT NOT NULL DEFAULT 'weekly' CHECK (frequency IN ('daily', 'weekly')),
                    min_likes INTEGER NOT NULL DEFAULT 0 CHECK (min_likes >= 0),
                    max_videos INTEGER NOT NULL DEFAULT 2 CHECK (max_videos BETWEEN 1 AND 100),
                    run_time TEXT NOT NULL,
                    timezone TEXT NOT NULL,
                    enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
                    window_start_at TEXT NOT NULL,
                    last_success_at TEXT,
                    next_run_at TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
                """
            )
            schedule_columns = {
                row["name"]
                for row in connection.execute("PRAGMA table_info(fetch_schedules)")
            }
            if "frequency" not in schedule_columns:
                connection.execute(
                    "ALTER TABLE fetch_schedules ADD COLUMN frequency TEXT NOT NULL DEFAULT 'weekly'"
                )
            if "min_likes" not in schedule_columns:
                connection.execute(
                    "ALTER TABLE fetch_schedules ADD COLUMN min_likes INTEGER NOT NULL DEFAULT 0"
                )
            if "max_videos" not in schedule_columns:
                connection.execute(
                    "ALTER TABLE fetch_schedules ADD COLUMN max_videos INTEGER NOT NULL DEFAULT 2"
                )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS fetch_runs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    schedule_id INTEGER NOT NULL REFERENCES fetch_schedules(id) ON DELETE CASCADE,
                    scheduled_for TEXT NOT NULL,
                    window_start_at TEXT NOT NULL,
                    window_end_at TEXT NOT NULL,
                    started_at TEXT NOT NULL,
                    completed_at TEXT,
                    status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
                    scanned_count INTEGER NOT NULL DEFAULT 0,
                    saved_count INTEGER NOT NULL DEFAULT 0,
                    error TEXT,
                    UNIQUE (schedule_id, scheduled_for)
                )
                """
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS monitored_videos (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    run_id INTEGER NOT NULL REFERENCES fetch_runs(id) ON DELETE CASCADE,
                    schedule_id INTEGER NOT NULL REFERENCES fetch_schedules(id) ON DELETE CASCADE,
                    video_id TEXT NOT NULL,
                    link TEXT,
                    description TEXT,
                    cover TEXT,
                    creator TEXT,
                    posted_at TEXT,
                    like_count INTEGER NOT NULL,
                    saved_at TEXT NOT NULL,
                    UNIQUE (run_id, video_id)
                )
                """
            )
            connection.execute(
                "CREATE INDEX IF NOT EXISTS fetch_schedules_due "
                "ON fetch_schedules (enabled, next_run_at)"
            )
            yield connection
    finally:
        connection.close()


def _timestamp():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _utc_iso(value):
    return value.astimezone(timezone.utc).isoformat(timespec="seconds")


def _timezone(value):
    if not isinstance(value, str) or not value.strip():
        raise ValueError("timezone must be a valid IANA timezone")
    try:
        return value.strip(), ZoneInfo(value.strip())
    except ZoneInfoNotFoundError as error:
        try:
            ZoneInfo("UTC")
        except ZoneInfoNotFoundError:
            raise ValueError(
                "timezone database is unavailable; install project requirements including tzdata"
            ) from error
        raise ValueError(f"{value.strip()!r} is not a valid IANA timezone") from error


def _schedule_time(value):
    if not isinstance(value, str):
        raise ValueError("run_time must be in HH:MM format")
    try:
        parsed = time.fromisoformat(value)
    except ValueError as error:
        raise ValueError("run_time must be in HH:MM format") from error
    if parsed.strftime("%H:%M") != value:
        raise ValueError("run_time must be in HH:MM format")
    return parsed


def _schedule_weekday(value):
    if isinstance(value, bool) or not isinstance(value, int) or not 0 <= value <= 6:
        raise ValueError("weekday must be an integer from 0 (Monday) to 6 (Sunday)")
    return value


def _schedule_frequency(value):
    if not isinstance(value, str) or value not in {"daily", "weekly"}:
        raise ValueError("frequency must be 'daily' or 'weekly'")
    return value


def _schedule_min_likes(value):
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise ValueError("min_likes must be a non-negative integer")
    return value


def _schedule_max_videos(value):
    if (
        isinstance(value, bool) or
        not isinstance(value, int) or
        not 1 <= value <= MAX_SCHEDULED_VIDEOS
    ):
        raise ValueError(f"max_videos must be an integer from 1 to {MAX_SCHEDULED_VIDEOS}")
    return value


def _schedule_start(value, zone):
    if not isinstance(value, str):
        raise ValueError("start_date must be a date in YYYY-MM-DD format")
    try:
        parsed = date.fromisoformat(value)
    except ValueError as error:
        raise ValueError("start_date must be a date in YYYY-MM-DD format") from error
    if parsed.isoformat() != value:
        raise ValueError("start_date must be a date in YYYY-MM-DD format")
    return datetime.combine(parsed, time.min, tzinfo=zone).astimezone(timezone.utc)


def _parse_schedule_start(value):
    parsed = datetime.fromisoformat(value)
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _next_schedule_run(after, frequency, weekday, run_time, zone, not_before=None):
    not_before = not_before or after
    local_after = after.astimezone(zone)
    local_not_before = not_before.astimezone(zone)
    first_day = max(local_after.date(), local_not_before.date())
    for offset in range(15):
        candidate_date = first_day + timedelta(days=offset)
        if frequency == "weekly" and candidate_date.weekday() != weekday:
            continue
        candidate = datetime.combine(candidate_date, run_time, tzinfo=zone)
        candidate_utc = candidate.astimezone(timezone.utc)
        if candidate_utc > after and candidate_utc >= not_before:
            return _utc_iso(candidate_utc)
    raise ValueError("could not calculate the next scheduled run")


def _optional_text(data, field, default=""):
    value = data.get(field, default)
    if not isinstance(value, str):
        raise ValueError(f"{field} must be a string")
    return value.strip()


def _due_date(value):
    if value is None or value == "":
        return None
    if not isinstance(value, str):
        raise ValueError("due_date must be a date in YYYY-MM-DD format or null")
    try:
        parsed = date.fromisoformat(value)
    except ValueError as error:
        raise ValueError("due_date must be a date in YYYY-MM-DD format") from error
    if parsed.isoformat() != value:
        raise ValueError("due_date must be a date in YYYY-MM-DD format")
    return value


def _entity_type(value):
    if not isinstance(value, str) or value.strip().lower() not in _ENTITY_TYPES:
        raise ValueError("entity_type must be 'hashtag' or 'profile'")
    return value.strip().lower()


def _target(value, entity_type):
    if not isinstance(value, str):
        raise ValueError("target must be a non-empty string")
    value = value.strip()
    if entity_type == "hashtag":
        value = value.lstrip("#").strip()
    elif value.startswith("@"):
        value = value[1:].strip()
    if not value:
        raise ValueError("target must be a non-empty string")
    return value


def _status(value):
    if not isinstance(value, str) or value.strip().lower() not in _STATUSES:
        raise ValueError("status must be 'open' or 'done'")
    return value.strip().lower()


def _category(value, entity_type):
    if not isinstance(value, str):
        raise ValueError("category must be a string")
    value = value.strip()
    if entity_type != "profile" and value:
        raise ValueError("category is only supported for profile follow-ups")
    return value


def _record(row):
    return dict(row) if row is not None else None


def _schedule_record(row):
    record = _record(row)
    if record is not None:
        record["enabled"] = bool(record["enabled"])
    return record


def list_follow_ups(entity_type=None, status=None):
    filters = []
    values = []
    if entity_type is not None:
        filters.append("entity_type = ?")
        values.append(_entity_type(entity_type))
    if status is not None:
        filters.append("status = ?")
        values.append(_status(status))
    query = "SELECT * FROM follow_ups"
    if filters:
        query += " WHERE " + " AND ".join(filters)
    query += " ORDER BY CASE WHEN due_date IS NULL THEN 1 ELSE 0 END, due_date, id"
    with _database() as connection:
        rows = connection.execute(query, values).fetchall()
    return [_record(row) for row in rows]


def create_fetch_schedule(data):
    if not isinstance(data, dict):
        raise ValueError("JSON request body must be an object")
    unknown = set(data) - _FETCH_SCHEDULE_FIELDS
    required = _FETCH_SCHEDULE_FIELDS - {"frequency", "min_likes", "max_videos"}
    missing = required - set(data)
    if unknown:
        raise ValueError(f"unsupported fields: {', '.join(sorted(unknown))}")
    if missing:
        raise ValueError(f"missing fields: {', '.join(sorted(missing))}")

    entity_type = _entity_type(data["entity_type"])
    target = _target(data["target"], entity_type)
    weekday = _schedule_weekday(data["weekday"])
    frequency = _schedule_frequency(data.get("frequency", "weekly"))
    min_likes = _schedule_min_likes(data.get("min_likes", 0))
    max_videos = _schedule_max_videos(data.get("max_videos", 2))
    run_time = _schedule_time(data["run_time"])
    timezone_name, zone = _timezone(data["timezone"])
    window_start = _schedule_start(data["start_date"], zone)
    now = datetime.now(timezone.utc)
    next_run = _next_schedule_run(now, frequency, weekday, run_time, zone, window_start)
    timestamp = _timestamp()

    with _database() as connection:
        cursor = connection.execute(
            """
            INSERT INTO fetch_schedules
                (entity_type, target, weekday, frequency, min_likes, max_videos, run_time,
                 timezone, enabled, window_start_at, next_run_at, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
            """,
            (
                entity_type, target, weekday, frequency, min_likes, max_videos,
                run_time.strftime("%H:%M"),
                timezone_name, _utc_iso(window_start), next_run, timestamp, timestamp,
            ),
        )
        row = connection.execute(
            "SELECT * FROM fetch_schedules WHERE id = ?", (cursor.lastrowid,)
        ).fetchone()
    return _schedule_record(row)


def list_fetch_schedules():
    with _database() as connection:
        rows = connection.execute(
            "SELECT * FROM fetch_schedules ORDER BY created_at DESC, id DESC"
        ).fetchall()
    return [_schedule_record(row) for row in rows]


def update_fetch_schedule(schedule_id, data):
    if not isinstance(data, dict):
        raise ValueError("JSON request body must be an object")
    if set(data) - {"enabled"}:
        raise ValueError("only the enabled field can be updated")
    if not data:
        raise ValueError("provide at least one field to update")
    enabled = data.get("enabled")
    if not isinstance(enabled, bool):
        raise ValueError("enabled must be a boolean")

    with _database() as connection:
        row = connection.execute(
            "SELECT * FROM fetch_schedules WHERE id = ?", (schedule_id,)
        ).fetchone()
        if row is None:
            return None
        now = datetime.now(timezone.utc)
        next_run = row["next_run_at"]
        if enabled:
            next_run = _next_schedule_run(
                now,
                row["frequency"],
                row["weekday"],
                _schedule_time(row["run_time"]),
                _timezone(row["timezone"])[1],
                _parse_schedule_start(row["window_start_at"]),
            )
        connection.execute(
            """
            UPDATE fetch_schedules
            SET enabled = ?, next_run_at = ?, updated_at = ?
            WHERE id = ?
            """,
            (int(enabled), next_run, _utc_iso(now), schedule_id),
        )
        updated = connection.execute(
            "SELECT * FROM fetch_schedules WHERE id = ?", (schedule_id,)
        ).fetchone()
    return _schedule_record(updated)


def delete_fetch_schedule(schedule_id):
    with _database() as connection:
        cursor = connection.execute(
            "DELETE FROM fetch_schedules WHERE id = ?", (schedule_id,)
        )
    return cursor.rowcount > 0


def claim_due_fetch_schedules(now=None):
    now = now or datetime.now(timezone.utc)
    now_iso = _utc_iso(now)
    claimed = []
    with _database() as connection:
        connection.execute("BEGIN IMMEDIATE")
        rows = connection.execute(
            """
            SELECT * FROM fetch_schedules
            WHERE enabled = 1 AND next_run_at <= ?
            ORDER BY next_run_at, id
            """,
            (now_iso,),
        ).fetchall()
        for row in rows:
            scheduled_for = row["next_run_at"]
            window_start = row["last_success_at"] or row["window_start_at"]
            cursor = connection.execute(
                """
                INSERT INTO fetch_runs
                    (schedule_id, scheduled_for, window_start_at, window_end_at,
                     started_at, status)
                VALUES (?, ?, ?, ?, ?, 'running')
                """,
                (row["id"], scheduled_for, window_start, now_iso, now_iso),
            )
            next_run = _next_schedule_run(
                now,
                row["frequency"],
                row["weekday"],
                _schedule_time(row["run_time"]),
                _timezone(row["timezone"])[1],
            )
            connection.execute(
                "UPDATE fetch_schedules SET next_run_at = ?, updated_at = ? WHERE id = ?",
                (next_run, now_iso, row["id"]),
            )
            claimed.append({
                **_record(row),
                "run_id": cursor.lastrowid,
                "scheduled_for": scheduled_for,
                "window_start_at": window_start,
                "window_end_at": now_iso,
            })
    return claimed


def recover_interrupted_fetch_runs(now=None):
    now_iso = _utc_iso(now or datetime.now(timezone.utc))
    with _database() as connection:
        connection.execute("BEGIN IMMEDIATE")
        connection.execute(
            """
            UPDATE fetch_runs
            SET status = 'failed', completed_at = ?, error = 'Interrupted by server restart'
            WHERE status = 'running'
            """,
            (now_iso,),
        )
        connection.execute(
            """
            UPDATE fetch_schedules
            SET next_run_at = ?, updated_at = ?
            WHERE enabled = 1 AND id IN (
                SELECT schedule_id FROM fetch_runs
                WHERE status = 'failed' AND error = 'Interrupted by server restart'
                  AND completed_at = ?
            )
            """,
            (now_iso, now_iso, now_iso),
        )


def finish_fetch_run(run_id, schedule_id, status, scanned_count, videos=(), error=None,
                     completed_at=None, window_end_at=None):
    if status not in {"succeeded", "failed"}:
        raise ValueError("status must be 'succeeded' or 'failed'")
    if isinstance(scanned_count, bool) or not isinstance(scanned_count, int) or scanned_count < 0:
        raise ValueError("scanned_count must be a non-negative integer")
    completed_at = completed_at or _timestamp()
    videos = list(videos) if status == "succeeded" else []

    with _database() as connection:
        run = connection.execute(
            "SELECT schedule_id FROM fetch_runs WHERE id = ?", (run_id,)
        ).fetchone()
        if run is None or run["schedule_id"] != schedule_id:
            raise ValueError("scheduled fetch run not found")
        if status == "succeeded":
            for video in videos:
                connection.execute(
                    """
                    INSERT INTO monitored_videos
                        (run_id, schedule_id, video_id, link, description, cover,
                         creator, posted_at, like_count, saved_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        run_id, schedule_id, video["video_id"], video.get("link"),
                        video.get("description"), video.get("cover"), video.get("creator"),
                        video.get("posted_at"), video["like_count"], completed_at,
                    ),
                )
        connection.execute(
            """
            UPDATE fetch_runs
            SET completed_at = ?, status = ?, scanned_count = ?, saved_count = ?, error = ?
            WHERE id = ?
            """,
            (completed_at, status, scanned_count, len(videos), error, run_id),
        )
        if status == "succeeded":
            connection.execute(
                "UPDATE fetch_schedules SET last_success_at = ? WHERE id = ?",
                (window_end_at or completed_at, schedule_id),
            )
        row = connection.execute(
            "SELECT * FROM fetch_runs WHERE id = ?", (run_id,)
        ).fetchone()
    return _record(row)


def list_fetch_runs(limit=100):
    if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= 500:
        raise ValueError("limit must be an integer from 1 to 500")
    with _database() as connection:
        runs = connection.execute(
            """
            SELECT r.*, s.entity_type, s.target
            FROM fetch_runs AS r
            JOIN fetch_schedules AS s ON s.id = r.schedule_id
            ORDER BY r.started_at DESC, r.id DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
        run_records = [_record(row) for row in runs]
        if run_records:
            placeholders = ",".join("?" for _ in run_records)
            video_rows = connection.execute(
                f"""
                SELECT * FROM monitored_videos
                WHERE run_id IN ({placeholders})
                ORDER BY like_count DESC, id
                """,
                [run["id"] for run in run_records],
            ).fetchall()
        else:
            video_rows = []
    videos_by_run = {}
    for row in video_rows:
        videos_by_run.setdefault(row["run_id"], []).append(_record(row))
    for run in run_records:
        run["videos"] = videos_by_run.get(run["id"], [])
    return run_records


def get_follow_up(follow_up_id):
    with _database() as connection:
        row = connection.execute(
            "SELECT * FROM follow_ups WHERE id = ?", (follow_up_id,)
        ).fetchone()
    return _record(row)


def create_follow_up(data):
    if not isinstance(data, dict):
        raise ValueError("JSON request body must be an object")
    unknown = set(data) - _CREATE_FIELDS
    if unknown:
        raise ValueError(f"unsupported fields: {', '.join(sorted(unknown))}")

    entity_type = _entity_type(data.get("entity_type"))
    target = _target(data.get("target"), entity_type)
    note = _optional_text(data, "note")
    category = _category(data.get("category", ""), entity_type)
    status = _status(data.get("status", "open"))
    due_date = _due_date(data.get("due_date"))
    timestamp = _timestamp()

    with _database() as connection:
        cursor = connection.execute(
            """
            INSERT INTO follow_ups
                (entity_type, target, note, category, status, due_date, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (entity_type, target, note, category, status, due_date, timestamp, timestamp),
        )
        row = connection.execute(
            "SELECT * FROM follow_ups WHERE id = ?", (cursor.lastrowid,)
        ).fetchone()
    return _record(row)


def update_follow_up(follow_up_id, data):
    if not isinstance(data, dict):
        raise ValueError("JSON request body must be an object")
    unknown = set(data) - _UPDATE_FIELDS
    if unknown:
        raise ValueError(f"unsupported fields: {', '.join(sorted(unknown))}")
    if not data:
        raise ValueError("provide at least one field to update")

    with _database() as connection:
        existing = connection.execute(
            "SELECT * FROM follow_ups WHERE id = ?", (follow_up_id,)
        ).fetchone()
        if existing is None:
            return None

        updates = {}
        if "target" in data:
            updates["target"] = _target(data["target"], existing["entity_type"])
        if "note" in data:
            updates["note"] = _optional_text(data, "note")
        if "category" in data:
            updates["category"] = _category(data["category"], existing["entity_type"])
        if "status" in data:
            updates["status"] = _status(data["status"])
        if "due_date" in data:
            updates["due_date"] = _due_date(data["due_date"])
        updates["updated_at"] = _timestamp()

        assignments = ", ".join(f"{field} = ?" for field in updates)
        connection.execute(
            f"UPDATE follow_ups SET {assignments} WHERE id = ?",
            (*updates.values(), follow_up_id),
        )
        row = connection.execute(
            "SELECT * FROM follow_ups WHERE id = ?", (follow_up_id,)
        ).fetchone()
    return _record(row)


def delete_follow_up(follow_up_id):
    with _database() as connection:
        cursor = connection.execute(
            "DELETE FROM follow_ups WHERE id = ?", (follow_up_id,)
        )
    return cursor.rowcount > 0


def _saved_video_text(data, field, required=False):
    value = data.get(field)
    if value is None and not required:
        return None
    if not isinstance(value, str):
        requirement = "a non-empty string" if required else "a string or null"
        raise ValueError(f"{field} must be {requirement}")
    value = value.strip()
    if required and not value:
        raise ValueError(f"{field} must be a non-empty string")
    return value or ("" if required else None)


def list_saved_videos():
    with _database() as connection:
        rows = connection.execute(
            "SELECT * FROM saved_videos ORDER BY saved_at DESC, video_id"
        ).fetchall()
    return [_record(row) for row in rows]


def save_video(data):
    if not isinstance(data, dict):
        raise ValueError("JSON request body must be an object")
    unknown = set(data) - _SAVED_VIDEO_FIELDS
    if unknown:
        raise ValueError(f"unsupported fields: {', '.join(sorted(unknown))}")

    video_id = _saved_video_text(data, "video_id", required=True)
    hashtag = _saved_video_text(data, "hashtag", required=True).lstrip("#").strip()
    if not hashtag:
        raise ValueError("hashtag must be a non-empty string")
    details = {
        field: _saved_video_text(data, field)
        for field in ("link", "description", "cover", "creator", "posted_at")
    }
    timestamp = _timestamp()

    with _database() as connection:
        connection.execute(
            """
            INSERT INTO saved_videos
                (video_id, hashtag, link, description, cover, creator, posted_at, saved_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(video_id) DO UPDATE SET
                hashtag = excluded.hashtag,
                link = excluded.link,
                description = excluded.description,
                cover = excluded.cover,
                creator = excluded.creator,
                posted_at = excluded.posted_at
            """,
            (
                video_id, hashtag, details["link"], details["description"],
                details["cover"], details["creator"], details["posted_at"], timestamp,
            ),
        )
        row = connection.execute(
            "SELECT * FROM saved_videos WHERE video_id = ?", (video_id,)
        ).fetchone()
    return _record(row)


def delete_saved_video(video_id):
    with _database() as connection:
        cursor = connection.execute(
            "DELETE FROM saved_videos WHERE video_id = ?", (video_id,)
        )
    return cursor.rowcount > 0
