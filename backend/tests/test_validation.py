"""Tests for job request validation."""

import pytest

from src.common.validation import safe_name, validate_request


def test_safe_name_strips_path_and_symbols():
    assert safe_name("../My File!.pdf", "document.pdf") == "My_File_.pdf"
    assert safe_name("", "document.pdf") == "document.pdf"


def test_validate_merge_request():
    operation, files, options = validate_request(
        {
            "operation": "merge",
            "files": [
                {"name": "a.pdf", "contentType": "application/pdf"},
                {"name": "b.pdf", "contentType": "application/pdf"},
            ],
        }
    )
    assert operation == "merge"
    assert [item["name"] for item in files] == ["a.pdf", "b.pdf"]
    assert options == {}


def test_validate_protect_keeps_password_out_of_the_error_path():
    with pytest.raises(ValueError, match="password"):
        validate_request(
            {
                "operation": "protect",
                "files": [{"name": "a.pdf", "contentType": "application/pdf"}],
                "options": {},
            }
        )


def test_validate_rejects_images_for_merge():
    with pytest.raises(ValueError, match="PDF"):
        validate_request(
            {
                "operation": "merge",
                "files": [
                    {"name": "a.png", "contentType": "image/png"},
                    {"name": "b.pdf", "contentType": "application/pdf"},
                ],
            }
        )
