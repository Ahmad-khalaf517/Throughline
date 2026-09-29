"""Export the Throughline logo and social assets from one geometric mark.

Requires Pillow and CairoSVG. Run: python scripts/export-brand-assets.py
The source artwork is the SVGs in public/brand; PNGs are distribution copies.
"""

from io import BytesIO
from pathlib import Path

import cairosvg
from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "public" / "brand"
EXPORTS = ROOT / "brand" / "exports"
APP = ROOT / "src" / "app"

ORANGE = "#C24D2C"
INK = "#1D1B19"
CREAM = "#FEF8F4"
PALE = "#F6ECE5"
MUTED = "#665D56"


def svg(content: str, viewbox: str) -> str:
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="'
        + viewbox
        + '">\n'
        + content
        + "\n</svg>\n"
    )


def mark(x: int = 0, y: int = 0, color: str = ORANGE) -> str:
    # The proportions come from the user-provided Throughline promotion.
    dots = "".join(
        f'<circle cx="{x + 31 + i * 5.7:.1f}" cy="{y + 16}" r="1.6" fill="{color}"/>'
        for i in range(7)
    )
    return (
        f'<circle cx="{x + 12}" cy="{y + 16}" r="12" fill="{color}"/>'
        + dots
        + f'<circle cx="{x + 84}" cy="{y + 16}" r="12" fill="{color}"/>'
    )


def lockup(word_color: str = INK) -> str:
    return svg(
        mark(0, 16)
        + f'<text x="122" y="48" fill="{word_color}" '
        + 'font-family="Arial, Helvetica, sans-serif" font-size="36" '
        + 'font-weight="800" letter-spacing="5.4">THROUGHLINE</text>',
        "0 0 470 64",
    )


def icon() -> str:
    # Optical variant: a stronger connector survives down to 16 px.
    return svg(
        f'<rect width="64" height="64" rx="14" fill="{CREAM}"/>'
        f'<circle cx="15" cy="32" r="8" fill="{ORANGE}"/>'
        f'<path d="M25 32H39" fill="none" stroke="{ORANGE}" '
        'stroke-width="3" stroke-linecap="round" stroke-dasharray="1 5"/>'
        f'<circle cx="49" cy="32" r="8" fill="{ORANGE}"/>',
        "0 0 64 64",
    )


def raster(source: str, width: int, height: int) -> Image.Image:
    data = cairosvg.svg2png(bytestring=source.encode(), output_width=width, output_height=height)
    return Image.open(BytesIO(data)).convert("RGBA")


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    candidates = (
        ["C:/Windows/Fonts/arialbd.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"]
        if bold
        else ["C:/Windows/Fonts/arial.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"]
    )
    for candidate in candidates:
        if Path(candidate).exists():
            return ImageFont.truetype(candidate, size)
    raise FileNotFoundError("Install Arial or DejaVu Sans to render social PNGs")


def rgb(hex_color: str) -> tuple[int, int, int]:
    return tuple(bytes.fromhex(hex_color.lstrip("#")))


def paste_mark(canvas: Image.Image, box: tuple[int, int, int, int], tile: bool = False) -> None:
    left, top, width, height = box
    source = icon() if tile else svg(mark(), "0 0 96 32")
    canvas.alpha_composite(raster(source, width, height), (left, top))


def tracked(draw: ImageDraw.ImageDraw, xy: tuple[int, int], message: str, size: int,
            color: str = INK, spacing: int = 4) -> None:
    x, y = xy
    face = font(size, True)
    for letter in message:
        draw.text((x, y), letter, font=face, fill=rgb(color), anchor="lt")
        x += round(draw.textlength(letter, font=face)) + spacing


