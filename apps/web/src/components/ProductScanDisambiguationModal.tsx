import React, { useState, useEffect } from "react";
import { ScanBarcode, CheckCircle2, X, Plus, ArrowRight, Layers } from "lucide-react";
import { type Row, str, rupees } from "../utils/helpers";
import { getProductBarcodes } from "../utils/barcodeScanner";

export interface ProductScanDisambiguationModalProps {
  open: boolean;
  products: Row[];
  scannedCode?: string;
  onSelectProduct: (product: Row) => void;
  onSelectAll?: (products: Row[]) => void;
  onClose: () => void;
}

export function ProductScanDisambiguationModal({
  open,
  products,
  scannedCode,
  onSelectProduct,
  onSelectAll,
  onClose,
}: ProductScanDisambiguationModalProps) {
  const [focusedIndex, setFocusedIndex] = useState(0);

  useEffect(() => {
    if (open) {
      setFocusedIndex(0);
    }
  }, [open, products]);

  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Escape closes
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }

      // 'b' or 'B' triggers Add All / Both
      if ((e.key === "b" || e.key === "B") && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (onSelectAll && products.length > 1) {
          e.preventDefault();
          e.stopPropagation();
          onSelectAll(products);
          return;
        }
      }

      // Number keys 1..9 for direct item selection
      const num = parseInt(e.key, 10);
      if (!isNaN(num) && num >= 1 && num <= products.length) {
        e.preventDefault();
        e.stopPropagation();
        onSelectProduct(products[num - 1]);
        return;
      }

      // Arrow keys navigation
      if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        setFocusedIndex((prev) => (prev > 0 ? prev - 1 : products.length - 1));
        return;
      }
      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        setFocusedIndex((prev) => (prev < products.length - 1 ? prev + 1 : 0));
        return;
      }

      // Enter key confirms currently focused card
      if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        if (products[focusedIndex]) {
          onSelectProduct(products[focusedIndex]);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [open, products, focusedIndex, onSelectProduct, onSelectAll, onClose]);

  if (!open || !products.length) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15, 23, 42, 0.65)",
        backdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1050,
        padding: 16,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          background: "#ffffff",
          borderRadius: 16,
          boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.25)",
          maxWidth: products.length <= 2 ? 680 : 840,
          width: "100%",
          border: "1px solid #e2e8f0",
          overflow: "hidden",
          animation: "modalFadeIn 0.15s ease-out",
        }}
      >
        {/* Modal Header */}
        <div
          style={{
            padding: "20px 24px 16px",
            borderBottom: "1px solid #f1f5f9",
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            background: "#fafafa",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: 12,
                background: "#fef3c7",
                color: "#b45309",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                border: "1px solid #fde68a",
                flexShrink: 0,
              }}
            >
              <ScanBarcode size={24} />
            </div>
            <div>
              <h3
                style={{
                  margin: 0,
                  fontSize: 18,
                  fontWeight: 700,
                  color: "#0f172a",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <span>{products.length} Products Matched</span>
                <span
                  style={{
                    fontSize: 11,
                    background: "#eff6ff",
                    color: "#2563eb",
                    border: "1px solid #bfdbfe",
                    padding: "2px 8px",
                    borderRadius: 9999,
                    fontWeight: 600,
                  }}
                >
                  Action Required
                </span>
              </h3>
              <p style={{ margin: "4px 0 0", fontSize: 13, color: "#64748b", lineHeight: 1.4 }}>
                {scannedCode ? (
                  <>
                    Barcode / Code <strong style={{ color: "#1e293b" }}>"{scannedCode}"</strong> matches{" "}
                    {products.length} products. Choose which one to add:
                  </>
                ) : (
                  <>This scan matches {products.length} products. Choose which one to add:</>
                )}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              color: "#94a3b8",
              cursor: "pointer",
              padding: 4,
              borderRadius: 6,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
            title="Close (Esc)"
          >
            <X size={20} />
          </button>
        </div>

        {/* Product Cards Grid */}
        <div
          style={{
            padding: 24,
            display: "grid",
            gridTemplateColumns: products.length <= 2 ? "repeat(auto-fit, minmax(280px, 1fr))" : "repeat(auto-fit, minmax(240px, 1fr))",
            gap: 16,
            maxHeight: "65vh",
            overflowY: "auto",
          }}
        >
          {products.map((p, idx) => {
            const isFocused = focusedIndex === idx;
            const keyShortcut = idx + 1;
            const pCode = str(p.code);
            const pName = str(p.name);
            const pCategory = str(p.category);
            const pRate = p.rate ? String(p.rate) : "";
            const basisNum = Number(p.basis || 1);
            const pUnit = str(p.unit) || "pcs";
            const barcodes = getProductBarcodes(p);

            return (
              <div
                key={str(p.id) || idx}
                onClick={() => onSelectProduct(p)}
                onMouseEnter={() => setFocusedIndex(idx)}
                style={{
                  border: isFocused ? "2px solid #2563eb" : "2px solid #e2e8f0",
                  borderRadius: 14,
                  padding: "16px 18px",
                  background: isFocused ? "#f8faff" : "#ffffff",
                  cursor: "pointer",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                  boxShadow: isFocused
                    ? "0 8px 20px -4px rgba(37, 99, 235, 0.2)"
                    : "0 1px 3px rgba(0, 0, 0, 0.05)",
                  transition: "all 0.15s ease",
                  position: "relative",
                  outline: "none",
                }}
              >
                {/* Keyboard Shortcut Badge */}
                <div
                  style={{
                    position: "absolute",
                    top: 12,
                    right: 12,
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                    background: isFocused ? "#2563eb" : "#f1f5f9",
                    color: isFocused ? "#ffffff" : "#475569",
                    padding: "3px 9px",
                    borderRadius: 8,
                    fontSize: 12,
                    fontWeight: 700,
                    letterSpacing: "0.02em",
                    border: isFocused ? "1px solid #1d4ed8" : "1px solid #cbd5e1",
                    transition: "all 0.15s ease",
                  }}
                  title={`Press '${keyShortcut}' on your keyboard to select`}
                >
                  <span>Key</span>
                  <kbd style={{ fontFamily: "monospace", fontSize: 13 }}>[{keyShortcut}]</kbd>
                </div>

                <div>
                  {/* Code pill */}
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                    <span
                      style={{
                        fontFamily: "monospace",
                        fontSize: 12,
                        fontWeight: 700,
                        background: isFocused ? "#e0e7ff" : "#f1f5f9",
                        color: isFocused ? "#3730a3" : "#334155",
                        padding: "2px 8px",
                        borderRadius: 6,
                        border: isFocused ? "1px solid #c7d2fe" : "1px solid #e2e8f0",
                      }}
                    >
                      {pCode || `ID: ${str(p.id)}`}
                    </span>
                    {pCategory && (
                      <span
                        style={{
                          fontSize: 11,
                          color: "#64748b",
                          fontWeight: 500,
                          textTransform: "uppercase",
                          letterSpacing: "0.03em",
                        }}
                      >
                        {pCategory}
                      </span>
                    )}
                  </div>

                  {/* Name */}
                  <h4
                    style={{
                      margin: "0 0 8px",
                      fontSize: 16,
                      fontWeight: 700,
                      color: "#0f172a",
                      lineHeight: 1.35,
                      paddingRight: 40,
                    }}
                  >
                    {pName}
                  </h4>

                  {/* Barcodes tag if present */}
                  {barcodes.length > 0 && (
                    <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 12 }}>
                      Barcode: {barcodes.join(", ")}
                    </div>
                  )}
                </div>

                {/* Bottom details & action button */}
                <div style={{ marginTop: 14 }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "baseline",
                      justifyContent: "space-between",
                      paddingBottom: 12,
                      borderBottom: "1px dashed #e2e8f0",
                      marginBottom: 12,
                    }}
                  >
                    <span style={{ fontSize: 12, color: "#64748b", fontWeight: 500 }}>Selling Rate:</span>
                    <div style={{ textAlign: "right" }}>
                      <span style={{ fontSize: 18, fontWeight: 800, color: "#059669" }}>
                        {pRate ? rupees(pRate) : "—"}
                      </span>
                      {basisNum > 1 ? (
                        <span style={{ fontSize: 11, color: "#64748b", marginLeft: 4 }}>
                          / {basisNum} {pUnit}
                        </span>
                      ) : pUnit ? (
                        <span style={{ fontSize: 11, color: "#64748b", marginLeft: 4 }}>
                          / {pUnit}
                        </span>
                      ) : null}
                    </div>
                  </div>

                  <button
                    type="button"
                    style={{
                      width: "100%",
                      padding: "9px 14px",
                      borderRadius: 9,
                      border: "none",
                      background: isFocused ? "#2563eb" : "#f1f5f9",
                      color: isFocused ? "#ffffff" : "#1e293b",
                      fontWeight: 600,
                      fontSize: 13,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 8,
                      cursor: "pointer",
                      transition: "all 0.15s ease",
                    }}
                  >
                    <CheckCircle2 size={16} />
                    <span>Select this product</span>
                    <ArrowRight size={14} style={{ opacity: isFocused ? 1 : 0.6 }} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Modal Footer */}
        <div
          style={{
            padding: "14px 24px",
            borderTop: "1px solid #f1f5f9",
            background: "#f8fafc",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: 12,
          }}
        >
          <div style={{ fontSize: 12, color: "#64748b", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <span>
              💡 Press <kbd style={{ background: "#e2e8f0", padding: "1px 5px", borderRadius: 4, fontWeight: 700, color: "#1e293b" }}>1</kbd> or <kbd style={{ background: "#e2e8f0", padding: "1px 5px", borderRadius: 4, fontWeight: 700, color: "#1e293b" }}>2</kbd> on keyboard to pick
            </span>
            <span>•</span>
            <span>
              <kbd style={{ background: "#e2e8f0", padding: "1px 5px", borderRadius: 4, fontWeight: 700, color: "#1e293b" }}>Enter</kbd> confirms selected
            </span>
            <span>•</span>
            <span>
              <kbd style={{ background: "#e2e8f0", padding: "1px 5px", borderRadius: 4, fontWeight: 700, color: "#1e293b" }}>Esc</kbd> cancels
            </span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {onSelectAll && products.length > 1 && (
              <button
                type="button"
                onClick={() => onSelectAll(products)}
                style={{
                  padding: "8px 14px",
                  borderRadius: 8,
                  border: "1px solid #cbd5e1",
                  background: "#ffffff",
                  color: "#334155",
                  fontSize: 13,
                  fontWeight: 600,
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  cursor: "pointer",
                }}
                title="Add all matched products (Shortcut: B)"
              >
                <Layers size={15} />
                <span>Add Both</span>
                <kbd style={{ fontSize: 10, background: "#f1f5f9", padding: "1px 4px", borderRadius: 3, color: "#64748b" }}>[B]</kbd>
              </button>
            )}

            <button
              type="button"
              onClick={onClose}
              style={{
                padding: "8px 14px",
                borderRadius: 8,
                border: "1px solid #cbd5e1",
                background: "#ffffff",
                color: "#64748b",
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
