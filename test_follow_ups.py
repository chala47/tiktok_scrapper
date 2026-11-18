import pytest

import follow_ups


@pytest.fixture
def database(tmp_path, monkeypatch):
    monkeypatch.setattr(follow_ups, "DB_PATH", str(tmp_path / "followups.sqlite3"))


def test_create_normalizes_and_persists_follow_up(database):
    created = follow_ups.create_follow_up({
        "entity_type": "HASHTAG",
        "target": "##TikTok ",
        "note": "Check for new posts",
        "due_date": "2026-11-20",
    })

    assert created["id"] > 0
    assert created["entity_type"] == "hashtag"
    assert created["target"] == "TikTok"
    assert created["note"] == "Check for new posts"
    assert created["category"] == ""
    assert created["status"] == "open"
    assert created["due_date"] == "2026-11-20"
    assert follow_ups.get_follow_up(created["id"]) == created


def test_list_filters_and_update_follow_up(database):
    hashtag = follow_ups.create_follow_up({"entity_type": "hashtag", "target": "#dance"})
    profile = follow_ups.create_follow_up({
        "entity_type": "profile",
        "target": "@creator",
        "category": "  Comedy  ",
    })
    assert profile["category"] == "Comedy"

    updated = follow_ups.update_follow_up(
        profile["id"],
        {"note": "Review latest profile", "status": "done", "due_date": None, "category": "Sports"},
    )

    assert updated["status"] == "done"
    assert updated["due_date"] is None
    assert updated["category"] == "Sports"
    assert updated["updated_at"] >= profile["updated_at"]
    assert [item["id"] for item in follow_ups.list_follow_ups(entity_type="hashtag")] == [
        hashtag["id"]
    ]
    assert [item["id"] for item in follow_ups.list_follow_ups(status="done")] == [
        profile["id"]
    ]


def test_delete_follow_up(database):
    item = follow_ups.create_follow_up({"entity_type": "profile", "target": "creator"})

    assert follow_ups.delete_follow_up(item["id"])
    assert not follow_ups.delete_follow_up(item["id"])
    assert follow_ups.get_follow_up(item["id"]) is None


@pytest.mark.parametrize(
    "data",
    [
        {"entity_type": "video", "target": "123"},
        {"entity_type": "hashtag", "target": "###"},
        {"entity_type": "profile", "target": "@"},
        {"entity_type": "profile", "target": "creator", "status": "pending"},
        {"entity_type": "profile", "target": "creator", "due_date": "2026-02-30"},
        {"entity_type": "hashtag", "target": "dance", "category": "Comedy"},
        {"entity_type": "profile", "target": "creator", "category": 7},
        {"entity_type": "profile", "target": "creator", "unexpected": True},
    ],
)
def test_create_rejects_invalid_follow_ups(database, data):
    with pytest.raises(ValueError):
        follow_ups.create_follow_up(data)


def test_update_rejects_empty_updates_and_unknown_ids(database):
    item = follow_ups.create_follow_up({"entity_type": "hashtag", "target": "news"})

    with pytest.raises(ValueError, match="at least one field"):
        follow_ups.update_follow_up(item["id"], {})
    assert follow_ups.update_follow_up(999, {"status": "done"}) is None


def test_existing_database_migrates_category_column(tmp_path, monkeypatch):
    database_path = tmp_path / "followups.sqlite3"
    connection = follow_ups.sqlite3.connect(database_path)
    connection.execute(
        """
        CREATE TABLE follow_ups (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            entity_type TEXT NOT NULL,
            target TEXT NOT NULL,
            note TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL DEFAULT 'open',
            due_date TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        """
    )
    connection.execute(
        """
        INSERT INTO follow_ups
            (entity_type, target, created_at, updated_at)
        VALUES ('profile', 'existing', '2026-01-01T00:00:00+00:00', '2026-01-01T00:00:00+00:00')
        """
    )
    connection.commit()
    connection.close()
    monkeypatch.setattr(follow_ups, "DB_PATH", str(database_path))

    existing = follow_ups.list_follow_ups()[0]

    assert existing["category"] == ""
    assert follow_ups.create_follow_up({
        "entity_type": "profile",
        "target": "new",
        "category": "Music",
    })["category"] == "Music"


def test_save_video_is_persistent_and_idempotent(database):
    video = follow_ups.save_video({
        "video_id": "12345",
        "hashtag": "#dance",
        "link": "https://www.tiktok.com/@creator/video/12345",
        "description": "A dance video",
        "creator": "creator",
    })

    assert video["video_id"] == "12345"
    assert video["hashtag"] == "dance"
    assert video["description"] == "A dance video"
    assert follow_ups.list_saved_videos() == [video]

    updated = follow_ups.save_video({
        "video_id": "12345",
        "hashtag": "music",
        "link": None,
    })
    assert updated["hashtag"] == "music"
    assert updated["link"] is None
    assert updated["saved_at"] == video["saved_at"]
    assert len(follow_ups.list_saved_videos()) == 1


def test_delete_saved_video(database):
    follow_ups.save_video({"video_id": "12345", "hashtag": "dance"})

    assert follow_ups.delete_saved_video("12345")
    assert not follow_ups.delete_saved_video("12345")
    assert follow_ups.list_saved_videos() == []


@pytest.mark.parametrize(
    "data",
    [
        {"hashtag": "dance"},
        {"video_id": "", "hashtag": "dance"},
        {"video_id": "12345", "hashtag": "###"},
        {"video_id": "12345", "hashtag": "dance", "unexpected": True},
        {"video_id": "12345", "hashtag": "dance", "link": 42},
    ],
)
def test_save_video_rejects_invalid_data(database, data):
    with pytest.raises(ValueError):
        follow_ups.save_video(data)
