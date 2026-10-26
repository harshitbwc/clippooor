import os
import subprocess
import tempfile
from pathlib import Path

import modal

app = modal.App("clippooor")

WHISPER_MODEL_SIZE = "small"


def _download_whisper_model():
    from faster_whisper import WhisperModel

    WhisperModel(WHISPER_MODEL_SIZE, device="cpu", compute_type="int8")


image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg", "fonts-dejavu-core", "fontconfig", "curl", "unzip")
    # YouTube increasingly requires solving a JS challenge to extract video
    # info; yt-dlp auto-detects Deno on PATH and uses it for this.
    .run_commands("curl -fsSL https://deno.land/install.sh | sh -s -- -y")
    .env({"PATH": "/root/.deno/bin:$PATH"})
    .pip_install("yt-dlp", "faster-whisper", "boto3", "fastapi[standard]")
    .run_function(_download_whisper_model)
)

secrets = [modal.Secret.from_name("clippooor-secrets")]

CTA_FONT_PATH = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
MAX_CLIP_DURATION_S = 90


def _r2_client():
    import boto3

    return boto3.client(
        "s3",
        endpoint_url=f"https://{os.environ['R2_ACCOUNT_ID']}.r2.cloudflarestorage.com",
        aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
    )


def _probe_duration_ms(path: Path) -> int:
    result = subprocess.run(
        [
            "ffprobe",
            "-v", "error",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1",
            str(path),
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    return int(float(result.stdout.strip()) * 1000)


@app.function(image=image, secrets=secrets, timeout=1800)
def fetch_source(youtube_url: str, storage_key_prefix: str) -> dict:
    with tempfile.TemporaryDirectory() as tmpdir:
        # Self-update before every run — YouTube breaks yt-dlp periodically.
        # Never let this failure block the fetch itself.
        subprocess.run(["yt-dlp", "-U"], capture_output=True)

        out_template = str(Path(tmpdir) / "source.%(ext)s")
        result = subprocess.run(
            [
                "yt-dlp",
                "-f", "bv*[height<=1080]+ba/b[height<=1080]",
                "--merge-output-format", "mp4",
                # Datacenter IPs (like Modal's) get bot-checked on the default
                # "web" client; android/tv historically avoid this check.
                "--extractor-args", "youtube:player_client=android,tv",
                "-o", out_template,
                youtube_url,
            ],
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            raise RuntimeError(f"yt-dlp failed: {result.stderr[-2000:]}")

        files = list(Path(tmpdir).glob("source.*"))
        if not files:
            raise RuntimeError("yt-dlp produced no output file")
        local_path = files[0]

        duration_ms = _probe_duration_ms(local_path)
        storage_key = f"{storage_key_prefix}/source{local_path.suffix}"
        _r2_client().upload_file(
            str(local_path), os.environ["R2_BUCKET"], storage_key,
            ExtraArgs={"ContentType": "video/mp4"},
        )

        return {"storageKey": storage_key, "durationMs": duration_ms}


@app.function(image=image, secrets=secrets, timeout=1800)
def transcribe(storage_key: str) -> dict:
    from faster_whisper import WhisperModel

    with tempfile.TemporaryDirectory() as tmpdir:
        local_path = Path(tmpdir) / f"source{Path(storage_key).suffix}"
        _r2_client().download_file(os.environ["R2_BUCKET"], storage_key, str(local_path))

        duration_ms = _probe_duration_ms(local_path)

        model = WhisperModel(WHISPER_MODEL_SIZE, device="cpu", compute_type="int8")
        segments, _info = model.transcribe(str(local_path), word_timestamps=True)

        result_segments = []
        for seg in segments:
            result_segments.append(
                {
                    "startMs": int(seg.start * 1000),
                    "endMs": int(seg.end * 1000),
                    "text": seg.text.strip(),
                    "words": [
                        {
                            "startMs": int(w.start * 1000),
                            "endMs": int(w.end * 1000),
                            "word": w.word,
                        }
                        for w in (seg.words or [])
                    ],
                }
            )

        return {"segments": result_segments, "durationMs": duration_ms}


def _ms_to_ass_time(ms: int) -> str:
    ms = max(ms, 0)
    hours = ms // 3_600_000
    minutes = (ms % 3_600_000) // 60_000
    seconds = (ms % 60_000) // 1_000
    centis = (ms % 1_000) // 10
    return f"{hours}:{minutes:02d}:{seconds:02d}.{centis:02d}"


def _build_ass(captions: list[dict]) -> str:
    # Video content now occupies a centered 1080x1440 (3:4) box within the
    # 1080x1920 canvas (240px black bars top and bottom — see render_clip).
    # MarginV=280 keeps spoken captions inside the visible footage, just
    # above where the bottom black bar begins at y=1680.
    header = (
        "[Script Info]\n"
        "ScriptType: v4.00+\n"
        "PlayResX: 1080\n"
        "PlayResY: 1920\n"
        "WrapStyle: 0\n\n"
        "[V4+ Styles]\n"
        "Format: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, BackColour, "
        "Bold, Outline, Shadow, Alignment, MarginL, MarginR, MarginV\n"
        "Style: Default,DejaVu Sans,56,&H00FFFFFF,&H00000000,&H80000000,1,3,0,2,60,60,280\n\n"
        "[Events]\n"
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n"
    )
    events = []
    for caption in captions:
        start = _ms_to_ass_time(caption["startMs"])
        end = _ms_to_ass_time(caption["endMs"])
        text = caption["text"].replace("\n", "\\N").replace("{", "(").replace("}", ")")
        events.append(f"Dialogue: 0,{start},{end},Default,,0,0,0,,{text}")
    return header + "\n".join(events) + "\n"


def _escape_drawtext(text: str) -> str:
    return text.replace("\\", "\\\\").replace("'", "’").replace(":", "\\:")


@app.function(image=image, secrets=secrets, timeout=1800)
def render_clip(
    source_storage_key: str,
    start_ms: int,
    end_ms: int,
    part_label: str,
    cta_text: str | None,
    captions: list[dict],
    output_storage_key: str,
) -> dict:
    with tempfile.TemporaryDirectory() as tmpdir:
        local_source = Path(tmpdir) / f"source{Path(source_storage_key).suffix}"
        _r2_client().download_file(os.environ["R2_BUCKET"], source_storage_key, str(local_source))

        ass_path = Path(tmpdir) / "captions.ass"
        ass_path.write_text(_build_ass(captions))

        out_path = Path(tmpdir) / "out.mp4"
        start_s = start_ms / 1000
        duration_s = min((end_ms - start_ms) / 1000, MAX_CLIP_DURATION_S)

        # 16:9 source cropped to a centered 3:4 box (1080x1440), then padded
        # with black bars top/bottom onto the full 1080x1920 canvas.
        filters = (
            "[0:v]scale=1080:1440:force_original_aspect_ratio=increase,"
            "crop=1080:1440,"
            "pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black[base]"
        )

        part_drawtext = (
            f"drawtext=text='{_escape_drawtext(part_label)}':fontfile={CTA_FONT_PATH}:"
            "fontsize=56:fontcolor=white:borderw=3:bordercolor=black@0.6:x=(w-text_w)/2"
        )
        if cta_text:
            # Two lines centered in the bottom 240px black bar (y 1680-1920).
            filters += f";[base]{part_drawtext}:y=1746[cta1]"
            filters += (
                f";[cta1]drawtext=text='{_escape_drawtext(cta_text)}':fontfile={CTA_FONT_PATH}:"
                "fontsize=40:fontcolor=white:borderw=2:bordercolor=black@0.6:"
                "x=(w-text_w)/2:y=1814[cta]"
            )
            video_label = "[cta]"
        else:
            # Single line, vertically centered alone in the bottom bar.
            filters += f";[base]{part_drawtext}:y=1772[cta]"
            video_label = "[cta]"
        filters += f";{video_label}ass={ass_path}[v]"

        cmd = [
            "ffmpeg", "-y",
            "-ss", str(start_s),
            "-i", str(local_source),
            "-t", str(duration_s),
            "-filter_complex", filters,
            "-map", "[v]", "-map", "0:a?",
            "-c:v", "libx264", "-preset", "medium", "-crf", "20",
            "-c:a", "aac", "-b:a", "128k",
            "-movflags", "+faststart",
            str(out_path),
        ]
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            raise RuntimeError(f"ffmpeg failed: {result.stderr[-2000:]}")

        _r2_client().upload_file(
            str(out_path), os.environ["R2_BUCKET"], output_storage_key,
            ExtraArgs={"ContentType": "video/mp4"},
        )
        return {"storageKey": output_storage_key}


@app.function(image=image, secrets=secrets)
@modal.asgi_app()
def web():
    from fastapi import FastAPI, HTTPException, Request
    from fastapi.responses import JSONResponse

    web_app = FastAPI()

    def _require_auth(request: Request) -> None:
        expected = f"Bearer {os.environ['MODAL_WEBHOOK_SECRET']}"
        if request.headers.get("authorization") != expected:
            raise HTTPException(status_code=401, detail="Unauthorized")

    @web_app.post("/fetch_source")
    async def http_fetch_source(request: Request):
        _require_auth(request)
        body = await request.json()
        try:
            result = fetch_source.remote(body["youtubeUrl"], body["storageKeyPrefix"])
            return JSONResponse(result)
        except Exception as exc:
            return JSONResponse({"error": str(exc)}, status_code=500)

    @web_app.post("/transcribe")
    async def http_transcribe(request: Request):
        _require_auth(request)
        body = await request.json()
        try:
            result = transcribe.remote(body["storageKey"])
            return JSONResponse(result)
        except Exception as exc:
            return JSONResponse({"error": str(exc)}, status_code=500)

    @web_app.post("/render_clip")
    async def http_render_clip(request: Request):
        _require_auth(request)
        body = await request.json()
        try:
            result = render_clip.remote(
                body["sourceStorageKey"],
                body["startMs"],
                body["endMs"],
                body["partLabel"],
                body.get("ctaText"),
                body["captions"],
                body["outputStorageKey"],
            )
            return JSONResponse(result)
        except Exception as exc:
            return JSONResponse({"error": str(exc)}, status_code=500)

    return web_app
