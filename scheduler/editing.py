"""
Media editing engine — wraps the bundled ffmpeg (bin/ffmpeg, bin/ffprobe).
Pure functions: they take input file paths + operations, write output files
into a temp workspace, and return the output paths. server.py registers the
outputs as new media (originals are never touched).
Operations dict:
  trim:    {"start": sec, "end": sec}          cut to this range
  splitAt: sec                                  split into two clips
  crop:    {"aspect": "9:16"|"1:1"|"4:5"|"16:9"|"2:3"}   center-crop
  grade:   {"brightness": -100..100, "contrast": -100..100,
            "saturation": -100..100, "warmth": -100..100}
"""
import json
import os
import subprocess
import uuid
ROOT = os.path.dirname(os.path.abspath(__file__))
FFMPEG = os.path.join(ROOT, "bin", "ffmpeg")
FFPROBE = os.path.join(ROOT, "bin", "ffprobe")
WORK_DIR = os.path.join(ROOT, "data", "editing")
os.makedirs(WORK_DIR, exist_ok=True)
VIDEO_EXT_OUT = ".mp4"
IMAGE_EXT_OUT = ".jpg"
def available():
    return os.path.isfile(FFMPEG) and os.access(FFMPEG, os.X_OK)
def _run(cmd, timeout=900):
    proc = subprocess.run(cmd, capture_output=True, timeout=timeout)
    if proc.returncode != 0:
        tail = proc.stderr.decode(errors="replace")[-800:]
        raise RuntimeError(f"ffmpeg failed: {tail}")
def probe(path):
    proc = subprocess.run(
        [FFPROBE, "-v", "quiet", "-print_format", "json",
         "-show_streams", "-show_format", path],
        capture_output=True, timeout=60)
    info = json.loads(proc.stdout or b"{}")
    out = {"width": 0, "height": 0, "duration": 0.0, "has_audio": False}
    for s in info.get("streams", []):
        if s.get("codec_type") == "video" and not out["width"]:
            out["width"] = int(s.get("width") or 0)
            out["height"] = int(s.get("height") or 0)
        if s.get("codec_type") == "audio":
            out["has_audio"] = True
    try:
        out["duration"] = float(info.get("format", {}).get("duration") or 0)
    except ValueError:
        pass
    return out
def _grade_filters(grade):
    """Map -100..100 sliders onto ffmpeg eq/colortemperature."""
    f = []
    g = grade or {}
    warmth = float(g.get("warmth") or 0)
    if warmth:
        # warmer = lower kelvin; 0 → 6500K neutral
        kelvin = int(6500 - warmth * 20)
        f.append(f"colortemperature=temperature={max(1000, min(40000, kelvin))}")
    eq = []
    b = float(g.get("brightness") or 0)
    c = float(g.get("contrast") or 0)
    s = float(g.get("saturation") or 0)
    if b:
        eq.append(f"brightness={b * 0.003:.4f}")     # ±0.3
    if c:
        eq.append(f"contrast={1 + c * 0.005:.4f}")   # 0.5..1.5
    if s:
        eq.append(f"saturation={max(0, 1 + s * 0.01):.4f}")  # 0..2
    if eq:
        f.append("eq=" + ":".join(eq))
    return f

def _crop_filter(crop, width, height):
    aspect = (crop or {}).get("aspect")
    if not aspect or not width or not height:
        return []
    try:
        aw, ah = (int(x) for x in aspect.split(":"))
    except ValueError:
        return []
    target = aw / ah
    current = width / height
    if abs(target - current) < 0.01:
        return []
    if current > target:   # too wide → crop sides
        cw, ch = int(height * target), height
    else:                  # too tall → crop top/bottom
        cw, ch = width, int(width / target)
    cw -= cw % 2
    ch -= ch % 2
    return [f"crop={cw}:{ch}:(iw-{cw})/2:(ih-{ch})/2"]
def _out_path(ext):
    return os.path.join(WORK_DIR, uuid.uuid4().hex[:12] + ext)
_VT_AVAILABLE = None
def _has_videotoolbox():
    """Apple hardware encoder — much faster for 4K than software x264."""
    global _VT_AVAILABLE
    if _VT_AVAILABLE is None:
        try:
            proc = subprocess.run([FFMPEG, "-hide_banner", "-encoders"],
                                  capture_output=True, timeout=30)
            _VT_AVAILABLE = b"h264_videotoolbox" in proc.stdout
        except Exception:
            _VT_AVAILABLE = False
    return _VT_AVAILABLE
