from datetime import datetime, timedelta, timezone

import pytest

import follow_ups
import scheduled_fetcher
from tiktok.fetch import TikTokUpstreamError


@pytest.fixture
def database(tmp_path, monkeypatch):
    monkeypatch.setattr(follow_ups, "DB_PATH", str(tmp_path / "followups.sqlite3"))


def schedule_payload():
    return {
        "entity_type": "profile",
        "target": "@creator",
        "weekday": 0,
        "run_time": "09:30",
        "timezone": "UTC",
        "start_date": "2026-01-01",
    }


def test_schedule_create_pause_resume_and_delete(database):
    schedule = follow_ups.create_fetch_schedule(schedule_payload())

    assert schedule["target"] == "creator"
    assert schedule["target_kind"] == "single"
    assert schedule["enabled"] is True
    assert datetime.fromisoformat(schedule["next_run_at"]) > datetime.now(timezone.utc)
    assert schedule["window_start_at"].startswith("2026-01-01")

    paused = follow_ups.update_fetch_schedule(schedule["id"], {"enabled": False})
    assert paused["enabled"] is False
    resumed = follow_ups.update_fetch_schedule(schedule["id"], {"enabled": True})
    assert resumed["enabled"] is True

    assert follow_ups.delete_fetch_schedule(schedule["id"])
    assert follow_ups.list_fetch_schedules() == []


def test_category_schedule_scans_every_saved_profile_in_that_category(database, monkeypatch):
    follow_ups.create_follow_up({
        "entity_type": "profile",
        "target": "@creator-one",
        "category": "Sports",
        "status": "done",
    })
    follow_ups.create_follow_up({
        "entity_type": "profile",
        "target": "creator-two",
        "category": "Sports",
    })
    follow_ups.create_follow_up({
        "entity_type": "profile",
        "target": "other-category",
        "category": "Food",
    })
    schedule = follow_ups.create_fetch_schedule({
        **schedule_payload(),
        "target": "Sports",
        "target_kind": "category",
    })
    calls = []

    def fake_fetch(profile, **kwargs):
        calls.append(profile["username"])
        return {
            "videos": [{
                "id": f"video-{profile['username']}",
                "created_at": "2026-01-03T00:00:00Z",
                "stats": {"like_count": 100},
            }],
            "has_more": False,
            "next_cursor": None,
        }

    monkeypatch.setattr(scheduled_fetcher.users, "get_posts", fake_fetch)

    candidates = scheduled_fetcher._fetch_window(
        schedule,
        datetime(2026, 1, 1, tzinfo=timezone.utc),
        datetime(2026, 1, 5, tzinfo=timezone.utc),
    )

    assert schedule["target_kind"] == "category"
    assert calls == ["creator-one", "creator-two"]
    assert {video["id"] for video in candidates} == {
        "video-creator-one",
        "video-creator-two",
    }


def test_category_schedules_are_only_valid_for_profiles(database):
    with pytest.raises(ValueError, match="only supported for profiles"):
        follow_ups.create_fetch_schedule({
            **schedule_payload(),
            "entity_type": "hashtag",
            "target": "sports",
            "target_kind": "category",
        })


@pytest.mark.parametrize(
    "patch",
    [
        {"weekday": 7},
        {"frequency": "monthly"},
        {"min_likes": -1},
        {"min_likes": True},
        {"max_videos": 0},
        {"max_videos": 101},
        {"max_videos": True},
        {"run_time": "9:30"},
        {"timezone": "not/a-timezone"},
        {"start_date": "2026-02-30"},
        {"extra": "value"},
    ],
)
def test_schedule_rejects_invalid_fields(database, patch):
    with pytest.raises(ValueError):
        follow_ups.create_fetch_schedule({**schedule_payload(), **patch})


