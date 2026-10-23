"""Build a clean portable download with the already built web interface."""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
import hashlib
import json

root = Path(__file__).resolve().parents[1]
version = json.loads((root / 'package.json').read_text())['version']
name = f'Dideban-v{version}'
output = root / 'downloads'
output.mkdir(exist_ok=True)
archive = output / f'{name}.zip'
files = [root / name for name in (
    'package.json', 'package-lock.json', 'README.md', '.env.example',
    'launch.mjs', 'start.sh', 'start-windows.cmd', 'DOWNLOAD-README-fa.txt',
)]
files += sorted(p for p in (root / 'server').glob('*.mjs') if not p.name.endswith('.test.mjs'))
files += sorted(p for p in (root / 'dist').rglob('*') if p.is_file())
if not (root / 'dist/index.html').is_file():
    raise SystemExit('Run npm run build before packaging.')
with ZipFile(archive, 'w', compression=ZIP_DEFLATED, compresslevel=9) as bundle:
    for file in files:
        relative = file.relative_to(root)
        info = ZipInfo(f'{name}/{relative.as_posix()}', date_time=(2026, 10, 22, 0, 0, 0))
        info.compress_type = ZIP_DEFLATED
        info.create_system = 3
        info.external_attr = (0o100755 if file.name == 'start.sh' else 0o100644) << 16
        bundle.writestr(info, file.read_bytes())
digest = hashlib.sha256(archive.read_bytes()).hexdigest()
(output / 'SHA256SUMS.txt').write_text(f'{digest}  {archive.name}\n')
print(f'{archive.name}: {archive.stat().st_size:,} bytes, {len(files)} files')
print(f'SHA-256: {digest}')
