"""Generate the three illustrated SecondLook sample photos.

Usage:  python scripts/make_samples.py
Writes samples/gate2-day.png, samples/gate2-night.png, samples/gate3-night.png (1200x900).
Deterministic: no randomness except a fixed-seed RNG for star positions.
"""
import os
import random

from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H = 1200, 900
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, "samples")

# Layout
WALL_TOP, WALL_BOTTOM = 430, 650
SIDEWALK_BOTTOM = 720
GATE_L, GATE_R = 600, 960          # gate opening
PILLAR_W = 50
SIGN_BOX = (560, 225, 1000, 360)   # sign plate above the gate
POLE_X = 360
POLE_TOP = 150
ARM_END_X = 500
LAMP_Y = 168


def font(size):
    for path in (r"C:\Windows\Fonts\arialbd.ttf", "DejaVuSans-Bold.ttf", "Arial Bold.ttf"):
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    return ImageFont.load_default(size=size)


def lerp(a, b, t):
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(3))


def vertical_gradient(draw, box, top, bottom):
    x0, y0, x1, y1 = box
    for y in range(y0, y1):
        t = (y - y0) / max(1, (y1 - y0 - 1))
        draw.line([(x0, y), (x1, y)], fill=lerp(top, bottom, t))


def palette(night):
    if night:
        return dict(
            sky_top=(10, 14, 38), sky_bottom=(38, 42, 82),
            far=(24, 28, 52), wall=(70, 58, 62), wall_line=(52, 42, 48), cap=(92, 86, 96),
            pillar=(84, 76, 86), pillar_cap=(110, 104, 116),
            gate=(20, 22, 30), inside=(16, 20, 34),
            sidewalk=(58, 60, 70), curb=(80, 82, 92), road=(30, 32, 40), road_line=(150, 140, 100),
            pole=(40, 46, 56), sign_bg=(250, 248, 236), sign_border=(30, 70, 130), sign_text=(20, 40, 90),
        )
    return dict(
        sky_top=(92, 162, 230), sky_bottom=(196, 228, 250),
        far=(150, 186, 170), wall=(196, 132, 104), wall_line=(168, 108, 84), cap=(214, 206, 192),
        pillar=(186, 176, 162), pillar_cap=(222, 216, 204),
        gate=(46, 52, 62), inside=(170, 200, 150),
        sidewalk=(190, 188, 180), curb=(214, 212, 204), road=(88, 92, 100), road_line=(246, 246, 236),
        pole=(70, 80, 92), sign_bg=(255, 255, 255), sign_border=(30, 80, 150), sign_text=(20, 50, 110),
    )


def draw_sky(img, night):
    d = ImageDraw.Draw(img)
    p = palette(night)
    vertical_gradient(d, (0, 0, W, WALL_TOP + 60), p["sky_top"], p["sky_bottom"])
    if night:
        rng = random.Random(42)
        for _ in range(90):
            x, y = rng.randrange(W), rng.randrange(0, WALL_TOP - 20)
            # keep stars away from the lamp glow area
            if abs(x - ARM_END_X) < 180 and y < 330:
                continue
            r = rng.choice((1, 1, 1, 2))
            c = rng.randrange(170, 255)
            d.ellipse([x - r, y - r, x + r, y + r], fill=(c, c, min(255, c + 10)))
        # crescent moon
        d.ellipse([1020, 60, 1110, 150], fill=(236, 232, 200))
        d.ellipse([1044, 48, 1134, 138], fill=p["sky_top"])
    else:
        d.ellipse([1020, 50, 1120, 150], fill=(255, 226, 110))
        for cx, cy, s in ((180, 110, 1.0), (760, 80, 0.8), (980, 230, 0.6)):
            for dx, dy, r in ((0, 0, 40), (45, -15, 50), (95, 0, 38), (45, 15, 42)):
                rr = r * s
                x, y = cx + dx * s, cy + dy * s
                d.ellipse([x - rr, y - rr, x + rr, y + rr], fill=(255, 255, 255))
    # distant tree line / hills behind the wall
    d.rectangle([0, WALL_TOP - 40, W, WALL_TOP], fill=p["far"])
    for i in range(14):
        cx = i * 92 + 20
        d.ellipse([cx - 60, WALL_TOP - 95, cx + 60, WALL_TOP + 10], fill=p["far"])


