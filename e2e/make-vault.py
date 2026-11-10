"""Build the test vault: three real-speech recordings (one per LibriSpeech chapter) with known utterance offsets."""
import json, subprocess, os, collections
meta = json.load(open("spike/data/libri/meta.json"))
by = collections.OrderedDict()
for m in meta: by.setdefault(m["chapter"], []).append(m)
fmt = {0: ("m4a", ["-c:a", "aac", "-b:a", "64k"]), 1: ("mp3", ["-c:a", "libmp3lame", "-b:a", "64k"]),
       2: ("webm", ["-c:a", "libopus", "-b:a", "32k", "-f", "webm", "-live", "1"])}  # live webm: no cues/duration, like a MediaRecorder file
truth = {}
for i, (ch, utts) in enumerate(by.items()):
    lst = f"/tmp/muninn-{ch}.txt"
    t = 0.0
    with open(lst, "w") as f:
        for u in utts:
            p = os.path.abspath(f"spike/data/libri/{u['id']}.flac")
            d = float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", p]))
            f.write(f"file '{p}'\n")
            truth[u["id"]] = {"start": round(t, 2), "end": round(t + d, 2)}
            t += d
    ext, codec = fmt[i]
    out = f"test-vault/Recordings/chapter-{ch}.{ext}"
    subprocess.check_call(["ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", lst, *codec, out])
    for u in utts: truth[u["id"]]["path"] = f"Recordings/chapter-{ch}.{ext}"
    print(out, round(t, 1), "s")
json.dump(truth, open("e2e/truth.json", "w"), indent=1)
