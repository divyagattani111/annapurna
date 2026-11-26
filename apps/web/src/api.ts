import { QueryClient } from "@tanstack/react-query";
import { z } from "zod";
import {
  dashboardResponse,
  previewResponse,
  documentResponse,
  documentListResponse,
  statementResponse,
  bookResponse,
  rowSchema,
} from "@ledger/contracts";
import { type Row } from "./utils/helpers";

export async function api<T = Row>(
  path: string,
  schema: z.ZodType<T> = rowSchema as z.ZodType<T>,
  body?: unknown,
  method?: string,
  key?: string,
  extraHeaders: Record<string, string> = {},
): Promise<T> {
  const actualMethod = method || (body !== undefined ? "POST" : "GET");
  const response = await fetch("/api/v1/" + path, {
    method: actualMethod,
    credentials: "same-origin",
    headers: {
      ...extraHeaders,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(key ? { "Idempotency-Key": key } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message ?? "Request failed");
  const resource = path.split("?")[0];
  const validated =
    resource === "dashboard"
      ? dashboardResponse
      : resource === "preview/bill"
        ? previewResponse
        : resource === "documents"
          ? documentListResponse
          : resource === "documents/lines"
            ? schema
            : resource.startsWith("documents/")
              ? documentResponse
              : resource.startsWith("statements/")
                ? statementResponse
                : resource.startsWith("books/")
                  ? bookResponse
                  : schema;
  return validated.parse(data) as T;
}

export const client = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: true } },
});
