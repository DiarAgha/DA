"""Reel #2 — the ten lessons. Plans the timeline from the narration, then (stage 2) mixes VO + music + SFX.

  stage 1:  python3 vo2.py plan     -> out/vo2.wav, out/timeline.json   (scene lengths are fitted to the voice)
  stage 2:  python3 vo2.py mix      -> out/ten-lessons-reel.mp4          (needs out/video2-silent.mp4, out/music2.wav, out/sfx2.wav)

Voice: Kokoro TTS (Apache-2.0, offline).  KOKORO_DIR must hold kokoro-v1.0.int8.onnx + voices-v1.0.bin
(https://github.com/thewh1teagle/kokoro-onnx/releases/tag/model-files-v1.0).
"""
import json, os, subprocess, sys
import numpy as np
import soundfile as sf

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out")
SR, TOTAL, SNAP = 44100, 15.0, 0.25
VOICE = os.environ.get("VOICE", "am_michael")

# narration, one line per scene.  (The two parentheticals are on-screen only.)
LINES = [
    "Steal like an artist.",
    "Don't wait until you know who you are, to get started.",
    "Write the book you want to read.",
    "Use your hands.",
    "Side projects and hobbies are important.",
    "The secret: do good work, and share it with people.",
    "Geography is no longer our master.",
    "Be nice.",
    "Be boring.",
    "Creativity is subtraction.",
]
WEIGHT = [1.5, 2, 1.5, 1, 1.6, 2, 2, 1, 1, 2.5]  # how much of the leftover time each scene gets
LEAD, TAIL = 0.07, 0.17                           # voice starts just after the cut, leaves a gap before the next
MIN_LEN = [1.0] * 10


def synth(k, speed):
    clips = []
    for text in LINES:
        s, sr = k.create(text, voice=VOICE, speed=speed, lang="en-us")
        s = np.asarray(s, dtype=np.float32)
        idx = np.where(np.abs(s) > 0.012)[0]
        s = s[idx[0]:idx[-1] + 1]
        if sr != SR:
            x = np.linspace(0, len(s) - 1, int(len(s) * SR / sr)); s = np.interp(x, np.arange(len(s)), s).astype(np.float32)
        f = int(.005 * SR); s[:f] *= np.linspace(0, 1, f); s[-f:] *= np.linspace(1, 0, f)
        clips.append(s)
    return clips


def plan_starts(durs):
    need = [max(MIN_LEN[i], durs[i] + LEAD + TAIL) for i in range(len(durs))]
    slack = TOTAL - sum(need)
    if slack < 0:
        return None
    raw = [need[i] + slack * WEIGHT[i] / sum(WEIGHT) for i in range(len(durs))]
    starts, acc = [], 0.0
    for i, r in enumerate(raw):
        starts.append(round(acc / SNAP) * SNAP); acc += r
    starts[0] = 0.0
    for i in range(1, len(starts)):  # make sure every scene is long enough for its line after snapping
        starts[i] = max(starts[i], starts[i - 1] + np.ceil(need[i - 1] / SNAP) * SNAP)
    if starts[-1] + need[-1] > TOTAL + 1e-6:
        return None
    return starts


def plan():
    from kokoro_onnx import Kokoro
    d = os.environ["KOKORO_DIR"]
    k = Kokoro(os.path.join(d, "kokoro-v1.0.int8.onnx"), os.path.join(d, "voices-v1.0.bin"))
    speed = 1.2
    while True:
        clips = synth(k, speed)
        durs = [len(c) / SR for c in clips]
        starts = plan_starts(durs)
        if starts:
            break
        speed += 0.03
        if speed > 1.7:
            sys.exit("cannot fit the narration — shorten LINES")
    ends = starts[1:] + [TOTAL]
    vo = np.zeros(int(TOTAL * SR) + SR, dtype=np.float32)
    scenes, voice = [], []
    for i, c in enumerate(clips):
        t0 = starts[i] + (0.02 if i == 0 else LEAD)
        s = int(t0 * SR); vo[s:s + len(c)] += c
        scenes.append({"start": starts[i], "len": round(ends[i] - starts[i], 3)})
        voice.append({"start": round(t0, 3), "dur": round(len(c) / SR, 3), "text": LINES[i]})
        print(f"{i + 1:2d}  scene {starts[i]:5.2f}s +{ends[i] - starts[i]:4.2f}s   vo {t0:5.2f}s +{len(c) / SR:4.2f}s  {LINES[i]}")
    print(f"voice speed {speed:.2f}")
    sf.write(os.path.join(OUT, "vo2.wav"), vo[:int(TOTAL * SR)], SR)
    json.dump({"scenes": scenes, "voice": voice, "speed": round(speed, 2)}, open(os.path.join(OUT, "timeline.json"), "w"), indent=1)


def mix():
    p = lambda n: os.path.join(OUT, n)
    fc = (
        "[1:a]highpass=f=90,equalizer=f=3200:t=q:w=1:g=3,acompressor=threshold=-20dB:ratio=3:attack=4:release=60,asplit=3[vo][sc1][sc2];"
        "[2:a]volume=0.8[m0];[m0][sc1]sidechaincompress=threshold=0.02:ratio=7:attack=6:release=200[m];"
        "[3:a]volume=1.0[s0];[s0][sc2]sidechaincompress=threshold=0.03:ratio=2.2:attack=5:release=150[s];"
        "[vo][m][s]amix=inputs=3:normalize=0:duration=first,alimiter=limit=0.89,loudnorm=I=-14:TP=-1.5:LRA=9[a]"
    )
    dest = p("ten-lessons-reel.mp4")
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", p("video2-silent.mp4"), "-i", p("vo2.wav"), "-i", p("music2.wav"), "-i", p("sfx2.wav"),
                    "-filter_complex", fc, "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "256k", "-ar", "44100", "-t", "15",
                    "-movflags", "+faststart", dest], check=True)
    print("wrote", dest)


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    {"plan": plan, "mix": mix}[sys.argv[1] if len(sys.argv) > 1 else "plan"]()
