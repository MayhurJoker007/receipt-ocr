// Two ways to get text out of a receipt image.
//
//   tesseract  runs locally with Tesseract.js. Nothing leaves the machine, works offline once the
//              language data is cached, but struggles with crumpled or faded thermal paper.
//   vision     Google Cloud Vision TEXT_DETECTION. Much better on bad photos, costs money,
//              and the image is sent to Google. Needs GOOGLE_VISION_API_KEY.

import { readFile } from 'node:fs/promises';

export async function tesseractText(image, { lang = 'eng', cachePath } = {}) {
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker(lang, 1, cachePath ? { cachePath } : {});
  try {
    // Treat the slip as one uniform block. Otherwise Tesseract tends to split the right-aligned
    // amounts into their own column and the cents end up at the bottom of the text.
    await worker.setParameters({ tessedit_pageseg_mode: '6', preserve_interword_spaces: '1' });
    const { data } = await worker.recognize(image);
    return data.text;
  } finally {
    await worker.terminate();
  }
}

export async function visionText(imagePath, apiKey = process.env.GOOGLE_VISION_API_KEY) {
  if (!apiKey) throw new Error('GOOGLE_VISION_API_KEY is not set');
  const content = (await readFile(imagePath)).toString('base64');
  const res = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requests: [{ image: { content }, features: [{ type: 'TEXT_DETECTION' }], imageContext: { languageHints: ['en'] } }],
    }),
  });
  if (!res.ok) throw new Error(`Vision API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const body = await res.json();
  const response = body.responses?.[0];
  if (response?.error) throw new Error(`Vision API: ${response.error.message}`);
  return response?.fullTextAnnotation?.text ?? '';
}
