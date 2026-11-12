# Handoff: testing what is left

Written at the end of a long build-and-fix session. Read CLAUDE.md first, then this.
Your job is to **test and report, not to change app code.**

## State of the repo

| Branch | What it is |
|---|---|
| `main` | The owner's code. As it stands, a release build crashes at startup (op-sqlite 11.4.9 on React Native 0.83). |
| `claude/happy-bardeen-j5epwv` | `main` + build fixes. |
| `improve/low-end-phones` | The fix branch + improvements. **Test this branch.** |

Nothing is merged. Do not push to `main` or merge.

What the improvements branch changes: op-sqlite 14.0.4; sherpa-onnx 1.13.4 with onnxruntime-android 1.27.0
(one `libonnxruntime.so` for both); release APK 868 MB -> 394 MB (only the Whisper files the app loads, ARM only,
unused sherpa libraries dropped); the speech model loads on the first mic tap, not at start; no crash when the phone
has no "All files access" screen; photo dates count calendar days.

## Already seen working (Android 11 emulator, x86_64, software only)

Launch, welcome, photo permission dialog, "getting photos ready", Home, Photos, Papers and Settings in English and
Hindi, the helper sheet (voice + photo search "Ready"), word search ("bill" found the electricity-bill screenshot),
photo viewer, 5 photos indexed with CLIP vectors, the charging-time background job starting by itself and pausing for
a user-started PDF scan, first mic tap ("Getting voice search ready…", model loads, no crash). No crash in the final build.

## Not tested yet: this is your list

Report each as PASS / FAIL / NOT TESTED with what you saw and the logcat lines.

1. **Indexing to the end.** All 13 photos and 4 PDFs finish. Note counts on Home and Papers, and any `failed` rows.
2. **Search by meaning.** Queries `cat`, `coffee`, `rocket`, `astronaut`. Expect the matching photo and a
   `Hybrid Search for ...` line in logcat. Never seen so far.
3. **Hinglish.** `bijli`, `dawai`, `ration` should find the Hindi photos; `aadhaar` the ID card.
4. **Typed Hindi** (`बिजली`, `दवाई`). `adb shell input text` cannot type Devanagari; if you find no way, say NOT TESTED.
5. **Collections on Home** (ID cards, Bills…) and the filter chips in search (All / Photos / Documents).
6. **Papers.** The 4 PDFs appear with sensible titles; the scanned one is read by OCR; the Hindi one is findable; opening one does not crash.
7. **Masking.** `adb root`, pull the database (look under `/data/data/com.pinpointer.app/`, file `pinpoint.db`),
   then `sqlite3 pinpoint.db "select title, content from document_index"`. The fake ID card has Aadhaar
   `2345 6789 0123`, PAN `ABCDE1234F`, phone `9876543210`: **none of these may appear unmasked**, in content or title.
8. **Scan tab** ("read text from a photo"): pick a photo, see the result. The image may lack a photo picker; report what happens.
9. **Background job.** `adb shell cmd jobscheduler run -f com.pinpointer.app 4711`; expect `[BackgroundIndexing]` lines, no crash.
10. **"Allow PDFs" without a Settings screen.** `adb shell pm clear com.pinpointer.app`, launch, walk first run, tap
    "Allow PDFs" **without** granting from the shell. This image has no Settings app. Expect: no crash, and the message
    "The switch is still off. Try again, or choose one folder instead."
11. **Refusals.** Deny the photo permission; use every "Not now"; Android back on each first-run step. Nothing may trap or crash.
12. **Deleted files.** Delete one indexed photo with `adb shell rm`, rescan media, tap its search result: it should be forgotten, not crash.
13. **Voice states.** No microphone on the emulator: just confirm tapping the mic on Home and in search does not crash, and note the texts shown.
14. **Memory.** `adb shell dumpsys meminfo com.pinpointer.app` while indexing and when idle; grep logcat for `lowmemorykiller` and `FATAL EXCEPTION`.
15. **How it looks.** Screenshots were blank with `-gpu swiftshader_indirect`. Try starting the emulator with `-gpu guest`;
    if `adb exec-out screencap -p` then gives real pictures, look at Home, search, Photos, Papers, Settings in both languages.
16. **Android 13 / 14** if time allows (`system-images;android-33;aosp_atd;x86_64`, `android-34`): the photo permission dialogs and the "only some photos" banner.

