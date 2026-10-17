import json, subprocess, sys
D = sys.argv[1]; VIDEO = sys.argv[2]; OUT = sys.argv[3]
# Video section starts (from the recording log) and the voiceover cut points (pause before each block).
sections = [0.0, 10.1, 22.5, 45.1, 70.3, 93.9, 126.1, 150.3, 164.2, 179.4, 209.3]
cuts = [0.0, 11.50, 26.41, 49.31, 66.56, 92.95, 117.03, 133.64, 142.23, 151.73, 171.58]
names = ["Intro", "Overview", "Class timetable", "Faculty/room/all", "Optimization Lab", "Live run",
         "After optimization", "Conflicts", "Resources", "Admin setup", "Import/publish/close"]
def dur(p):
    return float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", p]).decode())
vo, total = f"{D}/vo.mp3", dur(VIDEO)
vo_end = dur(vo)
inputs, filters, prev_end = [], [], 0.0
for i in range(len(cuts)):
    a, b = cuts[i], (cuts[i + 1] if i + 1 < len(cuts) else vo_end)
    length = b - a
    start = max(sections[i] + (0.25 if i else 0.3), prev_end + 0.35)
    limit = (sections[i + 1] if i + 1 < len(sections) else total - 1.0) - 0.3
    tempo = min(1.12, max(1.0, length / max(1.0, limit - start)))
    out_len = length / tempo
    prev_end = start + out_len
    seg = f"{D}/b{i}.wav"
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-ss", f"{a:.3f}", "-to", f"{b:.3f}", "-i", vo,
                    "-af", f"atempo={tempo:.4f},afade=t=in:d=0.02,areverse,afade=t=in:d=0.04,areverse,aresample=48000",
                    "-ac", "1", seg], check=True)
    lag = start - sections[i]
    print(f"{i+1:2d} {names[i]:22s} voice {a:6.1f}-{b:6.1f}s ({length:4.1f}s)  → video {start:6.1f}-{prev_end:6.1f}s  "
          f"tempo {tempo:.2f}  starts {lag:+.1f}s vs scene{'  (spills %.1fs)' % (prev_end - limit) if prev_end > limit + 0.05 else ''}")
    inputs += ["-i", seg]
    ms = int(start * 1000)
    filters.append(f"[{i}:a]adelay={ms}|{ms}[a{i}]")
mix = "".join(f"[a{i}]" for i in range(len(cuts)))
fc = ";".join(filters) + f";{mix}amix=inputs={len(cuts)}:normalize=0,apad,atrim=0:{total:.3f},highpass=f=60,loudnorm=I=-16:TP=-1.5:LRA=9[aout]"
subprocess.run(["ffmpeg", "-loglevel", "error", "-y", *inputs, "-filter_complex", fc, "-map", "[aout]", "-ar", "48000", "-ac", "2",
                f"{D}/voiceover_track.wav"], check=True)
subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", VIDEO, "-i", f"{D}/voiceover_track.wav", "-map", "0:v:0", "-map", "1:a:0",
                "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "-shortest", OUT], check=True)
print("done", OUT, f"{dur(OUT):.1f}s")
