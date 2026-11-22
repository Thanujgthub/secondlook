"""Generate the five SecondLook sample photos with Google's Gemini image models.

The key is NEVER stored in the repo. Provide it via the GEMINI_API_KEY env var
or `--key-file <path>`.

Usage:
  python scripts/make_samples.py gen <id> [--model M] [--ref <raw.png>] [--prompt "..."] [--raw DIR] [--tag T]
      Text-to-image (no --ref) or image edit (--ref) using the stored prompt for <id>
      (or --prompt). Writes DIR/<id>[-T].png  (DIR defaults to $SAMPLES_RAW_DIR or <tmp>/secondlook-samples-raw).
  python scripts/make_samples.py illustrate [<id> ...]
      Fallback when the image API is unavailable: render the five scenes locally (numpy + Pillow)
      from one parametric scene and finalize them (caption "Illustrated sample").
  python scripts/make_samples.py finalize <id> <raw.png> [--caption TEXT]
      Crop/resize to 1600x1200, add an "AI-generated sample" caption, save samples/<id>.jpg (<450 KB).

Generation chain used for the shipped files (each edit uses the previous raw image as reference):
  gate2-night (text)  -> gate2-day (edit) ; gate3-night (edit) ; row-partial (edit) -> row-full (edit)
"""
import argparse
import base64
import io
import json
import os
import sys
import tempfile
import time
import urllib.error
import urllib.request

from PIL import Image, ImageDraw, ImageFilter, ImageFont

try:
    import numpy as np
except ImportError:  # only needed for `illustrate`
    np = None

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, "samples")
API = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
MODELS = ["gemini-3-pro-image", "gemini-3.1-flash-image", "gemini-nano-banana-2.1"]
W, H = 1600, 1200
MAX_BYTES = 450 * 1024

STYLE = (
    "Photorealistic smartphone photo, natural colours, slight sensor noise, no people, "
    "no watermark, no logos or brand names, no other text anywhere except the gate sign."
)

PROMPTS = {
    "gate2-night": (
        "A real night-time photo taken by a municipal field worker on a market road in an Indian city ward. "
        "A whitewashed, slightly weathered compound wall with a metal gate. Mounted on the wall right beside "
        "the gate is a large rectangular blue sign with bold white capital letters reading exactly \"GATE 2\" "
        "(nothing else on the sign). Directly next to the gate stands exactly ONE grey metal streetlight pole "
        "with a single LED lamp head, clearly switched ON and glowing warm white, casting a pool of light on "
        "the wall, the sign and the dusty road. Only this one pole and lamp are in the frame. Dark sky, "
        "a few distant dim shop lights blurred far away. Landscape 4:3 framing, eye level. " + STYLE
    ),
    "gate2-day": (
        "Edit this photo: show the SAME scene, same camera position and framing, but in bright DAYTIME "
        "(late-morning sun, blue sky). The single streetlight lamp is switched OFF (lamp head unlit, no glow). "
        "Keep the sign reading exactly \"GATE 2\", the wall, the gate and the single pole exactly as they are. "
        "Do not add any other poles or lamps. " + STYLE
    ),
    "gate3-night": (
        "Edit this photo: keep everything identical (night, the single glowing lamp, the wall, the gate, "
        "framing) but change the sign text so it reads exactly \"GATE 3\" in the same font, size and colours. "
        "Change nothing else. " + STYLE
    ),
    "row-partial": (
        "Using this photo as the reference for the place (same whitewashed compound wall, same metal gate, "
        "same blue \"GATE 2\" sign, same pole and lamp design, same night-time look), create a WIDE view "
        "taken from across the road, further back, looking along the wall. The \"GATE 2\" sign stays clearly "
        "legible near the left of the frame. Along the wall there is a row of EXACTLY FIVE identical "
        "streetlight poles, evenly spaced, all fully in frame. Counting from left to right: poles 1, 2 and 4 "
        "have lamps switched ON and glowing warm white with pools of light below; poles 3 and 5 have lamps "
        "completely OFF and DARK with no glow, the wall beneath them in shadow. No other lights on poles. " + STYLE
    ),
    "row-full": (
        "Edit this photo: keep the exact same scene, framing, wall, gate, \"GATE 2\" sign and the same five "
        "streetlight poles. The only change: ALL FIVE lamps are now switched ON and glowing warm white, each "
        "with a pool of light on the wall and road below. Do not add or remove any poles. " + STYLE
    ),
}


