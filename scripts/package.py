"""Create a loadable extension ZIP; never include test fixtures or development output."""
from pathlib import Path
import json
import zipfile

root = Path(__file__).resolve().parent.parent
version = json.loads((root / 'manifest.json').read_text())['version']
output = root / 'dist' / f'unified-obsidian-clipper-{version}.zip'
output.parent.mkdir(exist_ok=True)
excluded = {'.git', 'node_modules', 'dist', 'tests', 'scripts', '.DS_Store', '__pycache__'}
with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
    for file in sorted(root.rglob('*')):
        relative = file.relative_to(root)
        if not file.is_file() or any(part in excluded for part in relative.parts):
            continue
        archive.write(file, relative.as_posix())
with zipfile.ZipFile(output) as archive:
    assert archive.testzip() is None
    assert 'manifest.json' in archive.namelist()
print(output)