def _encode_args(is_video, hw=True):
    if not is_video:
        return ["-q:v", "1"]  # top-quality jpeg
    if hw and _has_videotoolbox():
        # constant-quality hardware encode; keeps full resolution incl. 4K
        return ["-c:v", "h264_videotoolbox", "-q:v", "65", "-pix_fmt", "yuv420p",
                "-c:a", "aac", "-b:a", "256k", "-movflags", "+faststart"]
    return ["-c:v", "libx264", "-preset", "fast", "-crf", "18",
            "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "256k",
            "-movflags", "+faststart"]
def _run_encode(make_cmd, is_video):
    """Try the hardware encoder first; fall back to software on failure."""
    try:
        _run(make_cmd(_encode_args(is_video, hw=True)))
    except RuntimeError:
        if not is_video or not _has_videotoolbox():
            raise
        _run(make_cmd(_encode_args(is_video, hw=False)))
def make_thumb(src_path, out_path, is_video):
    """Small poster jpeg so the library grid never loads full 4K files."""
    cmd = [FFMPEG, "-y", "-hide_banner", "-loglevel", "error"]
    if is_video:
        cmd += ["-ss", "0.5"]
    cmd += ["-i", src_path, "-frames:v", "1",
            "-vf", "scale=320:-2", "-q:v", "4", out_path]
    _run(cmd, timeout=120)
def edit_media(src_path, is_video, ops):
    """Apply trim/crop/grade (and optional splitAt). Returns list of output paths."""
    info = probe(src_path)
    vf = _crop_filter(ops.get("crop"), info["width"], info["height"]) + \
        _grade_filters(ops.get("grade"))
    vf_args = ["-vf", ",".join(vf)] if vf else []
    def cut(start, end, out):
        def make_cmd(enc):
            cmd = [FFMPEG, "-y", "-hide_banner", "-loglevel", "error", "-i", src_path]
            if start is not None:
                cmd += ["-ss", f"{max(0, float(start)):.3f}"]
            if end is not None:
                cmd += ["-to", f"{float(end):.3f}"]

            return cmd + vf_args + enc + [out]
        _run_encode(make_cmd, is_video)
    ext = VIDEO_EXT_OUT if is_video else IMAGE_EXT_OUT
    trim = ops.get("trim") or {}
    t_start = trim.get("start")
    t_end = trim.get("end")
    split_at = ops.get("splitAt")
    if is_video and split_at:
        split_at = float(split_at)
        lo = float(t_start or 0)
        hi = float(t_end or info["duration"] or split_at + 1)
        a, b = _out_path(ext), _out_path(ext)
        cut(lo, split_at, a)
        cut(split_at, hi, b)
        return [a, b]
    out = _out_path(ext)
    if not is_video:
        # images: no trim; just filters (or plain re-encode for format unify)
        cmd = [FFMPEG, "-y", "-hide_banner", "-loglevel", "error",
               "-i", src_path] + vf_args + _encode_args(False) + [out]
        _run(cmd)
        return [out]
    if not vf and t_start is None and t_end is None:
        raise RuntimeError("no edits selected — move a slider, set a crop, or cut first")
    cut(t_start, t_end, out)
    return [out]
def concat_videos(src_paths):
    """Stitch clips into one video (normalized to the first clip's size, 30fps)."""
    first = probe(src_paths[0])
    w = first["width"] or 1080
    h = first["height"] or 1920
    w -= w % 2
    h -= h % 2
    parts = []
    for p in src_paths:
        info = probe(p)
        inter = _out_path(".mp4")
        def make_cmd(enc, p=p, info=info, inter=inter):
            cmd = [FFMPEG, "-y", "-hide_banner", "-loglevel", "error", "-i", p]
            if not info["has_audio"]:
                cmd += ["-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo", "-shortest"]
            return cmd + ["-vf",
                          f"scale={w}:{h}:force_original_aspect_ratio=decrease,"
                          f"pad={w}:{h}:(ow-iw)/2:(oh-ih)/2,fps=30,setsar=1",
                          "-ar", "44100"] + enc + [inter]
        _run_encode(make_cmd, True)
        parts.append(inter)
    listfile = _out_path(".txt")
    with open(listfile, "w") as f:
        for p in parts:
            f.write(f"file '{p}'\n")
    out = _out_path(".mp4")
    _run([FFMPEG, "-y", "-hide_banner", "-loglevel", "error",
          "-f", "concat", "-safe", "0", "-i", listfile, "-c", "copy", out])
    for p in parts + [listfile]:
        try:
            os.remove(p)
        except OSError:
            pass
    return [out]
def bake_audio(video_path, audio_path):
    """Replace/add the video's soundtrack with the given audio (trimmed to video length)."""
    out = _out_path(".mp4")
    _run([FFMPEG, "-y", "-hide_banner", "-loglevel", "error",
          "-i", video_path, "-i", audio_path,
          "-map", "0:v:0", "-map", "1:a:0",
          "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
          "-shortest", "-movflags", "+faststart", out])
    return [out]
