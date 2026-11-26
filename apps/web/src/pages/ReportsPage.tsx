import React, {
  useEffect,
  useRef,
  useState,
  useCallback,
  useMemo,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import Decimal from "decimal.js";
import {
  Calendar,
  Copy,
  Download,
  Package,
  PanelLeftClose,
  PanelLeftOpen,
  Printer,
  Search,
  Star,
  X,
} from "lucide-react";
import {
  rowsSchema, rowSchema, commandResult, commands, cleanMoney, cleanDecimal,
  parseMultiAmounts, cleanIndianPhone, type CommandName,
  encodeCsvRows,
} from "@ledger/contracts";
import { api } from "../api";
import { Button, Field, Empty, Table, DocLink, NoteTooltip } from "../components/ui";
import {
  D, str, arr, rupees, formatCents, parseCents, parseMoneyNumber,
  formatBilledCaption, dateLabel, timeOnlyLabel, formatDateTime, resolveTransactionType, type Row,
} from "../utils/helpers";
import {
  getProductBarcodes, matchProductsByScanOrCode, matchProductByScanOrCode,
  useGlobalBarcodeScanner,
} from "../utils/barcodeScanner";
import {
  CustomerSearchableSelect, ProductIdSearchableSelect, ProductSearchableSelect,
  ConfectionerySearchableSelect, BarcodeScannerInput,
  type ConfectioneryRowItem, type DraftConfectioneryItem,
} from "../components/selectors";

function reportColumns(rows: Row[]): [string, string, boolean?][] {
  return rows.length
    ? Object.keys(rows[0])
      .filter((k) => k !== "id" && !k.endsWith("_id") && k !== "matches" && (k !== "created_at" || !("date" in rows[0])))
      .map((k) => [
        k,
        k.replaceAll("_", " "),
        /^(amount|expense|due|advance|signed_balance|signed_outstanding|principal|handed_over|credited|returned|in_transit|expected|counted|difference|statement|book|remaining)$/.test(
          k,
        ),
      ])
    : [];
}


export function StockVerificationReport({
  masters,
  onSelect,
  defaultDate,
}: {
  masters: Row;
  onSelect?: (id: string) => void;
  defaultDate: string;
}) {
  const salesmenList = arr(masters.salesmen).filter((s) => s.active);

  const [loadingSheetFrom, setLoadingSheetFrom] = useState(defaultDate);
  const [loadingSheetTo, setLoadingSheetTo] = useState(defaultDate);
  const [loadingSheetScope, setLoadingSheetScope] = useState<"all" | "route">("all");
  const [selectedSalesmanId, setSelectedSalesmanId] = useState<string>(
    salesmenList[0] ? str(salesmenList[0].id) : "",
  );
  const [selectedBillIds, setSelectedBillIds] = useState<string[]>([]);
  const [hasManuallySelectedBills, setHasManuallySelectedBills] = useState(false);
  const [showReversedBills, setShowReversedBills] = useState(false);
  const [loadingSheetBillSearch, setLoadingSheetBillSearch] = useState("");
  const [copyFeedback, setCopyFeedback] = useState(false);
  const [verifiedItems, setVerifiedItems] = useState<Record<string, boolean>>({});
  const [billsSelectorCollapsed, setBillsSelectorCollapsed] = useState(false);

  // Query bills for the specified date range and route
  const billsQuery = useQuery({
    queryKey: [
      "stock-verification-bills",
      loadingSheetScope === "all" ? "all" : selectedSalesmanId,
      loadingSheetFrom,
      loadingSheetTo,
    ],
    queryFn: () => {
      const params = new URLSearchParams({ kind: "bill", limit: "1000" });
      if (loadingSheetScope === "route" && selectedSalesmanId) {
        params.set("salesmanId", selectedSalesmanId);
      }
      if (loadingSheetFrom.trim()) {
        params.set("from", loadingSheetFrom.trim());
      }
      if (loadingSheetTo.trim()) {
        params.set("to", loadingSheetTo.trim());
      }
      return api<Row[]>(`documents?${params.toString()}`, rowsSchema);
    },
  });

  const loadingBills = useMemo(() => {
    const list = arr(billsQuery.data).filter((b) => showReversedBills || !b.reversed);
    if (!loadingSheetBillSearch.trim()) return list;
    const q = loadingSheetBillSearch.toLowerCase().trim();
    return list.filter((b) => {
      const num = str(b.number).toLowerCase();
      const cName = str((b.data as Row)?.customerName || (b.data as Row)?.customerRef || "").toLowerCase();
      const sName = str(b.salesman_name || "").toLowerCase();
      return num.includes(q) || cName.includes(q) || sName.includes(q);
    });
  }, [billsQuery.data, loadingSheetBillSearch, showReversedBills]);

  const reversedBillsCount = useMemo(() => {
    return arr(billsQuery.data).filter((b) => b.reversed).length;
  }, [billsQuery.data]);

  // Auto-select all available bills on initial load unless user has explicitly customized selection
  useEffect(() => {
    if (!hasManuallySelectedBills && loadingBills.length > 0 && selectedBillIds.length === 0) {
      setSelectedBillIds(loadingBills.map((b) => str(b.id)));
    }
  }, [loadingBills, hasManuallySelectedBills, selectedBillIds.length]);

  // Reset bill selection when route scope or date changes
  useEffect(() => {
    setHasManuallySelectedBills(false);
    setSelectedBillIds([]);
  }, [loadingSheetScope, selectedSalesmanId, loadingSheetFrom, loadingSheetTo]);

  // Query line items across selected bills
  const linesQuery = useQuery({
    queryKey: ["stock-verification-lines", selectedBillIds],
    queryFn: async () => {
      if (selectedBillIds.length === 0) return [];
      return api<Row[]>("documents/lines", rowsSchema, { documentIds: selectedBillIds });
    },
    enabled: selectedBillIds.length > 0,
  });

  // Aggregate items across selected bills
  const aggregatedProducts = useMemo(() => {
    const lines = arr(linesQuery.data);
    const map = new Map<
      string,
      {
        id: string;
        productId: string;
        name: string;
        code: string;
        category: string;
        unit: string;
        rate: string;
        quantity: Decimal;
        amount: Decimal;
        billNumbers: string[];
      }
    >();

    for (const l of lines) {
      const snap = (l.snapshot || {}) as Row;
      const name = str(snap.name || l.name || "Item");
      const unit = str(snap.unit || "unit");
      const rawRate = str(snap.rate || snap.masterRate || "0.00");
      const rate = cleanMoney(rawRate) || rawRate;
      const code = str(snap.code || "");
      const category = str(snap.category || "CG-01 CIGARETTE");
      const pId = str(l.product_id || snap.id || "");
      const key = pId ? `p_${pId}` : (code ? `c_${code.toLowerCase()}` : `n_${name.toLowerCase()}`);
      const docNum = str(l.document_number);

      const qty = D(cleanDecimal(l.quantity) || "0");
      const amt = D(cleanMoney(l.amount) || "0");

      const existing = map.get(key);
      if (existing) {
        existing.quantity = existing.quantity.plus(qty);
        existing.amount = existing.amount.plus(amt);
        if (docNum && !existing.billNumbers.includes(docNum)) {
          existing.billNumbers.push(docNum);
        }
      } else {
        map.set(key, {
          id: key,
          productId: pId,
          name,
          code,
          category,
          unit,
          rate,
          quantity: qty,
          amount: amt,
          billNumbers: docNum ? [docNum] : [],
        });
      }
    }

    return Array.from(map.values()).sort((a, b) => {
      if (a.category !== b.category) {
        const aIsCig = a.category === "CG-01 CIGARETTE" || a.category === "cigarette";
        const bIsCig = b.category === "CG-01 CIGARETTE" || b.category === "cigarette";
        if (aIsCig && !bIsCig) return -1;
        if (!aIsCig && bIsCig) return 1;
      }
      return a.name.localeCompare(b.name);
    });
  }, [linesQuery.data]);

  const totalLoadedQty = useMemo(() => {
    return aggregatedProducts.reduce((sum, p) => sum.plus(p.quantity), D(0));
  }, [aggregatedProducts]);

  const totalLoadedAmount = useMemo(() => {
    return aggregatedProducts.reduce((sum, p) => sum.plus(p.amount), D(0));
  }, [aggregatedProducts]);

  const toggleBill = (id: string) => {
    setHasManuallySelectedBills(true);
    setSelectedBillIds((prev) =>
      prev.includes(id) ? prev.filter((bId) => bId !== id) : [...prev, id],
    );
  };

  const toggleAllBills = () => {
    setHasManuallySelectedBills(true);
    if (selectedBillIds.length === loadingBills.length) {
      setSelectedBillIds([]);
    } else {
      setSelectedBillIds(loadingBills.map((b) => str(b.id)));
    }
  };

  const toggleVerified = (key: string) => {
    setVerifiedItems((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const handleCopyList = () => {
    if (aggregatedProducts.length === 0) return;
    const salesmanName =
      loadingSheetScope === "all"
        ? "All Salesmen / Routes"
        : str(salesmenList.find((s) => str(s.id) === selectedSalesmanId)?.name || "Salesman");
    const dateStr =
      !loadingSheetFrom && !loadingSheetTo
        ? "All Dates"
        : loadingSheetFrom === loadingSheetTo
          ? loadingSheetFrom
          : `${loadingSheetFrom || "Start"} to ${loadingSheetTo || "End"}`;

    const lines = [
      `Stock Verification & Loading Sheet - ${salesmanName}`,
      `Date: ${dateStr} | Bills Included: ${selectedBillIds.length}`,
      "--------------------------------------------------",
    ];

    aggregatedProducts.forEach((p, idx) => {
      lines.push(
        `${idx + 1}. ${p.name}${p.code ? ` (${p.code})` : ""} - ${p.quantity.toString()} ${p.unit} @ ₹${p.rate} = ₹${p.amount.toFixed(2)} [Bills: ${p.billNumbers.length}]`,
      );
    });

    lines.push("--------------------------------------------------");
    lines.push(`Total Quantity to Dispatch: ${totalLoadedQty.toString()}`);
    lines.push(`Total Billed Value: ₹${totalLoadedAmount.toFixed(2)}`);

    navigator.clipboard.writeText(lines.join("\n"));
    setCopyFeedback(true);
    setTimeout(() => setCopyFeedback(false), 2000);
  };

  const handleExportCsv = () => {
    if (aggregatedProducts.length === 0) return;
    const headers = [
      "Index",
      "Product Name",
      "Product Code",
      "Category",
      "Billed Quantity",
      "Unit",
      "Rate (INR)",
      "Total Value (INR)",
      "In Bills Count",
      "Bill Numbers",
    ];
    const rows = aggregatedProducts.map((p, idx) => [
      String(idx + 1),
      `"${p.name.replace(/"/g, '""')}"`,
      `"${p.code}"`,
      `"${p.category}"`,
      p.quantity.toString(),
      `"${p.unit}"`,
      p.rate,
      p.amount.toFixed(2),
      String(p.billNumbers.length),
      `"${p.billNumbers.join(", ")}"`,
    ]);
    const csvContent = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `stock-verification-${loadingSheetFrom || "all"}-${loadingSheetTo || "all"}.csv`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <section className="panel" style={{ marginTop: 6, borderRadius: 16, padding: "20px 22px" }}>
      {/* Top Header & Filter Controls Bar */}
      <div
        className="no-print"
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          flexWrap: "wrap",
          gap: 16,
          marginBottom: 20,
          paddingBottom: 16,
          borderBottom: "1px solid #e2e8f0",
        }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <h2 style={{ margin: 0, fontSize: 19, color: "#0f172a" }}>
              Stock Verification & Loading Sheet
            </h2>
            <span
              style={{
                background: "#e0f2fe",
                color: "#0369a1",
                fontSize: 12,
                fontWeight: 700,
                padding: "3px 9px",
                borderRadius: 6,
              }}
            >
              {loadingSheetScope === "all"
                ? "All Salesmen / Routes"
                : str(salesmenList.find((s) => str(s.id) === selectedSalesmanId)?.name || "Salesman")}
            </span>
          </div>
          <p className="muted" style={{ margin: "4px 0 0", fontSize: 13 }}>
            Tally and aggregate all products across billed dispatches to verify physical vehicle loading and warehouse dispatch stock.
          </p>
        </div>

        {/* Controls Bar: Scope Toggle & Date Range Selector */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 12,
          }}
        >
          {/* Salesman Scope Toggle & Dropdown */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              background: "#f8fafc",
              padding: "6px 12px",
              borderRadius: 10,
              border: "1px solid #e2e8f0",
            }}
          >
            <span style={{ fontSize: 12, fontWeight: 700, color: "#475569" }}>Route / Salesman:</span>
            <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
              <button
                type="button"
                onClick={() => setLoadingSheetScope("all")}
                style={{
                  padding: "4px 8px",
                  fontSize: 11,
                  fontWeight: 600,
                  borderRadius: 5,
                  border: "1px solid #cbd5e1",
                  background: loadingSheetScope === "all" ? "#0284c7" : "#ffffff",
                  color: loadingSheetScope === "all" ? "#ffffff" : "#475569",
                  cursor: "pointer",
                }}
              >
                All Routes
              </button>
              <button
                type="button"
                onClick={() => setLoadingSheetScope("route")}
                style={{
                  padding: "4px 8px",
                  fontSize: 11,
                  fontWeight: 600,
                  borderRadius: 5,
                  border: "1px solid #cbd5e1",
                  background: loadingSheetScope === "route" ? "#0284c7" : "#ffffff",
                  color: loadingSheetScope === "route" ? "#ffffff" : "#475569",
                  cursor: "pointer",
                }}
              >
                Specific Route
              </button>
              {loadingSheetScope === "route" && (
                <select
                  value={selectedSalesmanId}
                  onChange={(e) => setSelectedSalesmanId(e.target.value)}
                  style={{
                    padding: "4px 8px",
                    fontSize: 12,
                    borderRadius: 6,
                    border: "1px solid #cbd5e1",
                    background: "#ffffff",
                  }}
                >
                  {salesmenList.map((s) => (
                    <option key={str(s.id)} value={str(s.id)}>
                      {str(s.name)}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>

          {/* Date Range Selector */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              flexWrap: "wrap",
              gap: 10,
              background: "#f8fafc",
              padding: "8px 12px",
              borderRadius: 10,
              border: "1px solid #e2e8f0",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <Calendar size={15} style={{ color: "#64748b" }} />
              <span style={{ fontSize: 12, fontWeight: 700, color: "#475569" }}>From:</span>
              <input
                type="date"
                value={loadingSheetFrom}
                onChange={(e) => setLoadingSheetFrom(e.target.value)}
                style={{
                  padding: "4px 8px",
                  borderRadius: 6,
                  border: "1px solid #cbd5e1",
                  fontSize: 13,
                  background: "#ffffff",
                }}
              />
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: "#475569" }}>To:</span>
              <input
                type="date"
                value={loadingSheetTo}
                onChange={(e) => setLoadingSheetTo(e.target.value)}
                style={{
                  padding: "4px 8px",
                  borderRadius: 6,
                  border: "1px solid #cbd5e1",
                  fontSize: 13,
                  background: "#ffffff",
                }}
              />
            </div>

            {/* Quick Preset Buttons */}
            <div style={{ display: "flex", gap: 4 }}>
              <button
                type="button"
                onClick={() => {
                  setLoadingSheetFrom(defaultDate);
                  setLoadingSheetTo(defaultDate);
                }}
                style={{
                  padding: "4px 8px",
                  fontSize: 11,
                  fontWeight: 600,
                  borderRadius: 5,
                  border: "1px solid #cbd5e1",
                  background: loadingSheetFrom === defaultDate && loadingSheetTo === defaultDate ? "#0284c7" : "#ffffff",
                  color: loadingSheetFrom === defaultDate && loadingSheetTo === defaultDate ? "#ffffff" : "#475569",
                  cursor: "pointer",
                }}
              >
                Today
              </button>
              <button
                type="button"
                onClick={() => {
                  const prev = new Date(defaultDate + "T12:00:00+05:30");
                  prev.setDate(prev.getDate() - 1);
                  const prevStr = prev.toISOString().slice(0, 10);
                  setLoadingSheetFrom(prevStr);
                  setLoadingSheetTo(prevStr);
                }}
                style={{
                  padding: "4px 8px",
                  fontSize: 11,
                  fontWeight: 600,
                  borderRadius: 5,
                  border: "1px solid #cbd5e1",
                  background: "#ffffff",
                  color: "#475569",
                  cursor: "pointer",
                }}
              >
                Yesterday
              </button>
              <button
                type="button"
                onClick={() => {
                  const past = new Date(defaultDate + "T12:00:00+05:30");
                  past.setDate(past.getDate() - 7);
                  setLoadingSheetFrom(past.toISOString().slice(0, 10));
                  setLoadingSheetTo(defaultDate);
                }}
                style={{
                  padding: "4px 8px",
                  fontSize: 11,
                  fontWeight: 600,
                  borderRadius: 5,
                  border: "1px solid #cbd5e1",
                  background: "#ffffff",
                  color: "#475569",
                  cursor: "pointer",
                }}
              >
                Last 7 Days
              </button>
              <button
                type="button"
                onClick={() => {
                  setLoadingSheetFrom("");
                  setLoadingSheetTo("");
                }}
                style={{
                  padding: "4px 8px",
                  fontSize: 11,
                  fontWeight: 600,
                  borderRadius: 5,
                  border: "1px solid #cbd5e1",
                  background: !loadingSheetFrom && !loadingSheetTo ? "#0284c7" : "#ffffff",
                  color: !loadingSheetFrom && !loadingSheetTo ? "#ffffff" : "#475569",
                  cursor: "pointer",
                }}
              >
                All Dates
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Quick Metrics Banner */}
      <div
        className="no-print"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: 12,
          marginBottom: 20,
          padding: 14,
          background: "#f8fafc",
          border: "1px solid #e2e8f0",
          borderRadius: 12,
        }}
      >
        <div>
          <small style={{ color: "#64748b", textTransform: "uppercase", fontSize: 11, fontWeight: 700 }}>
            Selected Bills
          </small>
          <div style={{ fontSize: 20, fontWeight: 800, color: "#0f172a", marginTop: 2 }}>
            {selectedBillIds.length}{" "}
            <span style={{ fontSize: 12, fontWeight: 500, color: "#64748b" }}>of {loadingBills.length}</span>
          </div>
        </div>

        <div>
          <small style={{ color: "#64748b", textTransform: "uppercase", fontSize: 11, fontWeight: 700 }}>
            Unique Products
          </small>
          <div style={{ fontSize: 20, fontWeight: 800, color: "#0284c7", marginTop: 2 }}>
            {aggregatedProducts.length} items
          </div>
        </div>

        <div>
          <small style={{ color: "#64748b", textTransform: "uppercase", fontSize: 11, fontWeight: 700 }}>
            Total Billed Quantity
          </small>
          <div style={{ fontSize: 20, fontWeight: 800, color: "#16a34a", marginTop: 2 }}>
            {totalLoadedQty.toString()}
          </div>
        </div>

        <div>
          <small style={{ color: "#64748b", textTransform: "uppercase", fontSize: 11, fontWeight: 700 }}>
            Total Billed Value
          </small>
          <div style={{ fontSize: 20, fontWeight: 800, color: "#0f172a", marginTop: 2 }}>
            {rupees(totalLoadedAmount.toString())}
          </div>
        </div>
      </div>

      {/* Main 2-Column Split: Bills on Left, Products on Right */}
      <div
        className="loading-sheet-grid"
        style={{ gridTemplateColumns: billsSelectorCollapsed ? "52px 1fr" : undefined }}
      >
        {/* LEFT COLUMN: BILL SELECTOR */}
        {billsSelectorCollapsed ? (
          <div
            className="no-print"
            onClick={() => setBillsSelectorCollapsed(false)}
            title="Click to expand Bills selector"
            style={{
              background: "#ffffff",
              border: "1px solid #e2e8f0",
              borderRadius: 12,
              padding: "14px 6px",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 12,
              cursor: "pointer",
              userSelect: "none",
              transition: "all 0.15s ease",
              minHeight: "420px",
              boxShadow: "0 1px 3px rgba(0,0,0,0.03)",
            }}
          >
            <button
              type="button"
              className="sidebar-toggle-btn"
              onClick={(e) => {
                e.stopPropagation();
                setBillsSelectorCollapsed(false);
              }}
              title="Expand bills selector"
              style={{
                background: "#f1f5f9",
                border: "1px solid #cbd5e1",
                borderRadius: 8,
                padding: "6px",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#0f172a",
              }}
            >
              <PanelLeftOpen size={16} />
            </button>

            <div
              style={{
                background: "#eff6ff",
                color: "#1d4ed8",
                fontSize: 11,
                fontWeight: 700,
                padding: "3px 6px",
                borderRadius: 6,
                border: "1px solid #bfdbfe",
              }}
              title={`${selectedBillIds.length} bills selected`}
            >
              {selectedBillIds.length}
            </div>

            <div
              style={{
                writingMode: "vertical-rl",
                textOrientation: "mixed",
                transform: "rotate(180deg)",
                fontSize: 11,
                fontWeight: 700,
                color: "#64748b",
                letterSpacing: "0.8px",
                textTransform: "uppercase",
                marginTop: 8,
                whiteSpace: "nowrap",
              }}
            >
              Bills ({selectedBillIds.length}/{loadingBills.length})
            </div>
          </div>
        ) : (
          <div
            className="no-print"
            style={{
              background: "#ffffff",
              border: "1px solid #e2e8f0",
              borderRadius: 12,
              padding: "16px",
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 15, color: "#0f172a", fontWeight: 700 }}>
                  Select Bills ({loadingBills.length})
                </h3>
                <small style={{ color: "#64748b" }}>Choose bills to aggregate</small>
              </div>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <Button
                  className="secondary"
                  type="button"
                  onClick={toggleAllBills}
                  style={{ fontSize: 11, padding: "4px 8px" }}
                >
                  {selectedBillIds.length === loadingBills.length && loadingBills.length > 0
                    ? "Deselect All"
                    : "Select All"}
                </Button>
                {selectedBillIds.length > 0 && (
                  <Button
                    className="secondary"
                    type="button"
                    onClick={() => {
                      setHasManuallySelectedBills(true);
                      setSelectedBillIds([]);
                    }}
                    style={{ fontSize: 11, padding: "4px 8px", color: "#dc2626" }}
                  >
                    Clear
                  </Button>
                )}
                <button
                  type="button"
                  onClick={() => setBillsSelectorCollapsed(true)}
                  title="Collapse bill selector to rail"
                  style={{
                    background: "#f8fafc",
                    border: "1px solid #cbd5e1",
                    borderRadius: 6,
                    padding: "4px 6px",
                    display: "flex",
                    alignItems: "center",
                    cursor: "pointer",
                    color: "#475569",
                  }}
                >
                  <PanelLeftClose size={15} />
                </button>
              </div>
            </div>

            {/* Bill Search & Reversed Filter */}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ position: "relative" }}>
                <Search
                  size={14}
                  style={{
                    position: "absolute",
                    left: 10,
                    top: "50%",
                    transform: "translateY(-50%)",
                    color: "#94a3b8",
                  }}
                />
                <input
                  type="text"
                  placeholder="Search bill #, customer, or salesman..."
                  value={loadingSheetBillSearch}
                  onChange={(e) => setLoadingSheetBillSearch(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "7px 10px 7px 32px",
                    borderRadius: 8,
                    border: "1px solid #cbd5e1",
                    fontSize: 12,
                    boxSizing: "border-box",
                  }}
                />
              </div>

              {reversedBillsCount > 0 && (
                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    fontSize: 11,
                    color: "#64748b",
                    cursor: "pointer",
                    userSelect: "none",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={showReversedBills}
                    onChange={(e) => setShowReversedBills(e.target.checked)}
                    style={{ width: 14, height: 14, cursor: "pointer" }}
                  />
                  <span>
                    Include {reversedBillsCount} reversed {reversedBillsCount === 1 ? "bill" : "bills"}
                  </span>
                </label>
              )}
            </div>

            {/* Scrollable Bills List */}
            <div
              style={{
                maxHeight: "560px",
                overflowY: "auto",
                border: "1px solid #f1f5f9",
                borderRadius: 8,
                display: "flex",
                flexDirection: "column",
                gap: 4,
                padding: 4,
              }}
            >
              {billsQuery.isLoading ? (
                <div style={{ padding: 20, textAlign: "center", color: "#64748b", fontSize: 13 }}>
                  Loading bills…
                </div>
              ) : loadingBills.length === 0 ? (
                <div style={{ padding: 24, textAlign: "center", color: "#94a3b8", fontSize: 13 }}>
                  No bills found for this selection.
                </div>
              ) : (
                loadingBills.map((b) => {
                  const bId = str(b.id);
                  const isSelected = selectedBillIds.includes(bId);
                  const bData = (b.data ?? {}) as Row;
                  const cName = str(bData.customerName || bData.customerRef || "Direct Customer");
                  const sName = str(b.salesman_name || "");
                  const linesCount = Number(b.lines_count ?? 0);
                  const qtyTotal = str(b.total_quantity ?? "");

                  return (
                    <div
                      key={bId}
                      onClick={() => toggleBill(bId)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "10px 12px",
                        borderRadius: 8,
                        cursor: "pointer",
                        transition: "all 0.15s ease",
                        background: isSelected ? "#eff6ff" : "#ffffff",
                        border: isSelected ? "1.5px solid #3b82f6" : "1px solid #f1f5f9",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => { }}
                          style={{ cursor: "pointer", width: 16, height: 16 }}
                        />
                        <div style={{ minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <DocLink
                              id={bId}
                              number={str(b.number)}
                              onSelect={onSelect}
                              style={{
                                fontWeight: 700,
                                fontSize: 13,
                                color: isSelected ? "#1d4ed8" : "#2563eb",
                              }}
                            />
                            <span style={{ fontSize: 11, color: "#64748b" }}>· {str(b.business_date)}</span>
                            {b.reversed ? (
                              <span
                                style={{
                                  fontSize: 10,
                                  fontWeight: 700,
                                  color: "#dc2626",
                                  background: "#fee2e2",
                                  padding: "1px 5px",
                                  borderRadius: 4,
                                }}
                              >
                                REVERSED
                              </span>
                            ) : null}
                          </div>
                          <div
                            style={{
                              fontSize: 12,
                              color: "#475569",
                              whiteSpace: "nowrap",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                            }}
                          >
                            {cName}
                            {loadingSheetScope === "all" && sName ? (
                              <span
                                style={{
                                  marginLeft: 6,
                                  fontSize: 10,
                                  fontWeight: 600,
                                  color: "#0369a1",
                                  background: "#e0f2fe",
                                  padding: "1px 5px",
                                  borderRadius: 4,
                                }}
                              >
                                {sName}
                              </span>
                            ) : null}
                          </div>
                        </div>
                      </div>

                      <div style={{ textAlign: "right", flexShrink: 0, paddingLeft: 8 }}>
                        <div style={{ fontWeight: 700, fontSize: 13, color: "#0f172a" }}>
                          {rupees(b.amount)}
                        </div>
                        <div style={{ fontSize: 11, color: "#64748b" }}>
                          {linesCount} {linesCount === 1 ? "line" : "lines"}
                          {qtyTotal ? ` · ${qtyTotal} qty` : ""}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* RIGHT COLUMN: AGGREGATED PRODUCTS & STOCK VERIFICATION */}
        <div className="loading-sheet-print-container">
          {/* Top Controls & Action Buttons */}
          <div
            className="no-print"
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: 10,
              paddingBottom: 12,
              borderBottom: "1px solid #e2e8f0",
            }}
          >
            <div>
              <h3 style={{ margin: 0, fontSize: 16, color: "#0f172a", fontWeight: 700 }}>
                Aggregated Products to Verify ({aggregatedProducts.length})
              </h3>
              <small style={{ color: "#64748b" }}>
                Total dispatch requirements across {selectedBillIds.length} selected bills
              </small>
            </div>

            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <Button
                className="secondary"
                type="button"
                onClick={() => setBillsSelectorCollapsed((prev) => !prev)}
                style={{ fontSize: 12, padding: "6px 10px", display: "flex", alignItems: "center", gap: 5 }}
                title={billsSelectorCollapsed ? "Expand bills sidebar" : "Collapse bills to sidebar rail"}
              >
                {billsSelectorCollapsed ? <PanelLeftOpen size={14} /> : <PanelLeftClose size={14} />}
                {billsSelectorCollapsed ? "Expand Bills" : "Collapse Bills"}
              </Button>
              <Button
                className="secondary"
                type="button"
                disabled={aggregatedProducts.length === 0}
                onClick={handleCopyList}
                style={{ fontSize: 12, padding: "6px 12px", display: "flex", alignItems: "center", gap: 6 }}
              >
                <Copy size={14} />
                {copyFeedback ? "✓ Copied Summary!" : "Copy Summary"}
              </Button>
              <Button
                className="secondary"
                type="button"
                disabled={aggregatedProducts.length === 0}
                onClick={handleExportCsv}
                style={{ fontSize: 12, padding: "6px 12px", display: "flex", alignItems: "center", gap: 6 }}
              >
                <Download size={14} />
                Export CSV
              </Button>
              <Button
                className="secondary"
                type="button"
                disabled={aggregatedProducts.length === 0}
                onClick={() => {
                  let styleEl = document.getElementById("dynamic-print-page-style") as HTMLStyleElement | null;
                  if (!styleEl) {
                    styleEl = document.createElement("style");
                    styleEl.id = "dynamic-print-page-style";
                    document.head.appendChild(styleEl);
                  }
                  styleEl.innerHTML = `@media print { @page { size: A4 portrait; margin: 6mm 8mm; } }`;
                  window.print();
                }}
                style={{ fontSize: 12, padding: "6px 12px", display: "flex", alignItems: "center", gap: 6 }}
              >
                <Printer size={14} />
                Print Sheet
              </Button>
            </div>
          </div>

          {selectedBillIds.length === 0 ? (
            <div
              style={{
                padding: "48px 20px",
                textAlign: "center",
                background: "#f8fafc",
                borderRadius: 10,
                border: "1px dashed #cbd5e1",
              }}
            >
              <Package size={36} style={{ color: "#94a3b8", marginBottom: 8 }} />
              <div style={{ fontSize: 15, fontWeight: 700, color: "#334155" }}>
                No Bills Selected
              </div>
              <p style={{ fontSize: 13, color: "#64748b", margin: "4px 0 0" }}>
                Select one or more bills on the left to calculate and verify aggregated products.
              </p>
            </div>
          ) : linesQuery.isLoading ? (
            <div style={{ padding: 40, textAlign: "center", color: "#64748b", fontSize: 14 }}>
              Fetching and combining product lines…
            </div>
          ) : linesQuery.isError ? (
            <div
              style={{
                padding: 30,
                textAlign: "center",
                color: "#dc2626",
                background: "#fef2f2",
                borderRadius: 10,
                border: "1px solid #fecaca",
              }}
            >
              <div style={{ fontWeight: 700, fontSize: 14 }}>Failed to fetch bill products</div>
              <div style={{ fontSize: 12, marginTop: 4, color: "#7f1d1d" }}>
                {(linesQuery.error as Error)?.message || "Error communicating with server"}
              </div>
              <Button
                className="secondary"
                type="button"
                onClick={() => linesQuery.refetch()}
                style={{ marginTop: 12, fontSize: 12 }}
              >
                Retry
              </Button>
            </div>
          ) : aggregatedProducts.length === 0 ? (
            <div style={{ padding: 30, textAlign: "center", color: "#94a3b8", fontSize: 13 }}>
              The selected bills do not have any product lines recorded.
            </div>
          ) : (
            <>
              {/* PRINT-ONLY CLEAN HEADER */}
              <div className="print-only" style={{ marginBottom: 14 }}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "baseline",
                    borderBottom: "2px solid #0f172a",
                    paddingBottom: 8,
                    marginBottom: 8,
                  }}
                >
                  <div>
                    <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: "#0f172a" }}>
                      Stock Verification & Loading Sheet
                    </h2>
                    <div style={{ fontSize: 13, color: "#334155", marginTop: 3 }}>
                      Route / Salesman:{" "}
                      <strong>
                        {loadingSheetScope === "all"
                          ? "All Routes / Salesmen"
                          : str(salesmenList.find((s) => str(s.id) === selectedSalesmanId)?.name || "Salesman")}
                      </strong>
                    </div>
                  </div>
                  <div style={{ textAlign: "right", fontSize: 12, color: "#334155" }}>
                    <div>
                      Date:{" "}
                      <strong>
                        {!loadingSheetFrom && !loadingSheetTo
                          ? "All Dates"
                          : loadingSheetFrom === loadingSheetTo
                            ? loadingSheetFrom
                            : `${loadingSheetFrom || "Start"} to ${loadingSheetTo || "End"}`}
                      </strong>
                    </div>
                    <div>
                      Bills Included: <strong>{selectedBillIds.length}</strong>
                    </div>
                  </div>
                </div>
              </div>

              {/* STRUCTURED ITEMIZED BREAKDOWN TABLE */}
              <div
                className="loading-sheet-table-wrap"
                style={{ overflowX: "auto", border: "1px solid #e2e8f0", borderRadius: 8 }}
              >
                <table className="ledger-table loading-sheet-table" style={{ width: "100%", fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: "#f1f5f9", textAlign: "left" }}>
                      <th style={{ padding: "8px 10px", width: 40 }}>#</th>
                      <th style={{ padding: "8px 10px" }}>Product Name</th>
                      <th style={{ padding: "8px 10px", textAlign: "right" }}>Billed Qty</th>
                      <th style={{ padding: "8px 10px", textAlign: "right" }}>MRP / Rate</th>
                      <th style={{ padding: "8px 10px", textAlign: "right" }}>Total Value</th>
                      <th style={{ padding: "8px 10px", textAlign: "center" }}>In Bills</th>
                      <th style={{ padding: "8px 10px", textAlign: "center", width: 100 }}>
                        <span className="no-print">Verify</span>
                        <span className="print-only">Physical Count</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {aggregatedProducts.map((p, idx) => {
                      const isVerified = !!verifiedItems[p.id];
                      return (
                        <tr
                          key={p.id}
                          style={{
                            borderBottom: "1px solid #f1f5f9",
                            background: isVerified ? "#f0fdf4" : idx % 2 === 0 ? "#ffffff" : "#fbfcfe",
                          }}
                        >
                          <td style={{ padding: "8px 10px", color: "#94a3b8", fontSize: 11 }}>
                            {idx + 1}
                          </td>
                          <td style={{ padding: "8px 10px", fontWeight: 600, color: "#0f172a" }}>
                            {p.name}
                            {p.code ? (
                              <small style={{ color: "#64748b", marginLeft: 6 }}>({p.code})</small>
                            ) : null}
                          </td>
                          <td
                            style={{
                              padding: "8px 10px",
                              textAlign: "right",
                              fontWeight: 800,
                              color: "#0369a1",
                            }}
                          >
                            {p.quantity.toString()} {p.unit}
                          </td>
                          <td style={{ padding: "8px 10px", textAlign: "right" }}>
                            {rupees(p.rate)}
                          </td>
                          <td
                            style={{
                              padding: "8px 10px",
                              textAlign: "right",
                              fontWeight: 700,
                              color: "#0f172a",
                            }}
                          >
                            {rupees(p.amount.toFixed(2))}
                          </td>
                          <td style={{ padding: "8px 10px", textAlign: "center" }}>
                            <span
                              style={{
                                background: "#f1f5f9",
                                color: "#334155",
                                fontSize: 11,
                                fontWeight: 700,
                                padding: "2px 7px",
                                borderRadius: 10,
                              }}
                              title={p.billNumbers.join(", ")}
                            >
                              {p.billNumbers.length} {p.billNumbers.length === 1 ? "bill" : "bills"}
                            </span>
                          </td>
                          <td style={{ padding: "8px 10px", textAlign: "center" }}>
                            {/* Screen View: Clickable Checkbox */}
                            <div className="no-print">
                              <label
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: 4,
                                  cursor: "pointer",
                                }}
                              >
                                <input
                                  type="checkbox"
                                  checked={isVerified}
                                  onChange={() => toggleVerified(p.id)}
                                  style={{ width: 16, height: 16, cursor: "pointer" }}
                                />
                                {isVerified && (
                                  <span style={{ fontSize: 11, fontWeight: 700, color: "#16a34a" }}>
                                    ✓
                                  </span>
                                )}
                              </label>
                            </div>
                            {/* Print View: Physical count box to write on paper */}
                            <div
                              className="print-only"
                              style={{
                                border: "1px dashed #64748b",
                                width: 55,
                                height: 20,
                                margin: "0 auto",
                              }}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr style={{ background: "#f8fafc", borderTop: "2px solid #cbd5e1", fontWeight: 800 }}>
                      <td colSpan={2} style={{ padding: "10px", color: "#0f172a" }}>
                        Total ({aggregatedProducts.length} items)
                      </td>
                      <td style={{ padding: "10px", textAlign: "right", color: "#0369a1", fontSize: 14 }}>
                        {totalLoadedQty.toString()}
                      </td>
                      <td style={{ padding: "10px" }} />
                      <td style={{ padding: "10px", textAlign: "right", color: "#0f172a", fontSize: 14 }}>
                        {rupees(totalLoadedAmount.toFixed(2))}
                      </td>
                      <td style={{ padding: "10px", textAlign: "center", fontSize: 12, color: "#64748b" }}>
                        {selectedBillIds.length} bills
                      </td>
                      <td style={{ padding: "10px" }} />
                    </tr>
                  </tfoot>
                </table>
              </div>

              {/* Print-Only Signature Section */}
              <div
                className="print-only"
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  marginTop: 40,
                  paddingTop: 16,
                  borderTop: "1px solid #cbd5e1",
                  fontSize: 12,
                }}
              >
                <div>
                  <div>Godown / Warehouse In-Charge: _______________________</div>
                </div>
                <div>
                  <div>Salesman / Vehicle Driver: _______________________</div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
export function ReportExplorer({
  masters,
  onSelect,
  activeTab: propActiveTab,
  setActiveTab: propSetActiveTab,
}: {
  masters: Row;
  onSelect?: (id: string) => void;
  activeTab?: string;
  setActiveTab?: (tab: string) => void;
}) {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
  }).format(new Date()),
    [localActiveTab, setLocalActiveTab] = useState<string>("transactions"),
    activeTab = propActiveTab ?? localActiveTab,
    setActiveTab = propSetActiveTab ?? setLocalActiveTab,
    [from, setFrom] = useState(today.slice(0, 7) + "-01"),
    [to, setTo] = useState(today),
    [searchQuery, setSearchQuery] = useState(""),
    [offset, setOffset] = useState(0),
    [exportStatus, setExportStatus] = useState("");

  // Dedicated column-wise filters for All Transactions
  const [txColNo, setTxColNo] = useState("");
  const [txColDate, setTxColDate] = useState("");
  const [txColType, setTxColType] = useState("");
  const [txColCategory, setTxColCategory] = useState("");
  const [txColAmount, setTxColAmount] = useState("");
  const [txColStatus, setTxColStatus] = useState("");
  const [txColNote, setTxColNote] = useState("");

  const reportTabs = [
    { id: "transactions", label: "All transactions", tableTitle: "ALL TRANSACTIONS REGISTER (BILLS, RECEIPTS, EXPENSES, SALARIES & TRANSFERS)" },
    { id: "stock_verification", label: "Stock Verification (Loading Sheet)", tableTitle: "STOCK VERIFICATION & VEHICLE LOADING DISPATCH SHEET" },
    { id: "closes", label: "Daily closes and differences", tableTitle: "DAILY CASH CLOSINGS & DIFFERENCES" },
  ];

  // Map tab id to actual API endpoint
  const apiPath = `reports/${activeTab}?from=${from}&to=${to}&offset=${offset}`;

  const q = useQuery<Row[]>({
    queryKey: ["report", activeTab, from, to, searchQuery, offset],
    queryFn: async () => {
      const res = await api<Row>(apiPath, rowSchema);
      return arr(res.rows);
    },
    enabled: activeTab !== "stock_verification",
  });

  const rawRows: Row[] = q.data ?? [];
  const normalizedRows: Row[] = rawRows.map((r) => {
    let status = str(r.status ?? "");
    if (!status) {
      if (r.kind === "bill" || r.type === "bill") {
        const parts = [str(r.settlement ?? "Unpaid")];
        if (r.returned) parts.push("returned");
        if (r.reversed) parts.push("reversal");
        status = parts.join(" / ");
      } else {
        status = r.reversed ? "Reversed" : "Posted";
      }
    }
    return {
      ...(r.matches ? { ...r, matches: JSON.stringify(r.matches) } : r),
      status,
    };
  });

  // Client-side text filter for tabs whose reports endpoint doesn't accept a search query directly
  const data: Row[] = normalizedRows.filter((r) => {
    if (searchQuery.trim()) {
      const qLower = searchQuery.toLowerCase().trim();
      const matchesSearch = Object.values(r).some((v) =>
        String(v ?? "").toLowerCase().includes(qLower),
      );
      if (!matchesSearch) return false;
    }
    if (activeTab === "transactions") {
      if (txColNo.trim()) {
        const noVal = String(r.no ?? "").toLowerCase();
        if (!noVal.includes(txColNo.toLowerCase().trim())) return false;
      }
      if (txColDate.trim()) {
        const qDate = txColDate.toLowerCase().trim();
        const dateVal = String(r.date ?? "").toLowerCase();
        const stampVal = timeOnlyLabel(r.created_at).toLowerCase();
        if (!dateVal.includes(qDate) && !stampVal.includes(qDate)) return false;
      }
      if (txColType) {
        const typeVal = String(r.type ?? "").toLowerCase();
        if (txColType === "foods_receipt") {
          if (!typeVal.startsWith("foods_receipt")) return false;
        } else if (typeVal !== txColType.toLowerCase()) {
          return false;
        }
      }
      if (txColCategory.trim()) {
        const catVal = String(r.category ?? "").toLowerCase();
        if (!catVal.includes(txColCategory.toLowerCase().trim())) return false;
      }
      if (txColAmount.trim()) {
        const amtVal = String(r.amount ?? "").toLowerCase();
        if (!amtVal.includes(txColAmount.toLowerCase().trim())) return false;
      }
      if (txColStatus.trim()) {
        const statusVal = String(r.status ?? "").toLowerCase();
        if (!statusVal.includes(txColStatus.toLowerCase().trim())) return false;
      }
      if (txColNote.trim()) {
        const noteVal = String(r.note ?? "").toLowerCase();
        if (!noteVal.includes(txColNote.toLowerCase().trim())) return false;
      }
    }
    return true;
  });

  const PAGE_SIZE = 15;
  const grandTotal = useMemo(() => {
    let sum = D(0);
    for (const r of data) {
      sum = sum.plus(D(str(r.amount || "0")));
    }
    return sum;
  }, [data]);
  const totalPages = Math.max(1, Math.ceil(data.length / PAGE_SIZE));
  const currentPage = Math.min(Math.floor(offset / PAGE_SIZE), totalPages - 1);
  const pageOffset = Math.max(0, currentPage * PAGE_SIZE);
  const displayedRows = activeTab === "transactions" ? data.slice(pageOffset, pageOffset + PAGE_SIZE) : data;

  const currentTabObj = reportTabs.find((t) => t.id === activeTab) ?? reportTabs[0];

  const handleExport = async () => {
    const snapshot = data.map((r) => ({ ...r }));
    try {
      await api("report-export-audit", rowSchema, {
        name: activeTab,
        from,
        to,
        offset,
        count: snapshot.length,
      });
      const url = URL.createObjectURL(
        new Blob([encodeCsvRows(snapshot)], {
          type: "text/csv;charset=utf-8",
        }),
      );
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${activeTab}-${from}-${to}.csv`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setExportStatus("CSV download requested for the exact displayed page.");
    } catch (e) {
      setExportStatus((e as Error).message);
    }
  };

  // Determine columns based on active tab
  const getColumns = (): [string, string, boolean?][] => {
    if (activeTab === "transactions") {
      return [
        ["no", "NO"],
        ["date", "DATE"],
        ["type", "TYPE"],
        ["category", "CATEGORY / PERSON"],
        ["amount", "AMOUNT", true],
        ["status", "STATUS"],
        ["note", "NOTE"],
      ];
    }
    return reportColumns(data);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Header with Title & Export Button */}
      <div
        className="no-print"
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          flexWrap: "wrap",
          gap: 16,
          paddingBottom: 4,
        }}
      >
        <div>
          <h1 style={{ fontSize: "1.85rem", fontWeight: 750, margin: 0, letterSpacing: "-0.5px" }}>
            Financial & Operational Reports
          </h1>
          <p className="muted" style={{ margin: "6px 0 0", fontSize: "0.95rem" }}>
            Trial balances, salesman dues registers, and auditable ledger summaries
          </p>
        </div>
        {activeTab !== "stock_verification" && (
          <Button
            type="button"
            onClick={handleExport}
            disabled={!q.data || q.isFetching}
            style={{
              background: "#18181b",
              color: "#ffffff",
              borderRadius: 24,
              padding: "9px 20px",
              fontWeight: 600,
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              border: "none",
              boxShadow: "0 1px 3px rgba(0,0,0,0.12)",
              cursor: "pointer",
            }}
          >
            <Download size={16} />
            <span>Export {activeTab === "outstanding" ? "Salesmen" : "Report"} CSV</span>
          </Button>
        )}
      </div>

      {/* Modern Horizontal Tabs Bar */}
      <div
        className="no-print"
        style={{
          display: "flex",
          gap: 22,
          overflowX: "auto",
          borderBottom: "1px solid #e7e5e4",
          paddingBottom: 2,
          scrollbarWidth: "none",
        }}
      >
        {reportTabs.map((tab) => {
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                setActiveTab(tab.id);
                setOffset(0);
                setExportStatus("");
              }}
              style={{
                background: "none",
                border: "none",
                borderBottom: active ? "2.5px solid #c2410c" : "2.5px solid transparent",
                padding: "8px 2px 10px",
                fontWeight: active ? 700 : 500,
                fontSize: "0.95rem",
                color: active ? "#9a3412" : "#78716c",
                cursor: "pointer",
                whiteSpace: "nowrap",
                transition: "all 0.15s ease",
              }}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {activeTab === "stock_verification" ? (
        <StockVerificationReport masters={masters} onSelect={onSelect} defaultDate={today} />
      ) : (
        <section className="panel" style={{ marginTop: 6, borderRadius: 16 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: 16,
              marginBottom: 16,
            }}
          >
            <strong
              style={{
                textTransform: "uppercase",
                fontSize: "0.86rem",
                letterSpacing: "0.6px",
                color: "#44403c",
                fontWeight: 800,
              }}
            >
              {currentTabObj.tableTitle}
            </strong>

            {/* Search & Date range filters */}
            <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              <input
                type="text"
                placeholder={`Filter ${currentTabObj.label.toLowerCase()}…`}
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setOffset(0);
                }}
                style={{
                  padding: "5px 12px",
                  fontSize: "0.85rem",
                  borderRadius: 8,
                  border: "1px solid #d6d3d1",
                  minWidth: 200,
                }}
              />
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.85rem", color: "#78716c" }}>
                <span>From:</span>
                <input
                  type="date"
                  value={from}
                  onChange={(e) => {
                    setFrom(e.target.value);
                    setOffset(0);
                  }}
                  style={{ padding: "4px 8px", fontSize: "0.85rem", borderRadius: 6, border: "1px solid #d6d3d1" }}
                />
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.85rem", color: "#78716c" }}>
                <span>To / As of:</span>
                <input
                  type="date"
                  value={to}
                  onChange={(e) => {
                    setTo(e.target.value);
                    setOffset(0);
                  }}
                  style={{ padding: "4px 8px", fontSize: "0.85rem", borderRadius: 6, border: "1px solid #d6d3d1" }}
                />
              </label>
            </div>
          </div>

          {q.isPending ? (
            <p style={{ padding: "24px 0", color: "#78716c" }}>Loading report records…</p>
          ) : q.isError ? (
            <p role="alert" className="error">
              {q.error.message}
            </p>
          ) : activeTab === "transactions" ? (
            <div style={{ overflowX: "auto" }}>
              {/* Top Summary Bar & Filter Actions */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: 12,
                  marginBottom: 12,
                }}
              >
                <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <div
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      background: "#f8fafc",
                      border: "1px solid #cbd5e1",
                      borderRadius: 8,
                      padding: "6px 14px",
                      fontSize: "0.85rem",
                      color: "#475569",
                    }}
                  >
                    <span style={{ color: "#64748b" }}>Total Records:</span>
                    <strong style={{ color: "#0f172a", fontWeight: 700 }}>{data.length}</strong>
                  </div>
                  <div
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      background: "#f0fdf4",
                      border: "1px solid #86efac",
                      borderRadius: 8,
                      padding: "6px 14px",
                      fontSize: "0.85rem",
                      color: "#166534",
                    }}
                  >
                    <span style={{ color: "#15803d" }}>Grand Total:</span>
                    <strong style={{ color: "#14532d", fontWeight: 750, fontSize: "0.95rem" }}>
                      {rupees(grandTotal)}
                    </strong>
                  </div>
                </div>

                {(txColNo || txColDate || txColType || txColCategory || txColAmount || txColStatus || txColNote) && (
                  <button
                    type="button"
                    onClick={() => {
                      setTxColNo("");
                      setTxColDate("");
                      setTxColType("");
                      setTxColCategory("");
                      setTxColAmount("");
                      setTxColStatus("");
                      setTxColNote("");
                      setOffset(0);
                    }}
                    style={{
                      background: "none",
                      border: "none",
                      color: "#dc2626",
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: "pointer",
                      textDecoration: "underline",
                    }}
                  >
                    Clear column filters
                  </button>
                )}
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
                    <th style={{ textAlign: "left", padding: "10px 12px", fontWeight: 700, fontSize: 13, color: "#475569" }}>
                      NO
                    </th>
                    <th style={{ textAlign: "left", padding: "10px 12px", fontWeight: 700, fontSize: 13, color: "#475569" }}>
                      DATE
                    </th>
                    <th style={{ textAlign: "left", padding: "10px 12px", fontWeight: 700, fontSize: 13, color: "#475569" }}>
                      TYPE
                    </th>
                    <th style={{ textAlign: "left", padding: "10px 12px", fontWeight: 700, fontSize: 13, color: "#475569" }}>
                      CATEGORY / PERSON
                    </th>
                    <th className="money-cell" style={{ textAlign: "right", padding: "10px 12px", fontWeight: 700, fontSize: 13, color: "#475569" }}>
                      AMOUNT
                    </th>
                    <th style={{ textAlign: "left", padding: "10px 12px", fontWeight: 700, fontSize: 13, color: "#475569" }}>
                      STATUS
                    </th>
                    <th style={{ textAlign: "center", padding: "10px 12px", fontWeight: 700, fontSize: 13, color: "#475569", width: 70 }}>
                      NOTE
                    </th>
                  </tr>

                  {/* Search & Filter Row Directly Below Headers */}
                  <tr style={{ background: "#f1f5f9", borderBottom: "2px solid #cbd5e1" }}>
                    <th style={{ padding: "6px 8px" }}>
                      <input
                        type="search"
                        placeholder="Search #…"
                        value={txColNo}
                        onChange={(e) => {
                          setTxColNo(e.target.value);
                          setOffset(0);
                        }}
                        style={{
                          width: "100%",
                          padding: "6px 8px",
                          fontSize: 12,
                          borderRadius: 6,
                          border: "1px solid #cbd5e1",
                          background: "#ffffff",
                        }}
                      />
                    </th>
                    <th style={{ padding: "6px 8px" }}>
                      <input
                        type="search"
                        placeholder="Search date…"
                        value={txColDate}
                        onChange={(e) => {
                          setTxColDate(e.target.value);
                          setOffset(0);
                        }}
                        style={{
                          width: "100%",
                          padding: "6px 8px",
                          fontSize: 12,
                          borderRadius: 6,
                          border: "1px solid #cbd5e1",
                          background: "#ffffff",
                        }}
                      />
                    </th>
                    <th style={{ padding: "6px 8px" }}>
                      <select
                        value={txColType}
                        onChange={(e) => {
                          setTxColType(e.target.value);
                          setOffset(0);
                        }}
                        style={{
                          width: "100%",
                          padding: "6px 8px",
                          fontSize: 12,
                          borderRadius: 6,
                          border: "1px solid #cbd5e1",
                          background: "#ffffff",
                        }}
                      >
                        <option value="">All Types</option>
                        <option value="bill">Bill</option>
                        <option value="receipt_cash">Cash Receipt</option>
                        <option value="receipt_online">Online Receipt</option>
                        <option value="foods_receipt_cash">Foods Receipt Cash</option>
                        <option value="foods_receipt_online">Foods Receipt Online</option>
                        <option value="foods_receipt">Foods Receipt (All)</option>
                        <option value="sales_return">Sales Return</option>
                        <option value="expense">Expense</option>
                        <option value="salary">Salary</option>
                        <option value="employee_receipt">Employee Receipt</option>
                        <option value="bank_deposit">Bank Deposit</option>
                        <option value="cash_transfer">Cash Transfer</option>
                      </select>
                    </th>
                    <th style={{ padding: "6px 8px" }}>
                      <input
                        type="search"
                        placeholder="Search category / person…"
                        value={txColCategory}
                        onChange={(e) => {
                          setTxColCategory(e.target.value);
                          setOffset(0);
                        }}
                        style={{
                          width: "100%",
                          padding: "6px 8px",
                          fontSize: 12,
                          borderRadius: 6,
                          border: "1px solid #cbd5e1",
                          background: "#ffffff",
                        }}
                      />
                    </th>
                    <th style={{ padding: "6px 8px" }}>
                      <input
                        type="search"
                        placeholder="Search ₹…"
                        value={txColAmount}
                        onChange={(e) => {
                          setTxColAmount(e.target.value);
                          setOffset(0);
                        }}
                        style={{
                          width: "100%",
                          padding: "6px 8px",
                          fontSize: 12,
                          borderRadius: 6,
                          border: "1px solid #cbd5e1",
                          background: "#ffffff",
                          textAlign: "right",
                        }}
                      />
                    </th>
                    <th style={{ padding: "6px 8px" }}>
                      <select
                        value={txColStatus}
                        onChange={(e) => {
                          setTxColStatus(e.target.value);
                          setOffset(0);
                        }}
                        style={{
                          width: "100%",
                          padding: "6px 8px",
                          fontSize: 12,
                          borderRadius: 6,
                          border: "1px solid #cbd5e1",
                          background: "#ffffff",
                        }}
                      >
                        <option value="">All Statuses</option>
                        <option value="Posted">Posted</option>
                        <option value="Settled">Settled</option>
                        <option value="Part-paid">Part-paid / credited</option>
                        <option value="Unpaid">Unpaid</option>
                        <option value="returned">Returned</option>
                        <option value="reversal">Reversal / Reversed</option>
                      </select>
                    </th>
                    <th style={{ padding: "6px 8px", width: 70 }}>
                      <input
                        type="search"
                        placeholder="Search note…"
                        value={txColNote}
                        onChange={(e) => {
                          setTxColNote(e.target.value);
                          setOffset(0);
                        }}
                        style={{
                          width: "100%",
                          padding: "6px 8px",
                          fontSize: 12,
                          borderRadius: 6,
                          border: "1px solid #cbd5e1",
                          background: "#ffffff",
                        }}
                      />
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.length === 0 ? (
                    <tr>
                      <td colSpan={7} style={{ textAlign: "center", padding: "28px 12px", color: "#64748b" }}>
                        No transactions match the selected filters
                      </td>
                    </tr>
                  ) : (
                    displayedRows.map((r, i) => (
                      <tr key={str(r.id) || i} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '10px 12px' }}>
                          {r.id && onSelect ? (
                            <button
                              type="button"
                              className="text-link"
                              onClick={() => onSelect(str(r.id))}
                              style={{
                                fontWeight: 700,
                                color: '#2563eb',
                                background: 'none',
                                border: 'none',
                                padding: 0,
                                cursor: 'pointer',
                                textDecoration: 'underline',
                                fontFamily: 'inherit',
                                fontSize: 'inherit',
                              }}
                            >
                              {str(r.no)}
                            </button>
                          ) : (
                            <span style={{ fontWeight: 600 }}>{str(r.no)}</span>
                          )}
                        </td>
                        <td style={{ padding: '10px 12px', color: '#475569', whiteSpace: 'nowrap' }}>
                          <div style={{ display: 'flex', flexDirection: 'column' }}>
                            <span style={{ fontWeight: 600, color: '#0f172a' }}>{str(r.date)}</span>
                            {r.created_at ? (
                              <span style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                                {timeOnlyLabel(r.created_at)}
                              </span>
                            ) : null}
                          </div>
                        </td>
                        <td style={{ padding: '10px 12px' }}>
                          {(() => {
                            const meta = resolveTransactionType(r);
                            return (
                              <span
                                className="badge"
                                style={{
                                  fontSize: 11,
                                  padding: "2px 8px",
                                  borderRadius: 4,
                                  background: meta.badgeStyle.background,
                                  color: meta.badgeStyle.color,
                                }}
                              >
                                {meta.label}
                              </span>
                            );
                          })()}
                        </td>
                        <td style={{ padding: '10px 12px', fontWeight: 500, color: '#0f172a' }}>
                          {str(r.category)}
                        </td>
                        <td
                          className="money-cell"
                          style={{
                            padding: '10px 12px',
                            textAlign: 'right',
                            fontWeight: 600,
                            color: String(r.amount ?? '').startsWith('-') ? '#dc2626' : '#0f172a',
                          }}
                        >
                          {str(r.amount)}
                        </td>
                        <td style={{ padding: '10px 12px' }}>
                          <span
                            style={{
                              fontSize: 12,
                              fontWeight: 600,
                              padding: '2px 8px',
                              borderRadius: 4,
                              background: r.reversed
                                ? '#fee2e2'
                                : r.returned
                                  ? '#ffedd5'
                                  : str(r.status).startsWith('Settled')
                                    ? '#dcfce7'
                                    : str(r.status).startsWith('Unpaid')
                                      ? '#fef9c3'
                                      : '#f1f5f9',
                              color: r.reversed
                                ? '#dc2626'
                                : r.returned
                                  ? '#c2410c'
                                  : str(r.status).startsWith('Settled')
                                    ? '#166534'
                                    : str(r.status).startsWith('Unpaid')
                                      ? '#854d0e'
                                      : '#334155',
                            }}
                          >
                            {str(r.status)}
                          </span>
                        </td>
                        <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                          <NoteTooltip text={str(r.note ?? "")} />
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          ) : (
            <Table
              rows={data.map((r) => ({
                ...r,
                salesman_id:
                  arr(masters.salesmen).find((s) => s.id === r.salesman_id)?.name ??
                  r.salesman_id,
                salesman_name:
                  r.salesman_name ??
                  arr(masters.salesmen).find((s) => s.id === r.salesman_id)?.name ??
                  '—',
                reverses: r.reverses ? str(r.reverses) : '—',
                reversed: r.reversed ? 'Yes' : 'No',
              }))}
              columns={getColumns()}
            />
          )}

          {exportStatus && (
            <p className="notice" role="status" style={{ marginTop: 12 }}>
              {exportStatus}
            </p>
          )}

          {/* Pagination bar */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginTop: 18,
              paddingTop: 14,
              borderTop: '1px solid #f5f5f4',
            }}
          >
            {activeTab === "transactions" ? (
              <>
                <span style={{ fontSize: '0.85rem', color: '#78716c' }}>
                  Showing {data.length === 0 ? 0 : pageOffset + 1}–{Math.min(pageOffset + PAGE_SIZE, data.length)} of {data.length} records (Page {data.length === 0 ? 0 : currentPage + 1} of {totalPages})
                </span>
                <div className="pagination" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <Button
                    className="secondary"
                    disabled={pageOffset === 0}
                    onClick={() => setOffset(Math.max(0, pageOffset - PAGE_SIZE))}
                  >
                    Previous
                  </Button>
                  <Button
                    className="secondary"
                    disabled={pageOffset + PAGE_SIZE >= data.length}
                    onClick={() => setOffset(pageOffset + PAGE_SIZE)}
                  >
                    Next
                  </Button>
                </div>
              </>
            ) : (
              <>
                <span style={{ fontSize: '0.85rem', color: '#78716c' }}>
                  Showing page {offset / 100 + 1} ({data.length} records)
                </span>
                <div className="pagination" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <Button
                    className="secondary"
                    disabled={!offset}
                    onClick={() => setOffset(Math.max(0, offset - 100))}
                  >
                    Previous
                  </Button>
                  <Button
                    className="secondary"
                    disabled={data.length < 100}
                    onClick={() => setOffset(offset + 100)}
                  >
                    Next
                  </Button>
                </div>
              </>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

export function BookExplorer({
  masters,
  date,
  onSelect,
}: {
  masters: Row;
  date: string;
  onSelect?: (id: string) => void;
}) {
  const [accountId, setAccount] = useState(""),
    [from, setFrom] = useState(date),
    [to, setTo] = useState(date),
    [offset, setOffset] = useState(0);
  const selected = accountId || str(arr(masters.accounts)[0]?.id),
    q = useQuery({
      queryKey: ["book", selected, from, to, offset],
      queryFn: () =>
        api(`books/${selected}?from=${from}&to=${to}&offset=${offset}`),
      enabled: !!selected,
    });
  return (
    <section className="panel">
      <h2>Cash & bank account book</h2>
      <div className="report-filters">
        <Field label="Custody / bank account">
          <select
            value={selected}
            onChange={(e) => {
              setAccount(e.target.value);
              setOffset(0);
            }}
          >
            {arr(masters.accounts).map((a) => (
              <option key={str(a.id)} value={str(a.id)}>
                {str(a.name)} · {str(a.holder)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="From">
          <input
            type="date"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
              setOffset(0);
            }}
          />
        </Field>
        <Field label="To">
          <input
            type="date"
            value={to}
            onChange={(e) => {
              setTo(e.target.value);
              setOffset(0);
            }}
          />
        </Field>
      </div>
      {q.isError ? (
        <p className="error">{q.error.message}</p>
      ) : q.data ? (
        <>
          <div className="review-balances">
            <p>
              Brought forward <b>{rupees(q.data.opening)}</b>
            </p>
            <p>
              Ending book balance <b>{rupees(q.data.ending)}</b>
            </p>
          </div>
          <Table
            rows={arr(q.data.entries)}
            columns={[
              ["date", "Date"],
              ["number", "Record"],
              ["kind", "Type"],
              ["inflow", "Money in", true],
              ["outflow", "Money out", true],
              ["balance", "Running book", true],
            ]}
            cellRenderers={{
              number: (r) => (
                <DocLink
                  id={str(r.id)}
                  number={str(r.number)}
                  onSelect={onSelect}
                />
              ),
            }}
          />
          <div className="pagination">
            <Button
              disabled={!offset}
              onClick={() => setOffset(Math.max(0, offset - 100))}
            >
              Previous
            </Button>
            <Button
              disabled={arr(q.data.entries).length < 100}
              onClick={() => setOffset(offset + 100)}
            >
              Next
            </Button>
          </div>
        </>
      ) : (
        <p>Loading account book…</p>
      )}
    </section>
  );
}

export function ItcExportPage({
  initialDate,
  onClose,
  onSelect,
}: {
  initialDate: string;
  onClose: () => void;
  onSelect?: (id: string) => void;
}) {
  const exportSectionRef = useRef<HTMLElement>(null);
  const [exportDate, setExportDate] = useState(initialDate);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    exportSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const billsQuery = useQuery({
    queryKey: ["itc-bills", exportDate],
    queryFn: () => api(`itc/bills?date=${exportDate}`, rowsSchema),
  });

  const bills = billsQuery.data ?? [];

  // When bills load, by default select all bills
  useEffect(() => {
    if (billsQuery.data) {
      setSelectedIds(new Set(billsQuery.data.map((b) => str(b.id))));
    }
  }, [billsQuery.data]);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedIds.size === bills.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(bills.map((b) => str(b.id))));
    }
  };

  const handleExport = async () => {
    if (selectedIds.size === 0) {
      alert("Please select at least one bill to export.");
      return;
    }
    setExporting(true);
    try {
      const billsParam = Array.from(selectedIds).join(",");
      const res = await fetch(`/api/v1/export/itc?date=${exportDate}&bills=${encodeURIComponent(billsParam)}`);
      if (!res.ok) {
        alert("Failed to export ITC file. Please try again.");
        return;
      }
      const blob = await res.blob();
      const contentDisposition = res.headers.get("content-disposition");
      let downloadFilename = `itc_export_${exportDate}.zip`;
      if (contentDisposition) {
        const match = contentDisposition.match(/filename=["']?([^"';]+)["']?/i);
        if (match && match[1]) {
          downloadFilename = match[1];
        }
      }
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = downloadFilename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Error exporting ITC file");
    } finally {
      setExporting(false);
    }
  };

  return (
    <section ref={exportSectionRef} id="itc-export-section" className="panel" style={{ padding: "20px 24px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, color: "#0f172a" }}>Export ITC Order Upload Files</h2>
          <p className="muted" style={{ margin: "4px 0 0", fontSize: 13 }}>
            Generate zip containing pre-formatted ITC order Excel / CSV files formatted for direct company upload.
          </p>
        </div>
        <Button className="secondary" onClick={onClose}>
          ✕ Close
        </Button>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
        <label style={{ fontSize: 13, fontWeight: 600, color: "#334155" }}>Business Date:</label>
        <input
          type="date"
          value={exportDate}
          onChange={(e) => setExportDate(e.target.value)}
          style={{ padding: "6px 12px", borderRadius: 8, border: "1px solid #cbd5e1", fontSize: 13 }}
        />
        <Button
          className="primary"
          disabled={exporting || bills.length === 0 || selectedIds.size === 0}
          onClick={handleExport}
          style={{ marginLeft: "auto" }}
        >
          {exporting ? "Generating Export…" : `Export Selected (${selectedIds.size})`}
        </Button>
      </div>

      {billsQuery.isLoading ? (
        <p>Loading bills for {exportDate}…</p>
      ) : bills.length === 0 ? (
        <Empty text={`No unreversed cigarette bills found for ${exportDate}.`} />
      ) : (
        <div className="table-scroll">
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#f8fafc", textAlign: "left", borderBottom: "2px solid #e2e8f0" }}>
                <th style={{ padding: "10px 12px", width: 40 }}>
                  <input
                    type="checkbox"
                    checked={selectedIds.size === bills.length && bills.length > 0}
                    onChange={toggleAll}
                  />
                </th>
                <th style={{ padding: "10px 12px", fontSize: 12, fontWeight: 600, color: "#64748b" }}>BILL #</th>
                <th style={{ padding: "10px 12px", fontSize: 12, fontWeight: 600, color: "#64748b" }}>TIME</th>
                <th style={{ padding: "10px 12px", fontSize: 12, fontWeight: 600, color: "#64748b" }}>SALESMAN</th>
                <th style={{ padding: "10px 12px", fontSize: 12, fontWeight: 600, color: "#64748b" }}>CUSTOMER / ROUTE</th>
                <th style={{ padding: "10px 12px", fontSize: 12, fontWeight: 600, color: "#64748b" }}>TYPE</th>
                <th style={{ padding: "10px 12px", fontSize: 12, fontWeight: 600, color: "#64748b", textAlign: "right" }}>ITEMS</th>
                <th style={{ padding: "10px 12px", fontSize: 12, fontWeight: 600, color: "#64748b", textAlign: "right" }}>AMOUNT</th>
              </tr>
            </thead>
            <tbody>
              {bills.map((b) => {
                const isSelected = selectedIds.has(str(b.id));
                return (
                  <tr
                    key={str(b.id)}
                    style={{
                      borderBottom: "1px solid #f1f5f9",
                      background: isSelected ? "#f0fdf4" : "#ffffff",
                      cursor: "pointer",
                    }}
                    onClick={() => toggleSelect(str(b.id))}
                  >
                    <td style={{ padding: "10px 12px" }} onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelect(str(b.id))}
                      />
                    </td>
                    <td style={{ padding: "10px 12px" }}>
                      <DocLink
                        id={str(b.id)}
                        number={str(b.number)}
                        onSelect={onSelect}
                        style={{ fontWeight: 600, color: "#2563eb" }}
                      />
                    </td>
                    <td style={{ padding: "10px 12px", fontSize: 12, color: "#64748b", whiteSpace: "nowrap" }}>
                      {b.created_at ? timeOnlyLabel(b.created_at) : "—"}
                    </td>
                    <td style={{ padding: "10px 12px", color: "#0f172a" }}>
                      {str(b.salesman_name)} ({str(b.salesman_code)})
                    </td>
                    <td style={{ padding: "10px 12px", color: "#475569" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span>{str(b.customer_name || b.beat_name || "Retail Pool")}</span>
                        {b.is_gst ? (
                          <span
                            style={{
                              fontSize: "0.68rem",
                              fontWeight: 700,
                              padding: "1px 5px",
                              borderRadius: 4,
                              backgroundColor: "#fef3c7",
                              color: "#92400e",
                              border: "1px solid #fde68a",
                            }}
                          >
                            GST
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td style={{ padding: "10px 12px" }}>
                      <span className="badge">{str(b.bill_type)}</span>
                    </td>
                    <td style={{ padding: "10px 12px", textAlign: "right" }}>
                      {str(b.lines_count)} lines
                    </td>
                    <td className="money-cell" style={{ padding: "10px 12px", textAlign: "right", fontWeight: 700 }}>
                      {rupees(b.amount)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ─── Public Receipt / Document Viewer (for WhatsApp links) ───────────────────
export function PublicDocumentView({ docId, token }: { docId: string; token: string }) {
  const [data, setData] = useState<Row | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/v1/public/documents/${docId}?token=${token}`);
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.message || "Invalid or expired document link");
        }
        const json = await res.json();
        setData(json);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "Failed to load document");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [docId, token]);

  if (loading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "100vh", fontFamily: "sans-serif", color: "#64748b" }}>
        Loading document…
      </div>
    );
  }

  if (error || !data) {
    return (
      <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", minHeight: "100vh", fontFamily: "sans-serif", padding: 20, textAlign: "center" }}>
        <h2 style={{ color: "#ef4444", marginBottom: 8 }}>Unable to View Document</h2>
        <p style={{ color: "#64748b", maxWidth: 400 }}>{error || "This document link is not recognized or may have expired."}</p>
      </div>
    );
  }

  const d = data;
  const docData = (d.data ?? {}) as Row;
  const isEmployeeVoucher =
    d.kind === "salary" ||
    d.kind === "employee_receipt" ||
    (d.kind === "loan" && docData.direction === "staff") ||
    (d.kind === "expense" && str(docData.category).startsWith("Employee"));

  const lines = arr(d.lines);
  const businessName = str(d.business_name ?? docData.businessName ?? "Annapurna Sales Corporation");
  const businessAddress = str((docData.businessProfile as Row | undefined)?.address ?? "");

  return (
    <div style={{ maxWidth: 800, margin: "0 auto", padding: "20px 16px", fontFamily: "system-ui, -apple-system, sans-serif" }}>
      {/* Top Action Bar */}
      <div className="no-print" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, paddingBottom: 14, borderBottom: "1px solid #e2e8f0" }}>
        <div>
          <span style={{ fontSize: 13, fontWeight: 700, color: "#16a34a", background: "#f0fdf4", padding: "4px 10px", borderRadius: 6 }}>
            ✓ Official Digital Record
          </span>
        </div>
        <button
          onClick={() => {
            let styleEl = document.getElementById("dynamic-print-page-style") as HTMLStyleElement | null;
            if (!styleEl) {
              styleEl = document.createElement("style");
              styleEl.id = "dynamic-print-page-style";
              document.head.appendChild(styleEl);
            }
            styleEl.innerHTML = `@media print { @page { size: A4 portrait; margin: 6mm 8mm; } }`;
            window.print();
          }}
          style={{
            background: "#0f172a",
            color: "#fff",
            border: "none",
            borderRadius: 6,
            padding: "8px 16px",
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <Printer size={15} /> Print / Save PDF
        </button>
      </div>

      {/* Main Document Box */}
      <div
        className="print-document"
        style={{
          background: "#fff",
          border: "2px solid #0f172a",
          borderRadius: 8,
          padding: "24px 28px",
          boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", borderBottom: "2px solid #0f172a", paddingBottom: 16, marginBottom: 20 }}>
          <div>
            <h1 style={{ margin: "0 0 4px", fontSize: 22, fontWeight: 800, color: "#0f172a" }}>
              {businessName}
            </h1>
            {Boolean(businessAddress) && <p style={{ margin: 0, fontSize: 12, color: "#475569" }}>{businessAddress}</p>}
          </div>
          <div style={{ textAlign: "right" }}>
            <span style={{ background: "#0f172a", color: "#fff", padding: "4px 12px", borderRadius: 4, fontSize: 13, fontWeight: 700, textTransform: "uppercase" }}>
              {str(d.kind)} #{str(d.number)}
            </span>
            <p style={{ margin: "6px 0 0", fontSize: 13, color: "#475569", fontWeight: 600 }}>
              Date: {str(d.business_date).split("T")[0]}
            </p>
          </div>
        </div>

        {/* Reversal Banner if cancelled */}
        {Boolean(d.reversed) && (
          <div style={{ background: "#fee2e2", border: "1px solid #f87171", borderRadius: 6, padding: "10px 14px", marginBottom: 18, color: "#b91c1c", fontWeight: 700, fontSize: 13 }}>
            ⚠️ CANCELLED / REVERSED RECORD
            {Boolean(docData.reason) && <div style={{ fontWeight: 400, marginTop: 4 }}>Reason: {str(docData.reason)}</div>}
          </div>
        )}

        {/* Party Particulars */}
        <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 6, padding: "14px 18px", marginBottom: 20 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 20px" }}>
            <div>
              <span style={{ fontSize: 11, textTransform: "uppercase", color: "#64748b", fontWeight: 700, display: "block" }}>
                {isEmployeeVoucher ? "Employee" : "Salesman / Party"}
              </span>
              <strong style={{ fontSize: 15, color: "#0f172a" }}>
                {str(d.salesman_name || d.employee_name || docData.salesmanName || docData.employeeName || "-")}
              </strong>
            </div>
            {Boolean(docData.customerName) && (
              <div>
                <span style={{ fontSize: 11, textTransform: "uppercase", color: "#64748b", fontWeight: 700, display: "block" }}>
                  Customer
                </span>
                <strong style={{ fontSize: 15, color: "#0f172a" }}>
                  {str(docData.customerName)}
                </strong>
              </div>
            )}
            <div>
              <span style={{ fontSize: 11, textTransform: "uppercase", color: "#64748b", fontWeight: 700, display: "block" }}>
                Total Amount
              </span>
              <strong style={{ fontSize: 18, color: "#047857" }}>
                {rupees(d.amount)}
              </strong>
            </div>
            {d.kind === "receipt" && (
              <div>
                <span style={{ fontSize: 11, textTransform: "uppercase", color: "#64748b", fontWeight: 700, display: "block" }}>
                  Payment Mode
                </span>
                <span style={{ fontSize: 14, color: "#1e293b", fontWeight: 600 }}>
                  {str(docData.method || "Cash").toUpperCase()} {docData.reference ? `(Ref: ${str(docData.reference)})` : ""}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Line Items Table (if any) */}
        {lines.length > 0 && (
          <div style={{ marginBottom: 20 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: "#f1f5f9", borderBottom: "2px solid #cbd5e1" }}>
                  <th style={{ padding: "8px 10px", textAlign: "left" }}>Product</th>
                  <th style={{ padding: "8px 10px", textAlign: "right" }}>Qty</th>
                  <th style={{ padding: "8px 10px", textAlign: "left" }}>Unit</th>
                  <th style={{ padding: "8px 10px", textAlign: "right" }}>Rate</th>
                  <th style={{ padding: "8px 10px", textAlign: "right" }}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => {
                  const snap = (l.snapshot as Row) || {};
                  return (
                    <tr key={str(l.id)} style={{ borderBottom: "1px solid #e2e8f0" }}>
                      <td style={{ padding: "8px 10px", fontWeight: 500 }}>{str(snap.name || "Item")}</td>
                      <td style={{ padding: "8px 10px", textAlign: "right" }}>{str(l.quantity)}</td>
                      <td style={{ padding: "8px 10px" }}>{str(snap.unit || "unit")}</td>
                      <td style={{ padding: "8px 10px", textAlign: "right" }}>{rupees(snap.rate || snap.masterRate || "0")}</td>
                      <td style={{ padding: "8px 10px", textAlign: "right", fontWeight: 600 }}>{rupees(l.amount)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: "2px solid #cbd5e1", background: "#f8fafc" }}>
                  <td colSpan={4} style={{ padding: "10px", fontWeight: 700, textAlign: "right" }}>Total:</td>
                  <td style={{ padding: "10px", fontWeight: 800, textAlign: "right", color: "#0f172a", fontSize: 15 }}>
                    {rupees(d.amount)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {/* Balance & Account Summary (Bills & Receipts) */}
        {d.kind === "bill" && (
          <div style={{ background: "#f8fafc", border: "1px solid #cbd5e1", borderRadius: 6, padding: "14px 18px", margin: "18px 0" }}>
            <h4 style={{ margin: "0 0 10px", fontSize: 13, textTransform: "uppercase", color: "#334155", letterSpacing: 0.5 }}>
              Account Summary at Issue
            </h4>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
              {docData.previousBalance !== undefined && (
                <div>
                  <span style={{ fontSize: 11, color: "#64748b", display: "block" }}>Previous Balance</span>
                  <strong style={{ fontSize: 14, color: "#0f172a" }}>{rupees(docData.previousBalance)}</strong>
                </div>
              )}
              <div>
                <span style={{ fontSize: 11, color: "#64748b", display: "block" }}>Current Bill Value</span>
                <strong style={{ fontSize: 14, color: "#0f172a" }}>{rupees(d.amount)}</strong>
              </div>
              {Boolean(docData.cashConfirmed && Number(docData.cashConfirmed) > 0) && (
                <div>
                  <span style={{ fontSize: 11, color: "#15803d", display: "block" }}>Cash Paid</span>
                  <strong style={{ fontSize: 14, color: "#15803d" }}>{rupees(docData.cashConfirmed)}</strong>
                </div>
              )}
              {Boolean(docData.onlineConfirmed && Number(docData.onlineConfirmed) > 0) && (
                <div>
                  <span style={{ fontSize: 11, color: "#15803d", display: "block" }}>Online Paid</span>
                  <strong style={{ fontSize: 14, color: "#15803d" }}>{rupees(docData.onlineConfirmed)}</strong>
                </div>
              )}
              {!docData.cashConfirmed && !docData.onlineConfirmed && docData.confirmed !== undefined && Number(docData.confirmed) > 0 && (
                <div>
                  <span style={{ fontSize: 11, color: "#15803d", display: "block" }}>On-spot Paid</span>
                  <strong style={{ fontSize: 14, color: "#15803d" }}>{rupees(docData.confirmed)}</strong>
                </div>
              )}
              {docData.issueBalance !== undefined && (
                <div>
                  <span style={{ fontSize: 11, color: "#0f172a", fontWeight: 700, display: "block" }}>Balance at Issue</span>
                  <strong style={{ fontSize: 15, color: "#0f172a" }}>{rupees(docData.issueBalance)}</strong>
                </div>
              )}
            </div>
          </div>
        )}

        {d.kind === "receipt" && (
          <div style={{ background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 6, padding: "14px 18px", margin: "18px 0" }}>
            <h4 style={{ margin: "0 0 10px", fontSize: 13, textTransform: "uppercase", color: "#166534", letterSpacing: 0.5 }}>
              Payment & Dues Impact
            </h4>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
              {docData.previousBalance !== undefined && (
                <div>
                  <span style={{ fontSize: 11, color: "#475569", display: "block" }}>Balance Before</span>
                  <strong style={{ fontSize: 14, color: "#0f172a" }}>{rupees(docData.previousBalance)}</strong>
                </div>
              )}
              <div>
                <span style={{ fontSize: 11, color: "#166534", display: "block" }}>Amount Received</span>
                <strong style={{ fontSize: 14, color: "#16a34a" }}>{rupees(docData.currentAmountReceived ?? d.amount)}</strong>
              </div>
              {docData.overallOutstanding !== undefined && (
                <div>
                  <span style={{ fontSize: 11, color: "#0f172a", fontWeight: 700, display: "block" }}>Updated Outstanding</span>
                  <strong style={{ fontSize: 16, color: "#0f172a" }}>{rupees(docData.overallOutstanding)}</strong>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Pending Online Claims at Issue / Open Claims */}
        {(() => {
          const claims = arr(d.openClaims);
          if (claims.length === 0 && (!docData.pendingAtIssue || Number(docData.pendingAtIssue) === 0)) return null;
          return (
            <div style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 6, padding: "12px 16px", margin: "14px 0" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: claims.length > 0 ? 8 : 0 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: "#92400e", textTransform: "uppercase" }}>
                  ⏳ Pending Online Claims (Awaiting Bank Verification)
                </span>
                {docData.pendingAtIssue !== undefined && (
                  <strong style={{ fontSize: 13, color: "#b45309" }}>
                    Total: {rupees(docData.pendingAtIssue)}
                  </strong>
                )}
              </div>
              {claims.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
                  {claims.map((c) => (
                    <div key={str(c.id)} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#78350f", background: "#fef3c7", padding: "6px 10px", borderRadius: 4 }}>
                      <span>
                        • {str(c.actual_date)} — Ref: <b>{str(c.reference || "Online Transfer")}</b>
                      </span>
                      <b>{rupees(c.amount)}</b>
                    </div>
                  ))}
                </div>
              )}
              <small style={{ display: "block", marginTop: 6, fontSize: 11, color: "#a16207" }}>
                * Dues will be credited to salesman's ledger upon bank statement verification.
              </small>
            </div>
          );
        })()}

        {/* Balance & Notes */}
        {Boolean(docData.note) && (
          <p style={{ fontSize: 13, color: "#475569", margin: "14px 0 0" }}>
            <b>Note:</b> {str(docData.note)}
          </p>
        )}

        <div style={{ marginTop: 28, paddingTop: 14, borderTop: "1px dashed #cbd5e1", textAlign: "center", fontSize: 11, color: "#94a3b8" }}>
          Generated by Annapurna Sales Corporation · Official operational record
        </div>
      </div>
    </div>
  );
}
