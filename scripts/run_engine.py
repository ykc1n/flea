#!/usr/bin/env python3
"""Run a pre-provisioned, version-matched Zero-K headless installation."""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess

p = argparse.ArgumentParser()
p.add_argument('--replay', required=True)
p.add_argument('--output', required=True)
p.add_argument('--engine', required=True)
p.add_argument('--game', required=True)
a = p.parse_args()
# JSON maps engine versions to an installed executable. No executable download or shell expansion.
engines = json.loads(os.environ.get('FLEA_ENGINES', '{}'))
if a.engine not in engines:
    raise SystemExit(f'Provision engine {a.engine} and add it to FLEA_ENGINES')
root = Path(os.environ['FLEA_ZK_ROOT']).resolve()
# The worker runs one engine at a time; give this service its own writable game installation.
widget = root / 'LuaUI/Widgets/flea_export.lua'
widget.parent.mkdir(parents=True, exist_ok=True)
shutil.copyfile(Path(__file__).resolve().parent.parent / 'worker/flea_export.lua', widget)
export = root / 'LuaUI/Logs/flea-events.jsonl'
export.unlink(missing_ok=True)
# Local widgets must be enabled in ZK_data.lua, see README. Missing game/map/engine fails visibly.
subprocess.run([engines[a.engine], '--write-dir', str(root), str(Path(a.replay).resolve())],
               cwd=root, check=True, timeout=max(1, int(os.environ.get('FLEA_PROCESS_TIMEOUT','3600'))-30))
if not export.exists():
    raise SystemExit('No export: enable local widgets and Flea Replay Export in the Zero-K installation')
shutil.copyfile(export, a.output)
