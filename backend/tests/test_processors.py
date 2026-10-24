"""Unit tests for each PDF operation."""

from __future__ import annotations

import io
import zipfile

import pikepdf
import pytest
from PIL import Image
from pypdf import PdfReader

from src.processors.dispatch import execute
from src.processors.split import parse_page_spec
from tests.pdf_factory import blank_pdf, noisy_image_pdf, png_bytes


def page_widths(data: bytes) -> list[float]:
    reader = PdfReader(io.BytesIO(data))
    return [float(page.mediabox.width) for page in reader.pages]


def test_merge_keeps_selected_order():
    result, media, name = execute("merge", [blank_pdf([200]), blank_pdf([350, 400])])
    assert media == "application/pdf"
    assert name == "merged.pdf"
    assert page_widths(result) == [200, 350, 400]


def test_merge_rejects_a_single_file():
    with pytest.raises(ValueError, match="2 to 10"):
        execute("merge", [blank_pdf([200])])


def test_split_range_extracts_requested_pages():
    source = blank_pdf([100, 200, 300, 400])
    result, media, name = execute("split", [source], {"mode": "range", "pages": "1-2,4"})
    assert (media, name) == ("application/pdf", "split.pdf")
    assert page_widths(result) == [100, 200, 400]


def test_split_each_page_returns_a_zip():
    result, media, name = execute("split", [blank_pdf([100, 200, 300])], {"mode": "each"})
    assert (media, name) == ("application/zip", "pages.zip")
    with zipfile.ZipFile(io.BytesIO(result)) as archive:
        names = sorted(archive.namelist())
        assert names == ["page-1.pdf", "page-2.pdf", "page-3.pdf"]
        assert page_widths(archive.read("page-2.pdf")) == [200]


def test_parse_page_spec_rejects_bad_ranges():
    assert parse_page_spec("1 - 3, 5", 6) == [0, 1, 2, 4]
    with pytest.raises(ValueError):
        parse_page_spec("3-1", 4)
    with pytest.raises(ValueError):
        parse_page_spec("1,1", 4)
    with pytest.raises(ValueError):
        parse_page_spec("9", 2)


def test_compress_shrinks_an_uncompressed_image():
    source = noisy_image_pdf()
    result, media, name = execute("compress", [source], {"quality": "low"})
    assert (media, name) == ("application/pdf", "compressed.pdf")
    assert len(result) < len(source) / 2
    with pikepdf.open(io.BytesIO(result)) as pdf:
        image = pikepdf.PdfImage(list(pdf.pages[0].get_images().values())[0]).as_pil_image()
        assert image.size == (240, 240)


def test_compress_blank_pdf_stays_a_pdf():
    result, _, _ = execute("compress", [blank_pdf([300])], {"quality": "high"})
    assert page_widths(result) == [300]


def test_pdf_to_images_and_back():
    source = blank_pdf([320, 280])
    archive, media, name = execute("pdf_to_images", [source], {"format": "png"})
    assert (media, name) == ("application/zip", "pages.zip")
    with zipfile.ZipFile(io.BytesIO(archive)) as bundle:
        images = [bundle.read(item) for item in sorted(bundle.namelist())]
    assert len(images) == 2
    Image.open(io.BytesIO(images[0])).verify()

    pdf, pdf_media, pdf_name = execute("images_to_pdf", images)
    assert (pdf_media, pdf_name) == ("application/pdf", "images.pdf")
    assert len(PdfReader(io.BytesIO(pdf)).pages) == 2


def test_images_to_pdf_preserves_order_by_color():
    red = png_bytes((200, 20, 20))
    blue = png_bytes((20, 40, 180))
    result, _, _ = execute("images_to_pdf", [red, blue])
    reader = PdfReader(io.BytesIO(result))
    assert len(reader.pages) == 2


def test_organize_rotates_reorders_and_deletes():
    source = blank_pdf([100, 200, 300])
    result, media, name = execute(
        "organize",
        [source],
        {"pages": [{"index": 2, "rotation": 0}, {"index": 0, "rotation": 90}]},
    )
    assert (media, name) == ("application/pdf", "organized.pdf")
    reader = PdfReader(io.BytesIO(result))
    assert page_widths(result) == [300, 100]
    assert reader.pages[1].rotation == 90


def test_protect_requires_the_password():
    source = blank_pdf([220])
    result, media, name = execute("protect", [source], {"password": "correct horse"})
    assert (media, name) == ("application/pdf", "protected.pdf")
    with pytest.raises(pikepdf.PasswordError):
        pikepdf.open(io.BytesIO(result))
    with pikepdf.open(io.BytesIO(result), password="correct horse") as pdf:
        assert len(pdf.pages) == 1


def test_rejects_non_pdf_bytes():
    with pytest.raises(ValueError, match="not a PDF"):
        execute("compress", [b"hello"], {"quality": "medium"})
