"""Prepare transparent UI assets from the approved generated WorkSpaceX logo.

Run from the project root with Pillow installed. Originals stay untouched.
Only the uniform graphite background is removed; no new artwork is generated.
"""

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
BRAND = ROOT / "public" / "brand"
SOURCE = BRAND / "generated"


def transparent_crop(filename, bounds, background, kind):
    image = Image.open(SOURCE / filename).convert("RGB").crop(bounds)
    pixels = []
    source_pixels = image.load()
    for red, green, blue in (source_pixels[x, y] for y in range(image.height) for x in range(image.width)):
        signal = green if kind == "mark" else max(red, green, blue)
        low, high = (38, 80) if kind == "mark" else (32, 205)
        alpha = max(0.0, min(1.0, (signal - low) / (high - low)))
        if alpha == 0:
            pixels.append((0, 0, 0, 0))
            continue
        channels = [
            round(max(0, min(255, (value - bg * (1 - alpha)) / alpha)))
            for value, bg in zip((red, green, blue), background)
        ]
        pixels.append((*channels, round(alpha * 255)))
    result = Image.new("RGBA", image.size)
    result.putdata(pixels)
    return result


def square_icon(mark, size, opaque=False):
    background = (19, 23, 21, 255) if opaque else (0, 0, 0, 0)
    icon = Image.new("RGBA", (size, size), background)
    width = round(size * 0.9)
    scaled = mark.resize((width, round(width * mark.height / mark.width)), Image.Resampling.LANCZOS)
    icon.alpha_composite(scaled, ((size - scaled.width) // 2, (size - scaled.height) // 2))
    return icon.convert("RGB") if opaque else icon


def main():
    mark = transparent_crop(
        "workspacex-icon-graphite.jpg", (172, 318, 834, 706), (22, 27, 21), "mark"
    )
    wordmark = transparent_crop(
        "workspacex-logo-graphite.jpg", (447, 376, 1093, 488), (20, 26, 22), "wordmark"
    )
    mark.save(BRAND / "workspacex-mark.png", optimize=True)
    wordmark.save(BRAND / "workspacex-wordmark.png", optimize=True)

    # Keep the proportions and spacing of the approved horizontal lockup.
    lockup = Image.new("RGBA", (930, 144))
    small_mark = mark.resize((240, 141), Image.Resampling.LANCZOS)
    lockup.alpha_composite(small_mark, (0, 1))
    lockup.alpha_composite(wordmark, (284, 16))
    lockup.save(BRAND / "workspacex-logo.png", optimize=True)

    for size in (32, 192, 256, 512):
        square_icon(mark, size).save(BRAND / f"workspacex-icon-{size}.png", optimize=True)
    square_icon(mark, 256).save(ROOT / "app" / "icon.png", optimize=True)
    square_icon(mark, 256).save(
        ROOT / "app" / "favicon.ico", format="ICO",
        sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )
    for name in ("icon-dark-32x32.png", "icon-light-32x32.png"):
        square_icon(mark, 32).save(ROOT / "public" / name, optimize=True)
    square_icon(mark, 180, opaque=True).save(ROOT / "public" / "apple-icon.png", optimize=True)
    print("Prepared WorkSpaceX mark, wordmark, lockup, PNG icons and multi-size favicon.")


if __name__ == "__main__":
    main()