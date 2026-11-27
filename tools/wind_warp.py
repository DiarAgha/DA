"""Add leaf-like wind motion to foliage in a viewport/preview video.
usage: python3 wind_warp.py in.mp4 out.mp4 [strength=1.0]

1. Foliage = areas dense in small dot texture (scattered tree proxies).
2. Leaf dots are lifted onto their own layer; the holes are inpainted so the
   building/terrain behind them stays perfectly still.
3. The leaf layer is displaced by: canopy sway (grows with height above the
   bottom of each foliage mass, so trunks stay anchored), gusts, and fast
   per-leaf flutter with randomized phase, plus a light/dark shimmer.
4. Wind/phase fields are pinned to the scene with a tracked camera homography,
   so they don't swim or jitter as the camera moves."""
import sys, cv2, numpy as np
src, dst = sys.argv[1], sys.argv[2]
K = float(sys.argv[3]) if len(sys.argv) > 3 else 1.0
cap = cv2.VideoCapture(src); fps = cap.get(cv2.CAP_PROP_FPS) or 25
W, H = int(cap.get(3)), int(cap.get(4)); s = W / 1920
out = cv2.VideoWriter(dst, cv2.VideoWriter_fourcc(*'mp4v'), fps, (W, H))
rng = np.random.default_rng(7)
def noise(sig):
    f = cv2.GaussianBlur(rng.standard_normal((H, W)).astype(np.float32), (0, 0), max(sig*s, .5))
    return f / (f.std() + 1e-6)
F = {'swx': noise(160), 'swy': noise(160), 'gst': noise(70),
     'ph': noise(12) * 2, 'ph2': noise(12) * 2, 'fx': noise(14), 'fy': noise(14),
     'w0': noise(20), 'w1': noise(20), 'w2': noise(20)}
gx, gy = np.meshgrid(np.arange(W, dtype=np.float32), np.arange(H, dtype=np.float32))

def foliage_mask(im):
    g = cv2.cvtColor(im, cv2.COLOR_BGR2GRAY).astype(np.float32)
    dog = np.abs(cv2.GaussianBlur(g, (0, 0), 1.2*s) - cv2.GaussianBlur(g, (0, 0), 3*s))
    e = (dog > 6).astype(np.uint8); L = int(25*s) | 1
    lines = cv2.morphologyEx(e, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (L, 1))) | \
            cv2.morphologyEx(e, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (1, L)))
    d = e & ~cv2.dilate(lines, np.ones((7, 7), np.uint8))
    hsv = cv2.cvtColor(im, cv2.COLOR_BGR2HSV)
    red = (((hsv[..., 0] < 8) | (hsv[..., 0] > 172)) & (hsv[..., 1] > 150)).astype(np.uint8)
    m = np.clip((cv2.GaussianBlur(d.astype(np.float32), (0, 0), 10*s) - .06) / .12, 0, 1)
    m *= 1 - cv2.GaussianBlur(cv2.dilate(red, np.ones((9, 9), np.uint8)).astype(np.float32), (0, 0), 3)
    return m, dog

def height_weight(m):
    """0 at the bottom edge of each foliage mass, rising to 1 ~220px above it."""
    b = (m > .3); h = np.zeros((H, W), np.float32); run = np.zeros(W, np.float32)
    for y in range(H - 1, -1, -1):
        run = np.where(b[y], run + 1, 0); h[y] = run
    return cv2.GaussianBlur(np.clip(h / (220*s), 0, 1)**.8, (0, 0), 8*s)

Hcum = np.eye(3); prev_small = None; ema = None; t = 0
while True:
    ok, im = cap.read()
    if not ok: break
    gray = cv2.cvtColor(im, cv2.COLOR_BGR2GRAY)
    if prev_small is not None:   # global camera motion t -> t-1 (homography), chained to frame 0
        p0 = cv2.goodFeaturesToTrack(gray, 1500, .01, 12)
        p1, st, _ = cv2.calcOpticalFlowPyrLK(gray, prev_small, p0, None, winSize=(31, 31), maxLevel=4)
        ok_ = st.ravel() == 1
        Hm, _ = cv2.findHomography(p0[ok_], p1[ok_], cv2.RANSAC, 2.0)
        if Hm is not None: Hcum = Hcum @ Hm
    prev_small = gray
    Fw = {k: cv2.warpPerspective(v, Hcum, (W, H), flags=cv2.INTER_LINEAR | cv2.WARP_INVERSE_MAP,
                                 borderMode=cv2.BORDER_REFLECT) for k, v in F.items()}
    m, dog = foliage_mask(im)
    ema = m if ema is None else .6*ema + .4*m
    # leaf layer: dot pixels inside foliage
    leaf = ((dog > 4) & (ema > .25)).astype(np.uint8)
    leaf = cv2.dilate(leaf, np.ones((3, 3), np.uint8))
    a = cv2.GaussianBlur(leaf.astype(np.float32), (0, 0), .7) * np.clip(ema*1.5, 0, 1)
    # still background behind the leaves (inpaint at half res, upsample)
    hm = cv2.resize(cv2.dilate(leaf, np.ones((3, 3), np.uint8))*255, (W//2, H//2), interpolation=cv2.INTER_NEAREST)
    bg = cv2.resize(cv2.inpaint(cv2.resize(im, (W//2, H//2)), hm, 3, cv2.INPAINT_TELEA), (W, H))
    bg = np.where(leaf[..., None] > 0, bg, im)
    T = t / fps; hw = height_weight(ema)
    # flutter: a few FIXED frequencies blended by smooth weights. (A per-pixel
    # frequency makes neighbours drift out of phase over time -> swirl artifacts.)
    wts = np.stack([np.exp(1.5*Fw['w0']), np.exp(1.5*Fw['w1']), np.exp(1.5*Fw['w2'])]); wts /= wts.sum(0)
    def flut(ph, k=1.0):
        return sum(wts[i]*np.sin(2*np.pi*f*k*T + ph + i*2.1) for i, f in enumerate((1.6, 2.5, 3.4)))
    sway = np.sin(2*np.pi*.33*T + Fw['swx']) + .5*np.sin(2*np.pi*.71*T + 2*Fw['gst'])
    gust = .5 + .5*np.sin(2*np.pi*.18*T)                              # wind rises and falls
    dx = K*s*(6*hw*sway*(.8+.4*gust) + 2.4*(.6+.4*hw)*flut(Fw['ph'])*(.5+.5*gust) + .7*Fw['fx']*flut(Fw['ph2'], 1.4))
    dy = K*s*(1.8*hw*np.cos(2*np.pi*.4*T + Fw['swy']) + 1.5*(.6+.4*hw)*flut(Fw['ph2'], 1.2) + .5*Fw['fy']*flut(Fw['ph'], 1.5))
    mx, my = (gx - dx).astype(np.float32), (gy - dy).astype(np.float32)
    lw = cv2.remap(im, mx, my, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT).astype(np.float32)
    aw = cv2.remap(a, mx, my, cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT)[..., None]
    shim = 1 + K*.16*flut(2*Fw['ph2'], 1.7)[..., None]  # leaves catching light
    lw = np.clip(lw * shim, 0, 255)
    res = bg.astype(np.float32)*(1 - aw) + lw*aw
    out.write(res.astype(np.uint8)); t += 1
    if t % 20 == 0: print('frame', t, flush=True)
out.release(); print('frames', t)
