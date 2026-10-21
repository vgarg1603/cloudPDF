# cloudPDF — Serverless cloud-based PDF processing platform

cloudPDF is a web application for merging, splitting, compressing, converting, organizing, and password-protecting PDF files. On AWS the browser talks to an HTTP API, uploads files straight to S3, and an S3 event wakes a Lambda worker through SQS. The same Python processors run locally when you do not want to deploy. The UI follows an iLovePDF-style layout.

## Features

- **Merge** combines PDFs in the order you choose.
- **Split** extracts a page range such as `1-3,5`, or writes every page into a ZIP.
- **Compress** recompresses embedded images and rewrites streams. Quality is low, medium, or high.
- **PDF to images / images to PDF** rasterizes pages to PNG or JPEG, or places PNG, JPEG, and WebP images onto PDF pages.
- **Rotate and organize** rotates pages by 90 degree steps, reorders them, and drops pages.
- **Protect** encrypts a PDF with AES-256. The password is removed from the job record when the worker finishes, and it is never logged.

Limits for a single job: 20 MB per file and 40 pages. Results are kept for one day.

## Local demo

Install Python 3.12, Node.js 20, and Poppler (`pdftoppm`). Poppler is only required for PDF-to-image conversion.

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt -r backend/requirements-dev.txt
```

On Debian or Ubuntu: `sudo apt install poppler-utils`. On macOS: `brew install poppler`.

Terminal one, from the repository root with the virtual environment active:

```bash
make test
make api
```

The API listens on `http://127.0.0.1:8000`.

Terminal two:

```bash
cd frontend
npm install
npm run dev
```

Open `http://127.0.0.1:5173`. The dev server proxies `/jobs` to the local API. No AWS credentials are used.

## AWS setup

Do this on your own computer, in the account you will use for the demo. Keep one region for every command. `us-east-1` is a safe default unless the course requires another region, such as `ap-south-1`.

1. Create an account at [aws.amazon.com](https://aws.amazon.com). Turn on multi-factor authentication for the root user, then add a billing budget alert around 5 USD. A card is required even on the Free Tier. This project’s Lambda, S3, API Gateway, SQS, and DynamoDB usage is small, but logs and data transfer can still cost a little.
2. In IAM, create a user such as `pdf-platform-deploy` with an access key. On a personal lab account, attach `AdministratorAccess` so CloudFormation can create roles. Do not create access keys for the root user. On a shared course account, use the role your instructor provides.
3. Install the [AWS CLI v2](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html), the [AWS SAM CLI](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html), and Docker. SAM uses Docker to build the Python functions and the Poppler layer.
4. Configure the CLI and confirm the caller is the deploy user, not root:

```bash
aws configure
aws sts get-caller-identity
```

5. Build and deploy from the repository root. The stack name must be lowercase because it is part of the S3 bucket names. Use `cloudpdf`. This school account allows the stack in `ap-southeast-2`.

```bash
sam build --use-container
sam deploy --guided --stack-name cloudpdf --region ap-southeast-2
```

Accept the defaults for the guided prompts, allow SAM to create IAM roles, and save the answers to `samconfig.toml` (that file is gitignored). Set `CorsOrigin` to `*` for a class demo, or to the exact site origin if you host the UI. Copy the `ApiUrl` output. It has no trailing slash.

6. Point the UI at that API and start it:

```bash
cd frontend
VITE_API_URL=https://YOUR_API_ID.execute-api.YOUR_REGION.amazonaws.com npm run dev
```

Uploads go directly to S3 with presigned URLs. The frontend does not contain access keys. Live demo API:

`https://nh6uhe1alj.execute-api.ap-southeast-2.amazonaws.com`

7. After the demo, empty the buckets named in the stack outputs and delete the stack so storage does not keep billing:

```bash
aws s3 rm s3://BUCKET_NAME --recursive
sam delete --stack-name cloudpdf --region ap-southeast-2
```

Run the `aws s3 rm` command for both the upload bucket and the results bucket.

## What the stack creates

Defined in [`template.yaml`](template.yaml):

- An HTTP API with `POST /jobs` and `GET /jobs/{jobId}`.
- A private upload bucket. Object-created events for the `uploads/` prefix go to SQS.
- A worker queue with a 180 second visibility timeout, three receives, and a dead-letter queue. The worker Lambda has a 120 second timeout and 1024 MB of memory, so a failed message becomes visible again shortly after the attempt ends.
- A results bucket. Objects in both buckets expire after one day.
- A DynamoDB table keyed by `jobId`, with a one-day TTL.
- A Poppler layer so the worker can rasterize PDF pages. Other operations use `pypdf`, `pikepdf`, and Pillow, which ship as wheels.

The worker claims a job only after every expected object is in S3, so a multi-file merge does not start on the first upload. A conditional DynamoDB update stops two queue messages from processing the same job.

## Project layout

- [`frontend/`](frontend/) — React UI for each tool, job progress, and download.
- [`backend/src/processors/`](backend/src/processors/) — PDF operations.
- [`backend/src/handlers/`](backend/src/handlers/) — Lambda handlers for create, status, and the SQS worker.
- [`backend/local_server.py`](backend/local_server.py) — local API and in-process worker.
- [`layers/poppler/`](layers/poppler/) — Makefile that SAM runs inside the build image.
- [`docs/REPORT.md`](docs/REPORT.md) — written report for the submission, including a short presentation outline.

## Tests

`make test` covers each operation, request validation, S3 event parsing, and a local merge of two PDFs. It checks that the merged page order matches the upload order, and that a protect job does not leave the password in the response or in the finished job record.
