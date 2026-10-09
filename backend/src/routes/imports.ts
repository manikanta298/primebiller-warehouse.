/** Bulk-import file parsing: Excel, JSON, Google Sheets links and CSV → rows of strings. */
import { Router } from "express";
import { z } from "zod";
import { ApiError } from "../errors.js";
import { h } from "../http.js";
import { requirePerm } from "../auth.js";
import { fetchGoogleSheet, googleSheetCsvUrl, parseImportBytes } from "../shared/import-parse.js";

export const importRouter = Router();

const input = z.object({
  fileName: z.string().max(255).default(""),
  contentBase64: z.string().max(14_000_000).optional(),
  url: z.string().max(2000).optional(),
}).refine((v) => v.contentBase64 || v.url, "Send a file or a link");

importRouter.post("/import/parse", h(async (req) => {
  requirePerm(req.ctx, "editMasters", "Only Owner or Manager can import");
  const body = input.parse(req.body);
  try {
    if (body.url) {
      const u = googleSheetCsvUrl(body.url);
      if (!u) throw new ApiError(400, "bad_link", "Only Google Sheets links are supported");
      return { rows: await fetchGoogleSheet(u) };
    }
    const r = parseImportBytes(new Uint8Array(Buffer.from(body.contentBase64!, "base64")));
    return { rows: "sheetUrl" in r ? await fetchGoogleSheet(r.sheetUrl) : r.grid };
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(422, "unreadable_file", e instanceof Error ? e.message : "File could not be read");
  }
}));
