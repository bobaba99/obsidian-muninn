"""Build one 2-hour, 40-speaker recording (stereo 48 kHz AAC, like a meeting export) with the 73 query targets at known offsets."""
import json, os, random, subprocess, glob, sys
root = "spike/data/LibriSpeech/dev-clean"
targets = {m["id"] for m in json.load(open("spike/data/libri/meta.json"))}
allf = sorted(glob.glob(f"{root}/*/*/*.flac"))
ids = {os.path.basename(f)[:-5]: f for f in allf}
rng = random.Random(7)
others = [i for i in ids if i not in targets]; rng.shuffle(others)
def dur(p): return float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", p]))
TARGET = float(sys.argv[1]) if len(sys.argv) > 1 else 7200
chosen, total = [], 0.0
for i in sorted(targets): d = dur(ids[i]); chosen.append((i, d)); total += d
for i in others:
    if total >= TARGET: break
    d = dur(ids[i]); chosen.append((i, d)); total += d
rng.shuffle(chosen)
truth, t = {}, 0.0
out = "Recordings/long-meeting.m4a"
with open("/tmp/muninn-long.txt", "w") as f:
    for i, d in chosen:
        f.write(f"file '{os.path.abspath(ids[i])}'\n")
        if i in targets: truth[i] = {"start": round(t, 2), "end": round(t + d, 2), "path": out}
        t += d
os.makedirs("test-vault/Recordings", exist_ok=True)
subprocess.check_call(["ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", "/tmp/muninn-long.txt", "-ac", "2", "-ar", "48000", "-c:a", "aac", "-b:a", "96k", f"test-vault/{out}"])
json.dump(truth, open("e2e/truth-long.json", "w"), indent=1)
print(out, round(t), "s", len(chosen), "utterances", os.path.getsize(f"test-vault/{out}") // 2**20, "MiB")
