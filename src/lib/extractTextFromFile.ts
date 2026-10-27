import { API_BASE, getAuthHeaders } from './api-utils';

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'heic', 'heif']);
const IMAGE_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
};
// Max PDF pages sent to vision OCR per file (cost/size bound)
const MAX_VISION_PAGES = 10;
// If extracted text is below this, the PDF is likely scanned/handwritten -> vision fallback
const MIN_PDF_TEXT_CHARS = 50;

interface VisionImage { data: string; mimeType: string }

export async function extractTextFromFile(file: File): Promise<string> {
  const ext = file.name.toLowerCase().split('.').pop() || '';
  if (IMAGE_EXTENSIONS.has(ext) || file.type.startsWith('image/')) {
    return extractImageText(file, ext);
  }
  switch (ext) {
    case 'pdf':
      return extractPdf(file);
    case 'docx':
      return extractDocx(file);
    case 'pptx':
      return extractPptx(file);
    case 'xlsx':
    case 'xls':
    case 'csv':
      return extractXlsx(file);
    case 'txt':
      return file.text();
    default:
      return file.text();
  }
}

// Send page images to the server-side vision OCR endpoint
async function extractViaVision(images: VisionImage[]): Promise<string> {
  if (!images.length) throw new Error('No readable pages found');
    const resp = await fetch(`${API_BASE}/vision-extract`, {
    method: 'POST',
    headers: await getAuthHeaders(),
    body: JSON.stringify({ images }),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data?.error || 'Could not read text from image');
  const text = String(data?.text || '').trim();
  if (!text) throw new Error('No readable text found in the image');
  return text;
}

// Single image file (photo of paper/board, iPad screenshot) -> OCR text
async function extractImageText(file: File, ext: string): Promise<string> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  const mimeType = IMAGE_MIME[ext] || (file.type.startsWith('image/') ? file.type : 'image/jpeg');
  return extractViaVision([{ data: btoa(binary), mimeType }]);
}

// Render PDF pages to JPEG images for vision OCR (scanned/handwritten PDFs)
async function renderPdfPagesToImages(file: File): Promise<VisionImage[]> {
  // @ts-ignore
  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
  try {
    // @ts-ignore
    const workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
    // @ts-ignore
    pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;
  } catch {}
  const buf = await file.arrayBuffer();
  // @ts-ignore
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const images: VisionImage[] = [];
  const pageCount = Math.min(pdf.numPages, MAX_VISION_PAGES);
  for (let i = 1; i <= pageCount; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) continue;
    canvas.height = viewport.height;
    canvas.width = viewport.width;
    // @ts-ignore
    await page.render({ canvasContext: context, canvas, viewport }).promise;
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    const data = dataUrl.split(',')[1];
    if (data) images.push({ data, mimeType: 'image/jpeg' });
  }
  return images;
}

async function extractPdf(file: File): Promise<string> {
  const ab = await file.arrayBuffer();
  // Dynamically import pdfjs to keep bundle smaller
  // @ts-ignore
  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
  try {
    // Set worker
    // @ts-ignore
    const workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
    // @ts-ignore
    pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;
  } catch {}
  // @ts-ignore
  const loadingTask = pdfjsLib.getDocument({ data: ab });
  const pdf = await loadingTask.promise;
  const out: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const strings = content.items.map((it: any) => (typeof it.str === 'string' ? it.str : '')).filter(Boolean);
    out.push(strings.join(' '));
  }
  const text = out.join('\n\n');
  if (text.trim().length >= MIN_PDF_TEXT_CHARS) return text;

  // Scanned or handwritten PDF -> render pages and read them with vision OCR
  const images = await renderPdfPagesToImages(file);
  const ocrText = await extractViaVision(images);
  if (pdf.numPages > MAX_VISION_PAGES) {
    return `${ocrText}\n\n[Note: only the first ${MAX_VISION_PAGES} of ${pdf.numPages} pages were processed]`;
  }
  return ocrText;
}

async function extractDocx(file: File): Promise<string> {
  const ab = await file.arrayBuffer();
  const mammoth = await import('mammoth');
  const result = await mammoth.extractRawText({ arrayBuffer: ab as any });
  return (result.value || '').trim();
}

async function extractPptx(file: File): Promise<string> {
  const ab = await file.arrayBuffer();
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(ab);
  // Collect text from slide xml files
  const slideFiles = Object.keys(zip.files).filter((p) => p.startsWith('ppt/slides/slide') && p.endsWith('.xml'));
  slideFiles.sort();
  const out: string[] = [];
  for (const path of slideFiles) {
    const xml = await zip.file(path)!.async('string');
    // naive XML text extraction: remove tags, keep text between <a:t>..</a:t>
    const texts: string[] = [];
    const regex = /<a:t>([\s\S]*?)<\/a:t>/g;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(xml)) !== null) {
      const t = m[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
      texts.push(t);
    }
    if (texts.length === 0) {
      // fallback: strip tags
      const stripped = xml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      if (stripped) out.push(stripped);
    } else {
      out.push(texts.join(' '));
    }
  }
  return out.join('\n\n');
}

async function extractXlsx(file: File): Promise<string> {
  const ab = await file.arrayBuffer();
  const XLSX = await import('xlsx');
  const wb = XLSX.read(ab, { type: 'array' });
  const out: string[] = [];
  for (const name of wb.SheetNames) {
    const sheet = wb.Sheets[name];
    if (!sheet) continue;
    const csv = XLSX.utils.sheet_to_csv(sheet, { FS: '\t' });
    if (csv.trim()) {
      out.push(`# ${name}\n${csv}`);
    }
  }
  return out.join('\n\n');
}
