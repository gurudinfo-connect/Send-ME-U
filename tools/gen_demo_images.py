"""Generates the demo pictures in public/assets (illustrated avatars, channel icons, story banners).
Run: python3 tools/gen_demo_images.py     (needs Pillow). No real people or brands are depicted."""
from PIL import Image, ImageDraw, ImageFilter
import math, os, random

OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'assets')
SS = 4  # supersampling

def hexc(h): h = h.lstrip('#'); return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))
def grad(size, c1, c2):
    w, h = size; im = Image.new('RGB', size); px = im.load(); a, b = hexc(c1), hexc(c2)
    for y in range(h):
        for x in range(w):
            t = (x / w + y / h) / 2; px[x, y] = tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))
    return im
def circle_mask(im):
    m = Image.new('L', im.size, 0); ImageDraw.Draw(m).ellipse((0, 0, im.size[0] - 1, im.size[1] - 1), fill=255)
    out = im.convert('RGBA'); out.putalpha(m); return out

def person(d, cx, top, hw, skin, hair, style, shirt, beard=False, glasses=False, hair_dark=None):
    """cx = centre x, top = y of top of head, hw = head width. Draws head + neck + shoulders."""
    hh = hw * 1.2; cy = top + hh / 2; sk = hexc(skin); hr = hexc(hair); sh = hexc(shirt)
    if style in ('long', 'wavy'):
        d.rounded_rectangle((cx - hw * .66, cy - hh * .42, cx + hw * .66, cy + hh * 1.35), radius=hw * .5, fill=hr)
    if style == 'bun':
        d.ellipse((cx - hw * .26, top - hw * .34, cx + hw * .26, top + hw * .18), fill=hr)
    # shoulders
    d.ellipse((cx - hw * 1.25, top + hh * 1.12, cx + hw * 1.25, top + hh * 2.9), fill=sh)
    # neck
    d.rectangle((cx - hw * .17, cy + hh * .3, cx + hw * .17, top + hh * 1.3), fill=tuple(int(c * .93) for c in sk))
    # collar
    d.polygon([(cx - hw * .2, top + hh * 1.22), (cx, top + hh * 1.52), (cx + hw * .2, top + hh * 1.22)], fill=tuple(int(c * .88) for c in sk))
    # ears + head
    for sx in (-1, 1): d.ellipse((cx + sx * hw * .5 - hw * .07, cy - hw * .04, cx + sx * hw * .5 + hw * .07, cy + hw * .16), fill=sk)
    d.ellipse((cx - hw / 2, top, cx + hw / 2, top + hh), fill=sk)
    # front hair
    if style == 'short':
        d.pieslice((cx - hw * .56, top - hw * .1, cx + hw * .56, top + hh * .95), 180, 360, fill=hr)
        d.rectangle((cx - hw * .56, top + hh * .2, cx - hw * .46, top + hh * .5), fill=hr); d.rectangle((cx + hw * .46, top + hh * .2, cx + hw * .56, top + hh * .5), fill=hr)
    elif style == 'curly':
        r = hw * .2
        for i in range(9):
            a = math.pi + i * math.pi / 8; x = cx + math.cos(a) * hw * .46; y = top + hh * .38 + math.sin(a) * hh * .42
            d.ellipse((x - r, y - r, x + r, y + r), fill=hr)
        d.ellipse((cx - hw * .38, top - hw * .06, cx + hw * .38, top + hh * .4), fill=hr)
    elif style in ('long', 'bun', 'wavy'):
        d.pieslice((cx - hw * .54, top - hw * .06, cx + hw * .54, top + hh * 1.0), 180, 360, fill=hr)
        d.polygon([(cx - hw * .5, top + hh * .45), (cx - hw * .08, top + hh * .1), (cx + hw * .5, top + hh * .45), (cx + hw * .5, top + hh * .1), (cx - hw * .5, top + hh * .1)], fill=hr)
    elif style == 'grey':
        d.pieslice((cx - hw * .52, top - hw * .04, cx + hw * .52, top + hh * .85), 180, 360, fill=hr)
    # beard
    if beard:
        bd = hexc(hair_dark or hair)
        d.pieslice((cx - hw * .5, top + hh * .3, cx + hw * .5, top + hh * 1.05), 0, 180, fill=bd)
        d.ellipse((cx - hw * .18, top + hh * .66, cx + hw * .18, top + hh * .8), fill=sk)
    # eyes, brows, smile
    ex = hw * .17; ey = cy - hh * .02; er = hw * .04
    for sx in (-1, 1):
        d.ellipse((cx + sx * ex - er, ey - er * 1.3, cx + sx * ex + er, ey + er * 1.3), fill=(40, 30, 40))
        d.line((cx + sx * ex - hw * .08, ey - hw * .1, cx + sx * ex + hw * .08, ey - hw * .11), fill=hr, width=max(2, int(hw * .035)))
    if not beard: d.arc((cx - hw * .15, cy + hh * .1, cx + hw * .15, cy + hh * .3), 20, 160, fill=(150, 60, 70), width=max(2, int(hw * .035)))
    else: d.arc((cx - hw * .12, cy + hh * .2, cx + hw * .12, cy + hh * .34), 20, 160, fill=(235, 220, 220), width=max(2, int(hw * .03)))
    if glasses:
        w = max(2, int(hw * .03)); r = hw * .13
        for sx in (-1, 1): d.ellipse((cx + sx * ex - r, ey - r, cx + sx * ex + r, ey + r), outline=(50, 50, 70), width=w)
        d.line((cx - ex + r, ey, cx + ex - r, ey), fill=(50, 50, 70), width=w)

