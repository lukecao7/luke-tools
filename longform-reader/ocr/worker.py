"""Local OCR process. Input/output use JSON lines; document images stay on this machine."""
import base64
import contextlib
import importlib.metadata
import json
import sys

import cv2
import numpy as np


def emit(value):
    print(json.dumps(value, ensure_ascii=False), flush=True)


try:
    with contextlib.redirect_stdout(sys.stderr):
        from rapidocr import RapidOCR
        # PDF rendering already applies page rotation. Per-line orientation
        # classification can incorrectly flip short chart values such as 69%.
        engine = RapidOCR(params={"Global.use_cls": False})
    emit({"type": "ready", "version": importlib.metadata.version("rapidocr"), "model": "PP-OCRv6-small"})
except Exception as error:
    emit({"type": "error", "error": str(error)})
    sys.exit(1)

for message in sys.stdin:
    request = {}
    try:
        request = json.loads(message)
        image = cv2.imdecode(np.frombuffer(base64.b64decode(request["image"]), dtype=np.uint8), cv2.IMREAD_COLOR)
        if image is None:
            raise ValueError("无法读取页面图片")
        with contextlib.redirect_stdout(sys.stderr):
            result = engine(image, return_word_box=True, return_single_char_box=True)
        lines = []
        if result.txts:
            for index, (text, box, score) in enumerate(zip(result.txts, result.boxes, result.scores)):
                glyphs = []
                cursor = 0
                words = result.word_results[index] if index < len(result.word_results) else ()
                for word, confidence, bounds in words:
                    start = text.find(word, cursor)
                    if start < 0 or bounds is None:
                        continue
                    # JavaScript character offsets are UTF-16 code units.
                    left = len(text[:start].encode("utf-16-le")) // 2
                    right = len(text[:start + len(word)].encode("utf-16-le")) // 2
                    glyphs.append({"start": left, "end": right, "box": np.asarray(bounds).tolist(), "score": float(confidence)})
                    cursor = start + len(word)
                lines.append({"text": text, "box": box.tolist(), "score": float(score), "glyphs": glyphs})
        emit({"id": request["id"], "width": image.shape[1], "height": image.shape[0], "lines": lines})
    except Exception as error:
        emit({"id": request.get("id"), "error": str(error)})
