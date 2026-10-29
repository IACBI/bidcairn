import { parentPort, workerData } from "node:worker_threads";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
try {
  const loadingTask = getDocument({
    data: new Uint8Array(workerData),
    isEvalSupported: false,
    useSystemFonts: true,
    disableFontFace: true,
  });
  const pdf = await loadingTask.promise;
  if (pdf.numPages > 20) throw new Error("Use a PDF with at most 20 pages.");
  const pages = [];
  let length = 0;
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const text = content.items
      .filter((x) => "str" in x)
      .map((x) => x.str + (x.hasEOL ? "\n" : " "))
      .join("");
    length += text.length;
    if (length > 60000)
      throw new Error(
        "This PDF has too much text. Upload a shorter proposal; text is never silently truncated.",
      );
    pages.push({ page: i, text });
  }
  if (pages.reduce((n, p) => n + p.text.trim().length, 0) < 80)
    throw new Error(
      "This file has no usable text layer. Scan-only PDFs and OCR are not supported.",
    );
  await loadingTask.destroy();
  parentPort.postMessage({ pages });
} catch (error) {
  parentPort.postMessage({
    error: error.message || "The PDF could not be read.",
  });
}