def avatar(name, size, bg, spec, circle=True):
    S = size * SS; im = grad((S, S), *bg); d = ImageDraw.Draw(im)
    hw = S * .36
    person(d, S / 2, S * .2, hw, **spec)
    im = im.resize((size, size), Image.LANCZOS)
    (circle_mask(im) if circle else im.convert('RGBA')).save(os.path.join(OUT, name), optimize=True)

SK = ['#f3d2b6', '#e0ac85', '#c98e63', '#a8693f', '#8a5230', '#f6dcc6']
P = lambda **k: k
AV = {
 # name: (size, bg, spec)
 'me.png':       (320, ('#6c5ce7', '#a29bfe'), P(skin=SK[1], hair='#2b2024', style='short', shirt='#3b4a6b', beard=True)),
 'priya.png':    (256, ('#ff9a8b', '#ffb88c'), P(skin=SK[1], hair='#241816', style='long', shirt='#e8537a')),
 'rahul.png':    (256, ('#4facfe', '#00c6fb'), P(skin=SK[2], hair='#1d1a1a', style='short', shirt='#2f855a', glasses=True)),
 'tl-priya.png': (200, ('#ff9a8b', '#ffb88c'), P(skin=SK[1], hair='#241816', style='long', shirt='#e8537a')),
 'tl-rahul.png': (200, ('#4facfe', '#00c6fb'), P(skin=SK[2], hair='#1d1a1a', style='short', shirt='#2f855a', glasses=True)),
 'tl-anu.png':   (200, ('#f6d365', '#fda085'), P(skin=SK[0], hair='#4a2c1a', style='bun', shirt='#6c5ce7')),
 'tl-karthik.png': (200, ('#84fab0', '#8fd3f4'), P(skin=SK[3], hair='#17120f', style='curly', shirt='#2d3748', beard=True)),
 'tl-muthu.png': (200, ('#a18cd1', '#fbc2eb'), P(skin=SK[2], hair='#201a18', style='short', shirt='#c05621')),
 'tl-neha.png':  (200, ('#fbc2eb', '#a6c1ee'), P(skin=SK[5], hair='#3b2418', style='wavy', shirt='#2b6cb0')),
 'anil.png':     (160, ('#43e97b', '#38f9d7'), P(skin=SK[2], hair='#1b1717', style='short', shirt='#975a16', glasses=True)),
 'call-a1.png':  (160, ('#fa709a', '#fee140'), P(skin=SK[0], hair='#2a1c15', style='long', shirt='#805ad5')),
 'call-a2.png':  (160, ('#30cfd0', '#667eea'), P(skin=SK[4], hair='#120f0f', style='curly', shirt='#e53e3e')),
 'call-a3.png':  (160, ('#5ee7df', '#b490ca'), P(skin=SK[1], hair='#22191a', style='short', shirt='#2c7a7b', beard=True)),
 'daddy.png':    (160, ('#c3cfe2', '#f5f7fa'), P(skin=SK[2], hair='#c9c9d1', style='grey', shirt='#2b6cb0', glasses=True, beard=True, hair_dark='#b8b8c2')),
 'hr.png':       (160, ('#ffecd2', '#fcb69f'), P(skin=SK[0], hair='#4a2e22', style='long', shirt='#d69e2e')),
 'venky.png':    (160, ('#667eea', '#764ba2'), P(skin=SK[3], hair='#16120f', style='short', shirt='#dd6b20')),
 'st-singer.png':(200, ('#f093fb', '#f5576c'), P(skin=SK[2], hair='#1e1514', style='curly', shirt='#1a202c', beard=True)),
 'st-vinay.png': (200, ('#4facfe', '#a18cd1'), P(skin=SK[1], hair='#241c1a', style='short', shirt='#38a169')),
 'st-chenna.png':(200, ('#fdcbf1', '#e6dee9'), P(skin=SK[3], hair='#1b1514', style='short', shirt='#3182ce', glasses=True)),
 'st-muthu.png': (200, ('#a18cd1', '#fbc2eb'), P(skin=SK[2], hair='#201a18', style='short', shirt='#c05621')),
 'st-karthik.png':(200, ('#84fab0', '#8fd3f4'), P(skin=SK[3], hair='#17120f', style='curly', shirt='#2d3748', beard=True)),
}
for n, (sz, bg, spec) in AV.items(): avatar(n, sz, bg, spec)

