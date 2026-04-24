import { Router, type IRouter } from "express";
import OpenAI from "openai";
import * as jpeg from "jpeg-js";

const router: IRouter = Router();

const client = new OpenAI({
  baseURL: process.env["AI_INTEGRATIONS_OPENAI_BASE_URL"],
  apiKey: process.env["AI_INTEGRATIONS_OPENAI_API_KEY"] ?? "no-key",
});

const SYSTEM_PROMPT = `You are a precise MRZ (Machine Readable Zone) reader for travel documents.

The image shows a travel document (passport, ID card, or visa). The MRZ is printed at the bottom of the document in a monospace OCR-B font.

MRZ formats:
- TD3 (passport): 2 rows of exactly 44 characters each
- TD1 (ID card): 3 rows of exactly 30 characters each
- TD2: 2 rows of exactly 36 characters each

Characters allowed: uppercase A-Z, digits 0-9, filler "<" ONLY.

Locate the MRZ rows in the image and return them — one row per line — with NO spaces, NO labels, NO explanation, NO markdown.

Common OCR corrections to apply:
- O (letter) ↔ 0 (zero) — zero appears in number fields, O appears in name/country fields
- I or L ↔ 1
- B ↔ 8
- S ↔ 5
- Z ↔ 2
- G ↔ 6

If you cannot see any MRZ text, respond with exactly: NONE`;

/**
 * Preprocess a JPEG buffer for best OCR results:
 *  1. Decode to RGBA pixels
 *  2. Convert to grayscale (perceptual luminance)
 *  3. Percentile contrast stretch (2 %–98 %) — robust against bright/dark corners
 *  4. Unsharp mask (amount=1.2) — sharpens text edges
 *  5. Re-encode as JPEG at quality 90
 *
 * Returns the original buffer unchanged if any step fails.
 */
function enhanceImage(inputBuffer: Buffer): Buffer {
  try {
    const { width, height, data } = jpeg.decode(inputBuffer, { useTArray: true });
    const total = width * height;

    // ── 1. Grayscale luminance ──────────────────────────────────────────────
    const lum = new Uint8Array(total);
    for (let i = 0; i < total; i++) {
      const r = data[i * 4];
      const g = data[i * 4 + 1];
      const b = data[i * 4 + 2];
      lum[i] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
    }

    // ── 2. Percentile contrast stretch (2 %–98 %) ──────────────────────────
    const hist = new Int32Array(256);
    for (let i = 0; i < total; i++) hist[lum[i]]++;
    const lo2 = total * 0.02;
    const hi98 = total * 0.98;
    let cumSum = 0;
    let minL = 0;
    let maxL = 255;
    for (let v = 0; v < 256; v++) {
      cumSum += hist[v];
      if (cumSum <= lo2) minL = v;
      if (cumSum <= hi98) maxL = v;
    }
    const range = maxL - minL || 1;
    const stretched = new Uint8Array(total);
    for (let i = 0; i < total; i++) {
      stretched[i] = Math.min(255, Math.max(0, Math.round(((lum[i] - minL) * 255) / range)));
    }

    // ── 3. Unsharp mask (3×3 box blur → sharpen) ───────────────────────────
    // Separate horizontal then vertical pass for speed (O(6N) vs O(9N)).
    const tmp = new Uint8Array(total);
    // Horizontal pass
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const x0 = Math.max(0, x - 1);
        const x2 = Math.min(width - 1, x + 1);
        const base = y * width;
        tmp[base + x] = Math.round((stretched[base + x0] + stretched[base + x] + stretched[base + x2]) / 3);
      }
    }
    // Vertical pass
    const blurred = new Uint8Array(total);
    for (let y = 0; y < height; y++) {
      const y0 = Math.max(0, y - 1);
      const y2 = Math.min(height - 1, y + 1);
      for (let x = 0; x < width; x++) {
        blurred[y * width + x] = Math.round((tmp[y0 * width + x] + tmp[y * width + x] + tmp[y2 * width + x]) / 3);
      }
    }
    // Sharpen: out = stretched + 1.2 * (stretched − blurred)
    const sharpened = new Uint8Array(total);
    for (let i = 0; i < total; i++) {
      sharpened[i] = Math.min(255, Math.max(0, Math.round(stretched[i] + 1.2 * (stretched[i] - blurred[i]))));
    }

    // ── 4. Re-encode as JPEG ────────────────────────────────────────────────
    const out = Buffer.alloc(total * 4);
    for (let i = 0; i < total; i++) {
      const v = sharpened[i];
      out[i * 4]     = v;
      out[i * 4 + 1] = v;
      out[i * 4 + 2] = v;
      out[i * 4 + 3] = 255;
    }
    const encoded = jpeg.encode({ width, height, data: out }, 90);
    console.log(`[mrz/preprocess] ok — ${width}×${height}, stretch ${minL}–${maxL}`);
    return encoded.data;
  } catch (err) {
    console.warn("[mrz/preprocess] enhance failed, using original:", err);
    return inputBuffer;
  }
}

router.post("/mrz/ocr", async (req, res) => {
  const { imageBase64 } = req.body as { imageBase64?: string };

  if (!imageBase64 || typeof imageBase64 !== "string") {
    res.status(400).json({ error: "imageBase64 is required" });
    return;
  }

  try {
    const rawBuf = Buffer.from(imageBase64, "base64");
    const enhancedBuf = enhanceImage(rawBuf);
    const processedBase64 = enhancedBuf.toString("base64");
    const dataUrl = `data:image/jpeg;base64,${processedBase64}`;

    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 250,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: { url: dataUrl, detail: "high" },
            },
            { type: "text", text: SYSTEM_PROMPT },
          ],
        },
      ],
    });

    const raw = completion.choices[0]?.message?.content?.trim() ?? "";
    console.log("[mrz/ocr] GPT raw output:", JSON.stringify(raw));

    if (raw === "NONE" || raw === "") {
      res.json({ text: null });
      return;
    }

    // GPT sometimes outputs spaces where faint < filler chars appear.
    // Replace every space with < (spaces are never valid MRZ characters).
    const cleaned = raw
      .split("\n")
      .map((line) => line.replace(/ /g, "<").replace(/\t/g, "<").trim())
      .filter((line) => line.length > 0)
      .join("\n");

    console.log("[mrz/ocr] cleaned:", JSON.stringify(cleaned));
    res.json({ text: cleaned });
  } catch (err) {
    console.error("[mrz/ocr] error:", err);
    res.status(500).json({ error: "OCR failed", text: null });
  }
});

export default router;
