"""Solve the camera motion of a reference video (static scene) with tracked features +
bundle adjustment, and export it relative to frame 0.
usage: python3 solve_camera.py video.mp4 out.json
Output: per frame, camera rotation (3x3, cam->cam0) and position (in cam0 coords,
OpenCV axes: x right, y down, z forward), plus the solved focal length in px.
Translation is up to scale: it is normalized so the median depth of tracked points
in frame 0 equals 1.0 (scale it to your scene)."""
import sys, json, cv2, numpy as np
from scipy.optimize import least_squares
from scipy.sparse import lil_matrix

cap = cv2.VideoCapture(sys.argv[1]); frames = []
while True:
    ok, f = cap.read()
    if not ok: break
    frames.append(cv2.cvtColor(f, cv2.COLOR_BGR2GRAY))
N = len(frames); H, W = frames[0].shape; cx, cy = W / 2, H / 2
print('frames', N)

# --- track features through the whole clip (forward-backward checked) ---
p0 = cv2.goodFeaturesToTrack(frames[0], 3000, 0.01, 14, blockSize=7)
tracks = [p0.reshape(-1, 2)]; alive = np.ones(len(p0), bool); cur = p0
lk = dict(winSize=(25, 25), maxLevel=4, criteria=(cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 40, 0.01))
for i in range(1, N):
    nxt, st, _ = cv2.calcOpticalFlowPyrLK(frames[i-1], frames[i], cur, None, **lk)
    back, st2, _ = cv2.calcOpticalFlowPyrLK(frames[i], frames[i-1], nxt, None, **lk)
    fb = np.linalg.norm((back - cur).reshape(-1, 2), axis=1)
    alive &= (st.ravel() == 1) & (st2.ravel() == 1) & (fb < 0.5)
    tracks.append(nxt.reshape(-1, 2)); cur = nxt
T = np.stack(tracks, 0)[:, alive]          # N x P x 2
inside = ((T[..., 0] > 5) & (T[..., 0] < W-5) & (T[..., 1] > 5) & (T[..., 1] < H-5)).all(0)
T = T[:, inside]; P = T.shape[1]; print('tracks kept', P)

def init(f):
    K = np.array([[f, 0, cx], [0, f, cy], [0, 0, 1.]])
    E, m = cv2.findEssentialMat(T[0], T[-1], K, cv2.RANSAC, 0.999, 1.0)
    _, R, t, m2 = cv2.recoverPose(E, T[0], T[-1], K, mask=m)
    X = cv2.triangulatePoints(K @ np.eye(3, 4), K @ np.hstack([R, t]), T[0].T, T[-1].T)
    X = (X[:3] / X[3]).T
    good = (m2.ravel() > 0) & (X[:, 2] > 0)
    poses = []
    for i in range(N):
        ok, rv, tv = cv2.solvePnP(X[good], T[i][good], K, None, flags=cv2.SOLVEPNP_ITERATIVE)
        poses.append(np.r_[rv.ravel(), tv.ravel()])
    return np.array(poses), X, good

def project(params, n_pts, f):
    poses = params[:N*6].reshape(N, 6); X = params[N*6:].reshape(n_pts, 3)
    out = []
    for i in range(N):
        R, _ = cv2.Rodrigues(poses[i, :3]); Xc = X @ R.T + poses[i, 3:]
        out.append(np.c_[f*Xc[:, 0]/Xc[:, 2] + cx, f*Xc[:, 1]/Xc[:, 2] + cy])
    return np.stack(out)

def ba(f, poses, X, obs):
    n = len(X)
    def res(p):
        r = project(np.r_[p[1:]], n, p[0]) - obs
        return np.r_[r.ravel(), 1e3*p[1:7]]          # pin frame 0 to identity
    A = lil_matrix((N*n*2 + 6, 1 + N*6 + n*3), dtype=int)
    for i in range(N):
        rows = np.arange(i*n*2, (i+1)*n*2)
        A[rows, 0] = 1; A[rows[:, None], 1 + i*6 + np.arange(6)] = 1
        for k in range(3):
            A[i*n*2 + np.arange(n)*2, 1 + N*6 + np.arange(n)*3 + k] = 1
            A[i*n*2 + np.arange(n)*2 + 1, 1 + N*6 + np.arange(n)*3 + k] = 1
    A[N*n*2 + np.arange(6), 1 + np.arange(6)] = 1
    r = least_squares(res, np.r_[f, poses.ravel(), X.ravel()], jac_sparsity=A, x_scale='jac',
                      loss='huber', f_scale=1.0, max_nfev=60, verbose=0)
    p = r.x; err = np.abs(project(p[1:], n, p[0]) - obs)
    return p[0], p[1:N*6+1].reshape(N, 6), p[N*6+1:].reshape(n, 3), np.median(np.linalg.norm(err, axis=2))

best = None
for fov in (30, 40, 50, 60, 70):      # coarse focal search (horizontal FOV), then BA refines f
    f = cx / np.tan(np.radians(fov/2))
    try: poses, X, good = init(f)
    except cv2.error: continue
    sel = np.where(good)[0]; sel = sel[np.linspace(0, len(sel)-1, min(400, len(sel))).astype(int)]
    fo, po, Xo, e = ba(f, poses, X[sel], T[:, sel])
    print(f'start hfov {fov}: solved hfov {2*np.degrees(np.arctan(cx/fo)):.1f}, median reproj {e:.3f}px')
    if best is None or e < best[3]: best = (fo, po, Xo, e)
f, poses, X, e = best
d0 = np.median(X[:, 2]); s = 1.0 / d0
out = {'focal_px': f, 'width': W, 'height': H, 'hfov_deg': 2*np.degrees(np.arctan(cx/f)),
       'vfov_deg': 2*np.degrees(np.arctan(cy/f)), 'median_reproj_px': e, 'frames': []}
for i in range(N):
    R, _ = cv2.Rodrigues(poses[i, :3]); t = poses[i, 3:] * s
    Rc = R.T; c = -R.T @ t                      # camera->cam0 rotation, camera center in cam0
    out['frames'].append({'R': Rc.tolist(), 'c': c.tolist()})
json.dump(out, open(sys.argv[2], 'w'), indent=1)
c = np.array([fr['c'] for fr in out['frames']])
print('solved: hfov %.1f, reproj %.3f px' % (out['hfov_deg'], e))
print('camera path (units of median scene depth) first/mid/last:', c[0].round(4), c[N//2].round(4), c[-1].round(4))
ang = [np.degrees(np.arccos(np.clip((np.trace(np.array(fr['R']))-1)/2, -1, 1))) for fr in out['frames']]
print('rotation from frame 0, deg (mid/last): %.2f %.2f' % (ang[N//2], ang[-1]))
