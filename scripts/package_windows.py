"""Create an offline-start Windows x64 bundle using a verified official Node ZIP."""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import tempfile

args = argparse.ArgumentParser()
args.add_argument('--node-archive', required=True, type=Path)
args.add_argument('--node-shasums', required=True, type=Path)
options = args.parse_args()
root = Path(__file__).resolve().parents[1]
runtime = options.node_archive.resolve()
if not re.fullmatch(r'node-v24\.\d+\.\d+-win-x64\.zip', runtime.name):
    raise SystemExit('An official Node.js 24 Windows x64 ZIP is required.')
checksums = {line.split()[1]: line.split()[0] for line in options.node_shasums.read_text().splitlines() if len(line.split()) == 2}
expected = checksums.get(runtime.name)
if not expected or hashlib.sha256(runtime.read_bytes()).hexdigest() != expected:
    raise SystemExit('Runtime checksum does not match the supplied official SHASUMS256.txt.')
if not (root / 'dist/index.html').is_file():
    raise SystemExit('Run npm run build first.')

version = json.loads((root / 'package.json').read_text())['version']
name = f'Dideban-v{version}-Windows-x64'
stage = Path(tempfile.mkdtemp(prefix='dideban-windows-build-')) / name
stage.mkdir()
for filename in ['package.json', 'package-lock.json', 'README.md', '.env.example', 'DOWNLOAD-README-fa.txt', 'launch.mjs', 'start-windows.cmd']:
    shutil.copy2(root / filename, stage / filename)
# Native CMD line endings, independent of the release builder's OS.
batch = stage / 'start-windows.cmd'
batch.write_bytes(batch.read_text().replace('\r\n', '\n').replace('\n', '\r\n').encode('utf-8'))
shutil.copytree(root / 'dist', stage / 'dist')
shutil.copytree(root / 'desktop',stage / 'desktop',ignore=shutil.ignore_patterns('installer.nsi','*.pfx','*.p12','*private*'))
(stage / 'server').mkdir()
for file in (root / 'server').glob('*.mjs'):
    if not file.name.endswith('.test.mjs'):
        shutil.copy2(file, stage / 'server' / file.name)

# Install from the committed lockfile during packaging, not on the user's PC.
subprocess.run([shutil.which('npm') or 'npm', 'ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', '--cache', str(Path(tempfile.gettempdir()) / 'dideban-npm-cache')], cwd=stage, check=True)
(stage / 'runtime').mkdir()
prefix = runtime.stem
with ZipFile(runtime) as official:
    for filename in ['node.exe', 'LICENSE']:
        (stage / 'runtime' / filename).write_bytes(official.read(f'{prefix}/{filename}'))
(stage / 'runtime' / 'PROVENANCE.txt').write_text(
    f'Official Node.js distribution: https://nodejs.org/dist/{prefix.removesuffix("-win-x64").removeprefix("node-")}/{runtime.name}\n'
    f'Archive SHA-256 verified against official SHASUMS256.txt: {expected}\n'
    f'Bundled node.exe SHA-256: {hashlib.sha256((stage / "runtime/node.exe").read_bytes()).hexdigest()}\n'
)

output = root / 'downloads'
output.mkdir(exist_ok=True)
archive = output / f'{name}.zip'
count = 0
with ZipFile(archive, 'w', compression=ZIP_DEFLATED, compresslevel=6) as bundle:
    for file in sorted(stage.rglob('*')):
        if not file.is_file() or file.is_symlink() or '.bin' in file.parts:
            continue
        relative = file.relative_to(stage)
        if any(part in {'.git', '.data', '.env', 'credentials.key'} for part in relative.parts):
            raise SystemExit(f'Private data found unexpectedly: {relative}')
        info = ZipInfo(f'{name}/{relative.as_posix()}', date_time=(2026, 10, 22, 0, 0, 0))
        info.compress_type = ZIP_DEFLATED
        info.create_system = 3
        info.external_attr = 0o100644 << 16
        with file.open('rb') as source, bundle.open(info, 'w') as target:
            shutil.copyfileobj(source, target)
        count += 1
sums = ''.join(f'{hashlib.sha256(file.read_bytes()).hexdigest()}  {file.name}\n' for file in sorted([*output.glob('*.zip'),*output.glob('*.exe')]))
(output / 'SHA256SUMS.txt').write_text(sums)
print(f'Windows bundle: {archive.name}, {archive.stat().st_size:,} bytes, {count} files')
print(f'Clean staging directory: {stage}')
Path(tempfile.gettempdir(), 'dideban-windows-stage-path').write_text(str(stage))
