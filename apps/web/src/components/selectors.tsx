/**
 * Shared searchable dropdowns and scanner input controls.
 * Used across billing pages, forms, and transaction entries.
 */
import React, { useEffect, useRef, useState } from "react";
import { Barcode, Store, Search, ScanBarcode, CheckCircle2, X } from "lucide-react";
import { matchProductsByScanOrCode, matchProductByScanOrCode, getProductBarcodes } from "../utils/barcodeScanner";
import { str, rupees, type Row } from "../utils/helpers";
import { Button } from "./ui";



export function CustomerSearchableSelect({
  customers,
  selectedId,
  onSelect,
  placeholder = "Search and select customer…",
}: {
  customers: Row[];
  selectedId: string;
  onSelect: (customerId: string) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selectedCustomer = customers.find((c) => str(c.id) === selectedId);

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) {
      document.addEventListener("mousedown", handleOutsideClick);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [open]);

  const filtered = customers.filter((c) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      str(c.customer_name).toLowerCase().includes(q) ||
      str(c.customer_id).toLowerCase().includes(q) ||
      str(c.beat_name).toLowerCase().includes(q) ||
      str(c.beat_code).toLowerCase().includes(q)
    );
  });

  return (
    <div ref={containerRef} style={{ position: "relative", width: "100%" }}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        style={{
          width: "100%",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "10px 14px",
          background: "#ffffff",
          border: open ? "1.5px solid #ea580c" : "1px solid #cbd5e1",
          borderRadius: 10,
          fontSize: 13,
          fontWeight: 500,
          color: selectedCustomer ? "#0f172a" : "#94a3b8",
          cursor: "pointer",
          textAlign: "left",
          boxShadow: open ? "0 0 0 3px rgba(234, 88, 12, 0.12)" : "0 1px 2px rgba(0,0,0,0.03)",
          transition: "all 0.15s ease",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, overflow: "hidden" }}>
          <Store size={16} color={selectedCustomer ? "#ea580c" : "#94a3b8"} style={{ flexShrink: 0 }} />
          {selectedCustomer ? (
            <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              <span style={{ fontWeight: 600, color: "#0f172a" }}>
                {str(selectedCustomer.customer_name)}
              </span>{" "}
              <span style={{ color: "#64748b", fontSize: 12 }}>
                ({str(selectedCustomer.beat_name) || `Beat ${str(selectedCustomer.beat_code)}`})
              </span>
            </div>
          ) : (
            <span>{placeholder}</span>
          )}
        </div>
        <span style={{ fontSize: 11, color: "#64748b", marginLeft: 8 }}>▼</span>
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            left: 0,
            right: 0,
            zIndex: 9999,
            background: "#ffffff",
            border: "1px solid #e2e8f0",
            borderRadius: 10,
            boxShadow: "0 12px 28px -4px rgba(0,0,0,0.12), 0 4px 12px -2px rgba(0,0,0,0.08)",
            padding: 8,
            minWidth: 280,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "6px 10px",
              background: "#f8fafc",
              border: "1px solid #e2e8f0",
              borderRadius: 8,
              marginBottom: 6,
            }}
          >
            <Search size={15} color="#64748b" />
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.keyCode === 13) {
                  e.preventDefault();
                  e.stopPropagation();
                  if (filtered.length > 0) {
                    onSelect(str(filtered[0].id));
                    setOpen(false);
                    setSearch("");
                  }
                }
              }}
              placeholder="Type customer name, code or beat…"
              style={{
                border: "none",
                background: "transparent",
                outline: "none",
                width: "100%",
                fontSize: 13,
                color: "#0f172a",
              }}
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                style={{
                  border: "none",
                  background: "transparent",
                  color: "#94a3b8",
                  cursor: "pointer",
                  padding: 0,
                  fontSize: 13,
                }}
              >
                ✕
              </button>
            )}
          </div>

          <div style={{ maxHeight: 250, overflowY: "auto" }}>
            {filtered.length === 0 ? (
              <div style={{ padding: "12px", textAlign: "center", color: "#94a3b8", fontSize: 13 }}>
                No customer found matching "{search}"
              </div>
            ) : (
              filtered.map((c) => {
                const isSelected = str(c.id) === selectedId;
                const balNum = parseFloat(str(c.balance || "0"));
                return (
                  <div
                    key={str(c.id)}
                    onClick={() => {
                      onSelect(str(c.id));
                      setOpen(false);
                      setSearch("");
                    }}
                    style={{
                      padding: "8px 12px",
                      borderRadius: 6,
                      background: isSelected ? "#fff7ed" : "transparent",
                      cursor: "pointer",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      borderBottom: "1px solid #f8fafc",
                      transition: "background 0.1s ease",
                    }}
                    onMouseEnter={(e) => {
                      if (!isSelected) e.currentTarget.style.background = "#f8fafc";
                    }}
                    onMouseLeave={(e) => {
                      if (!isSelected) e.currentTarget.style.background = "transparent";
                    }}
                  >
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: isSelected ? "#ea580c" : "#1e293b" }}>
                        {str(c.customer_name)}
                      </div>
                      <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
                        <span style={{ fontFamily: "monospace" }}>{str(c.customer_id)}</span> ·{" "}
                        <span>{str(c.beat_name) || `Beat ${str(c.beat_code)}`}</span>
                      </div>
                    </div>
                    <div style={{ textAlign: "right", marginLeft: 12 }}>
                      <div
                        style={{
                          fontSize: 12,
                          fontWeight: 700,
                          color: balNum > 0 ? "#dc2626" : "#16a34a",
                        }}
                      >
                        {rupees(c.balance)}
                      </div>
                      <div style={{ fontSize: 10, color: "#94a3b8" }}>
                        {balNum > 0 ? "due" : "clear"}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}


export interface DraftConfectioneryItem {
  rowId?: string;
  productId?: string;
  code?: string;
  name?: string;
  quantity?: string;
  rate?: string;
  isManual?: boolean;
}


export function ProductIdSearchableSelect({
  products,
  selectedId,
  onSelect,
  disabledIds,
}: {
  products: Row[];
  selectedId: string;
  onSelect: (productId: string) => void;
  disabledIds?: string[] | Set<string>;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedProduct = products.find((p) => str(p.id) === selectedId);

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) {
      document.addEventListener("mousedown", handleOutsideClick);
    }
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [open]);

  const filtered = products.filter((p) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    const barcodes = getProductBarcodes(p);
    return (
      str(p.code).toLowerCase().includes(q) ||
      str(p.name).toLowerCase().includes(q) ||
      barcodes.some((bc) => bc.includes(q))
    );
  });

  return (
    <div ref={containerRef} style={{ position: "relative", width: "100%", minWidth: 0 }}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        style={{
          width: "100%",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "9px 12px",
          minHeight: 42,
          borderRadius: 8,
          border: "1.5px solid #cbd5e1",
          background: selectedProduct ? "#f8fafc" : "#ffffff",
          color: selectedProduct ? "#0f172a" : "#64748b",
          fontFamily: selectedProduct ? "monospace" : "inherit",
          fontWeight: 700,
          fontSize: 14,
          cursor: "pointer",
          textAlign: "left",
          boxSizing: "border-box",
        }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
          {selectedProduct ? str(selectedProduct.code) : "Search ID…"}
        </span>
        <span style={{ fontSize: 11, color: "#64748b", marginLeft: 6 }}>▼</span>
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            width: "min(320px, calc(100vw - 32px))",
            maxWidth: "calc(100vw - 32px)",
            background: "#ffffff",
            border: "1px solid #cbd5e1",
            borderRadius: 10,
            boxShadow: "0 12px 24px -4px rgba(0,0,0,0.15), 0 4px 6px -2px rgba(0,0,0,0.05)",
            zIndex: 100,
            padding: 8,
          }}
        >
          <input
            autoFocus
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.keyCode === 13) {
                e.preventDefault();
                e.stopPropagation();
                if (filtered.length > 0) {
                  const first = filtered[0];
                  const isAlreadyAdded = Boolean(
                    disabledIds && (disabledIds instanceof Set ? disabledIds.has(str(first.id)) : disabledIds.includes(str(first.id)))
                  );
                  if (!isAlreadyAdded) {
                    onSelect(str(first.id));
                    setOpen(false);
                    setSearch("");
                  }
                }
              }
            }}
            placeholder="Search product code / name…"
            style={{
              width: "100%",
              padding: "8px 12px",
              border: "1.5px solid #94a3b8",
              borderRadius: 6,
              fontSize: 13,
              marginBottom: 8,
              boxSizing: "border-box",
              fontFamily: "monospace",
              outline: "none",
            }}
          />
          <div style={{ maxHeight: 260, overflowY: "auto" }}>
            {filtered.length === 0 ? (
              <div style={{ padding: "12px 10px", fontSize: 13, color: "#94a3b8", textAlign: "center" }}>
                No matching product
              </div>
            ) : (
              filtered.map((p) => {
                const isSelected = str(p.id) === selectedId;
                const isAlreadyAdded = Boolean(
                  disabledIds && (disabledIds instanceof Set ? disabledIds.has(str(p.id)) : disabledIds.includes(str(p.id)))
                );
                return (
                  <div
                    key={str(p.id)}
                    onClick={() => {
                      if (isAlreadyAdded) return;
                      onSelect(str(p.id));
                      setOpen(false);
                      setSearch("");
                    }}
                    style={{
                      padding: "8px 12px",
                      borderRadius: 6,
                      fontSize: 13,
                      cursor: isAlreadyAdded ? "not-allowed" : "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      background: isSelected ? "#fed7aa" : isAlreadyAdded ? "#f8fafc" : "transparent",
                      opacity: isAlreadyAdded ? 0.5 : 1,
                    }}
                    onMouseEnter={(e) => {
                      if (!isSelected && !isAlreadyAdded) e.currentTarget.style.background = "#f1f5f9";
                    }}
                    onMouseLeave={(e) => {
                      if (!isSelected && !isAlreadyAdded) e.currentTarget.style.background = isAlreadyAdded ? "#f8fafc" : "transparent";
                    }}
                  >
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <strong style={{ fontFamily: "monospace", color: isAlreadyAdded ? "#94a3b8" : "#0f172a", fontSize: 14 }}>
                          {str(p.code)}
                        </strong>
                        {isAlreadyAdded && (
                          <span style={{ fontSize: 10, background: "#e2e8f0", color: "#64748b", padding: "1px 5px", borderRadius: 4, fontWeight: 600 }}>
                            Already in bill
                          </span>
                        )}
                      </div>
                      <div style={{ color: isAlreadyAdded ? "#94a3b8" : "#475569", fontSize: 12, marginTop: 1 }}>{str(p.name)}</div>
                    </div>
                    {isSelected && <span style={{ color: "#c2410c", fontSize: 14, fontWeight: 800 }}>✓</span>}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function ProductSearchableSelect({
  products,
  selectedId,
  onSelect,
  disabledIds,
}: {
  products: Row[];
  selectedId: string;
  onSelect: (productId: string) => void;
  disabledIds?: string[] | Set<string>;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedProduct = products.find((p) => str(p.id) === selectedId);

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) {
      document.addEventListener("mousedown", handleOutsideClick);
    }
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [open]);

  const filtered = products.filter((p) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    const barcodes = getProductBarcodes(p);
    return (
      str(p.name).toLowerCase().includes(q) ||
      str(p.code).toLowerCase().includes(q) ||
      barcodes.some((bc) => bc.includes(q))
    );
  });

  return (
    <div ref={containerRef} style={{ position: "relative", width: "100%", minWidth: 0 }}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        style={{
          width: "100%",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "9px 12px",
          minHeight: 42,
          borderRadius: 8,
          border: "1.5px solid #cbd5e1",
          background: selectedProduct ? "#f8fafc" : "#ffffff",
          color: selectedProduct ? "#0f172a" : "#64748b",
          fontWeight: 600,
          fontSize: 13,
          cursor: "pointer",
          textAlign: "left",
          boxSizing: "border-box",
        }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
          {selectedProduct ? str(selectedProduct.name) : "Select product…"}
        </span>
        <span style={{ fontSize: 11, color: "#64748b", marginLeft: 6 }}>▼</span>
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            width: "min(340px, calc(100vw - 32px))",
            maxWidth: "calc(100vw - 32px)",
            background: "#ffffff",
            border: "1px solid #cbd5e1",
            borderRadius: 10,
            boxShadow: "0 12px 24px -4px rgba(0,0,0,0.15), 0 4px 6px -2px rgba(0,0,0,0.05)",
            zIndex: 100,
            padding: 8,
          }}
        >
          <input
            autoFocus
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.keyCode === 13) {
                e.preventDefault();
                e.stopPropagation();
                if (filtered.length > 0) {
                  const first = filtered[0];
                  const isAlreadyAdded = Boolean(
                    disabledIds && (disabledIds instanceof Set ? disabledIds.has(str(first.id)) : disabledIds.includes(str(first.id)))
                  );
                  if (!isAlreadyAdded) {
                    onSelect(str(first.id));
                    setOpen(false);
                    setSearch("");
                  }
                }
              }
            }}
            placeholder="Search product name / code…"
            style={{
              width: "100%",
              padding: "8px 12px",
              border: "1.5px solid #94a3b8",
              borderRadius: 6,
              fontSize: 13,
              marginBottom: 8,
              boxSizing: "border-box",
              outline: "none",
            }}
          />
          <div style={{ maxHeight: 260, overflowY: "auto" }}>
            {filtered.length === 0 ? (
              <div style={{ padding: "12px 10px", fontSize: 13, color: "#94a3b8", textAlign: "center" }}>
                No matching product
              </div>
            ) : (
              filtered.map((p) => {
                const isSelected = str(p.id) === selectedId;
                const isAlreadyAdded = Boolean(
                  disabledIds && (disabledIds instanceof Set ? disabledIds.has(str(p.id)) : disabledIds.includes(str(p.id)))
                );
                return (
                  <div
                    key={str(p.id)}
                    onClick={() => {
                      if (isAlreadyAdded) return;
                      onSelect(str(p.id));
                      setOpen(false);
                      setSearch("");
                    }}
                    style={{
                      padding: "8px 12px",
                      borderRadius: 6,
                      fontSize: 13,
                      cursor: isAlreadyAdded ? "not-allowed" : "pointer",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      background: isSelected ? "#fed7aa" : isAlreadyAdded ? "#f8fafc" : "transparent",
                      opacity: isAlreadyAdded ? 0.5 : 1,
                    }}
                    onMouseEnter={(e) => {
                      if (!isSelected && !isAlreadyAdded) e.currentTarget.style.background = "#f1f5f9";
                    }}
                    onMouseLeave={(e) => {
                      if (!isSelected && !isAlreadyAdded) e.currentTarget.style.background = isAlreadyAdded ? "#f8fafc" : "transparent";
                    }}
                  >
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <div style={{ fontWeight: 700, color: isAlreadyAdded ? "#94a3b8" : "#0f172a", fontSize: 14 }}>
                          {str(p.name)}
                        </div>
                        {isAlreadyAdded && (
                          <span style={{ fontSize: 10, background: "#e2e8f0", color: "#64748b", padding: "1px 5px", borderRadius: 4, fontWeight: 600 }}>
                            Already in bill
                          </span>
                        )}
                      </div>
                      <div style={{ color: isAlreadyAdded ? "#94a3b8" : "#475569", fontSize: 12, marginTop: 2 }}>
                        Code: <b style={{ fontFamily: "monospace" }}>{str(p.code)}</b> · Rate: <b>₹{str(p.rate || "0")}</b> / {String(p.basis || 1)}m
                      </div>
                    </div>
                    {isSelected && <span style={{ color: "#c2410c", fontSize: 14, fontWeight: 800 }}>✓</span>}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export interface ConfectioneryRowItem {
  rowId: string;
  productId: string;
  code: string;
  name: string;
  quantity: string;
  rate: string;
  isManual: boolean;
}

export function ConfectionerySearchableSelect({
  products,
  selectedId,
  selectedName,
  onSelectMaster,
  onSelectManual,
  disabledIds,
}: {
  products: Row[];
  selectedId?: string;
  selectedName?: string;
  onSelectMaster: (product: Row) => void;
  onSelectManual: (customName: string) => void;
  disabledIds?: string[] | Set<string>;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedProduct = products.find((p) => str(p.id) === selectedId);
  const displayName = selectedProduct ? str(selectedProduct.name) : selectedName || "";

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) {
      document.addEventListener("mousedown", handleOutsideClick);
    }
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [open]);

  const filtered = products.filter((p) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return str(p.name).toLowerCase().includes(q) || str(p.code).toLowerCase().includes(q);
  });

  return (
    <div ref={containerRef} style={{ position: "relative", minWidth: 0, width: "100%" }}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        style={{
          width: "100%",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "7px 10px",
          background: displayName ? "#ffffff" : "#fdfefe",
          border: "1px solid #cbd5e1",
          borderRadius: 8,
          fontSize: 13,
          fontWeight: 600,
          color: displayName ? "#0f172a" : "#64748b",
          cursor: "pointer",
          textAlign: "left",
          minHeight: 38,
          boxSizing: "border-box",
        }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
          {displayName || "Select from master or type…"}
        </span>
        <span style={{ fontSize: 11, color: "#64748b", marginLeft: 6 }}>▼</span>
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            width: "min(340px, calc(100vw - 32px))",
            maxWidth: "calc(100vw - 32px)",
            background: "#ffffff",
            border: "1px solid #cbd5e1",
            borderRadius: 10,
            boxShadow: "0 12px 24px -4px rgba(0,0,0,0.15), 0 4px 6px -2px rgba(0,0,0,0.05)",
            zIndex: 100,
            padding: 8,
          }}
        >
          <input
            autoFocus
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.keyCode === 13) {
                e.preventDefault();
                e.stopPropagation();
                if (search.trim()) {
                  onSelectManual(search.trim());
                  setOpen(false);
                  setSearch("");
                }
              }
            }}
            placeholder="Search master or type custom item…"
            style={{
              width: "100%",
              padding: "7px 10px",
              border: "1.5px solid #94a3b8",
              borderRadius: 6,
              fontSize: 13,
              marginBottom: 8,
              boxSizing: "border-box",
              outline: "none",
            }}
          />

          <div style={{ maxHeight: 220, overflowY: "auto" }}>
            {search.trim() && (
              <div
                onClick={() => {
                  onSelectManual(search.trim());
                  setOpen(false);
                  setSearch("");
                }}
                style={{
                  padding: "7px 10px",
                  borderRadius: 6,
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: "pointer",
                  color: "#d97706",
                  background: "#fffbeb",
                  border: "1px dashed #f59e0b",
                  marginBottom: 6,
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <span>➕ Use custom: <b>"{search.trim()}"</b></span>
              </div>
            )}

            {filtered.length === 0 && !search.trim() ? (
              <div style={{ padding: "12px 10px", fontSize: 13, color: "#94a3b8", textAlign: "center" }}>
                No confectionery items in master
              </div>
            ) : (
              filtered.map((p) => {
                const isSelected = str(p.id) === selectedId;
                const isAlreadyAdded = Boolean(
                  disabledIds && (disabledIds instanceof Set ? disabledIds.has(str(p.id)) : disabledIds.includes(str(p.id)))
                );
                return (
                  <div
                    key={str(p.id)}
                    onClick={() => {
                      if (isAlreadyAdded) return;
                      onSelectMaster(p);
                      setOpen(false);
                      setSearch("");
                    }}
                    style={{
                      padding: "7px 10px",
                      borderRadius: 6,
                      fontSize: 13,
                      cursor: isAlreadyAdded ? "not-allowed" : "pointer",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      background: isSelected ? "#fed7aa" : isAlreadyAdded ? "#f8fafc" : "transparent",
                      opacity: isAlreadyAdded ? 0.5 : 1,
                    }}
                    onMouseEnter={(e) => {
                      if (!isSelected && !isAlreadyAdded) e.currentTarget.style.background = "#f1f5f9";
                    }}
                    onMouseLeave={(e) => {
                      if (!isSelected && !isAlreadyAdded) e.currentTarget.style.background = isAlreadyAdded ? "#f8fafc" : "transparent";
                    }}
                  >
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <div style={{ fontWeight: 700, color: isAlreadyAdded ? "#94a3b8" : "#0f172a", fontSize: 13 }}>
                          {str(p.name)}
                        </div>
                        {isAlreadyAdded && (
                          <span style={{ fontSize: 10, background: "#e2e8f0", color: "#64748b", padding: "1px 5px", borderRadius: 4, fontWeight: 600 }}>
                            Already in bill
                          </span>
                        )}
                      </div>
                      <div style={{ color: isAlreadyAdded ? "#94a3b8" : "#64748b", fontSize: 11, marginTop: 2 }}>
                        Code: <b style={{ fontFamily: "monospace" }}>{str(p.code)}</b> · Rate: <b>₹{str(p.rate || "0")}</b> / pc
                      </div>
                    </div>
                    {isSelected && <span style={{ color: "#c2410c", fontSize: 14, fontWeight: 800 }}>✓</span>}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function BarcodeScannerInput({
  products,
  onProductScanned,
  onProductsScanned,
  externalNotFoundCode,
  onClearNotFound,
  autoFocus = false,
}: {
  products: Row[];
  onProductScanned?: (product: Row) => void;
  onProductsScanned?: (products: Row[]) => void;
  externalNotFoundCode?: string | null;
  onClearNotFound?: () => void;
  autoFocus?: boolean;
}) {
  const [scanValue, setScanValue] = useState("");
  const [scanStatus, setScanStatus] = useState<"idle" | "found" | "not_found">("idle");
  const [lastScannedName, setLastScannedName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (externalNotFoundCode) {
      setScanStatus("not_found");
      const timer = setTimeout(() => {
        setScanStatus("idle");
        onClearNotFound?.();
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [externalNotFoundCode]);

  const handleScanSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    const query = scanValue.trim();
    if (!query) return;

    const matchedList = matchProductsByScanOrCode(products, query);
    if (matchedList.length > 0) {
      setScanStatus("found");
      setLastScannedName(
        matchedList.length > 1
          ? `${matchedList.length} items (${matchedList.map((p) => str(p.name)).join(", ")})`
          : str(matchedList[0].name)
      );
      setScanValue("");
      if (onProductsScanned) {
        onProductsScanned(matchedList);
      } else if (onProductScanned) {
        onProductScanned(matchedList[0]);
      }
      setTimeout(() => setScanStatus("idle"), 2500);
    } else {
      setScanStatus("not_found");
      setTimeout(() => setScanStatus("idle"), 3000);
    }
  };

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 12,
        padding: "10px 14px",
        background: scanStatus === "found" ? "#ecfdf5" : scanStatus === "not_found" ? "#fef2f2" : "#f8fafc",
        border: `1.5px solid ${scanStatus === "found" ? "#10b981" : scanStatus === "not_found" ? "#f87171" : "#cbd5e1"}`,
        borderRadius: 10,
        marginBottom: 16,
        transition: "all 0.2s ease",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, color: scanStatus === "found" ? "#059669" : "#475569" }}>
        <Barcode size={22} />
        <span style={{ fontSize: 13, fontWeight: 700, whiteSpace: "nowrap" }}>
          Scan Barcode / Code:
        </span>
        <span
          style={{
            fontSize: 10,
            background: "#ecfdf5",
            color: "#059669",
            border: "1px solid #a7f3d0",
            borderRadius: 6,
            padding: "2px 6px",
            fontWeight: 700,
          }}
          title="Auto-detect is active. You can scan barcodes directly from anywhere on this page without clicking the input."
        >
          ⚡ Auto-Detect ON
        </span>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 240 }}>
        <input
          ref={inputRef}
          autoFocus={autoFocus}
          type="text"
          value={scanValue}
          onChange={(e) => setScanValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.keyCode === 13) {
              e.preventDefault();
              e.stopPropagation();
              handleScanSubmit();
            }
          }}
          placeholder="Scan barcode or type product code & press Enter…"
          style={{
            flex: 1,
            padding: "8px 12px",
            borderRadius: 8,
            border: "1.5px solid #94a3b8",
            fontSize: 14,
            fontWeight: 500,
            background: "#ffffff",
            outline: "none",
          }}
        />
        <Button
          type="button"
          onClick={() => handleScanSubmit()}
          className="secondary"
          style={{
            fontSize: 13,
            padding: "8px 14px",
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            background: "#ffffff",
            fontWeight: 600,
          }}
        >
          <ScanBarcode size={15} /> Add Item
        </Button>
      </div>

      {scanStatus === "found" && (
        <span style={{ fontSize: 12, fontWeight: 700, color: "#059669", display: "flex", alignItems: "center", gap: 4 }}>
          <CheckCircle2 size={16} /> Selected: {lastScannedName} → Enter Qty
        </span>
      )}
      {scanStatus === "not_found" && (
        <span style={{ fontSize: 12, fontWeight: 700, color: "#dc2626", display: "flex", alignItems: "center", gap: 4 }}>
          <X size={16} /> No product matched "{externalNotFoundCode || scanValue}"
        </span>
      )}
    </div>
  );
}

