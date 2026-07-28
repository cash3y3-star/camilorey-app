"""
Genera los íconos de la app (favicon, apple-touch-icon, manifest icons)
con el bot mascota de CZECH IA AGENTS en vez del viejo monograma "CR"
con corona — mismo diseño/colores que CzechBotLogo (pages/index.js) y
public/icon-master.svg, dibujado a mano con Pillow porque no hay
rasterizador de SVG disponible en este entorno.

Uso: python scripts/gen-bot-icons.py (una sola vez, no se corre en CI).
"""
import math
from PIL import Image, ImageDraw

BLUE = (138, 180, 255, 255)
RED = (224, 70, 75, 255)
GREEN = (93, 202, 165, 255)
VISOR = (12, 12, 14, 255)
BG_TOP = (28, 28, 31, 255)
BG_BOTTOM = (0, 0, 0, 255)

SIZE = 1024
SCALE = SIZE / 130.0  # el bot original se dibuja en un lienzo de 130x130 unidades, centrado


def pt(x, y):
    return (x * SCALE, y * SCALE)


def rounded_rect_mask(size, radius):
    mask = Image.new('L', (size, size), 0)
    d = ImageDraw.Draw(mask)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    return mask


def quad_bezier(p0, p1, p2, steps=24):
    pts = []
    for i in range(steps + 1):
        t = i / steps
        x = (1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * p1[0] + t ** 2 * p2[0]
        y = (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * p1[1] + t ** 2 * p2[1]
        pts.append((x, y))
    return pts


def build_icon():
    # Fondo: gradiente vertical oscuro + esquinas redondeadas, mismo
    # estilo que el icon-master.svg anterior.
    grad = Image.new('RGBA', (SIZE, SIZE))
    for y in range(SIZE):
        t = y / (SIZE - 1)
        r = round(BG_TOP[0] + (BG_BOTTOM[0] - BG_TOP[0]) * t)
        g = round(BG_TOP[1] + (BG_BOTTOM[1] - BG_TOP[1]) * t)
        b = round(BG_TOP[2] + (BG_BOTTOM[2] - BG_TOP[2]) * t)
        for x in range(0, SIZE, SIZE):  # placeholder loop kept simple below
            pass
        ImageDraw.Draw(grad).line([(0, y), (SIZE, y)], fill=(r, g, b, 255))

    mask = rounded_rect_mask(SIZE, radius=int(SIZE * 0.22))
    bg = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
    bg.paste(grad, (0, 0), mask)

    img = bg
    draw = ImageDraw.Draw(img)

    # Centrado: el bot (cabeza+antena) ocupa aprox x:[28,102] y:[2,74]
    # en el espacio original de 130 unidades — lo centramos manualmente
    # con un offset fijo en unidades originales.
    ox, oy = -65, -38  # centro del bounding box del bot
    cx, cy = SIZE / 2, SIZE / 2

    def T(x, y):
        return (cx + (x + ox) * SCALE * 0.95, cy + (y + oy) * SCALE * 0.95)

    lw = max(3, int(SIZE * 0.016))

    # Antena
    draw.line([T(65, 18), T(65, 8)], fill=BLUE, width=lw)
    tip = T(65, 6)
    r = SIZE * 0.028
    draw.ellipse([tip[0] - r, tip[1] - r, tip[0] + r, tip[1] + r], fill=RED)

    # Cabeza (rect redondeado, solo contorno)
    x0, y0 = T(28, 18)
    x1, y1 = T(102, 74)
    draw.rounded_rectangle([x0, y0, x1, y1], radius=(x1 - x0) * 0.19, outline=BLUE, width=lw + 1)

    # Visor
    vx0, vy0 = T(40, 34)
    vx1, vy1 = T(90, 50)
    draw.rounded_rectangle([vx0, vy0, vx1, vy1], radius=(vy1 - vy0) * 0.45, fill=VISOR, outline=GREEN, width=lw)

    # Ojos
    for ex in (56, 74):
        ecx, ecy = T(ex, 42)
        er = SIZE * 0.026
        draw.ellipse([ecx - er, ecy - er, ecx + er, ecy + er], fill=GREEN)

    # Sonrisa (bezier cuadrática)
    pts = quad_bezier(T(52, 60), T(65, 68), T(78, 60))
    draw.line(pts, fill=GREEN, width=lw, joint='curve')

    return img


def main():
    master = build_icon()
    master.save('public/icon-master-1024.png')

    targets = {
        'public/icon-512x512.png': 512,
        'public/icon-192x192.png': 192,
        'public/apple-touch-icon.png': 180,
        'public/favicon-32x32.png': 32,
        'public/favicon-16x16.png': 16,
    }
    for path, size in targets.items():
        im = master.resize((size, size), Image.LANCZOS)
        im.save(path)
        print('wrote', path, size)

    master.resize((256, 256), Image.LANCZOS).save(
        'public/favicon.ico', sizes=[(16, 16), (32, 32), (48, 48), (64, 64)]
    )
    print('wrote public/favicon.ico')


if __name__ == '__main__':
    main()
