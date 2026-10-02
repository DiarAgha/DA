# Steal Like an Artist — 15s motion reel (1080×1920)

Vertical Instagram Reel made entirely in code: a canvas animation (`reel.html`) rendered frame-by-frame
with headless Chromium, a dependency-free synthesised soundtrack (`audio.mjs`), and ffmpeg for the encode.

    node audio.mjs                                   # -> out/audio.wav
    node render.mjs --name "Your Name" --handle "@you"   # -> out/steal-like-an-artist-reel.mp4
    node render.mjs --stills 0,45,150                # preview single frames

Text is limited to short chapter titles and a one-line quote from *Steal Like an Artist* by Austin Kleon (credited in the video).
Fonts: Anton, Instrument Serif, Space Grotesk (all SIL OFL).

## Voice-over
`vo.py` synthesises the narration offline with Kokoro TTS, ducks the music under it and muxes the result onto the
rendered video -> `out/steal-like-an-artist-reel-vo.mp4`. Change the lines/timings in `LINES`, or try `--voice bm_george --speed 1.0`.
