"""
Reliable PDF extraction module using PyMuPDF (fitz).
- Extracts actual readable text page by page.
- Preserves page numbers ('--- Page N ---') and natural reading order.
- Does NOT extract XMP metadata or raw PDF dictionaries as document content.
- Never decodes raw PDF binary bytes or outputs Base64/PDF objects.
- Detects scanned/image-only pages and uses local Tesseract OCR (eng+hin+kan).
- Halts and returns clear error if extraction fails.
"""

import io
import re
from typing import Dict, Any, List

try:
    import fitz  # PyMuPDF
    PYMUPDF_AVAILABLE = True
except ImportError:
    PYMUPDF_AVAILABLE = False

try:
    import pytesseract
    from PIL import Image
    OCR_AVAILABLE = True
except ImportError:
    OCR_AVAILABLE = False


def is_scanned_page(text: str, page) -> bool:
    """
    Determines if a page is predominantly scanned/image-based
    by checking extracted text length against images present on the page.
    """
    clean_text = re.sub(r"\s+", "", text)
    if len(clean_text) < 40:
        try:
            image_list = page.get_images(full=True)
            if len(image_list) > 0:
                return True
        except Exception:
            pass
    return False


def ocr_page(page, languages: str = "eng+hin+kan") -> str:
    """
    Renders the page to high-res pixmap and performs Tesseract OCR
    supporting Kannada, Hindi, and English.
    """
    if not OCR_AVAILABLE:
        return "[Scanned page detected, but local Tesseract OCR is not installed. Please install tesseract-ocr.]"
    
    try:
        # Render page at 2x resolution (144 DPI) for accurate OCR
        zoom = 2.0
        mat = fitz.Matrix(zoom, zoom)
        pix = page.get_pixmap(matrix=mat)
        img_bytes = pix.tobytes("png")
        image = Image.open(io.BytesIO(img_bytes))
        
        # Run OCR
        ocr_text = pytesseract.image_to_string(image, lang=languages)
        return ocr_text.strip()
    except Exception as e:
        # Fallback to English if multi-language packs (hin/kan) are missing
        try:
            return pytesseract.image_to_string(image, lang="eng").strip()
        except Exception as ocr_err:
            return f"[OCR Error: {str(ocr_err)}]"


def extract_pdf_content(file_bytes: bytes, filename: str = "document.pdf", languages: str = "eng+hin+kan") -> Dict[str, Any]:
    """
    Extracts text page by page from raw PDF bytes using PyMuPDF (fitz).
    Enforces clean text boundaries, zero binary leakage, and OCR fallback.
    """
    if not PYMUPDF_AVAILABLE:
        raise RuntimeError("PyMuPDF (fitz) is not installed in the Python environment. Run: pip install pymupdf")

    if not file_bytes or len(file_bytes) < 4:
        raise ValueError("Uploaded file is empty or corrupted.")

    # Strict check: verify PDF signature without decoding binary stream
    if not file_bytes.startswith(b"%PDF"):
        raise ValueError("File does not start with standard %PDF signature. Invalid PDF format.")

    try:
        doc = fitz.open(stream=file_bytes, filetype="pdf")
    except Exception as e:
        raise ValueError(f"PyMuPDF failed to open PDF document: {str(e)}")

    page_count = len(doc)
    if page_count == 0:
        raise ValueError("PDF document contains 0 pages.")

    extracted_pages: List[Dict[str, Any]] = []
    full_text_blocks: List[str] = []
    scanned_pages_detected = 0

    for page_idx in range(page_count):
        page_num = page_idx + 1
        page = doc[page_idx]

        # Extract textual blocks to preserve horizontal & vertical reading order
        # get_text("blocks") returns tuples: (x0, y0, x1, y1, "text", block_no, block_type)
        blocks = page.get_text("blocks")
        
        # Sort blocks in reading order: top-to-bottom, left-to-right
        blocks = sorted(blocks, key=lambda b: (b[1], b[0]))
        
        page_text = "\n".join([b[4].strip() for b in blocks if len(b) > 4 and b[4].strip()])

        # Scanned page check
        if is_scanned_page(page_text, page):
            scanned_pages_detected += 1
            ocr_result = ocr_page(page, languages=languages)
            if ocr_result:
                page_text = f"[OCR Extracted ({languages})]\n{ocr_result}"

        # Clean up any residual non-printable null bytes
        page_text = page_text.replace("\x00", "")

        extracted_pages.append({
            "page": page_num,
            "text": page_text,
            "word_count": len(page_text.split()),
            "char_count": len(page_text)
        })

        full_text_blocks.append(f"--- Page {page_num} of {page_count} ---\n{page_text}")

    doc.close()

    full_readable_text = "\n\n".join(full_text_blocks)

    return {
        "filename": filename,
        "page_count": page_count,
        "total_chars": len(full_readable_text),
        "total_words": len(full_readable_text.split()),
        "scanned_pages": scanned_pages_detected,
        "pages": extracted_pages,
        "text": full_readable_text,
        "status": "success"
    }
