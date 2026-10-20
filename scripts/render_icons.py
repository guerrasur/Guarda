#!/usr/bin/env python3
"""Generate the favicon/PWA PNGs and ICO from the reviewed SVG source files."""
from pathlib import Path
from io import BytesIO
from PIL import Image
import cairosvg

public = Path(__file__).resolve().parent.parent / "public"

def render(name: str, size: int) -> Image.Image:
    payload = cairosvg.svg2png(url=str(public / name), output_width=size, output_height=size)
    return Image.open(BytesIO(payload)).convert("RGBA")

for size, filename in [(16, "favicon-16x16.png"), (32, "favicon-32x32.png"),
                       (192, "icon-192.png"), (512, "icon-512.png"),
                       (180, "apple-touch-icon.png")]:
    render("favicon.svg", size).save(public / filename, optimize=True)

render("guardia-icon.svg", 256).save(public / "guardia-icon.png", optimize=True)

# Modern browsers prefer the SVG; the ICO remains a multi-resolution fallback.
render("favicon.svg", 256).save(public / "favicon.ico", format="ICO",
                                sizes=[(16, 16), (32, 32), (48, 48)])
print("Generated Guarda's icon, favicon, Apple touch icon, and PWA images.")
