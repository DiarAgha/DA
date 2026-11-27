"""Add procedural wind sway to foliage in a viewport/preview video.
usage: python3 wind_warp.py in.mp4 out.mp4 [strength=1.0]
Foliage is detected as dense small-dot texture (scattered tree proxies),
then a smooth, time-varying displacement field is applied only inside that mask."""
import sys, cv2, numpy as np
src, dst = sys.argv[1], sys.argv[2]
K = float(sys.argv[3]) if len(sys.argv) > 3 else 1.0
cap = cv2.VideoCapture(src); fps = cap.get(cv2.CAP_PROP_FPS) or 25
W, H = int(cap.get(3)), int(cap.get(4)); s = W / 1920
out = cv2.VideoWriter(dst, cv2.VideoWriter_fourcc(*'mp4v'), fps, (W, H))
rng = np.random.default_rng(7)
def field(sig):
    f = cv2.GaussianBlur(rng.standard_normal((H, W)).astype(np.float32), (0, 0), sig*s)
    return f / (f.std() + 1e-6)
# (amplitude px, temporal freq Hz, spatial scale) — slow sway + gust + leaf flutter
layers = [(7, 0.35, 180), (4, 0.8, 90), (1.8, 2.6, 25)]
fields = [(a*s*K, hz, field(sig), field(sig), field(sig)) for a, hz, sig in layers]
gx, gy = np.meshgrid(np.arange(W, dtype=np.float32), np.arange(H, dtype=np.float32))
ema = None; t = 0
while True:
    ok, im = cap.read()
    if not ok: break
    g = cv2.cvtColor(im, cv2.COLOR_BGR2GRAY).astype(np.float32)
    dog = np.abs(cv2.GaussianBlur(g, (0, 0), 1.2*s) - cv2.GaussianBlur(g, (0, 0), 3*s))
    e = (dog > 6).astype(np.uint8)
    L = int(25*s) | 1
    lines = cv2.morphologyEx(e, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (L, 1))) | \
            cv2.morphologyEx(e, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (1, L)))
    d = e & ~cv2.dilate(lines, np.ones((7, 7), np.uint8))
    hsv = cv2.cvtColor(im, cv2.COLOR_BGR2HSV)
    red = (((hsv[..., 0] < 8) | (hsv[..., 0] > 172)) & (hsv[..., 1] > 150)).astype(np.uint8)
    dens = cv2.GaussianBlur(d.astype(np.float32), (0, 0), 10*s)
    m = np.clip((dens - 0.06) / 0.12, 0, 1)
    m *= 1 - cv2.GaussianBlur(cv2.dilate(red, np.ones((9, 9), np.uint8)).astype(np.float32), (0, 0), 3)
    ema = m if ema is None else 0.6*ema + 0.4*m          # temporal smoothing, no mask flicker
    T = t / fps; dx = np.zeros((H, W), np.float32); dy = np.zeros_like(dx)
    for a, hz, ph, nx, ny in fields:
        w = np.sin(2*np.pi*hz*T + 3*ph)                   # phase varies across space -> waves travel
        dx += a * (0.8 + 0.4*nx) * w                      # mostly horizontal (wind direction)
        dy += a * 0.35 * ny * np.cos(2*np.pi*hz*1.3*T + 3*ph)
    mx, my = gx - dx*ema, gy - dy*ema
    out.write(cv2.remap(im, mx, my, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT))
    t += 1
out.release(); print('frames', t)
