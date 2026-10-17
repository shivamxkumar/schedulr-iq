import json, subprocess, sys
W = sys.argv[1]; VOICE = sys.argv[2]; VIDEO = sys.argv[3]; OUT = sys.argv[4]
segs = json.load(open(f"{W}/narration.json"))
def dur(p):
    return float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", p]).decode())
inputs, filters = [], []
for i, (start, end, text) in enumerate(segs):
    raw = f"{W}/s{i}.aiff"
    subprocess.run(["say", "-v", VOICE, "-r", "172", "-o", raw, text], check=True)
    d = dur(raw); window = end - start - 0.35
    tempo = max(1.0, d / window)
    if tempo > 1.3:
        print(f"WARNING seg {i}: needs tempo {tempo:.2f}", file=sys.stderr)
    tempo = min(tempo, 1.3)
    wav = f"{W}/s{i}.wav"
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", raw, "-af", f"atempo={tempo:.4f},aresample=48000",
                    "-ac", "1", wav], check=True)
    print(f"seg {i:2d} @{start:6.1f}s  speech {d:5.1f}s  window {window:5.1f}s  tempo {tempo:.2f}  → {dur(wav):5.1f}s")
    inputs += ["-i", wav]
    ms = int(start * 1000)
    filters.append(f"[{i}:a]adelay={ms}|{ms}[a{i}]")
total = dur(VIDEO)
mix = "".join(f"[a{i}]" for i in range(len(segs)))
fc = ";".join(filters) + f";{mix}amix=inputs={len(segs)}:normalize=0,apad,atrim=0:{total:.3f}," \
     "highpass=f=70,acompressor=threshold=-18dB:ratio=2.5:attack=5:release=120,loudnorm=I=-16:TP=-1.5:LRA=7[aout]"
subprocess.run(["ffmpeg", "-loglevel", "error", "-y", *inputs, "-filter_complex", fc, "-map", "[aout]",
                "-ar", "48000", "-ac", "2", f"{W}/narration.wav"], check=True)
subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", VIDEO, "-i", f"{W}/narration.wav", "-map", "0:v:0", "-map", "1:a:0",
                "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "-shortest", OUT], check=True)
print("done", OUT, f"{dur(OUT):.1f}s")
