"""The 41 TikTok endpoints. Every path is served with and without the
`/tiktok` prefix, so code generated against the hosted API on RapidAPI
(paths like /videos/details) runs unchanged against this server.

Params are validated by the same marshmallow schemas the hosted API uses
(tiktok/schemas.py): `user`, `video`, `hashtag`, `music`, `playlist`,
`collection`, `place` and `effect` each accept a bare value or a pasted
tiktok.com link."""
import json

from bottle import hook, request, response, route

import config
import follow_ups
from schema_fields import load_query
from scraper_errors import BadRequest, Blocked, NotFound, UpstreamError
from tiktok import ads, discovery, live, schemas, search, users, videos


@hook("before_request")
def add_cors_headers():
    allowed_origins = [origin.strip() for origin in config.CORS_ORIGINS.split(",") if origin.strip()]
    origin = request.get_header("Origin")
    if "*" in allowed_origins:
        response.set_header("Access-Control-Allow-Origin", "*")
    elif origin and origin in allowed_origins:
        response.set_header("Access-Control-Allow-Origin", origin)
        response.set_header("Vary", "Origin")
    response.set_header("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
    response.set_header("Access-Control-Allow-Headers", "Origin, Accept, Content-Encoding, Content-Type, Authorization")


@route("/<path:path>", method="OPTIONS")
@route("/", method="OPTIONS")
def cors_preflight(path=None):
    response.status = 204
    return ""


def json_response(data, status=200):
    response.status = status
    response.content_type = "application/json"
    return json.dumps(data, ensure_ascii=False)


def query_dict():
    """The query as unicode strings (bottle 0.12's .get() hands back latin-1
    decoded bytes, so a UTF-8 "Amélie" would arrive as "AmÃ©lie")."""
    return {key: request.query.getunicode(key) for key in request.query.keys()}


def call(label, schema, fn, encode=json_response):
    """Validate, run, map errors: bad params -> 400, missing entity -> 404,
    transport/blocks -> 500."""
    data, error = load_query(schema, query_dict())
    if error:
        return json_response(error, 400)
    try:
        return encode(fn(**data))
    except ValueError as e:                # bad value
        return json_response({"error": str(e)}, 400)
    except BadRequest as e:                # upstream rejected the request (e.g. a bad cursor)
        return json_response({"error": f"tiktok rejected the request: {e}"}, 400)
    except NotFound as e:
        return json_response({"error": str(e) or "not found"}, 404)
    except Blocked as e:                   # silent empty body, 403 / 429
        return json_response({"error": f"tiktok blocked the request, retry later: {e}"}, 502)
    except UpstreamError as e:             # retries exhausted
        return json_response({"error": f"tiktok {label} failed: {e}"}, 502)
    except Exception as e:                 # parser surprises
        return json_response({"error": f"tiktok {label} failed: {type(e).__name__}: {e}"}, 500)


def mount(path, schema, fn):
    """Serve an endpoint function at /path and /tiktok/path."""
    label = path.strip("/")

    def handler():
        return call(label, schema, fn)

    handler.__name__ = "tiktok_" + label.replace("/", "_").replace("-", "_")
    route(path, method="GET")(handler)
    route("/tiktok" + path, method="GET")(handler)


def video_download_response(result):
    response.content_type = result["content_type"]
    response.set_header("Content-Disposition", f'attachment; filename="{result["filename"]}"')
    response.set_header("Content-Length", str(len(result["content"])))
    return result["content"]


def mount_download(path):
    def handler():
        return call("videos/download", schemas.VideoSchema, videos.download, video_download_response)

    handler.__name__ = "tiktok_videos_download"
    route(path, method="GET")(handler)
    route("/tiktok" + path, method="GET")(handler)


def follow_up_json_body():
    if request.content_type != "application/json":
        return None, json_response({"error": "Content-Type must be application/json"}, 415)
    try:
        body = json.loads(request.body.read().decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return None, json_response({"error": "request body must contain valid JSON"}, 400)
    return body, None


def register_follow_ups():
    def list_handler():
        try:
            return json_response(
                follow_ups.list_follow_ups(
                    entity_type=request.query.getunicode("entity_type"),
                    status=request.query.getunicode("status"),
                )
            )
        except ValueError as error:
            return json_response({"error": str(error)}, 400)

    def create_handler():
        data, error = follow_up_json_body()
        if error:
            return error
        try:
            item = follow_ups.create_follow_up(data)
        except ValueError as error:
            return json_response({"error": str(error)}, 400)
        response.set_header("Location", f"/follow-ups/{item['id']}")
        return json_response(item, 201)

    def get_handler(follow_up_id):
        item = follow_ups.get_follow_up(follow_up_id)
        if item is None:
            return json_response({"error": "follow-up not found"}, 404)
        return json_response(item)

    def update_handler(follow_up_id):
        data, error = follow_up_json_body()
        if error:
            return error
        try:
            item = follow_ups.update_follow_up(follow_up_id, data)
        except ValueError as error:
            return json_response({"error": str(error)}, 400)
        if item is None:
            return json_response({"error": "follow-up not found"}, 404)
        return json_response(item)

    def delete_handler(follow_up_id):
        if not follow_ups.delete_follow_up(follow_up_id):
            return json_response({"error": "follow-up not found"}, 404)
        response.status = 204
        return ""

    def saved_videos_list_handler():
        return json_response(follow_ups.list_saved_videos())

    def saved_video_create_handler():
        data, error = follow_up_json_body()
        if error:
            return error
        try:
            item = follow_ups.save_video(data)
        except ValueError as error:
            return json_response({"error": str(error)}, 400)
        response.status = 201
        return json_response(item)

    def saved_video_delete_handler(video_id):
        if not follow_ups.delete_saved_video(video_id):
            return json_response({"error": "saved video not found"}, 404)
        response.status = 204
        return ""

    handlers = [
        ("/follow-ups", "follow_ups_list", "GET", list_handler),
        ("/follow-ups", "follow_ups_create", "POST", create_handler),
        ("/follow-ups/<follow_up_id:int>", "follow_up_get", "GET", get_handler),
        ("/follow-ups/<follow_up_id:int>", "follow_up_update", "PATCH", update_handler),
        ("/follow-ups/<follow_up_id:int>", "follow_up_delete", "DELETE", delete_handler),
        ("/saved-videos", "saved_videos_list", "GET", saved_videos_list_handler),
        ("/saved-videos", "saved_video_create", "POST", saved_video_create_handler),
        ("/saved-videos/<video_id>", "saved_video_delete", "DELETE", saved_video_delete_handler),
    ]
    for path, name, method, handler in handlers:
        handler.__name__ = name
        route(path, method=method)(handler)
        route("/tiktok" + path, method=method)(handler)


def register_fetch_schedules():
    def list_handler():
        return json_response(follow_ups.list_fetch_schedules())

    def create_handler():
        data, error = follow_up_json_body()
        if error:
            return error
        try:
            item = follow_ups.create_fetch_schedule(data)
        except ValueError as error:
            return json_response({"error": str(error)}, 400)
        response.set_header("Location", f"/monitor/schedules/{item['id']}")
        return json_response(item, 201)

    def update_handler(schedule_id):
        data, error = follow_up_json_body()
        if error:
            return error
        try:
            item = follow_ups.update_fetch_schedule(schedule_id, data)
        except ValueError as error:
            return json_response({"error": str(error)}, 400)
        if item is None:
            return json_response({"error": "fetch schedule not found"}, 404)
        return json_response(item)

    def delete_handler(schedule_id):
        if not follow_ups.delete_fetch_schedule(schedule_id):
            return json_response({"error": "fetch schedule not found"}, 404)
        response.status = 204
        return ""

    def runs_handler():
        try:
            limit_value = request.query.getunicode("limit", "100")
            limit = int(limit_value)
            return json_response(follow_ups.list_fetch_runs(limit))
        except (ValueError, TypeError) as error:
            return json_response({"error": str(error)}, 400)

    def run_video_delete_handler(run_id, video_id):
        if not follow_ups.delete_monitored_video(run_id, video_id):
            return json_response({"error": "scheduled pick not found"}, 404)
        response.status = 204
        return ""

    handlers = [
        ("/monitor/schedules", "monitor_schedules_list", "GET", list_handler),
        ("/monitor/schedules", "monitor_schedules_create", "POST", create_handler),
        ("/monitor/schedules/<schedule_id:int>", "monitor_schedule_update", "PATCH", update_handler),
        ("/monitor/schedules/<schedule_id:int>", "monitor_schedule_delete", "DELETE", delete_handler),
        ("/monitor/runs", "monitor_runs_list", "GET", runs_handler),
        ("/monitor/runs/<run_id:int>/videos/<video_id>", "monitor_run_video_delete", "DELETE", run_video_delete_handler),
    ]
    for path, name, method, handler in handlers:
        handler.__name__ = name
        route(path, method=method)(handler)
        route("/tiktok" + path, method=method)(handler)


ENDPOINTS = [
    # videos
    ("/videos/download", schemas.VideoSchema, videos.download),
    ("/videos/details", schemas.VideoSchema, videos.get_details),
    ("/videos/media", schemas.VideoSchema, videos.get_media),
    ("/videos/comments", schemas.VideoPageSchema, videos.get_comments),
    ("/videos/comment-replies", schemas.CommentRepliesSchema, videos.get_comment_replies),
    ("/videos/transcript", schemas.TranscriptSchema, videos.get_transcript),
    ("/videos/related", schemas.VideoSchema, videos.get_related),
    ("/videos/resolve", schemas.VideoSchema, videos.resolve),
    # users
    ("/users/profile", schemas.UserSchema, users.get_profile),
    ("/users/videos", schemas.UserPostsSchema, users.get_posts),
    ("/users/reposts", schemas.UserVideosSchema, users.get_reposts),
    ("/users/followers", schemas.UserPageSchema, users.get_followers),
    ("/users/following", schemas.UserPageSchema, users.get_following),
    ("/users/playlists", schemas.UserPageSchema, users.get_playlists),
    ("/users/collections", schemas.UserPageSchema, users.get_collections),
    ("/users/resolve", schemas.UserSchema, users.resolve),
    # search
    ("/search/suggestions", schemas.SuggestionsSchema, search.get_suggestions),
    ("/search/videos", schemas.VideoSearchSchema, search.search_videos),
    ("/search/users", schemas.UserSearchSchema, search.search_users),
    ("/search/top", schemas.SearchSchema, search.search_top),
    ("/search/live", schemas.SearchSchema, search.search_live),
    # hashtags, sounds, playlists, collections, places, effects
    ("/hashtags/details", schemas.HashtagSchema, discovery.get_hashtag),
    ("/hashtags/videos", schemas.HashtagPostsSchema, discovery.get_hashtag_posts),
    ("/music/details", schemas.MusicSchema, discovery.get_music),
    ("/music/videos", schemas.MusicPostsSchema, discovery.get_music_posts),
    ("/playlists/details", schemas.PlaylistSchema, discovery.get_playlist),
    ("/playlists/videos", schemas.PlaylistPostsSchema, discovery.get_playlist_posts),
    ("/collections/videos", schemas.CollectionPostsSchema, discovery.get_collection_posts),
    ("/places/details", schemas.PlaceSchema, discovery.get_place),
    ("/places/videos", schemas.PlacePostsSchema, discovery.get_place_posts),
    ("/effects/details", schemas.EffectSchema, discovery.get_effect),
    # feeds
    ("/feed/trending", schemas.TrendingSchema, discovery.get_trending),
    ("/feed/explore", schemas.ExploreSchema, discovery.get_explore),
    ("/feed/explore/categories", schemas.EmptySchema, discovery.get_explore_categories),
    # live
    ("/live/details", schemas.UserSchema, live.get_room),
    # ads: Commercial Content Library + Creative Center top ads
    ("/ads/search", schemas.AdsSearchSchema, ads.search_library),
    ("/ads/details", schemas.AdSchema, ads.get_library_ad),
    ("/ads/advertisers", schemas.AdvertiserSearchSchema, ads.search_advertisers),
    ("/ads/countries", schemas.EmptySchema, ads.get_library_countries),
    ("/ads/top", schemas.TopAdsSchema, ads.get_top_ads),
    ("/ads/top/details", schemas.AdSchema, ads.get_top_ad),
    ("/ads/top/filters", schemas.EmptySchema, ads.get_top_ad_filters),
]

for _path, _schema, _fn in ENDPOINTS:
    if _path == "/videos/download":
        mount_download(_path)
    else:
        mount(_path, _schema, _fn)

register_follow_ups()
register_fetch_schedules()


@route("/", method="GET")
@route("/health", method="GET")
def health():
    return json_response({
        "status": "ok",
        "endpoints": [p for p, _, _ in ENDPOINTS],
        "follow_ups": [
            "GET /follow-ups",
            "POST /follow-ups",
            "GET /follow-ups/{id}",
            "PATCH /follow-ups/{id}",
            "DELETE /follow-ups/{id}",
        ],
        "saved_videos": [
            "GET /saved-videos",
            "POST /saved-videos",
            "DELETE /saved-videos/{video_id}",
        ],
        "monitor": [
            "GET /monitor/schedules",
            "POST /monitor/schedules",
            "PATCH /monitor/schedules/{id}",
            "DELETE /monitor/schedules/{id}",
            "GET /monitor/runs",
            "DELETE /monitor/runs/{run_id}/videos/{video_id}",
        ],
    })