# group picture
S = 256 * SS; im = grad((S, S), '#ffd6a5', '#cdb4db'); d = ImageDraw.Draw(im)
person(d, S * .24, S * .36, S * .24, skin=SK[0], hair='#3a2a20', style='wavy', shirt='#e8537a')
person(d, S * .76, S * .36, S * .24, skin=SK[3], hair='#17120f', style='short', shirt='#2f855a')
person(d, S * .5, S * .24, S * .3, skin=SK[1], hair='#241816', style='short', shirt='#6c5ce7', glasses=True)
circle_mask(im.resize((256, 256), Image.LANCZOS)).save(os.path.join(OUT, 'friends.png'), optimize=True)

# channel icons (generic glyphs on colour tiles)
def tile(name, bg, glyph):
    S = 160 * SS; im = grad((S, S), *bg); d = ImageDraw.Draw(im); W = (255, 255, 255)
    c = S / 2
    if glyph == 'briefcase':
        d.rounded_rectangle((c - S*.26, c - S*.14, c + S*.26, c + S*.2), radius=S*.05, fill=W); d.rounded_rectangle((c - S*.1, c - S*.24, c + S*.1, c - S*.12), radius=S*.03, outline=W, width=int(S*.035)); d.rectangle((c - S*.26, c + S*.02, c + S*.26, c + S*.05), fill=hexc(bg[0]))
    elif glyph == 'search':
        d.ellipse((c - S*.22, c - S*.24, c + S*.12, c + S*.1), outline=W, width=int(S*.06)); d.line((c + S*.08, c + S*.06, c + S*.26, c + S*.26), fill=W, width=int(S*.07))
    elif glyph == 'people':
        for dx, r in ((-.14, .1), (.14, .1)): d.ellipse((c + S*dx - S*r, c - S*.2, c + S*dx + S*r, c)), 
        for dx in (-.14, .14): d.ellipse((c + S*dx - S*.1, c - S*.2, c + S*dx + S*.1, c), fill=W); d.pieslice((c + S*dx - S*.17, c + S*.02, c + S*dx + S*.17, c + S*.34), 180, 360, fill=W)
    elif glyph == 'smile':
        d.ellipse((c - S*.26, c - S*.26, c + S*.26, c + S*.26), outline=W, width=int(S*.05))
        for dx in (-.09, .09): d.ellipse((c + S*dx - S*.025, c - S*.1, c + S*dx + S*.025, c - S*.03), fill=W)
        d.arc((c - S*.14, c - S*.06, c + S*.14, c + S*.16), 20, 160, fill=W, width=int(S*.045))
    elif glyph == 'plane':
        d.polygon([(c - S*.26, c - S*.04), (c + S*.28, c - S*.22), (c + S*.1, c + S*.26), (c + S*.02, c + S*.06)], fill=W)
    elif glyph == 'compass':
        d.ellipse((c - S*.26, c - S*.26, c + S*.26, c + S*.26), outline=W, width=int(S*.05)); d.polygon([(c - S*.1, c + S*.1), (c + S*.14, c - S*.14), (c + S*.04, c + S*.04)], fill=W)
    elif glyph == 'bulb':
        d.ellipse((c - S*.2, c - S*.26, c + S*.2, c + S*.14), fill=W); d.rectangle((c - S*.1, c + S*.12, c + S*.1, c + S*.24), fill=W)
    circle_mask(im.resize((160, 160), Image.LANCZOS)).save(os.path.join(OUT, name), optimize=True)
