"""Stage the single supported ArcFace model from InsightFace's official archive."""
import argparse
import hashlib
from pathlib import Path
import shutil
from urllib.request import urlopen
import zipfile


URL = "https://github.com/deepinsight/insightface/releases/download/model-zoo/buffalo_l.zip"
ARCHIVE_SIZE = 288_621_354
ARCHIVE_HASH = "80ffe37d8a5940d59a7384c201a2a38d4741f2f3c51eef46ebb28218a7b0ca2f"
MODEL_NAME = "w600k_r50.onnx"
MODEL_SIZE = 174_383_860
BLOCK = 1024 * 1024


def checked_archive(source, target):
    digest = hashlib.sha256()
    total = 0
    with target.open("xb") as output:
        for block in iter(lambda: source.read(BLOCK), b""):
            total += len(block)
            if total > ARCHIVE_SIZE:
                raise ValueError("ArcFace archive exceeds its expected size")
            digest.update(block)
            output.write(block)
    if total != ARCHIVE_SIZE or digest.hexdigest() != ARCHIVE_HASH:
        raise ValueError("ArcFace archive checksum mismatch")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("stage", type=Path)
    parser.add_argument("--archive", type=Path, help="Use a previously downloaded official archive")
    args = parser.parse_args()
    archive = args.stage / "buffalo_l.zip"
    with (args.archive.open("rb") if args.archive else urlopen(URL, timeout=30)) as source:
        checked_archive(source, archive)
    with zipfile.ZipFile(archive) as package:
        model = package.getinfo(MODEL_NAME)
        if model.file_size != MODEL_SIZE:
            raise ValueError("Unexpected ArcFace model size")
        with package.open(model) as source, (args.stage / MODEL_NAME).open("xb") as output:
            shutil.copyfileobj(source, output, BLOCK)


if __name__ == "__main__":
    main()