Cannot be done on this emulator at all (owner's phone only): real speed, speech being transcribed, the ARM libraries, 32-bit phones.

## Setting up (commands that worked; about 30–40 minutes)

Use the cloud environment named **`pinpointer-ai`**: it allows the hosts the build needs. No KVM: the emulator is software only.
Disk allowance is about 30 GB: delete `android/app/build` between builds and the Python venv after the CLIP export.

```bash
apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq openjdk-17-jdk-headless unzip zip bzip2
export JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64 ANDROID_HOME=/opt/android-sdk
export PATH=$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/emulator:$PATH
mkdir -p $ANDROID_HOME/cmdline-tools && curl -sS -o /tmp/cl.zip https://dl.google.com/android/repository/commandlinetools-linux-16111833_latest.zip
unzip -q /tmp/cl.zip -d $ANDROID_HOME/cmdline-tools && mv $ANDROID_HOME/cmdline-tools/cmdline-tools $ANDROID_HOME/cmdline-tools/latest
yes | sdkmanager --licenses > /dev/null
sdkmanager "platform-tools" "platforms;android-36" "build-tools;36.0.0" "ndk;28.0.13004108" "cmake;3.22.1" "emulator" "system-images;android-30;aosp_atd;x86_64"
```

React Native's Gradle plugin asks a blocked host (central.sonatype.com) first for every dependency. Put this in
`~/.gradle/init.d/skip-unreachable-snapshots.gradle` (outside the repo) or the build hangs:

```groovy
allprojects { p -> p.repositories.all { repo ->
  if (repo instanceof org.gradle.api.artifacts.repositories.MavenArtifactRepository && repo.url?.host == 'central.sonatype.com') {
    repo.content { it.includeGroup('sandbox.unreachable.snapshots') } } } }
```

```bash
NODE_USE_ENV_PROXY=1 npm ci        # also downloads the sherpa-onnx AAR and the speech model
python3 -m venv /opt/venv-clip && /opt/venv-clip/bin/pip install -q torch torchvision --index-url https://download.pytorch.org/whl/cpu
/opt/venv-clip/bin/pip install -q open_clip_torch timm onnx onnxruntime onnxscript pillow
HF_HUB_DISABLE_XET=1 /opt/venv-clip/bin/python scripts/export_mobileclip.py   # CLIP models; then rm -rf /opt/venv-clip ~/.cache/huggingface ~/.cache/pip
npx tsc --noEmit && npm run lint && npx jest --silent
cd android && ./gradlew assembleRelease -PpinpointerAbis=x86_64   # emulator build, debug-signed, ~350 MB; first build ~15 min
```

If a host is refused (403 from the proxy), do not work around it: say which host and stop.

## Emulator: what to expect

```bash
echo no | avdmanager create avd -n pp30 -k "system-images;android-30;aosp_atd;x86_64" --force
printf 'hw.ramSize=2048\nhw.cpu.ncore=2\nhw.lcd.width=720\nhw.lcd.height=1280\nhw.lcd.density=320\ndisk.dataPartition.size=6G\n' >> ~/.android/avd/pp30.avd/config.ini
nohup emulator -avd pp30 -no-window -no-audio -no-boot-anim -gpu swiftshader_indirect -accel off -no-snapshot -no-metrics > /tmp/emu.log 2>&1 &
```

- Boot takes 5–7 minutes. Wait for `getprop sys.boot_completed` = 1 **and** for `/sdcard/DCIM` to exist before pushing files.
- Install takes about 2 minutes. `install -r` keeps the index.
- Each photo takes about 4 minutes to index (CLIP on a software CPU). Start indexing, then test other things meanwhile.
- After pushing photos: `adb shell content call --uri content://media --method scan_volume --arg external_primary`.
- The image has no Settings app. For "All files access": `adb shell appops set --uid com.pinpointer.app MANAGE_EXTERNAL_STORAGE allow`.
  For the mic: `adb shell pm grant com.pinpointer.app android.permission.RECORD_AUDIO`.
- Read screens with `uiautomator dump` (script below). Type only after tapping the text field and waiting a few seconds.
- Keep `adb logcat -v time > file &` running. Useful greps: `FATAL EXCEPTION`, `ReactNativeJS`, `MobileCLIP`, `SherpaOnnx`, `Indexed`, `Search for`.
- Background processes die if the session's worker restarts: restart the emulator, its data is kept.

### Test files

Put about 13 photos in `/sdcard/DCIM/Camera` and `/sdcard/Pictures/Screenshots`, and 4 PDFs in `/sdcard/Download` and
`/sdcard/Documents`. Used last time: real photos from `scikit-image` (`pip install scikit-image`; `skimage/data/`:
chelsea = cat, coffee, astronaut, rocket, coins, moon, retina), and pages rendered with the pre-installed Playwright
Chromium using the Mukta fonts in `android/app/src/main/assets/fonts` (so Hindi is shaped correctly): an electricity
bill, a bank SMS screenshot, `बिजली का बिल`, `दवाई की पर्ची`, `राशन कार्ड`, the fake ID card with the numbers in test 7;
PDFs: rent agreement, salary slip, a Hindi insurance policy, and one image-only (scanned) PDF.

### Screen-reading helper (`ui.py dump | tap <text or testID> | tapxy x y | text <ascii> | key <KEYCODE>`)

```python
#!/usr/bin/env python3
"""Tiny UI driver for the emulator: ui.py dump | tap <text> | shot <name> | text <string> | key <KEYCODE> | wait <text> [secs]"""
import re, subprocess, sys, time, os
ADB = ['/opt/android-sdk/platform-tools/adb', '-s', 'emulator-5554']

def sh(*args, timeout=120, binary=False):
    r = subprocess.run(ADB + list(args), capture_output=True, timeout=timeout)
    return r.stdout if binary else r.stdout.decode('utf-8', 'replace')

def dump():
    for _ in range(3):
        sh('shell', 'uiautomator', 'dump', '/sdcard/ui.xml', timeout=180)
        xml = sh('shell', 'cat', '/sdcard/ui.xml')
        if '<node' in xml:
            break
        time.sleep(2)
    nodes = []
    for m in re.finditer(r'<node ([^>]*?)/?>', xml):
        a = dict(re.findall(r'([\w-]+)="([^"]*)"', m.group(1)))
        b = re.match(r'\[(\d+),(\d+)\]\[(\d+),(\d+)\]', a.get('bounds', ''))
        if not b: continue
        x1, y1, x2, y2 = map(int, b.groups())
        nodes.append({'text': a.get('text', ''), 'desc': a.get('content-desc', ''), 'id': a.get('resource-id', ''),
                      'click': a.get('clickable') == 'true', 'cls': a.get('class', '').split('.')[-1],
                      'pkg': a.get('package', ''), 'c': ((x1 + x2) // 2, (y1 + y2) // 2), 'b': (x1, y1, x2, y2)})
    return nodes

def show(nodes):
    for n in nodes:
        label = n['text'] or n['desc']
        if label or n['click'] and n['id']:
            print(f"{'*' if n['click'] else ' '} {n['c'][0]:4d},{n['c'][1]:4d} {n['cls'][:14]:14s} {label[:90]!r} {n['id'].split('/')[-1]}")

def find(nodes, needle):
    needle = needle.lower()
    exact = [n for n in nodes if needle in (n['text'].lower(), n['desc'].lower(), n['id'].split('/')[-1].lower())]
    part = [n for n in nodes if needle in n['text'].lower() or needle in n['desc'].lower()]
    return (exact or part or [None])[0]

cmd = sys.argv[1]
if cmd == 'dump':
    ns = dump(); print('package:', sorted({n['pkg'] for n in ns})); show(ns)
elif cmd == 'tap':
    n = find(dump(), sys.argv[2])
    if not n: print('NOT FOUND:', sys.argv[2]); sys.exit(1)
    sh('shell', 'input', 'tap', str(n['c'][0]), str(n['c'][1])); print('tapped', sys.argv[2], n['c'])
elif cmd == 'tapxy':
    sh('shell', 'input', 'tap', sys.argv[2], sys.argv[3])
elif cmd == 'text':
    sh('shell', 'input', 'text', sys.argv[2].replace(' ', '%s'))
elif cmd == 'key':
    sh('shell', 'input', 'keyevent', sys.argv[2])
```

## Checklist for the owner's own phone (15 minutes, worth more than hours of emulator)

Install `PinPointer-APK2.apk` (uninstall any older build signed with another key first), then:
first run in Hindi and English; allow photos and PDFs; let it index for a few minutes; search a word that is in a
photo, a Hinglish word, and a thing that is only shown (`cat`, `food`); open a PDF from Papers; tap the mic and say
"bijli bill" (note how long "Getting voice search ready…" lasts the first time, and that the next launch is instant);
Scan a photo; leave it charging and check the count goes up; note anything slow, cut off, or wrong in Hindi.
If something crashes: `adb logcat -d > crash.txt` right after, and note the phone model and Android version.

## How to report back

One table: number, test, expected, what you saw, PASS / FAIL / NOT TESTED, logcat excerpt for every FAIL.
Then a short list of anything odd that is not on the list. Never write that something works unless you saw it.

## Proposals waiting (do not implement while testing)

1. Load the CLIP models without a Java-heap copy (`MobileCLIPModule.kt` `readBytes()`): Java heap was 148 MB right after the text encoder loaded, 19 MB later.
2. Remove the `INTERNET` permission from release builds (ML Kit adds it).
3. Stop writing search text and file paths to logcat in release (`AppLogger.info`).
4. Translate the two English-only voice alerts in `useVoiceRecording.ts`.
5. Free the speech model in the background. 6. Hindi voice search (the Whisper model is English-only).