def social_card(width: int, height: int, kind: str) -> Image.Image:
    scale = 2
    canvas = Image.new("RGBA", (width * scale, height * scale), rgb(CREAM) + (255,))
    draw = ImageDraw.Draw(canvas)
    s = lambda n: n * scale
    margin = s(64 if width <= 1200 else 80)

    # Quiet paper-like composition leaves safe margins for platform cropping.
    draw.rectangle((0, 0, s(12), s(height)), fill=rgb(ORANGE))
    draw.line((margin, s(height - 68), s(width) - margin, s(height - 68)),
              fill=rgb("#D8C9BF"), width=s(1))
    paste_mark(canvas, (margin, s(68), s(96), s(32)))
    tracked(draw, (margin + s(126), s(62)), "THROUGHLINE", s(33), spacing=s(4))

    if kind == "banner":
        title_size, title_y = 55, 170
        title = ["Every decision keeps its lineage."]
    elif kind == "story":
        title_size, title_y = 96, 650
        title = ["Every decision", "keeps its lineage."]
    else:
        title_size, title_y = 72, 180 if height < 800 else 420
        title = ["Every decision", "keeps its lineage."]

    for index, line in enumerate(title):
        draw.text((margin, s(title_y + index * (title_size + 18))), line,
                  font=font(s(title_size), True), fill=rgb(INK), anchor="lt")

    tagline_y = title_y + len(title) * (title_size + 18) + 18
    draw.text((margin, s(tagline_y)), "FROM BRIEF TO BACKLOG, CONNECTED.",
              font=font(s(20 if kind != "story" else 29)), fill=rgb(ORANGE), anchor="lt")

    # A long dotted line scales with the format and echoes the core mark.
    line_y = height - (120 if kind == "banner" else 140 if kind == "share" else 150 if kind == "post" else 370)
    x0, x1 = margin, s(width) - margin
    draw.ellipse((x0, s(line_y) - s(14), x0 + s(28), s(line_y) + s(14)), fill=rgb(ORANGE))
    draw.ellipse((x1 - s(28), s(line_y) - s(14), x1, s(line_y) + s(14)), fill=rgb(ORANGE))
    for x in range(x0 + s(54), x1 - s(52), s(16)):
        draw.ellipse((x, s(line_y) - s(2), x + s(4), s(line_y) + s(2)), fill=rgb(ORANGE))

    draw.text((margin, s(height - 48)), "throughline", font=font(s(17)),
              fill=rgb(MUTED), anchor="lt")
    return canvas.resize((width, height), Image.Resampling.LANCZOS).convert("RGB")


def main() -> None:
    for directory in (WEB, EXPORTS):
        directory.mkdir(parents=True, exist_ok=True)

    symbol = svg(mark(), "0 0 96 32")
    tile = icon()
    horizontal = lockup()
    inverse = lockup(CREAM)
    (WEB / "logo-mark.svg").write_text(symbol, encoding="utf-8")
    (WEB / "logo-horizontal.svg").write_text(horizontal, encoding="utf-8")
    (WEB / "logo-horizontal-inverse.svg").write_text(inverse, encoding="utf-8")
    (WEB / "logo-icon.svg").write_text(tile, encoding="utf-8")
    (APP / "icon.svg").write_text(tile, encoding="utf-8")

    raster(horizontal, 940, 128).save(WEB / "email-logo.png", optimize=True)
    raster(tile, 180, 180).save(APP / "apple-icon.png", optimize=True)
    raster(tile, 192, 192).save(EXPORTS / "app-icon-192.png", optimize=True)
    raster(tile, 512, 512).save(EXPORTS / "app-icon-512.png", optimize=True)
    raster(symbol, 960, 320).save(EXPORTS / "logo-mark-transparent.png", optimize=True)
    raster(horizontal, 1880, 256).save(EXPORTS / "logo-horizontal-transparent.png", optimize=True)
    raster(inverse, 1880, 256).save(EXPORTS / "logo-horizontal-inverse-transparent.png", optimize=True)
    raster(tile, 256, 256).save(
        APP / "favicon.ico", format="ICO", sizes=[(16, 16), (32, 32), (48, 48)],
    )

    avatar = Image.new("RGBA", (800, 800), rgb(PALE) + (255,))
    paste_mark(avatar, (112, 288, 576, 192))
    avatar.convert("RGB").save(EXPORTS / "social-avatar-800.png", optimize=True)
    share = social_card(1200, 630, "share")
    share.save(APP / "opengraph-image.png", optimize=True)
    share.save(APP / "twitter-image.png", optimize=True)
    share.save(EXPORTS / "social-link-1200x630.png", optimize=True)
    social_card(1080, 1080, "post").save(EXPORTS / "social-post-1080.png", optimize=True)
    social_card(1080, 1920, "story").save(EXPORTS / "social-story-1080x1920.png", optimize=True)
    social_card(1500, 500, "banner").save(EXPORTS / "social-banner-1500x500.png", optimize=True)


if __name__ == "__main__":
    main()