tile('ch-freshers.png', ('#667eea', '#764ba2'), 'briefcase'); tile('ch-google.png', ('#00c6fb', '#005bea'), 'search')
tile('ch-hire.png', ('#f6d365', '#fda085'), 'people'); tile('ch-nooneCares.png', ('#fbc2eb', '#a18cd1'), 'smile'); tile('ch-nxt.png', ('#43e97b', '#38f9d7'), 'plane')

# story banners (blurred colour scenes) and my-story cover
def scene(name, size, c1, c2, c3, jpg=True):
    w, h = size; S = (w * 2, h * 2); im = grad(S, c1, c2); d = ImageDraw.Draw(im)
    random.seed(name)
    d.ellipse((S[0] * .62, S[1] * .12, S[0] * .62 + S[1] * .5, S[1] * .12 + S[1] * .5), fill=hexc(c3))
    for k, col in enumerate(((0, 0, 0, 60), (0, 0, 0, 90))):
        pts = [(0, S[1])] + [(x, S[1] * (.62 + .1 * k) - random.random() * S[1] * .22) for x in range(0, S[0] + 1, max(8, S[0] // 8))] + [(S[0], S[1])]
        ov = Image.new('RGBA', S, (0, 0, 0, 0)); ImageDraw.Draw(ov).polygon(pts, fill=col); im = Image.alpha_composite(im.convert('RGBA'), ov); d = ImageDraw.Draw(im)
    im = im.convert('RGB').resize(size, Image.LANCZOS).filter(ImageFilter.GaussianBlur(1.2))
    im.save(os.path.join(OUT, name), quality=88, optimize=True)
scene('mystory.jpg', (610, 322), '#6c5ce7', '#fd79a8', '#ffeaa7')
for n, cs in {'stbg-singer.jpg': ('#f093fb', '#f5576c', '#ffe29f'), 'stbg-vinay.jpg': ('#4facfe', '#00f2fe', '#ffffff'), 'stbg-chenna.jpg': ('#a18cd1', '#fbc2eb', '#fff1eb'), 'stbg-muthu.jpg': ('#fa709a', '#fee140', '#ffffff'), 'stbg-karthik.jpg': ('#43e97b', '#38f9d7', '#ffffff')}.items():
    scene(n, (280, 92), *cs)
print('ok')