def draw_ground(img, night):
    d = ImageDraw.Draw(img)
    p = palette(night)
    d.rectangle([0, WALL_BOTTOM, W, SIDEWALK_BOTTOM], fill=p["sidewalk"])
    for x in range(0, W, 120):
        d.line([(x, WALL_BOTTOM), (x - 30, SIDEWALK_BOTTOM)], fill=p["curb"], width=2)
    d.rectangle([0, SIDEWALK_BOTTOM, W, SIDEWALK_BOTTOM + 14], fill=p["curb"])
    d.rectangle([0, SIDEWALK_BOTTOM + 14, W, H], fill=p["road"])
    for x in range(20, W, 180):
        d.rectangle([x, 820, x + 100, 834], fill=p["road_line"])


def draw_wall_and_gate(img, night):
    d = ImageDraw.Draw(img)
    p = palette(night)
    # wall
    d.rectangle([0, WALL_TOP, W, WALL_BOTTOM], fill=p["wall"])
    row_h = 30
    for i, y in enumerate(range(WALL_TOP, WALL_BOTTOM, row_h)):
        d.line([(0, y), (W, y)], fill=p["wall_line"], width=2)
        off = 0 if i % 2 == 0 else 40
        for x in range(off, W, 80):
            d.line([(x, y), (x, y + row_h)], fill=p["wall_line"], width=2)
    d.rectangle([0, WALL_TOP - 16, W, WALL_TOP], fill=p["cap"])

    # gate opening (view inside)
    d.rectangle([GATE_L, 397, GATE_R, WALL_BOTTOM], fill=p["inside"])
    # iron gate bars
    d.rectangle([GATE_L, 470, GATE_R, 482], fill=p["gate"])
    d.rectangle([GATE_L, 600, GATE_R, 612], fill=p["gate"])
    for x in range(GATE_L + 14, GATE_R, 26):
        d.rectangle([x, 450, x + 7, WALL_BOTTOM], fill=p["gate"])
        d.polygon([(x - 3, 452), (x + 3.5, 438), (x + 10, 452)], fill=p["gate"])
    d.line([(GATE_L + (GATE_R - GATE_L) // 2, 450), (GATE_L + (GATE_R - GATE_L) // 2, WALL_BOTTOM)],
           fill=p["gate"], width=6)

    # pillars
    for px in (GATE_L - PILLAR_W, GATE_R):
        d.rectangle([px, 395, px + PILLAR_W, WALL_BOTTOM], fill=p["pillar"])
        d.rectangle([px - 8, 383, px + PILLAR_W + 8, 397], fill=p["pillar_cap"])

    # lintel connecting pillars, sign mounted on it
    d.rectangle([GATE_L - PILLAR_W, 383, GATE_R + PILLAR_W, 397], fill=p["pillar_cap"])


def draw_sign(img, night, text):
    d = ImageDraw.Draw(img)
    p = palette(night)
    x0, y0, x1, y1 = SIGN_BOX
    # posts from sign to lintel
    for px in (x0 + 60, x1 - 60):
        d.rectangle([px - 6, y1, px + 6, 385], fill=p["gate"])
    d.rounded_rectangle([x0 + 4, y0 + 6, x1 + 4, y1 + 6], radius=14, fill=(0, 0, 0))
    d.rounded_rectangle(SIGN_BOX, radius=14, fill=p["sign_border"])
    d.rounded_rectangle([x0 + 10, y0 + 10, x1 - 10, y1 - 10], radius=10, fill=p["sign_bg"])
    f = font(100)
    bbox = d.textbbox((0, 0), text, font=f)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    tx = (x0 + x1) / 2 - tw / 2 - bbox[0]
    ty = (y0 + y1) / 2 - th / 2 - bbox[1]
    d.text((tx, ty), text, font=f, fill=p["sign_text"])


def draw_pole(img, night):
    d = ImageDraw.Draw(img)
    p = palette(night)
    # base
    d.rectangle([POLE_X - 22, 660, POLE_X + 22, 690], fill=p["pole"])
    # pole shaft
    d.rectangle([POLE_X - 10, POLE_TOP, POLE_X + 10, 662], fill=p["pole"])
    # arm curving out to the lamp
    d.arc([POLE_X - 10, POLE_TOP - 6, POLE_X + 70, POLE_TOP + 60], 180, 270, fill=p["pole"], width=12)
    d.rectangle([POLE_X + 30, POLE_TOP - 6, ARM_END_X, POLE_TOP + 6], fill=p["pole"])
    # lamp head housing
    d.polygon([(ARM_END_X - 62, LAMP_Y - 10), (ARM_END_X + 62, LAMP_Y - 10),
               (ARM_END_X + 46, LAMP_Y + 14), (ARM_END_X - 46, LAMP_Y + 14)], fill=p["pole"])


def draw_lamp_lens(img, on):
    d = ImageDraw.Draw(img)
    box = [ARM_END_X - 44, LAMP_Y + 10, ARM_END_X + 44, LAMP_Y + 30]
    if on:
        d.ellipse(box, fill=(255, 250, 215))
    else:
        d.ellipse(box, fill=(150, 160, 170), outline=(90, 100, 110), width=3)


def add_glow(img):
    """Lamp glow halo + light cone + pool of light on the ground (night only)."""
    base = img.convert("RGBA")

    # light cone (soft)
    cone = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    cd = ImageDraw.Draw(cone)
    cd.polygon([(ARM_END_X - 40, LAMP_Y + 24), (ARM_END_X + 40, LAMP_Y + 24),
                (ARM_END_X + 270, 700), (ARM_END_X - 270, 700)], fill=(255, 224, 140, 80))
    cd.ellipse([ARM_END_X - 330, 640, ARM_END_X + 330, 760], fill=(255, 220, 140, 95))
    cone = cone.filter(ImageFilter.GaussianBlur(18))
    base = Image.alpha_composite(base, cone)

    # halo around the lamp head
    halo = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    hd = ImageDraw.Draw(halo)
    for r, a in ((170, 55), (115, 95), (70, 160), (40, 235)):
        hd.ellipse([ARM_END_X - r, LAMP_Y + 20 - r, ARM_END_X + r, LAMP_Y + 20 + r], fill=(255, 236, 170, a))
    halo = halo.filter(ImageFilter.GaussianBlur(22))
    base = Image.alpha_composite(base, halo)
    return base.convert("RGB")


def caption(img, night):
    d = ImageDraw.Draw(img)
    f = font(20)
    text = "Illustrated sample"
    bbox = d.textbbox((0, 0), text, font=f)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    x, y = W - tw - 30, H - th - 26
    d.rounded_rectangle([x - 12, y - 8, x + tw + 12, y + th + 10], radius=8, fill=(0, 0, 0))
    d.text((x - bbox[0], y - bbox[1]), text, font=f, fill=(235, 235, 235))


def make_scene(night, sign_text):
    img = Image.new("RGB", (W, H))
    draw_sky(img, night)
    draw_wall_and_gate(img, night)
    draw_ground(img, night)
    draw_sign(img, night, sign_text)
    draw_pole(img, night)
    if night:
        img = add_glow(img)
    draw_lamp_lens(img, on=night)
    caption(img, night)
    return img


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    scenes = (
        ("gate2-day.png", False, "GATE 2"),
        ("gate2-night.png", True, "GATE 2"),
        ("gate3-night.png", True, "GATE 3"),
    )
    for name, night, text in scenes:
        path = os.path.join(OUT_DIR, name)
        make_scene(night, text).save(path, optimize=True)
        print(f"{path}: {os.path.getsize(path) // 1024} KB")


if __name__ == "__main__":
    main()
