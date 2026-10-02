"""Generates the voice-over (Kokoro TTS, Apache-2.0, runs offline), ducks the music under it,
and muxes the result onto the already-rendered video.

    pip install kokoro-onnx soundfile
    # model files: kokoro-v1.0.int8.onnx + voices-v1.0.bin from
    # https://github.com/thewh1teagle/kokoro-onnx/releases/tag/model-files-v1.0
    KOKORO_DIR=/path/to/model python3 vo.py [--voice am_michael] [--speed 1.08]

Needs out/audio.wav (node audio.mjs) and out/video-silent.mp4 or out/steal-like-an-artist-reel.mp4.
"""
import argparse, os, subprocess, sys
import numpy as np
import soundfile as sf
from kokoro_onnx import Kokoro

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out")
SR = 44100

ap = argparse.ArgumentParser()
ap.add_argument("--voice", default="am_michael")
ap.add_argument("--speed", type=float, default=1.08)
ap.add_argument("--vo-gain", type=float, default=1.0)
args = ap.parse_args()

# (start time in seconds, text, latest allowed end) — lines land on the beat of each scene
LINES = [
    (0.10, "Good artists copy.",                     1.45),
    (1.50, "Great artists steal.",                   3.00),
    (3.12, "Don't wait until you know who you are.", 5.00),
    (5.12, "Write the book you want to read.",       7.00),
    (7.15, "Use your hands.",                        9.00),
    (9.12, "Do good work. Share it.",                11.00),
    (11.12, "Creativity is subtraction.",            13.00),
    (13.28, "Steal like a motion designer.",         15.00),
]

kdir = os.environ.get("KOKORO_DIR", os.path.join(HERE, "model"))
k = Kokoro(os.path.join(kdir, "kokoro-v1.0.int8.onnx"), os.path.join(kdir, "voices-v1.0.bin"))

vo = np.zeros(int(15 * SR), dtype=np.float32)
os.makedirs(os.path.join(OUT, "vo"), exist_ok=True)
for i, (t0, text, tmax) in enumerate(LINES):
    # speed up per-line if it would run past its slot
    speed = args.speed
    for _ in range(4):
        samples, sr = k.create(text, voice=args.voice, speed=speed, lang="en-us")
        samples = np.asarray(samples, dtype=np.float32)
        # trim leading/trailing silence
        idx = np.where(np.abs(samples) > 0.01)[0]
        samples = samples[idx[0]:idx[-1] + 1]
        dur = len(samples) / sr
        if t0 + dur <= tmax - 0.05:
            break
        speed *= 1.08
    print(f"{t0:5.2f}s  +{dur:4.2f}s  speed {speed:.2f}  {text}")
    if sr != SR:  # resample (linear) to the mix rate
        x = np.linspace(0, len(samples) - 1, int(len(samples) * SR / sr))
        samples = np.interp(x, np.arange(len(samples)), samples).astype(np.float32)
    fade = int(.006 * SR); samples[:fade] *= np.linspace(0, 1, fade); samples[-fade:] *= np.linspace(1, 0, fade)
    s = int(t0 * SR); e = min(len(vo), s + len(samples)); vo[s:e] += samples[:e - s]
sf.write(os.path.join(OUT, "vo.wav"), vo, SR)

# ---- mix: voice presence EQ + compression, music ducked by the voice, then loudness-normalise ----
video = os.path.join(OUT, "video-silent.mp4")
if not os.path.exists(video):
    src = os.path.join(OUT, "steal-like-an-artist-reel.mp4")
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", src, "-an", "-c:v", "copy", video], check=True)

fc = (
    f"[1:a]highpass=f=90,equalizer=f=3500:t=q:w=1:g=3,acompressor=threshold=-20dB:ratio=3:attack=5:release=80,"
    f"volume={args.vo_gain},asplit=2[vo][vosc];"
    "[2:a]volume=0.9[mus0];"
    "[mus0][vosc]sidechaincompress=threshold=0.02:ratio=6:attack=8:release=250:makeup=1[mus];"
    "[mus][vo]amix=inputs=2:normalize=0:duration=first,loudnorm=I=-14:TP=-1.5:LRA=9[a]"
)
final = os.path.join(OUT, "steal-like-an-artist-reel-vo.mp4")
subprocess.run([
    "ffmpeg", "-y", "-loglevel", "error", "-i", video, "-i", os.path.join(OUT, "vo.wav"), "-i", os.path.join(OUT, "audio.wav"),
    "-filter_complex", fc, "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "256k", "-ar", "44100",
    "-t", "15", "-movflags", "+faststart", final,
], check=True)
print("wrote", final)
