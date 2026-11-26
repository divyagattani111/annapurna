import { useEffect, useRef } from "react";
import { type Row, str } from "./helpers";

export function getProductBarcodes(p: Row): string[] {
  const details = (p.details as Record<string, unknown>) || {};
  const raw = [
    str(p.barcode || ""),
    str(details.barcode || ""),
    str(details.ean || ""),
    ...(Array.isArray(details.barcodes) ? details.barcodes.map(String) : []),
  ];
  const set = new Set<string>();
  for (const item of raw) {
    if (!item) continue;
    const tokens = item.split(/[\s,;]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
    for (const t of tokens) set.add(t);
  }
  return Array.from(set);
}

export function matchProductsByScanOrCode(products: Row[], rawInput: string): Row[] {
  const query = rawInput.trim().toLowerCase();
  if (!query) return [];

  // 1. Exact match on any barcode or ean (supports multiple barcodes per product & multiple products per barcode)
  const byBarcode = products.filter((p) => {
    const barcodes = getProductBarcodes(p);
    return barcodes.includes(query);
  });
  if (byBarcode.length > 0) return byBarcode;

  // 2. Exact match on product code
  const byCode = products.filter((p) => str(p.code).trim().toLowerCase() === query);
  if (byCode.length > 0) return byCode;

  // 3. Exact match on product id
  const byId = products.filter((p) => str(p.id).trim().toLowerCase() === query);
  if (byId.length > 0) return byId;

  // 4. Exact match on name
  const byExactName = products.filter((p) => str(p.name).trim().toLowerCase() === query);
  if (byExactName.length > 0) return byExactName;

  // 5. Code starts with query or name starts with query
  const byPrefix = products.filter((p) =>
    str(p.code).trim().toLowerCase().startsWith(query) ||
    str(p.name).trim().toLowerCase().startsWith(query)
  );
  if (byPrefix.length > 0) return byPrefix;

  // 6. Substring match
  return products.filter((p) =>
    str(p.code).toLowerCase().includes(query) ||
    str(p.name).toLowerCase().includes(query) ||
    getProductBarcodes(p).some((bc) => bc.includes(query))
  );
}

export function matchProductByScanOrCode(products: Row[], rawInput: string): Row | undefined {
  const list = matchProductsByScanOrCode(products, rawInput);
  return list.length > 0 ? list[0] : undefined;
}

export function useGlobalBarcodeScanner({
  enabled,
  products,
  onProductScanned,
  onProductsScanned,
  onRestoreQuantity,
  onScanNotFound,
}: {
  enabled: boolean;
  products: Row[];
  onProductScanned?: (product: Row) => void;
  onProductsScanned?: (products: Row[]) => void;
  onRestoreQuantity?: (rowId: string, prevVal: string) => void;
  onScanNotFound?: (rawBarcode: string) => void;
}) {
  const bufferRef = useRef<{
    chars: string[];
    timestamps: number[];
    targetInput?: HTMLInputElement;
    initialVal?: string;
    rowId?: string;
  }>({
    chars: [],
    timestamps: [],
  });

  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const now = Date.now();

      if (e.key === "Enter" || e.keyCode === 13) {
        const { chars, timestamps, targetInput, initialVal, rowId } = bufferRef.current;
        bufferRef.current = { chars: [], timestamps: [] };

        if (chars.length >= 3 && timestamps.length >= 2) {
          const totalDuration = now - timestamps[0];
          const avgInterval = totalDuration / chars.length;

          // Hardware barcode scanners emit keystrokes rapidly (typically 10-50ms avg interval)
          if (avgInterval < 65) {
            const rawScan = chars.join("").trim();
            const matchedList = matchProductsByScanOrCode(products, rawScan);

            e.preventDefault();
            e.stopPropagation();

            // Revert any input that was focused while the scanner was typing
            if (targetInput) {
              targetInput.value = initialVal ?? "";
              try {
                targetInput.dispatchEvent(new Event("input", { bubbles: true }));
              } catch {
                // ignore
              }
              if (rowId && onRestoreQuantity) {
                onRestoreQuantity(rowId, initialVal ?? "");
              }
            }

            if (matchedList.length > 0) {
              if (onProductsScanned) {
                onProductsScanned(matchedList);
              } else if (onProductScanned) {
                onProductScanned(matchedList[0]);
              }
            } else {
              onScanNotFound?.(rawScan);
              if (targetInput) {
                targetInput.focus();
                targetInput.select?.();
              }
            }
          }
        }
        return;
      }

      if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
        const lastTime = bufferRef.current.timestamps[bufferRef.current.timestamps.length - 1];

        // If time since last char > 85ms, it is manual human typing — reset buffer
        if (lastTime && now - lastTime > 85) {
          bufferRef.current = { chars: [], timestamps: [] };
        }

        if (bufferRef.current.chars.length === 0) {
          const activeEl = document.activeElement as HTMLElement | null;
          const isInput = activeEl?.tagName === "INPUT";
          const inputEl = isInput ? (activeEl as HTMLInputElement) : undefined;
          const rowId = inputEl?.id?.replace(/^qty-input-(?:m-)?/, "");

          bufferRef.current = {
            chars: [e.key],
            timestamps: [now],
            targetInput: inputEl,
            initialVal: inputEl?.value,
            rowId: rowId && rowId !== inputEl?.id ? rowId : undefined,
          };
        } else {
          bufferRef.current.chars.push(e.key);
          bufferRef.current.timestamps.push(now);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [enabled, products, onProductScanned, onProductsScanned, onRestoreQuantity, onScanNotFound]);
}
