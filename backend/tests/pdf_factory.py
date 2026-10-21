"""Build small PDFs and images for tests."""

from __future__ import annotations

import io

import pikepdf
from PIL import Image
from pypdf import PdfWriter


def blank_pdf(widths: list[float], height: float = 720) -> bytes:
    writer = PdfWriter()
    for width in widths:
        writer.add_blank_page(width=width, height=height)
    buffer = io.BytesIO()
    writer.write(buffer)
    return buffer.getvalue()


def noisy_image_pdf(size: int = 240) -> bytes:
    image = Image.effect_noise((size, size), 80).convert("RGB")
    pdf = pikepdf.new()
    page = pdf.add_blank_page(page_size=(size, size))
    stream = pikepdf.Stream(pdf, image.tobytes())
    stream.Type = pikepdf.Name.XObject
    stream.Subtype = pikepdf.Name.Image
    stream.Width = size
    stream.Height = size
    stream.ColorSpace = pikepdf.Name.DeviceRGB
    stream.BitsPerComponent = 8
    page.Resources = pikepdf.Dictionary(XObject=pikepdf.Dictionary(Im0=stream))
    page.Contents = pikepdf.Stream(pdf, f"q {size} 0 0 {size} 0 0 cm /Im0 Do Q".encode())
    buffer = io.BytesIO()
    pdf.save(buffer)
    return buffer.getvalue()


def png_bytes(color: tuple[int, int, int], size: int = 40) -> bytes:
    image = Image.new("RGB", (size, size), color)
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()
