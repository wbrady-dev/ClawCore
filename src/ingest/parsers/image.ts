/**
 * Image parser — extracts text via OCR (Tesseract).
 *
 * Supports: .png, .jpg, .jpeg, .gif, .webp, .bmp, .tiff
 * Requires: tesseract installed and on PATH
 *   Windows: choco install tesseract / download from GitHub
 *   Linux: apt install tesseract-ocr
 *   macOS: brew install tesseract
 *
 * Falls back to metadata-only if Tesseract is not available.
 */

import { basename } from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { config } from "../../config.js";
import type { ParsedDocument, DocMetadata } from "./index.js";

const execFileAsync = promisify(execFile);

let _tesseractAvailable: boolean | null = null;

async function isTesseractAvailable(): Promise<boolean> {
  if (_tesseractAvailable !== null) return _tesseractAvailable;
  try {
    await execFileAsync("tesseract", ["--version"], { timeout: 5000 });
    _tesseractAvailable = true;
  } catch {
    _tesseractAvailable = false;
  }
  return _tesseractAvailable;
}

export async function parseImage(filePath: string): Promise<ParsedDocument> {
  const metadata: DocMetadata = {
    fileType: "image",
    title: basename(filePath),
    source: filePath,
  };

  // Removed existsSync check — TOCTOU race. The file could disappear between
  // check and execFileSync anyway, so let Tesseract report the error directly.

  if (!(await isTesseractAvailable())) {
    return {
      text: `[Image: ${basename(filePath)} — OCR unavailable (install Tesseract for text extraction)]`,
      structure: [],
      metadata,
    };
  }

  try {
    // Run Tesseract OCR — use execFileAsync with args array to prevent shell injection
    const { stdout } = await execFileAsync(
      "tesseract", [filePath, "stdout", "-l", config.extraction.ocrLanguage, "--psm", "3"],
      { timeout: config.extraction.ocrTimeoutMs, maxBuffer: 10 * 1024 * 1024 },
    );
    const result = stdout.trim();

    if (!result || result.length < 3) {
      return {
        text: `[Image: ${basename(filePath)} — no text detected by OCR]`,
        structure: [],
        metadata,
      };
    }

    return { text: result, structure: [], metadata };
  } catch (err: any) {
    return {
      text: `[Image: ${basename(filePath)} — OCR failed: ${err.message?.substring(0, 100) ?? "unknown error"}]`,
      structure: [],
      metadata,
    };
  }
}
