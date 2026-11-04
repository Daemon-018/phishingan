"""Generate PhishinGAN extension icons as PNG files without external deps."""

from __future__ import annotations

import math
import struct
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "extension" / "icons"

BG_TOP = (126, 166, 255)
BG_BOTTOM = (68, 114, 230)
SHIELD = (255, 255, 255)
CHECK = (17, 26, 40)


def rounded_box(x: float, y: float, size: float, radius: float) -> bool:
    left, top = 0.0, 0.0
    right, bottom = size, size
    if x < left or x > right or y < top or y > bottom:
        return False
    cx = min(max(x, left + radius), right - radius)
    cy = min(max(y, top + radius), bottom - radius)
    return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2


def shield(x: float, y: float, size: float) -> bool:
    """Shield centred in the icon, expressed in 0..1 coordinates."""
    u = x / size
    v = y / size
    # Shield outline: wide at the top, tapering to a point at the bottom.
    if v < 0.2 or v > 0.84:
        return False
    half = 0.30
    cx = 0.5
    if v <= 0.56:
        return abs(u - cx) <= half
    # Taper from 0.30 half-width down to 0 at the tip.
    t = (v - 0.56) / (0.84 - 0.56)
    return abs(u - cx) <= half * (1 - t) ** 0.85


def check(x: float, y: float, size: float) -> bool:
    u = x / size
    v = y / size
    # Thick checkmark drawn as two capsules.
    def segment(ax, ay, bx, by, radius):
        dx, dy = bx - ax, by - ay
        length2 = dx * dx + dy * dy
        t = 0.0 if length2 == 0 else max(0.0, min(1.0, ((u - ax) * dx + (v - ay) * dy) / length2))
        px, py = ax + t * dx, ay + t * dy
        return (u - px) ** 2 + (v - py) ** 2 <= radius * radius

    return segment(0.40, 0.50, 0.47, 0.58, 0.035) or segment(0.47, 0.58, 0.60, 0.43, 0.035)


def sample(x: float, y: float, size: float):
    if not rounded_box(x, y, size, size * 0.22):
        return None
    if shield(x, y, size):
        if check(x, y, size):
            return CHECK
        return SHIELD
    # Vertical gradient background.
    t = max(0.0, min(1.0, y / size))
    return tuple(
        int(round(BG_TOP[i] + (BG_BOTTOM[i] - BG_TOP[i]) * t)) for i in range(3)
    )


def render(size: int, supersample: int = 4) -> bytes:
    rows = []
    for py in range(size):
        row = bytearray()
        for px in range(size):
            r = g = b = a = 0
            for sy in range(supersample):
                for sx in range(supersample):
                    x = px + (sx + 0.5) / supersample
                    y = py + (sy + 0.5) / supersample
                    colour = sample(x, y, size)
                    if colour is not None:
                        r += colour[0]
                        g += colour[1]
                        b += colour[2]
                        a += 255
            count = supersample * supersample
            if a == 0:
                row.extend((0, 0, 0, 0))
            else:
                hit = a // 255
                row.extend((r // hit, g // hit, b // hit, a // count))
        rows.append(bytes(row))
    return b"".join(b"\x00" + row for row in rows)


def png(size: int) -> bytes:
    raw = render(size)
    def chunk(tag: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    header = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", header)
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    for size in (16, 48, 128):
        path = OUT / f"icon{size}.png"
        path.write_bytes(png(size))
        print(f"wrote {path} ({path.stat().st_size} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
