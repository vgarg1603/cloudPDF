"""Tests for SQS and S3 event parsing."""

import json

from src.handlers.process_job import iter_s3_keys, job_id_from_key


def test_job_id_from_upload_key():
    assert job_id_from_key("uploads/6f0c1a3e-1c2b-4d5e-8f90-123456789abc/00-a.pdf") == (
        "6f0c1a3e-1c2b-4d5e-8f90-123456789abc"
    )
    assert job_id_from_key("results/job/merged.pdf") is None


def test_iter_s3_keys_decodes_names_and_skips_the_test_event():
    event = {
        "Records": [
            {"body": json.dumps({"Event": "s3:TestEvent"})},
            {
                "body": json.dumps(
                    {
                        "Records": [
                            {"s3": {"object": {"key": "uploads/job-1/00-report.pdf"}}}
                        ]
                    }
                )
            },
        ]
    }
    assert iter_s3_keys(event) == ["uploads/job-1/00-report.pdf"]