def load_key(key_file):
    if key_file:
        with open(key_file, "r", encoding="utf-8") as f:
            return f.read().strip()
    key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not key:
        sys.exit("Set GEMINI_API_KEY or pass --key-file.")
    return key


def call(model, key, prompt, ref_path=None):
    parts = []
    if ref_path:
        with open(ref_path, "rb") as f:
            data = base64.b64encode(f.read()).decode()
        mime = "image/png" if ref_path.lower().endswith(".png") else "image/jpeg"
        parts.append({"inlineData": {"mimeType": mime, "data": data}})
    parts.append({"text": prompt})
    body = {
        "contents": [{"role": "user", "parts": parts}],
        "generationConfig": {
            "responseModalities": ["TEXT", "IMAGE"],
            "imageConfig": {"aspectRatio": "4:3"},
        },
    }
    req = urllib.request.Request(
        API.format(model=model),
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json", "x-goog-api-key": key},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=300) as r:
        resp = json.loads(r.read())
    for cand in resp.get("candidates", []):
        for p in cand.get("content", {}).get("parts", []):
            inline = p.get("inlineData") or p.get("inline_data")
            if inline and inline.get("data"):
                return base64.b64decode(inline["data"])
    raise RuntimeError("no image in response: " + json.dumps(resp)[:600])


def generate(args):
    key = load_key(args.key_file)
    prompt = args.prompt or PROMPTS[args.id]
    models = [args.model] + [m for m in MODELS if m != args.model] if args.model else MODELS
    raw_dir = args.raw or os.environ.get("SAMPLES_RAW_DIR") or os.path.join(tempfile.gettempdir(), "secondlook-samples-raw")
    os.makedirs(raw_dir, exist_ok=True)
    out = os.path.join(raw_dir, args.id + (("-" + args.tag) if args.tag else "") + ".png")
    for attempt in range(6):
        model = models[attempt % len(models)]
        try:
            img = call(model, key, prompt, args.ref)
            Image.open(io.BytesIO(img)).convert("RGB").save(out)
            print(f"ok {model} -> {out}")
            return
        except urllib.error.HTTPError as e:
            msg = e.read().decode(errors="replace")[:300]
            print(f"HTTP {e.code} from {model}: {msg}", file=sys.stderr)
        except Exception as e:  # noqa: BLE001
            print(f"error from {model}: {e}", file=sys.stderr)
        time.sleep(min(30, 4 * (attempt + 1)))
    sys.exit("all attempts failed")


def caption_font(size):
    for path in (r"C:\Windows\Fonts\segoeui.ttf", r"C:\Windows\Fonts\arial.ttf", "DejaVuSans.ttf"):
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    return ImageFont.load_default()


def finalize(args):
    im = Image.open(args.raw_png).convert("RGB")
    # center-crop to 4:3 then resize
    w, h = im.size
    if w / h > 4 / 3:
        nw = round(h * 4 / 3)
        im = im.crop(((w - nw) // 2, 0, (w - nw) // 2 + nw, h))
    elif w / h < 4 / 3:
        nh = round(w * 3 / 4)
        im = im.crop((0, (h - nh) // 2, w, (h - nh) // 2 + nh))
    im = im.resize((W, H), Image.LANCZOS)

    overlay = Image.new("RGBA", im.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(overlay)
    f = caption_font(18)
    text = getattr(args, "caption", None) or "AI-generated sample"
    x0, y0, x1, y1 = d.textbbox((0, 0), text, font=f)
    tw, th = x1 - x0, y1 - y0
    px, py, m = 12, 6, 14
    box = (W - m - tw - 2 * px, H - m - th - 2 * py, W - m, H - m)
    d.rounded_rectangle(box, radius=(box[3] - box[1]) // 2, fill=(0, 0, 0, 120))
    d.text((box[0] + px - x0, box[1] + py - y0), text, font=f, fill=(255, 255, 255, 225))
    im = Image.alpha_composite(im.convert("RGBA"), overlay).convert("RGB")

    os.makedirs(OUT_DIR, exist_ok=True)
    out = os.path.join(OUT_DIR, args.id + ".jpg")
    for q in (85, 82, 78, 74, 70, 65):
        buf = io.BytesIO()
        im.save(buf, "JPEG", quality=q, optimize=True, progressive=True)
        if buf.tell() < MAX_BYTES:
            break
    with open(out, "wb") as fh:
        fh.write(buf.getvalue())
    print(f"{out}  {buf.tell() // 1024} KB  q={q}")


# --------------------------------------------------------------------------------------------
# Fallback: deterministic illustrated renders of the same scene (used when the image API is
# unavailable). One parametric scene => all five samples stay consistent.
# --------------------------------------------------------------------------------------------
VIEWS = {
    "close": dict(s=1.0, wall_top=520, wall_bot=930, side_bot=990, pillar_top=468,
                  pillars=[(940, 992), (1330, 1382)], sign=(585, 585, 905, 725), font=104,
                  poles=[420], pole_top=170, pole_base=982, arm=230, bldg=(230, 520)),
    "wide": dict(s=0.45, wall_top=640, wall_bot=860, side_bot=905, pillar_top=616,
                 pillars=[(668, 692), (832, 856)], sign=(448, 672, 640, 744), font=54,
                 poles=[90, 370, 930, 1200, 1450], pole_top=402, pole_base=900, arm=80,
                 bldg=(440, 640)),
}
SCENES = {
    "gate2-day": dict(view="close", night=False, text="GATE 2", lit=[False]),
    "gate2-night": dict(view="close", night=True, text="GATE 2", lit=[True]),
    "gate3-night": dict(view="close", night=True, text="GATE 3", lit=[True]),
    # pole 2 is the Gate 2 lamp from the close-ups (lit in both); poles 1 and 4 dark
    "row-partial": dict(view="wide", night=True, text="GATE 2", lit=[False, True, True, False, True]),
    "row-full": dict(view="wide", night=True, text="GATE 2", lit=[True] * 5),
}


def _noise(seed, scale, w=W, h=H):
    rng = np.random.default_rng(seed)
    small = rng.random((h // scale + 3, w // scale + 3)).astype(np.float32)
    im = Image.fromarray((small * 255).astype(np.uint8)).resize(
        ((w // scale + 3) * scale, (h // scale + 3) * scale), Image.BICUBIC)
    return np.asarray(im, np.float32)[:h, :w] / 255.0


def _fbm(seed, scales=(160, 64, 24, 8, 3), weights=(0.35, 0.25, 0.18, 0.12, 0.10)):
    return sum(wt * _noise(seed + i, sc) for i, (sc, wt) in enumerate(zip(scales, weights)))


def _mask(draw_fn):
    m = Image.new("L", (W, H), 0)
    draw_fn(ImageDraw.Draw(m))
    return np.asarray(m, np.float32)[..., None] / 255.0


def _paint(img, m, col):
    col = np.asarray(col, np.float32)
    return img * (1 - m) + col * m


def _font(size):
    for path in (r"C:\Windows\Fonts\arialbd.ttf", "DejaVuSans-Bold.ttf", "Arial Bold.ttf"):
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    return ImageFont.load_default()


def render(scene):
    v = VIEWS[scene["view"]]
    s, night = v["s"], scene["night"]
    ys, xs = np.mgrid[0:H, 0:W].astype(np.float32)
    grain = _fbm(11)
    alb = np.zeros((H, W, 3), np.float32)
    sky = np.ones((H, W, 1), np.float32)
    interior = np.zeros((H, W, 1), np.float32)  # inside the compound (less lamp light)
    far = np.zeros((H, W, 1), np.float32)       # distant background (no lamp light)
    shadow = np.ones((H, W, 1), np.float32)     # daytime cast shadows
    emis = np.zeros((H, W, 3), np.float32)
    wt, wb, sb = v["wall_top"], v["wall_bot"], v["side_bot"]

    # --- distant buildings (behind the wall), rooftop tanks, a tree inside the compound
    rng = np.random.default_rng(7)
    b0, b1 = v["bldg"]
    x = -20
    palette = [(0.80, 0.74, 0.62), (0.70, 0.76, 0.68), (0.82, 0.68, 0.64), (0.74, 0.72, 0.70),
               (0.86, 0.80, 0.58), (0.66, 0.70, 0.78)]
    windows = []
    while x < W:
        bw = int(rng.integers(150, 330) * (0.6 + 0.4 * s))
        top = int(b0 + rng.integers(0, int((b1 - b0) * 0.55)))
        col = np.array(palette[rng.integers(len(palette))]) * (0.92 + 0.1 * grain[..., None])
        m = _mask(lambda d: d.rectangle([x, top, x + bw, b1 + 5], fill=255))
        alb = _paint(alb, m, col)
        sky *= 1 - m
        if rng.random() < 0.6:  # black rooftop water tank
            tx = x + int(bw * rng.uniform(0.2, 0.7))
            tw_, th_ = int(46 * (0.5 + 0.5 * s)), int(40 * (0.5 + 0.5 * s))
            m = _mask(lambda d: d.rounded_rectangle([tx, top - th_, tx + tw_, top], radius=6, fill=255))
            alb = _paint(alb, m, (0.10, 0.10, 0.11))
            sky *= 1 - m
        ww, wh = int(34 * (0.5 + 0.5 * s)), int(42 * (0.5 + 0.5 * s))
        for wy in range(top + int(30 * s) + 10, b1 - wh, int(95 * (0.5 + 0.5 * s))):
            for wx in range(x + 22, x + bw - ww - 10, int(80 * (0.5 + 0.5 * s))):
                windows.append((wx, wy, ww, wh))
                m = _mask(lambda d: d.rectangle([wx, wy, wx + ww, wy + wh], fill=255))
                alb = _paint(alb, m, (0.28, 0.27, 0.27))
                if night and rng.random() < 0.18:
                    emis += m * np.array([0.55, 0.40, 0.20], np.float32) * rng.uniform(0.25, 0.6)
        x += bw + int(rng.integers(0, 30))
    tree = (_fbm(23, (90, 40, 14, 5), (0.45, 0.3, 0.15, 0.1)))
    tcx, tcy, trx, try_ = (1500, 470, 260, 210) if scene["view"] == "close" else (1060, 600, 150, 95)
    blob = 1 - ((xs - tcx) / trx) ** 2 - ((ys - tcy) / try_) ** 2
    far = 1 - sky
    tm = np.clip((blob + tree * 0.9 - 0.62) * 8, 0, 1)[..., None] * (ys < wt + 5)[..., None]
    alb = _paint(alb, tm, np.stack([0.16 + 0.12 * tree, 0.30 + 0.16 * tree, 0.12 + 0.05 * tree], -1))
    sky *= 1 - tm

    # --- overhead wires across the sky
    def wires(d):
        for i, (y0, sag) in enumerate([(150, 60), (185, 75), (300, 40)] if scene["view"] == "close"
                                      else [(330, 40), (352, 48), (420, 30)]):
            pts = [(px, y0 + sag * (1 - ((px - 800) / 900) ** 2) + i * 4) for px in range(-50, W + 60, 40)]
            d.line(pts, fill=255, width=2)
    m = _mask(wires)
    alb = _paint(alb, m, (0.08, 0.08, 0.09))
    sky *= 1 - m
    far = np.maximum(far, tm)

    # --- compound wall (whitewash with stains), coping, drain line
    wall = 0.86 + 0.10 * (grain - 0.5) - 0.05 * _noise(31, 6)
    streak = np.clip(_noise(41, 18, W, H) * 1.6 - 0.6, 0, 1) * np.clip(1 - (ys - wt) / ((wb - wt) * 0.7), 0, 1)
    wall = wall - 0.16 * streak - 0.14 * np.clip((ys - (wb - 90 * s)) / (90 * s), 0, 1)
    wall_col = np.stack([wall * 0.97, wall * 0.95, wall * 0.89], -1)
    m = _mask(lambda d: d.rectangle([0, wt, W, wb], fill=255))
    alb = _paint(alb, m, wall_col)
    sky *= 1 - m
    m = _mask(lambda d: d.rectangle([0, wt - 16 * s - 4, W, wt + 6 * s], fill=255))
    alb = _paint(alb, m, (0.70, 0.68, 0.64))
    sky *= 1 - m
    shadow *= 1 - 0.25 * _mask(lambda d: d.rectangle([0, wt + 6 * s, W, wt + 22 * s], fill=255))

    # --- gate opening, interior, pillars, metal gate
    (pl0, pl1), (pr0, pr1) = v["pillars"]
    m = _mask(lambda d: d.rectangle([pl1, wt - 30 * s, pr0, wb], fill=255))
    inside = np.stack([0.42 + 0.05 * grain, 0.40 + 0.05 * grain, 0.36 + 0.04 * grain], -1)
    alb = _paint(alb, m, inside)
    interior = np.maximum(interior, m)
    for a, b in v["pillars"]:
        m = _mask(lambda d: d.rectangle([a, v["pillar_top"], b, wb], fill=255))
        alb = _paint(alb, m, wall_col * 0.97)
        sky *= 1 - m
        m = _mask(lambda d: d.rectangle([a - 8 * s, v["pillar_top"] - 18 * s, b + 8 * s, v["pillar_top"]], fill=255))
        alb = _paint(alb, m, (0.66, 0.64, 0.60))
        sky *= 1 - m

    def gate(d):
        top, bot = wt + 10 * s, wb - 6 * s
        lw = max(2, int(7 * s))
        mid = (pl1 + pr0) / 2
        for gx0, gx1 in ((pl1 + 2, mid - 2), (mid + 2, pr0 - 2)):
            d.rectangle([gx0, top, gx1, bot], outline=255, width=lw + 2)
            for ry in (top + (bot - top) * 0.3, top + (bot - top) * 0.72):
                d.line([(gx0, ry), (gx1, ry)], fill=255, width=lw)
            step = max(9, int(24 * s))
            for bx in np.arange(gx0 + step, gx1 - 2, step):
                d.line([(bx, top), (bx, bot)], fill=255, width=max(2, int(5 * s)))
                d.polygon([(bx - 5 * s, top), (bx + 5 * s, top), (bx, top - 18 * s)], fill=255)
    m = _mask(gate)
    alb = _paint(alb, m, (0.16, 0.22, 0.20))
    interior = np.where(m > 0, 0, interior)

    # --- sign
    sx0, sy0, sx1, sy1 = v["sign"]
    m = _mask(lambda d: d.rounded_rectangle([sx0, sy0, sx1, sy1], radius=int(10 * s + 3), fill=255))
    alb = _paint(alb, m, (0.93, 0.93, 0.92))
    bd = max(4, int(9 * s))
    m = _mask(lambda d: d.rounded_rectangle([sx0 + bd, sy0 + bd, sx1 - bd, sy1 - bd], radius=int(7 * s + 2), fill=255))
    alb = _paint(alb, m, np.stack([0.07 + 0.03 * grain, 0.24 + 0.04 * grain, 0.58 + 0.05 * grain], -1))
    size = v["font"]
    inner_w, inner_h = (sx1 - sx0) - 2 * bd, (sy1 - sy0) - 2 * bd
    while size > 10:
        f = _font(size)
        bx0, by0, bx1, by1 = ImageDraw.Draw(Image.new("L", (1, 1))).textbbox((0, 0), scene["text"], font=f)
        if bx1 - bx0 <= inner_w * 0.86 and by1 - by0 <= inner_h * 0.66:
            break
        size -= 2

    def text(d):
        bx0, by0, bx1, by1 = d.textbbox((0, 0), scene["text"], font=f)
        d.text(((sx0 + sx1 - (bx1 - bx0)) / 2 - bx0, (sy0 + sy1 - (by1 - by0)) / 2 - by0),
               scene["text"], font=f, fill=255)
    alb = _paint(alb, _mask(text), (0.97, 0.97, 0.95))
    for bx in (sx0 + 3 * bd, sx1 - 3 * bd):  # bolts
        alb = _paint(alb, _mask(lambda d: d.ellipse([bx - 4 * s - 2, sy0 + bd * 0.5 - 3, bx + 4 * s + 2, sy0 + bd * 0.5 + 5 * s], fill=255)), (0.6, 0.6, 0.6))
    shadow *= 1 - 0.3 * _mask(lambda d: d.rectangle([sx0 + 10 * s, sy1, sx1 + 10 * s, sy1 + 12 * s], fill=255))

    # --- footpath, drain slabs, road
    foot = 0.62 + 0.12 * (grain - 0.5) + 0.06 * (_noise(51, 4) - 0.5)
    m = _mask(lambda d: d.rectangle([0, wb, W, sb], fill=255))
    alb = _paint(alb, m, np.stack([foot * 0.95, foot * 0.88, foot * 0.78], -1))

    def slabs(d):
        step = int(150 * s) + 20
        for sx in range(0, W, step):
            d.line([(sx, wb + 2), (sx - 10 * s, sb)], fill=255, width=2)
    alb = _paint(alb, _mask(slabs), (0.35, 0.33, 0.30))
    road = 0.30 + 0.10 * (grain - 0.5) + 0.08 * (_noise(61, 2) - 0.5) - 0.06 * np.clip(_noise(71, 40) * 2 - 1.1, 0, 1)
    m = _mask(lambda d: d.rectangle([0, sb, W, H], fill=255))
    alb = _paint(alb, m, np.stack([road, road * 0.98, road * 0.96], -1))
    alb = _paint(alb, _mask(lambda d: d.rectangle([0, sb, W, sb + 10 * s + 3], fill=255)), (0.55, 0.53, 0.50))
    sky *= 1 - _mask(lambda d: d.rectangle([0, wb, W, H], fill=255))

    # --- poles with LED lamp heads
    lamps = []
    for px, on in zip(v["poles"], scene["lit"]):
        top, base, arm = v["pole_top"], v["pole_base"], v["arm"]
        hw0, hw1 = 9 * s + 4, 15 * s + 6

        def pole(d, px=px, top=top, base=base):
            d.polygon([(px - hw0, top), (px + hw0, top), (px + hw1, base), (px - hw1, base)], fill=255)
            d.rectangle([px - hw1 - 6 * s, base - 14 * s, px + hw1 + 6 * s, base + 4], fill=255)
            d.rectangle([px - hw1 - 5 * s, base - (base - top) * 0.28, px + hw1 + 5 * s,
                         base - (base - top) * 0.28 + 70 * s + 8], fill=255)
            pts = [(px, top + 10 * s)]
            for t in np.linspace(0, 1, 12):
                pts.append((px + arm * t, top - 28 * s * np.sin(t * np.pi * 0.5) + 10 * s))
            d.line(pts, fill=255, width=int(9 * s + 3))
        m = _mask(pole)
        u = np.clip((xs - px) / hw1, -1.2, 1.2)
        shade = 0.95 - 0.40 * (u + 0.35) ** 2
        alb = _paint(alb, m, np.stack([0.56 * shade, 0.57 * shade, 0.59 * shade], -1))
        sky *= 1 - m
        interior = np.where(m > 0, 0, interior)
        far = np.where(m > 0, 0, far)
        hx0, hx1 = px + arm - 30 * s, px + arm + 95 * s
        hy0, hy1 = top - 32 * s, top - 2 * s
        m = _mask(lambda d: d.rounded_rectangle([hx0, hy0, hx1, hy1], radius=int(12 * s + 2), fill=255))
        alb = _paint(alb, m, (0.36, 0.37, 0.39))
        sky *= 1 - m
        lm = _mask(lambda d: d.rounded_rectangle([hx0 + 10 * s, hy1 - 9 * s - 2, hx1 - 10 * s, hy1 + 5 * s], radius=4, fill=255))
        alb = _paint(alb, lm, (0.30, 0.31, 0.33) if night else (0.70, 0.72, 0.74))
        sky *= 1 - lm
        if night and not on:  # unlit lamp: dull grey lens catching faint ambient, no glow
            emis = emis * (1 - lm) + lm * np.array([0.085, 0.09, 0.10], np.float32)
        if night and on:
            emis = emis * (1 - lm) + lm * np.array([3.2, 3.0, 2.6], np.float32)
            lamps.append(((hx0 + hx1) / 2, hy1 + 4 * s))
        if not night:  # sun from the upper left: pole shadow across footpath and up the wall
            off = 140 * s

            def psh(d, px=px):
                d.polygon([(px - hw1, base), (px + hw1, base), (px + hw1 + off * 0.35, wb), (px - hw1 + off * 0.35, wb)], fill=255)
                d.polygon([(px - hw1 + off * 0.35, wb), (px + hw1 + off * 0.35, wb),
                           (px + hw0 + off, wt + 10 * s), (px - hw0 + off, wt + 10 * s)], fill=255)
            shadow *= 1 - 0.38 * _mask(psh).clip(0, 1) * (1 - sky)

    # --- sky
    t = np.clip(ys / (v["bldg"][1]), 0, 1)[..., None]
    if night:
        sky_col = np.array([0.015, 0.022, 0.06]) * (1 - t) + np.array([0.20, 0.15, 0.16]) * t ** 1.5
        sky_col = sky_col + 0.01 * (_fbm(81)[..., None] - 0.5)
    else:
        clouds = np.clip(_fbm(91, (240, 120, 50, 20, 8)) * 1.8 - 0.95, 0, 1)[..., None]
        sky_col = np.array([0.30, 0.52, 0.86]) * (1 - t) + np.array([0.70, 0.80, 0.92]) * t
        sky_col = sky_col * (1 - clouds * 0.8) + 0.97 * clouds * 0.8

    # --- lighting
    if night:
        light = np.ones((H, W, 3), np.float32) * np.array([0.07, 0.08, 0.12], np.float32)
        for lx, ly in lamps:
            R = 380 * s
            dd = np.sqrt((xs - lx) ** 2 + (ys - ly) ** 2 * 0.33)
            fall = 1.0 / (1 + (dd / R) ** 2) ** 1.4
            down = np.clip((ys - ly + 30 * s) / (90 * s), 0.06, 1)
            inten = (2.0 * fall * down)[..., None] * (1 - 0.55 * interior) * (1 - 0.85 * far)
            light = light + inten * np.array([1.0, 0.80, 0.52], np.float32)
            # faint haze cone under the lamp
            spread = np.clip((ys - ly) / (H - ly), 0, 1) * 260 * s + 40 * s
            cone = np.exp(-((xs - lx) / spread) ** 2) * np.clip((ys - ly) / 40, 0, 1) * np.exp(-(ys - ly) / (520 * s))
            emis = emis + (0.05 * cone)[..., None] * np.array([1.0, 0.85, 0.6], np.float32)
        img = alb * light
    else:
        img = alb * 1.02 * shadow * (1 - 0.18 * interior)
    img = img * (1 - sky) + sky_col * sky

    # --- emissive + bloom
    if night:
        hot = np.clip(emis - 0.5, 0, None)  # only bright emitters bloom
        e8 = Image.fromarray(np.clip(hot / 4 * 255, 0, 255).astype(np.uint8))
        bloom = np.zeros_like(emis)
        for r, wgt in ((4, 0.9), (14, 1.0), (45, 1.1), (130, 0.9)):
            k = max(1, r // 6)
            small = e8.resize((W // k, H // k), Image.BILINEAR)
            for _ in range(3):
                small = small.filter(ImageFilter.GaussianBlur(r / k / 1.7))
            bloom += wgt * np.asarray(small.resize((W, H), Image.BICUBIC), np.float32) / 255 * 4
        img = img * (1 - np.clip(emis, 0, 1)) + emis + bloom * np.array([1.0, 0.86, 0.62], np.float32)
        img = img / (1 + 0.35 * np.clip(img - 0.8, 0, None))  # soft highlight roll-off

    # --- camera: vignette + sensor noise
    vig = 1 - 0.28 * (((xs - W / 2) / (W / 2)) ** 2 + ((ys - H / 2) / (H / 2)) ** 2)[..., None] / 2
    img = img * vig
    rng = np.random.default_rng(99)
    img = img + rng.normal(0, 0.022 if night else 0.010, img.shape).astype(np.float32)
    return Image.fromarray(np.clip(img * 255, 0, 255).astype(np.uint8))


def illustrate(args):
    if np is None:
        sys.exit("numpy is required for `illustrate`")
    raw_dir = args.raw or os.environ.get("SAMPLES_RAW_DIR") or os.path.join(tempfile.gettempdir(), "secondlook-samples-raw")
    os.makedirs(raw_dir, exist_ok=True)
    for sid in args.ids or list(SCENES):
        out = os.path.join(raw_dir, sid + "-illustrated.png")
        render(SCENES[sid]).save(out)
        args.id, args.raw_png = sid, out
        finalize(args)


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    g = sub.add_parser("gen")
    g.add_argument("id", choices=list(PROMPTS))
    g.add_argument("--model")
    g.add_argument("--ref")
    g.add_argument("--prompt")
    g.add_argument("--raw")
    g.add_argument("--tag")
    g.add_argument("--key-file")
    g.set_defaults(fn=generate)
    fz = sub.add_parser("finalize")
    fz.add_argument("id", choices=list(PROMPTS))
    fz.add_argument("raw_png")
    fz.add_argument("--caption")
    fz.set_defaults(fn=finalize)
    il = sub.add_parser("illustrate", help="fallback: render the scenes locally (no API)")
    il.add_argument("ids", nargs="*", help="subset of: " + ", ".join(SCENES))
    il.add_argument("--raw")
    il.add_argument("--caption", default="Illustrated sample")
    il.set_defaults(fn=illustrate)
    args = ap.parse_args()
    args.fn(args)


if __name__ == "__main__":
    main()