def test_due_run_stores_top_video_results(database):
    schedule = follow_ups.create_fetch_schedule(schedule_payload())
    with follow_ups._database() as connection:
        connection.execute(
            "UPDATE fetch_schedules SET next_run_at = ? WHERE id = ?",
            ("2020-01-01T00:00:00+00:00", schedule["id"]),
        )

    claimed = follow_ups.claim_due_fetch_schedules(
        datetime(2026, 1, 7, 9, 30, tzinfo=timezone.utc)
    )
    assert len(claimed) == 1
    result = follow_ups.finish_fetch_run(
        claimed[0]["run_id"],
        schedule["id"],
        "succeeded",
        5,
        videos=[
            {
                "video_id": "video-1",
                "link": "https://tiktok.com/video/1",
                "description": "Most liked",
                "cover": None,
                "creator": "creator",
                "posted_at": "2026-01-06T10:00:00Z",
                "like_count": 500,
            },
            {
                "video_id": "video-2",
                "link": None,
                "description": None,
                "cover": None,
                "creator": None,
                "posted_at": "2026-01-05T10:00:00Z",
                "like_count": 300,
            },
        ],
        completed_at="2026-01-07T09:30:05+00:00",
        window_end_at=claimed[0]["window_end_at"],
    )

    assert result["status"] == "succeeded"
    assert result["scanned_count"] == 5
    assert result["saved_count"] == 2
    assert [video["video_id"] for video in follow_ups.list_fetch_runs()[0]["videos"]] == [
        "video-1",
        "video-2",
    ]
    assert follow_ups.delete_monitored_video(claimed[0]["run_id"], "video-1")
    remaining_run = follow_ups.list_fetch_runs()[0]
    assert remaining_run["saved_count"] == 1
    assert [video["video_id"] for video in remaining_run["videos"]] == ["video-2"]
    assert not follow_ups.delete_monitored_video(claimed[0]["run_id"], "video-1")


def test_daily_schedule_advances_to_the_next_day(database):
    schedule = follow_ups.create_fetch_schedule({
        **schedule_payload(),
        "frequency": "daily",
        "min_likes": 250,
        "max_videos": 3,
    })
    assert schedule["frequency"] == "daily"
    assert schedule["min_likes"] == 250
    assert schedule["max_videos"] == 3

    with follow_ups._database() as connection:
        connection.execute(
            "UPDATE fetch_schedules SET next_run_at = ? WHERE id = ?",
            ("2026-01-06T09:30:00+00:00", schedule["id"]),
        )

    claimed = follow_ups.claim_due_fetch_schedules(
        datetime(2026, 1, 7, 10, 0, tzinfo=timezone.utc)
    )

    assert len(claimed) == 1
    refreshed = follow_ups.list_fetch_schedules()[0]
    assert refreshed["next_run_at"] == "2026-01-08T09:30:00+00:00"


@pytest.mark.parametrize("interval_hours", [1, 6, 12])
def test_hourly_schedule_keeps_interval_from_first_run_time(database, interval_hours):
    schedule = follow_ups.create_fetch_schedule({
        **schedule_payload(),
        "frequency": "hourly",
        "interval_hours": interval_hours,
    })
    assert schedule["frequency"] == "hourly"
    assert schedule["interval_hours"] == interval_hours

    with follow_ups._database() as connection:
        connection.execute(
            "UPDATE fetch_schedules SET next_run_at = ? WHERE id = ?",
            ("2026-01-01T09:30:00+00:00", schedule["id"]),
        )

    claimed = follow_ups.claim_due_fetch_schedules(
        datetime(2026, 1, 1, 16, 0, tzinfo=timezone.utc)
    )

    assert len(claimed) == 1
    expected_next_run = datetime(2026, 1, 1, 9, 30, tzinfo=timezone.utc)
    while expected_next_run <= datetime(2026, 1, 1, 16, 0, tzinfo=timezone.utc):
        expected_next_run += timedelta(hours=interval_hours)
    assert follow_ups.list_fetch_schedules()[0]["next_run_at"] == expected_next_run.isoformat()


@pytest.mark.parametrize("interval_hours", [0, 2, 24, True])
def test_hourly_schedule_rejects_unsupported_intervals(database, interval_hours):
    with pytest.raises(ValueError, match="interval_hours must be 1, 6, or 12"):
        follow_ups.create_fetch_schedule({
            **schedule_payload(),
            "frequency": "hourly",
            "interval_hours": interval_hours,
        })


