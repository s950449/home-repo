#!/usr/bin/env python3
"""Compatibility entry point; validation now uses the shared Node.js tooling."""

from pathlib import Path
import shutil
import subprocess
import sys

node = shutil.which("node")
if node is None:
    print("ERROR: Node.js 22.20.0 or later is required.", file=sys.stderr)
    sys.exit(1)
sys.exit(subprocess.call([node, str(Path(__file__).with_suffix(".mjs"))]))
