from pathlib import Path
from PIL import Image, ImageDraw

for size in [192, 512]:
    image = Image.new('RGB', (size, size), '#c5e5b4')
    draw = ImageDraw.Draw(image)
    scale = size / 48
    def line(points):
        draw.line([(x * scale, y * scale) for x, y in points], fill='#183b30', width=round(2.5 * scale), joint='curve')
    line([(13,35),(13,15),(35,10),(35,35),(13,35)])
    line([(19,35),(19,19),(29,17),(29,35)])
    draw.ellipse(tuple(v * scale for v in (24.5,25.5,27.5,28.5)), fill='#183b30')
    image.save(Path('public') / f'icon-{size}.png')
