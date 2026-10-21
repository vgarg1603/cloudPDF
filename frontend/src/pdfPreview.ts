import * as pdfjs from "pdfjs-dist";

let configured = false;

function configurePdf(): void {
  if (configured) return;
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();
  configured = true;
}

export interface PdfPreview {
  pageCount: number;
  thumbs: string[];
}

export async function readPdf(file: File, withThumbs: boolean): Promise<PdfPreview> {
  configurePdf();
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjs.getDocument({ data }).promise;
  const thumbs: string[] = [];
  if (withThumbs) {
    for (let number = 1; number <= pdf.numPages; number += 1) {
      const page = await pdf.getPage(number);
      const viewport = page.getViewport({ scale: 0.28 });
      const canvas = window.document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const context = canvas.getContext("2d");
      if (!context) continue;
      await page.render({ canvasContext: context, viewport }).promise;
      thumbs.push(canvas.toDataURL("image/jpeg", 0.72));
    }
  }
  const pageCount = pdf.numPages;
  await pdf.destroy();
  return { pageCount, thumbs };
}