def test_fetch_window_pages_filters_exact_window_and_ranks_likes(monkeypatch):
    pages = {
        None: {
            "videos": [
                {"id": "boundary", "created_at": "2026-01-01T00:00:00Z", "stats": {"like_count": 999}},
                {"id": "older", "created_at": "2025-12-31T23:59:59Z", "stats": {"like_count": 1000}},
            ],
            "has_more": True,
            "next_cursor": "page-2",
        },
        "page-2": {
            "videos": [
                {"id": "one", "created_at": "2026-01-03T00:00:00Z", "stats": {"like_count": 100}},
                {"id": "two", "created_at": "2026-01-02T00:00:00Z", "stats": {"like_count": 200}},
                {"id": "three", "created_at": "2026-01-04T00:00:00Z", "stats": {"like_count": 300}},
            ],
            "has_more": False,
            "next_cursor": None,
        },
    }
    calls = []

    def fake_fetch(_target, cursor=None, **kwargs):
        calls.append((cursor, kwargs))
        return pages[cursor]

    monkeypatch.setattr(scheduled_fetcher.discovery, "get_hashtag_posts", fake_fetch)
    schedule = {"id": 1, "entity_type": "hashtag", "target": "dance"}
    start = datetime(2026, 1, 1, tzinfo=timezone.utc)
    end = datetime(2026, 1, 5, tzinfo=timezone.utc)

    candidates = scheduled_fetcher._fetch_window(schedule, start, end)
    winners = scheduled_fetcher._rank_videos(candidates)

    assert len(calls) == 2
    assert calls[0][1] == {"start_date": "2026-01-01", "end_date": "2026-01-05"}
    assert {video["id"] for video in candidates} == {"one", "two", "three"}
    assert [video["video_id"] for video in winners] == ["three", "two"]
    assert [video["video_id"] for video in scheduled_fetcher._rank_videos(candidates, 250)] == [
        "three",
    ]
    assert [video["video_id"] for video in scheduled_fetcher._rank_videos(candidates, 0, 1)] == [
        "three",
    ]


def test_dns_errors_retry_every_interval_until_a_response(monkeypatch):
    monkeypatch.setattr(scheduled_fetcher, "DNS_RETRY_INTERVAL_SECONDS", 30)
    monkeypatch.setattr(scheduled_fetcher, "DNS_RETRY_WINDOW_SECONDS", 60)
    elapsed = [0]
    delays = []
    attempts = [0]

    def fake_sleep(seconds):
        delays.append(seconds)
        elapsed[0] += seconds

    def fetch():
        attempts[0] += 1
        if attempts[0] < 3:
            raise TikTokUpstreamError("request failed: DNSError")
        return "response"

    result = scheduled_fetcher._call_with_dns_retry(
        fetch,
        1,
        monotonic=lambda: elapsed[0],
        sleep=fake_sleep,
    )

    assert result == "response"
    assert attempts[0] == 3
    assert delays == [30, 30]


def test_dns_retry_stops_at_window_and_other_errors_are_not_retried(monkeypatch):
    monkeypatch.setattr(scheduled_fetcher, "DNS_RETRY_INTERVAL_SECONDS", 30)
    monkeypatch.setattr(scheduled_fetcher, "DNS_RETRY_WINDOW_SECONDS", 60)
    elapsed = [0]
    attempts = [0]

    def fake_sleep(seconds):
        elapsed[0] += seconds

    def dns_failure():
        attempts[0] += 1
        raise TikTokUpstreamError("request failed: DNSError")

    with pytest.raises(TikTokUpstreamError):
        scheduled_fetcher._call_with_dns_retry(
            dns_failure,
            1,
            monotonic=lambda: elapsed[0],
            sleep=fake_sleep,
        )
    assert attempts[0] == 3

    attempts[0] = 0

    def other_failure():
        attempts[0] += 1
        raise TikTokUpstreamError("HTTP 500")

    with pytest.raises(TikTokUpstreamError, match="HTTP 500"):
        scheduled_fetcher._call_with_dns_retry(
            other_failure,
            1,
            monotonic=lambda: elapsed[0],
            sleep=fake_sleep,
        )
    assert attempts[0] == 1
