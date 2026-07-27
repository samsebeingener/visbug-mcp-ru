#!/usr/bin/env python3
"""Generate VisBug MCP Bridge extension icons — bold, high-contrast (toolbar-friendly)."""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "extension" / "icons"

WHITE = (255, 255, 255, 255)
PINK = (236, 72, 153, 255)
PINK_DARK = (219, 39, 119, 255)
CYAN = (14, 165, 233, 255)
CYAN_DARK = (2, 132, 199, 255)
NAVY = (15, 23, 42, 255)
GREEN = (34, 197, 94, 255)
SHADOW = (0, 0, 0, 50)


def pt(size: int, x: float, y: float) -> tuple[float, float]:
    return (size * x, size * y)


def poly(size: int, *coords: tuple[float, float]) -> list[tuple[float, float]]:
    return [pt(size, x, y) for x, y in coords]


def draw_icon(size: int) -> Image.Image:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    s = size
    simple = s <= 32

    shadow_r = s * 0.47
    d.ellipse(
        (s * 0.5 - shadow_r, s * 0.51 - shadow_r, s * 0.5 + shadow_r, s * 0.51 + shadow_r),
        fill=SHADOW,
    )

    disc_r = s * 0.45
    cx, cy = s * 0.5, s * 0.5
    d.ellipse(
        (cx - disc_r, cy - disc_r, cx + disc_r, cy + disc_r),
        fill=WHITE,
        outline=(203, 213, 225, 255),
        width=max(1, s // 28),
    )

    if simple:
        # toolbar 16–32px: только крупная V + зелёный статус
        d.polygon(
            poly(s, (0.12, 0.16), (0.32, 0.16), (0.50, 0.78), (0.38, 0.78)),
            fill=PINK_DARK,
        )
        d.polygon(
            poly(s, (0.50, 0.78), (0.68, 0.16), (0.88, 0.16), (0.62, 0.78)),
            fill=PINK,
        )
    else:
        d.polygon(
            poly(s, (0.10, 0.14), (0.30, 0.14), (0.46, 0.72), (0.34, 0.72)),
            fill=PINK_DARK,
        )
        d.polygon(
            poly(s, (0.46, 0.72), (0.54, 0.14), (0.74, 0.14), (0.50, 0.72)),
            fill=PINK,
        )
        bar_y0, bar_y1 = s * 0.38, s * 0.54
        bar_x0, bar_x1 = s * 0.56, s * 0.74
        d.rounded_rectangle(
            (bar_x0, bar_y0, bar_x1, bar_y1),
            radius=max(2, s // 14),
            fill=CYAN,
        )
        d.polygon(
            [
                (bar_x1, (bar_y0 + bar_y1) / 2),
                (s * 0.82, bar_y0 + s * 0.02),
                (s * 0.82, bar_y1 - s * 0.02),
            ],
            fill=CYAN_DARK,
        )
        chip = (s * 0.68, s * 0.28, s * 0.92, s * 0.64)
        d.rounded_rectangle(
            chip,
            radius=max(3, s // 10),
            fill=NAVY,
            outline=CYAN_DARK,
            width=max(2, s // 14),
        )
        pr = max(1, s // 22)
        for ox in (0.74, 0.80, 0.86):
            px, py = s * ox, s * 0.46
            d.ellipse((px - pr, py - pr, px + pr, py + pr), fill=CYAN)

    badge_r = s * (0.16 if simple else 0.14)
    bx, by = s * 0.86, s * 0.86
    d.ellipse(
        (bx - badge_r - s * 0.03, by - badge_r - s * 0.03, bx + badge_r + s * 0.03, by + badge_r + s * 0.03),
        fill=WHITE,
    )
    d.ellipse(
        (bx - badge_r, by - badge_r, bx + badge_r, by + badge_r),
        fill=GREEN,
        outline=(21, 128, 61, 255),
        width=max(1, s // 20),
    )

    return img


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for size in (16, 32, 48, 128):
        path = OUT / f"icon-{size}.png"
        draw_icon(size).save(path, "PNG", optimize=True)
        print(f"wrote {path}")


if __name__ == "__main__":
    main()
