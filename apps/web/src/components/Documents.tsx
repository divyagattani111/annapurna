import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Search, Star, X } from "lucide-react";
import { documentListResponse, rowsSchema } from "@ledger/contracts";
import { api } from "../api";
import { Button, Table, Field, Empty, DocLink, NoteTooltip } from "./ui";
import { type Row, str, arr, rupees, formatDateTime, dateLabel, timeOnlyLabel, resolveTransactionType, type TransactionTypeMeta } from "../utils/helpers";

export function Documents({
  onSelect,
  kind,
  salesmanId,
  excludeSalesmanId,
  requireSalesman,
  title,
}: {
  onSelect: (id: string) => void;
  kind?: string;
  salesmanId?: string;
  excludeSalesmanId?: string;
  requireSalesman?: boolean;
  title?: string;
}) {
  const [offset, setOffset] = useState(0);
  const pageSize = 20;

  // Dedicated column-wise filter states
  const [colRecord, setColRecord] = useState("");
  const [colDate, setColDate] = useState("");
  const [colPerson, setColPerson] = useState("");
  const [colType, setColType] = useState("");
  const [colAmount, setColAmount] = useState("");
  const [colStatus, setColStatus] = useState("");
  const [colNote, setColNote] = useState("");

  const q = useQuery({
    queryKey: ["documents", kind, salesmanId, excludeSalesmanId, requireSalesman, offset],
    queryFn: () => {
      const params = new URLSearchParams();
      params.set("offset", "0");
      params.set("limit", "100"); // Load generous window for instantaneous column filtering
      if (kind) params.set("kind", kind);
      if (salesmanId) params.set("salesmanId", salesmanId);
      if (excludeSalesmanId) params.set("excludeSalesmanId", excludeSalesmanId);
      if (requireSalesman) params.set("requireSalesman", "true");
      return api(`documents?${params.toString()}`, rowsSchema);
    },
  });

  const rawRows: Row[] = (q.data ?? []).map((r: Row) => {
    const rowData = (r.data as Row) || {};
    const personName =
      rowData.customerName
        ? `${rowData.customerName}${r.salesman_name ? ` (${r.salesman_name})` : ""}`
        : r.salesman_name ||
        rowData.employeeName ||
        rowData.payee ||
        rowData.counterparty ||
        "—";
    let statusStr = str(r.settlement ?? "Posted");
    if (r.kind === "bill") {
      const parts = [str(r.settlement ?? "Unpaid")];
      if (r.returned) parts.push("returned");
      if (r.reversed) parts.push("reversal");
      statusStr = parts.join(" / ");
    } else {
      if (r.reversed) {
        statusStr = "Reversed";
      }
    }
    const formattedDate = dateLabel(r.business_date);
    const noteText = str(
      rowData.note ||
      rowData.notes ||
      rowData.remarks ||
      rowData.reference ||
      rowData.reason ||
      r.note ||
      ""
    );
    const typeMeta = resolveTransactionType(r);
    const displayKind = typeMeta.key;

    return {
      ...r,
      person_name: personName,
      formatted_date: formattedDate,
      raw_date: str(r.business_date || ""),
      status: statusStr,
      note_text: noteText,
      display_kind: displayKind,
      type_label: typeMeta.label,
      type_group: typeMeta.group,
      type_badge_style: typeMeta.badgeStyle,
    };
  });

  // Client-side instant filter across all columns
  const filteredRows = rawRows.filter((r: Row) => {
    if (colRecord.trim() && !str(r.number).toLowerCase().includes(colRecord.trim().toLowerCase())) {
      return false;
    }
    if (
      colDate.trim() &&
      !str(r.formatted_date).toLowerCase().includes(colDate.trim().toLowerCase()) &&
      !str(r.raw_date).includes(colDate.trim()) &&
      !timeOnlyLabel(r.created_at).toLowerCase().includes(colDate.trim().toLowerCase())
    ) {
      return false;
    }
    if (colPerson.trim() && !str(r.person_name).toLowerCase().includes(colPerson.trim().toLowerCase())) {
      return false;
    }
    if (colType.trim()) {
      if (colType === "reversed") {
        if (!r.reversed) return false;
      } else {
        const targetType = colType.toLowerCase();
        const rowDisplayKind = str(r.display_kind).toLowerCase();
        const rowKind = str(r.kind).toLowerCase();
        const rowGroup = str(r.type_group).toLowerCase();
        if (
          rowDisplayKind !== targetType &&
          rowKind !== targetType &&
          rowGroup !== targetType
        ) {
          return false;
        }
      }
    }
    if (colAmount.trim() && !str(r.amount).includes(colAmount.trim())) {
      return false;
    }
    if (colStatus.trim() && !str(r.status).toLowerCase().includes(colStatus.trim().toLowerCase())) {
      return false;
    }
    if (colNote.trim() && !str(r.note_text).toLowerCase().includes(colNote.trim().toLowerCase())) {
      return false;
    }
    return true;
  });

  const paginatedRows = filteredRows.slice(offset, offset + pageSize);

  const availableTypes = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of rawRows) {
      const key = str(r.display_kind || r.kind);
      const label = str(r.type_label) || resolveTransactionType(r).label;
      if (key && label) {
        map.set(key, label);
      }
    }
    if (map.size === 0) {
      const fallbacks = [
        "bill",
        "receipt_cash",
        "receipt_online",
        "foods_receipt_cash",
        "foods_receipt_online",
        "foods_receipt",
        "sales_return",
        "expense",
        "salary",
        "loan",
        "employee_receipt",
        "bank_deposit",
        "cash_transfer",
      ];
      for (const fb of fallbacks) {
        map.set(fb, resolveTransactionType({ kind: fb }).label);
      }
    }
    return Array.from(map.entries()).map(([key, label]) => ({ key, label }));
  }, [rawRows]);
  const hasActiveFilters = Boolean(colRecord || colDate || colPerson || colType || colAmount || colStatus || colNote);

  const clearFilters = () => {
    setColRecord("");
    setColDate("");
    setColPerson("");
    setColType("");
    setColAmount("");
    setColStatus("");
    setColNote("");
    setOffset(0);
  };

  const personColumnTitle = salesmanId
    ? "Customer / Person"
    : kind?.includes("salary")
      ? "Employee / Person"
      : kind === "foods_receipt"
        ? "Foods Salesman"
        : "Salesman / Customer";

  return (
    <section className="panel" style={{ padding: "16px 18px" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 12,
          marginBottom: 16,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>
            {title ||
              (kind === "bill"
                ? "Bill Register"
                : kind === "receipt"
                  ? "Receipts Register"
                  : kind === "foods_receipt"
                    ? "Foods Collections Register"
                    : kind === "expense"
                      ? "Expense Vouchers"
                      : "Register")}
          </h2>
          <span className="badge" style={{ fontSize: 12, fontWeight: 700 }}>
            {filteredRows.length} record{filteredRows.length === 1 ? "" : "s"}
          </span>
        </div>

        {hasActiveFilters && (
          <Button
            className="secondary"
            onClick={clearFilters}
            style={{ fontSize: 12, padding: "5px 12px", color: "#dc2626", borderColor: "#fca5a5" }}
          >
            ✕ Reset All Filters
          </Button>
        )}
      </div>

      {q.isPending ? (
        <p>Loading records…</p>
      ) : q.isError ? (
        <p role="alert" className="error">
          {q.error.message}
        </p>
      ) : (
        <div className="table-scroll" style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              {/* Row 1: Column Headings */}
              <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
                <th style={{ textAlign: "left", padding: "10px 12px", fontWeight: 700, fontSize: 13, color: "#475569" }}>
                  Record
                </th>
                <th style={{ textAlign: "left", padding: "10px 12px", fontWeight: 700, fontSize: 13, color: "#475569" }}>
                  Date
                </th>
                <th style={{ textAlign: "left", padding: "10px 12px", fontWeight: 700, fontSize: 13, color: "#475569" }}>
                  {personColumnTitle}
                </th>
                <th style={{ textAlign: "left", padding: "10px 12px", fontWeight: 700, fontSize: 13, color: "#475569" }}>
                  Type
                </th>
                <th className="money-cell" style={{ textAlign: "right", padding: "10px 12px", fontWeight: 700, fontSize: 13, color: "#475569" }}>
                  Amount
                </th>
                <th style={{ textAlign: "left", padding: "10px 12px", fontWeight: 700, fontSize: 13, color: "#475569" }}>
                  Status
                </th>
                <th style={{ textAlign: "center", padding: "10px 12px", fontWeight: 700, fontSize: 13, color: "#475569", width: 70 }}>
                  Note
                </th>
              </tr>

              {/* Row 2: Search and Filter Row Directly Below All Columns */}
              <tr style={{ background: "#f1f5f9", borderBottom: "2px solid #cbd5e1" }}>
                <th style={{ padding: "6px 8px" }}>
                  <input
                    type="search"
                    placeholder="Search #…"
                    value={colRecord}
                    onChange={(e) => {
                      setColRecord(e.target.value);
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
                    value={colDate}
                    onChange={(e) => {
                      setColDate(e.target.value);
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
                    placeholder="Search name…"
                    value={colPerson}
                    onChange={(e) => {
                      setColPerson(e.target.value);
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
                    value={colType}
                    onChange={(e) => {
                      setColType(e.target.value);
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
                    {availableTypes.map(({ key, label }) => (
                      <option key={key} value={key}>
                        {label}
                      </option>
                    ))}
                    <option value="reversed">Reversed</option>
                  </select>
                </th>
                <th style={{ padding: "6px 8px" }}>
                  <input
                    type="search"
                    placeholder="Search ₹…"
                    value={colAmount}
                    onChange={(e) => {
                      setColAmount(e.target.value);
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
                    value={colStatus}
                    onChange={(e) => {
                      setColStatus(e.target.value);
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
                    value={colNote}
                    onChange={(e) => {
                      setColNote(e.target.value);
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
              {paginatedRows.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: "center", padding: "28px 12px", color: "#64748b" }}>
                    No matching records found.
                  </td>
                </tr>
              ) : (
                paginatedRows.map((r, i) => (
                  <tr key={str(r.id) || i} style={{ borderBottom: "1px solid #f1f5f9" }}>
                    <td style={{ padding: "10px 12px" }}>
                      <button
                        className="text-link"
                        onClick={() => onSelect(str(r.id))}
                        style={{ fontWeight: 600, color: "#2563eb", cursor: "pointer" }}
                      >
                        {str(r.number)}
                      </button>
                    </td>
                    <td style={{ padding: "10px 12px", color: "#475569", whiteSpace: "nowrap" }}>
                      <div style={{ display: "flex", flexDirection: "column" }}>
                        <span>{str(r.formatted_date)}</span>
                        {r.created_at ? (
                          <span style={{ fontSize: 11, color: "#94a3b8" }}>
                            {timeOnlyLabel(r.created_at)}
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td style={{ padding: "10px 12px", fontWeight: 500, color: "#0f172a" }}>
                      {str(r.person_name)}
                    </td>
                    <td style={{ padding: "10px 12px" }}>
                      <span
                        className="badge"
                        style={{
                          fontSize: 11,
                          padding: "2px 8px",
                          borderRadius: 4,
                          background: (r.type_badge_style as { background: string; color: string })?.background || "#f1f5f9",
                          color: (r.type_badge_style as { background: string; color: string })?.color || "#475569",
                        }}
                      >
                        {str(r.type_label || str(r.display_kind || r.kind).replace(/_/g, " "))}
                      </span>
                    </td>
                    <td className="money-cell" style={{ padding: "10px 12px", textAlign: "right", fontWeight: 700 }}>
                      {rupees(r.amount)}
                    </td>
                    <td style={{ padding: "10px 12px" }}>
                      <span
                        style={{
                          fontSize: 12,
                          fontWeight: 600,
                          padding: "2px 8px",
                          borderRadius: 4,
                          background: r.reversed
                            ? "#fee2e2"
                            : r.returned
                              ? "#ffedd5"
                              : str(r.status).startsWith("Settled")
                                ? "#dcfce7"
                                : str(r.status).startsWith("Unpaid")
                                  ? "#fef9c3"
                                  : "#f1f5f9",
                          color: r.reversed
                            ? "#dc2626"
                            : r.returned
                              ? "#c2410c"
                              : str(r.status).startsWith("Settled")
                                ? "#166534"
                                : str(r.status).startsWith("Unpaid")
                                  ? "#854d0e"
                                  : "#334155",
                        }}
                      >
                        {str(r.status)}
                      </span>
                    </td>
                    <td style={{ padding: "10px 12px", textAlign: "center" }}>
                      <NoteTooltip text={str(r.note_text ?? "")} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {filteredRows.length > 0 && (
        <div className="pagination" style={{ marginTop: 14 }}>
          <Button
            disabled={!offset}
            onClick={() => setOffset(Math.max(0, offset - pageSize))}
          >
            Previous
          </Button>
          <span>
            Records {offset + 1}–{Math.min(offset + pageSize, filteredRows.length)} of {filteredRows.length}
          </span>
          <Button
            disabled={offset + pageSize >= filteredRows.length}
            onClick={() => setOffset(offset + pageSize)}
          >
            Next
          </Button>
        </div>
      )}
    </section>
  );
}
export function SignaturePad({
  onChange,
  onClear,
}: {
  onChange: (blob: Blob | null) => void;
  onClear?: () => void;
}) {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const [hasStroke, setHasStroke] = useState(false);
  const isDrawing = React.useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Set high-DPI scaling
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    ctx.scale(dpr, dpr);

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, rect.width, rect.height);
    ctx.strokeStyle = "#0f172a";
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
  }, []);

  const getPos = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    if ("touches" in e) {
      const touch = e.touches[0] || (e as React.TouchEvent).changedTouches[0];
      return {
        x: touch.clientX - rect.left,
        y: touch.clientY - rect.top,
      };
    }
    return {
      x: (e as React.MouseEvent).clientX - rect.left,
      y: (e as React.MouseEvent).clientY - rect.top,
    };
  };

  const startDraw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const pos = getPos(e);
    isDrawing.current = true;
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawing.current) return;
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const pos = getPos(e);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
    if (!hasStroke) setHasStroke(true);
  };

  const stopDraw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawing.current) return;
    e.preventDefault();
    isDrawing.current = false;
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.toBlob((blob) => {
      onChange(blob);
    }, "image/png");
  };

  const handleClear = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
    ctx.strokeStyle = "#0f172a";
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    setHasStroke(false);
    onChange(null);
    onClear?.();
  };

  return (
    <div style={{ margin: "14px 0", border: "1px dashed #cbd5e1", borderRadius: 8, padding: 12, background: "#f8fafc" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: "#334155" }}>
          ✍️ Employee Digital Signature (Touch / Mouse / Pen)
        </span>
        <button
          type="button"
          onClick={handleClear}
          style={{
            background: "#fee2e2",
            border: "1px solid #fca5a5",
            color: "#991b1b",
            borderRadius: 4,
            padding: "3px 10px",
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Clear
        </button>
      </div>
      <canvas
        ref={canvasRef}
        style={{
          width: "100%",
          height: "150px",
          background: "#ffffff",
          borderRadius: 6,
          border: "1px solid #e2e8f0",
          touchAction: "none",
          display: "block",
          cursor: "crosshair",
        }}
        onMouseDown={startDraw}
        onMouseMove={draw}
        onMouseUp={stopDraw}
        onMouseLeave={stopDraw}
        onTouchStart={startDraw}
        onTouchMove={draw}
        onTouchEnd={stopDraw}
      />
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: 11, color: "#64748b" }}>
        <span>Sign above inside the white canvas to attach proof of receipt</span>
        {hasStroke ? (
          <span style={{ color: "#16a34a", fontWeight: 600 }}>✓ Signature captured</span>
        ) : (
          <span>(Optional / Can sign printout)</span>
        )}
      </div>
    </div>
  );
}

