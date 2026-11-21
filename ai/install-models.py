"""Fetch the pinned OpenCV models; verify SHA256 before atomic replacement."""
import argparse
import hashlib
import json
from pathlib import Path
import urllib.request


def digest(path):
    value = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            value.update(block)
    return value.hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check-only', action='store_true', help='No downloads or filesystem changes')
    args = parser.parse_args()
    root = Path(__file__).resolve().parent / 'models'
    missing = []
    for item in json.loads((root / 'manifest.json').read_text(encoding='utf-8-sig')):
        name = item['name']
        if name not in ('yunet', 'sface', 'yolox') or not item['source'].startswith('https://media.githubusercontent.com/media/opencv/opencv_zoo/'):
            raise ValueError('Unexpected model manifest entry')
        target = root / (name + '.onnx')
        if target.is_file() and digest(target) == item['sha256']:
            print(name + ': SHA256 OK')
            continue
        if args.check_only:
            missing.append(name)
            print(name + ': missing or checksum mismatch')
            continue
        temporary = root / (name + '.download')
        try:
            with urllib.request.urlopen(item['source'], timeout=60) as source, temporary.open('wb') as destination:
                total = 0
                while True:
                    block = source.read(1024 * 1024)
                    if not block:
                        break
                    total += len(block)
                    if total > 256 * 1024 * 1024:
                        raise ValueError('Model exceeds size limit')
                    destination.write(block)
            if digest(temporary) != item['sha256']:
                raise ValueError('SHA256 mismatch: ' + name)
            temporary.replace(target)
            print(name + ': downloaded and SHA256 verified')
        finally:
            temporary.unlink(missing_ok=True)
    return 1 if missing else 0


if __name__ == '__main__':
    raise SystemExit(main())
