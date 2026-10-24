"""Compile a per-user NSIS installer from the clean, verified portable ZIP."""
from pathlib import Path
from zipfile import ZipFile
import argparse, hashlib, json, os, shutil, subprocess, tempfile

parser = argparse.ArgumentParser()
parser.add_argument('--makensis', default=shutil.which('makensis'))
arguments = parser.parse_args()
if not arguments.makensis:
    raise SystemExit('Install NSIS 3 or pass --makensis /path/to/makensis.')
root = Path(__file__).resolve().parents[1]
version = json.loads((root / 'package.json').read_text())['version']
portable = root / 'downloads' / f'Dideban-v{version}-Windows-x64.zip'
output = root / 'downloads' / f'Dideban-v{version}-Setup-Windows-x64.exe'
with tempfile.TemporaryDirectory(prefix='dideban-installer-') as temporary:
    stage = Path(temporary)
    with ZipFile(portable) as bundle:
        for item in bundle.infolist():
            relative = Path(item.filename)
            if relative.is_absolute() or '..' in relative.parts or any(part in {'.data','.git','.env','credentials.key'} for part in relative.parts):
                raise SystemExit('The portable ZIP contains an unsafe path or private data.')
        bundle.extractall(stage)
    payload = stage / f'Dideban-v{version}-Windows-x64'
    subprocess.run([arguments.makensis, '-INPUTCHARSET', 'UTF8', f'-DVERSION={version}', f'-DPAYLOAD={payload}', f'-DOUTPUT={output}', str(root / 'desktop/installer.nsi')], cwd=root / 'desktop', check=True)
assert output.read_bytes()[:2] == b'MZ'
files = sorted([* (root / 'downloads').glob('*.zip'), *(root / 'downloads').glob('*.exe')])
(root / 'downloads/SHA256SUMS.txt').write_text(''.join(f'{hashlib.sha256(file.read_bytes()).hexdigest()}  {file.name}\n' for file in files))
print(f'Windows installer: {output.name}, {output.stat().st_size:,} bytes. Authenticode signing requires the publisher certificate.')
