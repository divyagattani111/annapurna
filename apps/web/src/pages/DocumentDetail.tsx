import React, {
  useEffect,
  useRef,
  useState,
  useCallback,
  useMemo,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import {
  MessageCircle,
  X,
  Printer,
  Download,
  Search,
} from "lucide-react";
import {
  rowsSchema, rowSchema, commandResult, commands, cleanMoney, cleanDecimal,
  parseMultiAmounts, cleanIndianPhone, type CommandName,
  encodeCsvRows,
} from "@ledger/contracts";
import { api } from "../api";
import { Button, Table, DocLink, Empty, Field } from "../components/ui";
import { D, str, arr, rupees, formatCents, parseCents, parseMoneyNumber,
  formatBilledCaption, dateLabel, timeOnlyLabel, formatDateTime, type Row,
} from "../utils/helpers";
import { getProductBarcodes, matchProductsByScanOrCode, matchProductByScanOrCode,
  useGlobalBarcodeScanner,
} from "../utils/barcodeScanner";
import {
  CustomerSearchableSelect, ProductIdSearchableSelect, ProductSearchableSelect,
  ConfectionerySearchableSelect, BarcodeScannerInput,
  type ConfectioneryRowItem, type DraftConfectioneryItem,
} from "../components/selectors";


function buildWhatsAppMessage(d: Row, businessName: string): string {
  const data = (d.data ?? {}) as Row;
  const lines: string[] = [];

  // ── Header ──
  lines.push(`*${businessName}*`);

  if (d.reversed) {
    lines.push(`⚠️ *[CANCELLED / REVERSED RECORD]*`);
    if (data.reason) lines.push(`Reason: ${str(data.reason)}`);
    lines.push("");
  }

  const kind = str(d.kind);
  const number = str(d.number);
  const dateStr = str(d.business_date).split("T")[0];

  const kindLabel: Record<string, string> = {
    bill: "📋 Bill / Invoice",
    receipt: "✅ Payment Receipt",
    return: "🔄 Return / Credit Note",
    expense: "🧾 Expense Voucher",
    salary: "💼 Salary Payment",
    employee_receipt: "💼 Employee Receipt",
    loan: "🤝 Loan / Advance",
    transfer: "🏦 Cash / Bank Transfer",
    deposit: "🏦 Bank Deposit",
    opening: "📂 Opening Balance",
    identify: "🏦 Bank Credit Identified",
  };
  lines.push(`*${kindLabel[kind] ?? kind.toUpperCase()} — ${number}*`);
  lines.push(`Date: ${dateStr}`);

  const partyName = str(
    data.salesmanName ?? data.employeeName ?? data.payee ?? data.counterparty ?? ""
  );
  if (partyName) lines.push(`Party: ${partyName}`);
  if (data.customerName) lines.push(`Customer: ${str(data.customerName)}`);
  lines.push("");

  // ── Instant PDF View / Download Link ──
  if (d.id && d.shareToken) {
    const origin = window.location.origin;
    const viewUrl = `${origin}/?view=${str(d.id)}&token=${str(d.shareToken)}`;
    lines.push(`📄 *View / Download Official PDF:*`);
    lines.push(viewUrl);
    lines.push(`_(Note: If the link is not clickable, please reply "OK" or save this number to your contacts)_`);
    lines.push("");
  }

  // ── Bill financial summary (below PDF link) ──
  if (kind === "bill") {
    lines.push(`*Total: ₹${str(d.amount)}*`);
    if (data.billDiscount && Number(data.billDiscount) > 0) {
      lines.push(`Bill Discount: -₹${str(data.billDiscount)}`);
    }
    if (data.previousBalance !== undefined) {
      lines.push(`Previous balance: ₹${str(data.previousBalance)}`);
    }
    const receiptsList = arr(data.receipts);
    const cashFromReceipts = receiptsList
      .filter((r) => (r as Row).method === "cash")
      .reduce((s, r) => s.plus(str((r as Row).amount || "0")), D(0));
    const onlineFromReceipts = receiptsList
      .filter((r) => (r as Row).method === "online")
      .reduce((s, r) => s.plus(str((r as Row).amount || "0")), D(0));

    const cashPayVal = data.cashConfirmed !== undefined
      ? str(data.cashConfirmed)
      : (cashFromReceipts.gt(0) ? cashFromReceipts.toFixed(2) : undefined);
    const onlinePayVal = data.onlineConfirmed !== undefined
      ? str(data.onlineConfirmed)
      : (onlineFromReceipts.gt(0) ? onlineFromReceipts.toFixed(2) : undefined);

    const hasCashPay = Boolean(cashPayVal && Number(cashPayVal) > 0);
    const hasOnlinePay = Boolean(onlinePayVal && Number(onlinePayVal) > 0);

    if (hasCashPay) {
      lines.push(`Cash payment: ₹${cashPayVal}`);
    }
    if (hasOnlinePay) {
      lines.push(`Online payment: ₹${onlinePayVal}`);
    }
    if (!hasCashPay && !hasOnlinePay && data.confirmed && Number(data.confirmed) > 0) {
      lines.push(`On-spot payment: ₹${str(data.confirmed)}`);
    }
    if (data.issueBalance !== undefined) {
      lines.push(`*Balance at issue: ₹${str(data.issueBalance)}*`);
    }
    if (data.pendingAtIssue && Number(data.pendingAtIssue) > 0) {
      lines.push(`Pending online claims at issue: ₹${str(data.pendingAtIssue)} (Awaiting verification)`);
    }
    const openClaims = arr(d.openClaims);
    if (openClaims.length > 0) {
      lines.push(`*Open Online Claims:*`);
      for (const oc of openClaims) {
        lines.push(`  • ${str(oc.actual_date)}: ₹${str(oc.amount)} (${str(oc.reference || "Online")})`);
      }
    }
    if (d.settlement) lines.push(`Settlement status: ${str(d.settlement)}`);
    lines.push("");
  }

  // ── Receipt summary ──
  if (kind === "receipt") {
    const method = str(data.method || "cash");
    const ref = str(data.reference || "");
    const methodLabel = method === "cash" ? "Cash" : method === "online" ? "Online / UPI" : method;
    lines.push(`Mode: ${methodLabel}${ref ? ` (Ref: ${ref})` : ""}`);

    // Distinguish verified vs pending online
    if (method === "online") {
      const verified = Boolean(data.verified ?? data.acceptedAmount);
      if (verified) {
        lines.push(`Status: ✅ Verified & Credited`);
      } else {
        lines.push(`Status: ⏳ Pending Verification`);
        lines.push(`(Dues will update once bank verification is complete)`);
      }
    }

    if (data.previousBalance !== undefined) {
      lines.push(`Balance before: ₹${str(data.previousBalance)}`);
    }
    lines.push(`Amount received: ₹${str(data.currentAmountReceived ?? d.amount)}`);
    if (data.overallOutstanding !== undefined) {
      lines.push(`*Updated outstanding: ₹${str(data.overallOutstanding)}*`);
    }
    lines.push("");
  }

  // ── Return summary ──
  if (kind === "return") {
    if (data.originalBillNumber) lines.push(`Original Bill: ${str(data.originalBillNumber)}`);
    if (data.reason) lines.push(`Reason: ${str(data.reason)}`);
    lines.push(`Credit: +₹${str(d.amount)}`);
    lines.push("");
  }

  // ── Employee / salary / expense ──
  if (["salary", "employee_receipt", "expense"].includes(kind) || (kind === "loan" && data.direction === "staff")) {
    lines.push(`*Amount: ₹${str(d.amount)}*`);
    if (data.period) lines.push(`Period: ${str(data.period)}`);
    if (data.category) lines.push(`Category: ${str(data.category)}`);
    if (data.note) lines.push(`Note: ${str(data.note)}`);
    lines.push("");
  }

  // ── Bill / Return line items (in the last) ──
  const rawLines = arr((d as Row).lines);
  const displayLines =
    rawLines.length > 0
      ? rawLines
      : kind === "return" && data.snapshot
      ? [
          {
            id: data.lineId || d.id,
            quantity: str(data.quantity || "1"),
            snapshot: data.snapshot,
            amount: d.amount,
          },
        ]
      : [];

  if (displayLines.length > 0) {
    lines.push(kind === "return" ? "*Returned Items:*" : "*Items:*");
    for (const l of displayLines) {
      const snap = (l.snapshot as Row) || {};
      const name = str(snap.name || "Item");
      const qty = str(l.quantity || "0").replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
      const unit = str(snap.unit || "unit");
      const rate = str(snap.rate || snap.masterRate || "0.00");
      const amt = str(l.amount || "0.00");
      lines.push(`  • ${name}: ${qty} ${unit} × ₹${rate} = ₹${amt}`);
      if (snap.discountAmount && Number(snap.discountAmount) > 0) {
        lines.push(`    (Disc: -₹${str(snap.discountAmount)})`);
      }
    }
    lines.push("");
  } else if (!["bill", "receipt", "return", "salary", "employee_receipt", "expense"].includes(kind)) {
    lines.push(`*Amount: ₹${str(d.amount)}*`);
    lines.push("");
  }

  // ── Generic note ──
  if (!["salary", "employee_receipt", "expense"].includes(kind)) {
    if (data.note) {
      lines.push(`Note: ${str(data.note)}`);
      lines.push("");
    }
  }

  // ── Footer ──
  if (d.reversed) {
    lines.push("⚠️ This record has been CANCELLED and is not valid for payment.");
    lines.push("");
  }
  lines.push(`_${businessName}_`);

  return lines.join("\n").trim();
}


function AuditView({ onBack, onSelect }: { onBack: () => void; onSelect?: (id: string) => void }) {
  const [offset, setOffset] = useState(0);
  const audit = useQuery({
    queryKey: ["audit", offset],
    queryFn: () => api(`audit?offset=${offset}`, rowsSchema),
  });

  return (
    <section className="panel">
      <Button onClick={onBack}>← Back</Button>
      <h2>Audit history</h2>
      {audit.isError ? (
        <p className="error">{audit.error.message}</p>
      ) : (
        <>
          <Table
            rows={audit.data ?? []}
            columns={[
              ["created_at", "Time"],
              ["actor_name", "Actor"],
              ["action", "Action"],
              ["record_label", "Record"],
              ["reason", "Reason"],
            ]}
            cellRenderers={{
              record_label: (r) => (
                <DocLink
                  id={r.document_id ? str(r.document_id) : null}
                  number={str(r.record_label)}
                  onSelect={onSelect}
                />
              ),
            }}
          />
          <div className="pagination" style={{ marginTop: 14 }}>
            <Button
              disabled={!offset}
              onClick={() => setOffset(Math.max(0, offset - 100))}
            >
              Previous
            </Button>
            <span>
              Showing {audit.data?.length ? offset + 1 : 0}–
              {offset + (audit.data?.length ?? 0)} (latest first)
            </span>
            <Button
              disabled={(audit.data?.length ?? 0) < 100}
              onClick={() => setOffset(offset + 100)}
            >
              Next
            </Button>
          </div>
        </>
      )}
    </section>
  );
}

// ─── WhatsApp Share ───────────────────────────────────────────────────────────

/** Build the plain-text WhatsApp message body from a loaded document. */

export function WhatsAppShareModal({
  doc,
  businessName,
  ownerPhone,
  onClose,
}: {
  doc: Row;
  businessName: string;
  ownerPhone?: string;
  onClose: () => void;
}) {
  const data = (doc.data ?? {}) as Row;
  const kind = str(doc.kind);

  // Determine initial recipient
  const isEmployeeKind =
    kind === "salary" ||
    kind === "employee_receipt" ||
    (kind === "loan" && data.direction === "staff") ||
    (kind === "expense" && str(data.category).startsWith("Employee"));

  const isFoodsKind =
    kind === "foods_receipt" ||
    Boolean(data.foodsSalesmanId || data.foodsSalesman);

  const rawPhone = isEmployeeKind
    ? str(doc.employee_phone || data.employeePhone || "")
    : isFoodsKind
    ? str(doc.foods_salesman_phone || data.foodsSalesmanPhone || "")
    : doc.salesman_id
    ? str(doc.salesman_phone || (data.salesmanDetails as Row | undefined)?.phone || data.salesmanPhone || "")
    : str(ownerPhone || "");

  const initialPhone = rawPhone;

  const recipientLabel = isEmployeeKind
    ? str(data.employeeName ?? data.payee ?? "Employee")
    : isFoodsKind
    ? str(data.foodsSalesman ?? doc.foods_salesman_name ?? "Foods Salesman")
    : doc.salesman_id
    ? str(data.salesmanName ?? "Salesman")
    : "Owner (Business Record)";

  // If no party at all (pure internal), route to owner
  const entityType: "salesman" | "employee" | "foods_salesman" | "owner" = isEmployeeKind
    ? "employee"
    : isFoodsKind
    ? "foods_salesman"
    : doc.salesman_id
    ? "salesman"
    : "owner";

  const entityId = isEmployeeKind
    ? str((data.employeeId as string) || "")
    : isFoodsKind
    ? str((data.foodsSalesmanId as string) || "")
    : str(doc.salesman_id || "");

  const qc = useQueryClient();
  const [phone, setPhone] = useState(initialPhone);
  const [savePhone, setSavePhone] = useState(!initialPhone);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const message = buildWhatsAppMessage(doc, businessName);

  async function handleSend() {
    const digits = phone.replace(/\D/g, "");
    if (digits.length < 10) {
      setError("Please enter a valid 10-digit mobile number.");
      return;
    }
    setError("");

    // Save phone to DB if checkbox ticked and there's a known entity
    if (savePhone && entityId && entityType !== "owner") {
      setSaving(true);
      try {
        const endpoint =
          entityType === "employee"
            ? `employees/${entityId}/phone`
            : entityType === "foods_salesman"
            ? `foods-salesmen/${entityId}`
            : `salesmen/${entityId}/phone`;
        await api(endpoint, undefined, { phone }, "PATCH");
        // Invalidate masters and document queries so Master Records screen updates immediately
        qc.invalidateQueries({ queryKey: ["masters"] });
        qc.invalidateQueries({ queryKey: ["document"] });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not save phone number.");
        setSaving(false);
        return;
      }
      setSaving(false);
    }

    // Build wa.me URL and open — synchronous, never blocked by browser
    const normalized = cleanIndianPhone(phone) ?? digits;
    const encoded = encodeURIComponent(message);
    window.open(`https://wa.me/${normalized}?text=${encoded}`, "_blank", "noopener,noreferrer");
    onClose();
  }

  return (
    <div
      className="no-print"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15, 23, 42, 0.6)",
        backdropFilter: "blur(2px)",
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{
          background: "#fff",
          borderRadius: 12,
          padding: "28px 32px",
          maxWidth: 480,
          width: "100%",
          boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
          <div style={{
            background: "#25D366",
            borderRadius: 8,
            padding: "6px 10px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}>
            <MessageCircle size={20} color="#fff" />
          </div>
          <div>
            <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: "#0f172a" }}>
              Share on WhatsApp
            </h3>
            <p style={{ margin: 0, fontSize: 12, color: "#64748b" }}>
              {doc.reversed ? "⚠️ Cancelled record" : `${str(doc.kind).toUpperCase()} — ${str(doc.number)}`}
            </p>
          </div>
          <button
            onClick={onClose}
            style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", padding: 4 }}
            aria-label="Close"
          >
            <X size={18} color="#64748b" />
          </button>
        </div>

        {/* Recipient */}
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#475569", marginBottom: 4, textTransform: "uppercase" }}>
            Recipient — {recipientLabel}
          </label>
          <input
            type="tel"
            value={phone}
            onChange={(e) => { setPhone(e.target.value); setError(""); }}
            placeholder="Enter 10-digit mobile number"
            style={{
              width: "100%",
              padding: "10px 12px",
              border: `1.5px solid ${error ? "#ef4444" : "#cbd5e1"}`,
              borderRadius: 8,
              fontSize: 15,
              fontFamily: "monospace",
              outline: "none",
              boxSizing: "border-box",
            }}
          />
          {error && <p style={{ margin: "4px 0 0", fontSize: 12, color: "#dc2626" }}>{error}</p>}
        </div>

        {/* Save checkbox — only show when entity exists and no phone was pre-filled */}
        {entityId && entityType !== "owner" && (
          <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16, cursor: "pointer", fontSize: 13, color: "#334155" }}>
            <input
              type="checkbox"
              checked={savePhone}
              onChange={(e) => setSavePhone(e.target.checked)}
              style={{ width: 15, height: 15 }}
            />
            Save this number to {entityType === "employee" ? "employee" : "salesman"} profile for future use
          </label>
        )}

        {/* Message preview */}
        <div style={{ marginBottom: 20 }}>
          <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#475569", marginBottom: 6, textTransform: "uppercase" }}>
            Message Preview
          </label>
          <pre
            style={{
              background: "#f1f5f9",
              border: "1px solid #e2e8f0",
              borderRadius: 8,
              padding: "12px 14px",
              fontSize: 12,
              lineHeight: 1.6,
              maxHeight: 220,
              overflowY: "auto",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              color: "#0f172a",
              margin: 0,
            }}
          >
            {message}
          </pre>
        </div>

        {/* Actions */}
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <Button className="secondary" onClick={onClose}>Cancel</Button>
          <Button
            onClick={handleSend}
            disabled={saving}
            style={{
              background: saving ? "#86efac" : "#25D366",
              color: "#fff",
              border: "none",
              display: "flex",
              alignItems: "center",
              gap: 7,
              fontWeight: 700,
            }}
          >
            <MessageCircle size={15} />
            {saving ? "Saving…" : "Open WhatsApp"}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function DocumentDetail({
  id,
  currentDate,
  onBack,
  setAction,
  owner,
  onSelect,
}: {
  id: string;
  currentDate?: string;
  onBack: () => void;
  setAction: (n: CommandName) => void;
  owner: boolean;
  onSelect?: (id: string) => void;
}) {
  const special = id.includes(":") || id === "audit";
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["document", id],
    queryFn: () => api("documents/" + id),
    enabled: !special,
  });

  // Local state for bill-specific Reverse and Linked Return dialogs
  const [showReverseModal, setShowReverseModal] = useState(false);
  const [showWAModal, setShowWAModal] = useState(false);
  const [reverseReason, setReverseReason] = useState("");
  const [reverseBusy, setReverseBusy] = useState(false);
  const [reverseError, setReverseError] = useState("");

  const [showReturnModal, setShowReturnModal] = useState(false);
  const [selectedReturnLineId, setSelectedReturnLineId] = useState<string>("");
  const [returnQty, setReturnQty] = useState("");
  const [returnReason, setReturnReason] = useState("Unsold stock return");
  const [returnNote, setReturnNote] = useState("");
  const [returnBusy, setReturnBusy] = useState(false);
  const [returnError, setReturnError] = useState("");

  if (special) return id === "audit" ? <AuditView onBack={onBack} onSelect={onSelect} /> : null;
  const d = q.data,
    data = d?.data as Row | undefined;

  const isEmployeeVoucher =
    d?.kind === "salary" ||
    d?.kind === "employee_receipt" ||
    (d?.kind === "loan" && data?.direction === "staff") ||
    (d?.kind === "expense" &&
      typeof data?.category === "string" &&
      data.category.startsWith("Employee"));

  const signatureAttachment = arr(d?.attachments).find(
    (a) => a.mime === "image/png",
  );

  const isBill = d?.kind === "bill";
  const isReversed = Boolean(d?.reversed);
  const billLines = arr(d?.lines);
  const selectedLine = billLines.find((l) => str(l.id) === selectedReturnLineId);
  const selectedLineSnap = selectedLine ? (selectedLine.snapshot as Row) : null;
  const selectedLineBilledQty = selectedLine ? parseFloat(str(selectedLine.quantity || "0")) : 0;
  const selectedLineReturnedQty = selectedLine ? parseFloat(str(selectedLine.returned_quantity || "0")) : 0;
  const selectedLineMaxReturn = Math.max(0, selectedLineBilledQty - selectedLineReturnedQty);

  const handleReverseSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reverseReason.trim() || reverseReason.trim().length < 3) {
      setReverseError("Please provide a valid reason (at least 3 characters).");
      return;
    }
    setReverseBusy(true);
    setReverseError("");
    try {
      await api(
        "commands/reverse",
        commandResult,
        {
          date: currentDate || str(d?.business_date),
          documentId: id,
          reason: reverseReason.trim(),
        },
        "POST",
        crypto.randomUUID(),
      );
      await qc.invalidateQueries();
      await q.refetch();
      setShowReverseModal(false);
      setReverseReason("");
    } catch (err: unknown) {
      setReverseError(err instanceof Error ? err.message : String(err));
    } finally {
      setReverseBusy(false);
    }
  };

  const handleReturnSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedReturnLineId) {
      setReturnError("Please select a product line to return.");
      return;
    }
    const qtyNum = parseFloat(returnQty);
    if (isNaN(qtyNum) || qtyNum <= 0) {
      setReturnError("Please enter a valid return quantity greater than 0.");
      return;
    }
    if (qtyNum > selectedLineMaxReturn + 0.0001) {
      setReturnError(`Quantity exceeds available return limit (${selectedLineMaxReturn.toFixed(2)} remaining).`);
      return;
    }
    if (!selectedLineSnap?.fractional && !Number.isInteger(qtyNum)) {
      setReturnError("This item requires whole unit quantities.");
      return;
    }
    if (!returnReason.trim() || returnReason.trim().length < 3) {
      setReturnError("Please enter a valid reason for return (at least 3 characters).");
      return;
    }
    setReturnBusy(true);
    setReturnError("");
    try {
      await api(
        "commands/return",
        commandResult,
        {
          date: currentDate || str(d?.business_date),
          lineId: selectedReturnLineId,
          quantity: returnQty.trim(),
          reason: returnReason.trim() + (returnNote.trim() ? ` - ${returnNote.trim()}` : ""),
        },
        "POST",
        crypto.randomUUID(),
      );
      await qc.invalidateQueries();
      await q.refetch();
      setShowReturnModal(false);
      setReturnQty("");
      setReturnNote("");
    } catch (err: unknown) {
      setReturnError(err instanceof Error ? err.message : String(err));
    } finally {
      setReturnBusy(false);
    }
  };

  return (
    <section className="panel print-document">
      <div className="section-title no-print">
        <Button onClick={onBack}>← Back</Button>
        <div className="actions">
          <Button className="secondary" onClick={() => window.print()}>
            <Printer size={16} /> Print {isEmployeeVoucher ? "Voucher" : "Record"}
          </Button>
          {d && (
            <Button
              className="secondary"
              onClick={() => setShowWAModal(true)}
              style={{ color: "#15803d", borderColor: "#86efac", display: "flex", alignItems: "center", gap: 6 }}
            >
              <MessageCircle size={16} /> Share on WhatsApp
            </Button>
          )}
          {!isEmployeeVoucher && !isReversed && (
            <Button
              className="secondary"
              onClick={() => {
                if (isBill && billLines.length > 0) {
                  // Pre-select first line with returnable qty
                  const firstEligible = billLines.find((l) => {
                    const b = parseFloat(str(l.quantity || "0"));
                    const r = parseFloat(str(l.returned_quantity || "0"));
                    return b - r > 0.0001;
                  });
                  setSelectedReturnLineId(str(firstEligible?.id || billLines[0]?.id));
                  setReturnQty("");
                  setReturnError("");
                  setShowReturnModal(true);
                } else {
                  setAction("return");
                }
              }}
            >
              Linked return
            </Button>
          )}
          {owner && !isReversed && (
            <Button
              className="secondary"
              style={{ color: "#b91c1c", borderColor: "#fca5a5" }}
              onClick={() => {
                setReverseError("");
                setReverseReason("");
                setShowReverseModal(true);
              }}
            >
              Reverse record
            </Button>
          )}
        </div>
      </div>
      {q.isError ? (
        <p className="error">{q.error.message}</p>
      ) : d ? (
        isEmployeeVoucher ? (
          <div className="voucher-container" style={{ maxWidth: 780, margin: "0 auto", padding: "16px 0" }}>
            <div
              style={{
                border: "2px solid #0f172a",
                borderRadius: 8,
                padding: "24px 28px",
                background: "#ffffff",
                boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
              }}
            >
              {/* Voucher Header */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  borderBottom: "2px solid #0f172a",
                  paddingBottom: 16,
                  marginBottom: 20,
                }}
              >
                <div>
                  <h1 style={{ margin: "0 0 4px", fontSize: 22, fontWeight: 800, color: "#0f172a", letterSpacing: 0.5 }}>
                    {str(data?.businessName ?? "Sales & Money Book")}
                  </h1>
                  <p style={{ margin: 0, fontSize: 12, color: "#475569" }}>
                    {str((data?.businessProfile as Row | undefined)?.address ?? "Official Payment Voucher")}
                  </p>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div
                    style={{
                      background: "#0f172a",
                      color: "#ffffff",
                      padding: "4px 12px",
                      borderRadius: 4,
                      fontSize: 13,
                      fontWeight: 800,
                      letterSpacing: 1,
                      textTransform: "uppercase",
                      display: "inline-block",
                      marginBottom: 6,
                    }}
                  >
                    {d.kind === "salary"
                      ? "Salary Payment Voucher"
                      : d.kind === "employee_receipt"
                        ? "Employee Receipt Voucher"
                        : d.kind === "loan"
                          ? "Staff Advance Voucher"
                          : "Employee Expense Voucher"}
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#1e293b" }}>
                    Voucher #: {str(d.number)}
                  </div>
                  <div style={{ fontSize: 12, color: "#64748b" }}>
                    Date: <b>{dateLabel(d.business_date)}</b>
                  </div>
                </div>
              </div>

              {Boolean(d.reversed) && (
                <div
                  style={{
                    background: "#fee2e2",
                    border: "1px solid #ef4444",
                    color: "#b91c1c",
                    padding: "8px 12px",
                    borderRadius: 6,
                    fontWeight: 700,
                    marginBottom: 16,
                    textAlign: "center",
                  }}
                >
                  ⚠️ THIS VOUCHER HAS BEEN OFFICIALLY REVERSED
                </div>
              )}

              {/* Voucher Particulars Table */}
              <div
                style={{
                  background: "#f8fafc",
                  border: "1px solid #e2e8f0",
                  borderRadius: 6,
                  padding: "16px 20px",
                  marginBottom: 24,
                }}
              >
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px 24px" }}>
                  <div>
                    <span style={{ fontSize: 11, textTransform: "uppercase", color: "#64748b", fontWeight: 700, display: "block" }}>
                      Employee Name / Person
                    </span>
                    <strong style={{ fontSize: 16, color: "#0f172a" }}>
                      {str(data?.employeeName ?? data?.payee ?? data?.counterparty ?? "-")}
                    </strong>
                  </div>

                  <div>
                    <span style={{ fontSize: 11, textTransform: "uppercase", color: "#64748b", fontWeight: 700, display: "block" }}>
                      Payment Category / Type
                    </span>
                    <span style={{ fontSize: 14, color: "#1e293b", fontWeight: 600 }}>
                      {str(
                        d.kind === "employee_receipt"
                          ? "Received money from employee"
                          : (data?.period ?? data?.category ?? (d.kind === "loan" ? "Staff Salary Advance" : "Salary"))
                      )}
                    </span>
                  </div>

                  <div>
                    <span style={{ fontSize: 11, textTransform: "uppercase", color: "#64748b", fontWeight: 700, display: "block" }}>
                      {d.kind === "employee_receipt" ? "Received Amount" : "Paid Amount (Net)"}
                    </span>
                    <strong style={{ fontSize: 22, color: "#047857" }}>
                      {rupees(d.amount)}
                    </strong>
                  </div>

                  <div>
                    <span style={{ fontSize: 11, textTransform: "uppercase", color: "#64748b", fontWeight: 700, display: "block" }}>
                      {d.kind === "employee_receipt" ? "Received Into Account" : "Payment Mode / Account"}
                    </span>
                    <span style={{ fontSize: 14, color: "#1e293b", fontWeight: 600 }}>
                      {d.kind === "employee_receipt" ? "Business Cash / Bank Account" : "Paid from Business Account"}
                    </span>
                  </div>

                  {data?.note ? (
                    <div style={{ gridColumn: "span 2" }}>
                      <span style={{ fontSize: 11, textTransform: "uppercase", color: "#64748b", fontWeight: 700, display: "block" }}>
                        Remarks / Notes
                      </span>
                      <span style={{ fontSize: 13, color: "#334155" }}>
                        {str(data.note)}
                      </span>
                    </div>
                  ) : null}
                </div>
              </div>

              {/* Acknowledgement & Signatures */}
              <div
                style={{
                  border: "1px solid #cbd5e1",
                  borderRadius: 6,
                  padding: "16px 20px",
                  background: "#ffffff",
                  marginBottom: 16,
                }}
              >
                <p style={{ margin: "0 0 16px", fontSize: 12, color: "#475569", fontStyle: "italic", textAlign: "center" }}>
                  {d.kind === "employee_receipt"
                    ? '"I hereby acknowledge handing over the money amount stated above to the business manager."'
                    : '"I hereby acknowledge receipt of the payment amount stated above towards salary/advance/reimbursement."'}
                </p>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 32, marginTop: 12 }}>
                  {/* Employee Signature Block */}
                  <div style={{ textAlign: "center" }}>
                    <div
                      style={{
                        height: 90,
                        borderBottom: "1.5px solid #0f172a",
                        display: "flex",
                        alignItems: "flex-end",
                        justifyContent: "center",
                        paddingBottom: 6,
                        marginBottom: 8,
                      }}
                    >
                      {signatureAttachment ? (
                        <img
                          src={"/api/v1/attachments/" + signatureAttachment.id}
                          alt="Employee Digital Signature"
                          style={{ maxHeight: 80, maxWidth: "100%", objectFit: "contain" }}
                        />
                      ) : (
                        <span style={{ fontSize: 11, color: "#94a3b8" }}>
                          (Sign above upon receipt)
                        </span>
                      )}
                    </div>
                    <strong style={{ display: "block", fontSize: 13, color: "#0f172a" }}>
                      Employee Signature / Received By
                    </strong>
                    <small style={{ color: "#64748b", fontSize: 11 }}>
                      {str(data?.payee ?? data?.counterparty ?? "Employee")}
                    </small>
                  </div>

                  {/* Authorized Signatory Block */}
                  <div style={{ textAlign: "center" }}>
                    <div
                      style={{
                        height: 90,
                        borderBottom: "1.5px solid #0f172a",
                        display: "flex",
                        alignItems: "flex-end",
                        justifyContent: "center",
                        paddingBottom: 6,
                        marginBottom: 8,
                      }}
                    >
                      <span style={{ fontSize: 11, color: "#94a3b8" }}>
                        (Authorized Signatory)
                      </span>
                    </div>
                    <strong style={{ display: "block", fontSize: 13, color: "#0f172a" }}>
                      Authorized Signatory
                    </strong>
                    <small style={{ color: "#64748b", fontSize: 11 }}>
                      For {str(data?.businessName ?? "Business")}
                    </small>
                  </div>
                </div>
              </div>

              {/* Voucher Footer */}
              <div style={{ textAlign: "center", fontSize: 11, color: "#94a3b8", marginTop: 12 }}>
                Payment Voucher Record #{str(d.number)} · Immutable Audit Log · Generated on {dateLabel(d.business_date)}
              </div>
            </div>

            {/* Evidence attachment controls in non-print mode */}
            <div className="no-print" style={{ marginTop: 24, padding: "16px 20px", border: "1px solid #e2e8f0", borderRadius: 8, background: "#f8fafc" }}>
              <h3 style={{ fontSize: 14, margin: "0 0 10px" }}>Attached Documents & Evidence</h3>
              {arr(d.attachments).map((a) => (
                <p key={str(a.id)} style={{ margin: "4px 0", fontSize: 13 }}>
                  📎 <a href={"/api/v1/attachments/" + a.id} target="_blank" rel="noreferrer">
                    Download {str(a.mime)} (ID: {str(a.id).slice(0, 8)})
                  </a>
                </p>
              ))}
              <div style={{ marginTop: 12 }}>
                <label style={{ fontSize: 12, fontWeight: 600, display: "block", marginBottom: 6 }}>
                  Attach additional receipt slip / proof:
                </label>
                <input
                  type="file"
                  aria-label="Attach private evidence"
                  accept="image/png,image/jpeg,application/pdf"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const form = new FormData();
                    form.set("file", file);
                    const r = await fetch("/api/v1/attachments/" + id, {
                      method: "POST",
                      body: form,
                    });
                    if (!r.ok) {
                      alert("Record is saved, but upload failed. Retry only the attachment.");
                    } else {
                      alert("Evidence saved.");
                      q.refetch();
                    }
                  }}
                />
              </div>
            </div>
          </div>
        ) : (
          <>
            <div className="eyebrow">
              OPERATIONAL RECORD · TAX INVOICE FORMAT NOT CONFIGURED
            </div>
            <h2>{str(data?.businessName ?? "Sales & Money Book")}</h2>
            <p className="small muted">
              {str((data?.businessProfile as Row | undefined)?.address)}
            </p>
            <h2>
              {d.kind === "return" ? `Sales Return ${str(d.number)}` : str(d.number)}{" "}
              {Boolean(d.reversed) && (
                <span className="badge">
                  Reversed
                  {d.reversal_id && onSelect ? (
                    <>
                      {" (see "}
                      <DocLink
                        id={str(d.reversal_id)}
                        number={str(d.reversal_number || "reversal")}
                        onSelect={onSelect}
                        style={{ color: "#dc2626", fontWeight: 700 }}
                      />
                      {")"}
                    </>
                  ) : null}
                </span>
              )}
            </h2>
            {Boolean(d.reverses) && (
              <p style={{ marginTop: 2, marginBottom: 8, fontSize: 13, color: "#64748b" }}>
                Reverses record:{" "}
                <DocLink
                  id={str(d.reverses)}
                  number={str(d.original_number || d.reverses)}
                  onSelect={onSelect}
                  style={{ fontWeight: 700 }}
                />
              </p>
            )}
            <p>
              {d.kind === "return" ? (
                <span className="badge" style={{ background: "#fef3c7", color: "#b45309", marginRight: 8, fontWeight: 700 }}>
                  Product Return
                </span>
              ) : (
                <>{str(d.kind)} · </>
              )}
              {dateLabel(d.business_date)} ·{" "}
              {str(data?.salesmanName || "Salesman")}
              {Boolean(data?.customerName) && (
                <span style={{ marginLeft: 8, background: "#fef3c7", color: "#92400e", padding: "2px 8px", borderRadius: 4, fontWeight: 600 }}>
                  Customer: {str(data?.customerName)}
                </span>
              )}
            </p>

            {d.kind === "return" && (
              <div style={{ background: "#fffbeb", border: "1.5px solid #fde68a", borderRadius: 8, padding: "14px 18px", marginBottom: 18 }}>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 14 }}>
                  <div>
                    <span style={{ fontSize: 11, textTransform: "uppercase", color: "#92400e", fontWeight: 700, display: "block" }}>
                      Original Bill #
                    </span>
                    <strong style={{ fontSize: 15, color: "#78350f" }}>
                      {data?.billId ? (
                        <DocLink
                          id={str(data.billId)}
                          number={str(data?.originalBillNumber || data?.billNumber || "View Bill")}
                          onSelect={onSelect}
                          style={{ fontSize: 15, fontWeight: 700, color: "#1d4ed8" }}
                        />
                      ) : (
                        str(data?.originalBillNumber || data?.billNumber || "-")
                      )}
                    </strong>
                  </div>
                  {Boolean(data?.originalBillDate) && (
                    <div>
                      <span style={{ fontSize: 11, textTransform: "uppercase", color: "#92400e", fontWeight: 700, display: "block" }}>
                        Original Bill Date
                      </span>
                      <span style={{ fontSize: 13, color: "#78350f" }}>
                        {dateLabel(str(data?.originalBillDate))}
                      </span>
                    </div>
                  )}
                  <div>
                    <span style={{ fontSize: 11, textTransform: "uppercase", color: "#92400e", fontWeight: 700, display: "block" }}>
                      Reason for Return
                    </span>
                    <span style={{ fontSize: 13, color: "#78350f", fontWeight: 600 }}>
                      {str(data?.reason || "Unsold stock return")}
                    </span>
                  </div>
                  <div>
                    <span style={{ fontSize: 11, textTransform: "uppercase", color: "#92400e", fontWeight: 700, display: "block" }}>
                      Salesman Khata Credit
                    </span>
                    <strong style={{ fontSize: 15, color: "#047857" }}>
                      +{rupees(d.amount)}
                    </strong>
                  </div>
                </div>
              </div>
            )}

            {(() => {
              const displayLines = (d.lines && arr(d.lines).length > 0)
                ? arr(d.lines)
                : d.kind === "return" && data?.snapshot
                  ? [{
                    id: data.lineId || d.id,
                    quantity: str(data.quantity || "1"),
                    snapshot: data.snapshot,
                    amount: d.amount,
                  }]
                  : [];

              if (displayLines.length === 0) return <h2>{rupees(d.amount)}</h2>;

              return (
                <Table
                  rows={displayLines.map((l) => {
                    const snap = (l.snapshot as Row) || {};
                    const hasLineDisc = Boolean(snap.discountAmount && Number(snap.discountAmount) > 0);
                    return {
                      ...l,
                      quantity: str(l.quantity)
                        .replace(/(\.\d*?)0+$/, "$1")
                        .replace(/\.$/, ""),
                      name: hasLineDisc
                        ? `${snap.name || "Item"} (Disc: -${rupees(snap.discountAmount)})`
                        : (snap.name || "Item"),
                      unit: snap.unit || "unit",
                      rate: snap.rate || snap.masterRate || "0.00",
                    };
                  })}
                  columns={[
                    ["name", d.kind === "return" ? "Returned Product" : "Product"],
                    ["quantity", d.kind === "return" ? "Returned Qty" : "Qty"],
                    ["unit", "Unit"],
                    ["rate", "Rate", true],
                    ["amount", d.kind === "return" ? "Refund Amount" : "Amount", true],
                  ]}
                  footer={
                    <>
                      {Boolean(data?.billDiscount && Number(data.billDiscount) > 0) && (
                        <>
                          <tr style={{ borderTop: "2px solid #cbd5e1", background: "#f8fafc" }}>
                            <td style={{ fontWeight: 600, fontSize: 13, color: "#475569" }}>Subtotal</td>
                            <td colSpan={3}></td>
                            <td className="money-cell" style={{ fontWeight: 600, fontSize: 14, color: "#475569" }}>
                              {rupees(data?.subtotal ?? d.amount)}
                            </td>
                          </tr>
                          <tr style={{ background: "#f8fafc" }}>
                            <td style={{ fontWeight: 600, fontSize: 13, color: "#dc2626" }}>Bill Discount</td>
                            <td colSpan={3}></td>
                            <td className="money-cell" style={{ fontWeight: 600, fontSize: 14, color: "#dc2626" }}>
                              -{rupees(data?.billDiscount)}
                            </td>
                          </tr>
                        </>
                      )}
                      <tr style={{ borderTop: "2px solid #cbd5e1", background: "#f8fafc" }}>
                        <td style={{ fontWeight: 700, fontSize: 13, color: "#0f172a" }}>
                          {d.kind === "return" ? "Total Return Credit" : "Net Total"}
                        </td>
                        <td style={{ fontWeight: 700, fontSize: 13, color: "#0f172a" }}>
                          {displayLines
                            .reduce((sum, l) => sum + (parseFloat(str(l.quantity || "0")) || 0), 0)
                            .toFixed(2)
                            .replace(/(\.\d*?)0+$/, "$1")
                            .replace(/\.$/, "")}{" "}
                          units
                        </td>
                        <td colSpan={2}></td>
                        <td className="money-cell" style={{ fontWeight: 800, fontSize: 16, color: d.kind === "return" ? "#047857" : "#0f172a" }}>
                          {rupees(d.amount)}
                        </td>
                      </tr>
                    </>
                  }
                />
              );
            })()}
            {isBill && data?.previousBalance !== undefined && (() => {
              const receiptsList = arr(data.receipts);
              const cashFromReceipts = receiptsList
                .filter((r) => (r as Row).method === "cash")
                .reduce((s, r) => s.plus(str((r as Row).amount || "0")), D(0));
              const onlineFromReceipts = receiptsList
                .filter((r) => (r as Row).method === "online")
                .reduce((s, r) => s.plus(str((r as Row).amount || "0")), D(0));

              const cashPayVal = data.cashConfirmed !== undefined
                ? str(data.cashConfirmed)
                : (cashFromReceipts.gt(0) ? cashFromReceipts.toFixed(2) : undefined);
              const onlinePayVal = data.onlineConfirmed !== undefined
                ? str(data.onlineConfirmed)
                : (onlineFromReceipts.gt(0) ? onlineFromReceipts.toFixed(2) : undefined);

              const hasCashPay = Boolean(cashPayVal && Number(cashPayVal) > 0);
              const hasOnlinePay = Boolean(onlinePayVal && Number(onlinePayVal) > 0);

              return (
                <div className="review-balances">
                  <h3>Account summary at issue</h3>
                  <p>
                    Previous balance <b>{rupees(data.previousBalance)}</b>
                  </p>
                  <p>
                    Current bill value <b>{rupees(d.amount)}</b>
                  </p>
                  {hasCashPay && (
                    <p>
                      Cash payment <b style={{ color: "#166534" }}>{rupees(cashPayVal)}</b>
                    </p>
                  )}
                  {hasOnlinePay && (
                    <p>
                      Online payment <b style={{ color: "#166534" }}>{rupees(onlinePayVal)}</b>
                    </p>
                  )}
                  {!hasCashPay && !hasOnlinePay && Boolean(data.confirmed && Number(data.confirmed) > 0) && (
                    <p>
                      On-spot payment <b>{rupees(str(data.confirmed))}</b>
                    </p>
                  )}
                  <p style={{ marginTop: 6, paddingTop: 6, borderTop: "1px dashed #e2e8f0", background: "#f8fafc", padding: "6px 8px", borderRadius: 6 }}>
                    Balance at issue <b style={{ color: "#0f172a", fontSize: "1.05em", fontWeight: 750 }}>{rupees(data.issueBalance)}</b>
                  </p>
                </div>
              );
            })()}
            {d.kind === "receipt" && (
              <div className="review-balances">
                <h3>Confirmed receipt</h3>
                {Boolean(data?.reference) && (
                  <p>
                    Reference <b>{str(data?.reference)}</b>
                  </p>
                )}
                <p>
                  Previous balance <b>{rupees(data?.previousBalance ?? "0.00")}</b>
                </p>
                <p>
                  Current amount received <b>{rupees(data?.currentAmountReceived ?? d.amount)}</b>
                </p>
                <p style={{ marginTop: 6, paddingTop: 6, borderTop: "1px dashed #e2e8f0", background: "#f8fafc", padding: "6px 8px", borderRadius: 6 }}>
                  Overall outstanding{" "}
                  <b style={{ color: "#0f172a", fontSize: "1.05em", fontWeight: 750 }}>
                    {rupees(data?.overallOutstanding ?? D(str(data?.previousBalance || "0")).minus(str(d.amount || "0")).toString())}
                  </b>
                </p>
              </div>
            )}
            {/* Pending Online Claims list */}
            {(() => {
              const claims = arr(d.openClaims);
              if (claims.length === 0 && (!data?.pendingAtIssue || Number(data.pendingAtIssue) === 0)) return null;
              return (
                <div style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 6, padding: "12px 16px", margin: "14px 0" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: claims.length > 0 ? 8 : 0 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: "#92400e", textTransform: "uppercase" }}>
                      ⏳ Pending Online Claims (Awaiting Bank Verification)
                    </span>
                    {data?.pendingAtIssue !== undefined && (
                      <strong style={{ fontSize: 13, color: "#b45309" }}>
                        At Issue: {rupees(data.pendingAtIssue)}
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
                    * Dues will update on salesman ledger once bank verification is completed.
                  </small>
                </div>
              );
            })()}
            <p>Note: {str(data?.note)}</p>
            <p className="small muted">
              {str((data?.businessProfile as Row | undefined)?.footer)}
            </p>

            {/* On-spot Payments Table (Only displayed for bills having on-spot payments) */}
            {isBill && arr(d.childReceipts).length > 0 && (
              <div style={{ marginTop: 20, marginBottom: 20 }}>
                <h3 style={{ fontSize: 15, fontWeight: 700, color: "#0f172a", marginBottom: 8 }}>
                  On-spot Payments
                </h3>
                <div style={{ overflowX: "auto", border: "1px solid #e2e8f0", borderRadius: 8 }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                    <thead>
                      <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0", color: "#475569" }}>
                        <th style={{ textAlign: "left", padding: "8px 12px", fontWeight: 600 }}>Receipt #</th>
                        <th style={{ textAlign: "left", padding: "8px 12px", fontWeight: 600 }}>Mode / Type</th>
                        <th style={{ textAlign: "right", padding: "8px 12px", fontWeight: 600 }}>Amount</th>
                        <th style={{ textAlign: "center", padding: "8px 12px", fontWeight: 600 }}>Status</th>
                        <th style={{ textAlign: "left", padding: "8px 12px", fontWeight: 600 }}>Reversal #</th>
                      </tr>
                    </thead>
                    <tbody>
                      {arr(d.childReceipts).map((rc) => {
                        const isRev = Boolean(rc.is_reversed);
                        const method = str(rc.method).toLowerCase();
                        return (
                          <tr key={str(rc.id)} style={{ borderBottom: "1px solid #f1f5f9" }}>
                            <td style={{ padding: "8px 12px" }}>
                              <DocLink
                                id={str(rc.id)}
                                number={str(rc.number)}
                                onSelect={onSelect}
                              />
                            </td>
                            <td style={{ padding: "8px 12px", textTransform: "capitalize" }}>
                              <span
                                style={{
                                  display: "inline-block",
                                  padding: "2px 8px",
                                  borderRadius: 4,
                                  fontSize: 11,
                                  fontWeight: 600,
                                  background: method === "online" ? "#f0f9ff" : "#f0fdf4",
                                  color: method === "online" ? "#0369a1" : "#15803d",
                                }}
                              >
                                {method === "online" ? "Online Receipt" : "Cash Receipt"}
                              </span>
                            </td>
                            <td style={{ padding: "8px 12px", textAlign: "right", fontWeight: 700 }}>
                              {rupees(rc.amount)}
                            </td>
                            <td style={{ padding: "8px 12px", textAlign: "center" }}>
                              <span
                                style={{
                                  display: "inline-block",
                                  padding: "2px 8px",
                                  borderRadius: 4,
                                  fontSize: 11,
                                  fontWeight: 700,
                                  background: isRev ? "#fee2e2" : "#dcfce7",
                                  color: isRev ? "#dc2626" : "#166534",
                                }}
                              >
                                {isRev ? "Reversed" : "Posted / Active"}
                              </span>
                            </td>
                            <td style={{ padding: "8px 12px" }}>
                              {rc.reversal_id && rc.reversal_number ? (
                                <DocLink
                                  id={str(rc.reversal_id)}
                                  number={str(rc.reversal_number)}
                                  onSelect={onSelect}
                                />
                              ) : (
                                <span style={{ color: "#94a3b8" }}>—</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            {(() => {
              const relevantAllocations = arr(d.allocations).filter((al) => {
                // If viewing a bill, exclude receipts (only show returns)
                if (isBill) {
                  return al.credit_kind === "return" || String(al.credit_number || "").startsWith("RETURN-");
                }
                return true;
              });

              if (relevantAllocations.length === 0) return null;

              return (
                <>
                  <h3>Settlement applications</h3>
                  <Table
                    rows={relevantAllocations.map((al) => ({
                      ...al,
                      credit_label: al.credit_customer ? `${str(al.credit_number)} · ${str(al.credit_customer)}` : str(al.credit_number),
                      charge_label: al.charge_customer ? `${str(al.charge_number)} · ${str(al.charge_customer)}` : str(al.charge_number),
                    }))}
                    columns={[
                      ["credit_label", "Credit source"],
                      ["charge_label", "Charge"],
                      ["created_at", "Settled at"],
                      ["amount", "Applied", true],
                    ]}
                    cellRenderers={{
                      credit_label: (r) => (
                        <DocLink
                          id={str(r.credit_id)}
                          number={str(r.credit_label)}
                          onSelect={onSelect}
                        />
                      ),
                      charge_label: (r) => (
                        <DocLink
                          id={str(r.charge_id)}
                          number={str(r.charge_label)}
                          onSelect={onSelect}
                        />
                      ),
                    }}
                  />
                </>
              );
            })()}
            <div className="no-print">
              <h3>Private evidence</h3>
              {arr(d.attachments).map((a) => (
                <p key={str(a.id)}>
                  <a href={"/api/v1/attachments/" + a.id}>
                    Download {str(a.mime)} evidence
                  </a>
                </p>
              ))}
              <input
                type="file"
                aria-label="Attach private evidence"
                accept="image/png,image/jpeg,application/pdf"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const form = new FormData();
                  form.set("file", file);
                  const r = await fetch("/api/v1/attachments/" + id, {
                    method: "POST",
                    body: form,
                  });
                  if (!r.ok)
                    alert(
                      "Record is saved, but upload failed. Retry only the attachment.",
                    );
                  else {
                    alert("Evidence saved. Malware scanning is not configured.");
                    q.refetch();
                  }
                }}
              />
            </div>
          </>
        )
      ) : (
        <p>Loading saved record…</p>
      )}

      {/* Bill-Specific Reverse Record Modal */}
      {showWAModal && d && (
        <WhatsAppShareModal
          doc={d as Row}
          businessName={str(d.businessName ?? (d.data as Row | undefined)?.businessName ?? "Annapurna Sales Corporation")}
          onClose={() => setShowWAModal(false)}
        />
      )}

      {showReverseModal && d && (
        <div
          className="no-print"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15, 23, 42, 0.6)",
            backdropFilter: "blur(2px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: 16,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget && !reverseBusy) {
              setShowReverseModal(false);
            }
          }}
        >
          <div
            style={{
              background: "#ffffff",
              borderRadius: 12,
              padding: "24px 28px",
              maxWidth: 520,
              width: "100%",
              boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.2)",
              border: "1px solid #e2e8f0",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: "1.2rem", color: "#b91c1c" }}>
                Reverse Record #{str(d.number)}
              </h3>
              <Button
                type="button"
                className="text-link"
                disabled={reverseBusy}
                onClick={() => setShowReverseModal(false)}
                style={{ fontSize: 18, padding: 0 }}
              >
                ✕
              </Button>
            </div>

            <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: 12, marginBottom: 16, fontSize: 13, color: "#991b1b" }}>
              <p style={{ margin: "0 0 6px", fontWeight: 700 }}>⚠️ Important Accounting Notice:</p>
              <p style={{ margin: 0 }}>
                This will post an official offsetting reversal for <b>{rupees(d.amount)}</b> on this {str(d.kind)} ({str(data?.salesmanName || "")}). The original record remains permanently in audit history.
              </p>
            </div>

            {reverseError && (
              <div style={{ background: "#fee2e2", color: "#b91c1c", padding: "8px 12px", borderRadius: 6, marginBottom: 14, fontSize: 13 }}>
                {reverseError}
              </div>
            )}

            <form onSubmit={handleReverseSubmit}>
              <div style={{ marginBottom: 18 }}>
                <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#334155", marginBottom: 6 }}>
                  Reason for Reversal <span style={{ color: "#e11d48" }}>*</span>
                </label>
                <textarea
                  rows={3}
                  required
                  placeholder="e.g. Duplicate bill entered by mistake / Wrong customer billed"
                  value={reverseReason}
                  onChange={(e) => setReverseReason(e.target.value)}
                  disabled={reverseBusy}
                  style={{
                    width: "100%",
                    borderRadius: 6,
                    border: "1px solid #cbd5e1",
                    padding: "8px 10px",
                    fontSize: 14,
                    fontFamily: "inherit",
                    resize: "vertical",
                  }}
                />
                <span style={{ fontSize: 11, color: "#64748b" }}>Minimum 3 characters required.</span>
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
                <Button
                  type="button"
                  className="secondary"
                  disabled={reverseBusy}
                  onClick={() => setShowReverseModal(false)}
                >
                  Cancel
                </Button>
                <button
                  type="submit"
                  disabled={reverseBusy}
                  style={{
                    background: "#dc2626",
                    color: "#ffffff",
                    border: "none",
                    borderRadius: 6,
                    padding: "8px 16px",
                    fontWeight: 600,
                    cursor: reverseBusy ? "not-allowed" : "pointer",
                    opacity: reverseBusy ? 0.7 : 1,
                  }}
                >
                  {reverseBusy ? "Posting Reversal…" : "Confirm Reversal"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Bill-Specific Linked Return Modal */}
      {showReturnModal && d && (
        <div
          className="no-print"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15, 23, 42, 0.6)",
            backdropFilter: "blur(2px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: 16,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget && !returnBusy) {
              setShowReturnModal(false);
            }
          }}
        >
          <div
            style={{
              background: "#ffffff",
              borderRadius: 12,
              padding: "24px 28px",
              maxWidth: 560,
              width: "100%",
              boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.2)",
              border: "1px solid #e2e8f0",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div>
                <h3 style={{ margin: 0, fontSize: "1.2rem", color: "#0f172a" }}>
                  Linked Return for Bill #{str(d.number)}
                </h3>
                <span style={{ fontSize: 12, color: "#64748b" }}>
                  Salesman: <b>{str(data?.salesmanName || "")}</b> · {dateLabel(d.business_date)}
                </span>
              </div>
              <Button
                type="button"
                className="text-link"
                disabled={returnBusy}
                onClick={() => setShowReturnModal(false)}
                style={{ fontSize: 18, padding: 0 }}
              >
                ✕
              </Button>
            </div>

            {returnError && (
              <div style={{ background: "#fee2e2", color: "#b91c1c", padding: "8px 12px", borderRadius: 6, marginBottom: 14, fontSize: 13 }}>
                {returnError}
              </div>
            )}

            <form onSubmit={handleReturnSubmit}>
              <div style={{ marginBottom: 14 }}>
                <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#334155", marginBottom: 6 }}>
                  Select Item from this Bill <span style={{ color: "#e11d48" }}>*</span>
                </label>
                <select
                  value={selectedReturnLineId}
                  onChange={(e) => {
                    setSelectedReturnLineId(e.target.value);
                    setReturnQty("");
                    setReturnError("");
                  }}
                  disabled={returnBusy}
                  style={{
                    width: "100%",
                    borderRadius: 6,
                    border: "1px solid #cbd5e1",
                    padding: "8px 10px",
                    fontSize: 14,
                    background: "#ffffff",
                  }}
                >
                  {billLines.map((l) => {
                    const snap = l.snapshot as Row;
                    const b = parseFloat(str(l.quantity || "0"));
                    const r = parseFloat(str(l.returned_quantity || "0"));
                    const rem = Math.max(0, b - r);
                    return (
                      <option key={str(l.id)} value={str(l.id)}>
                        {str(snap.name)} — Billed: {b.toFixed(2)} | Returned: {r.toFixed(2)} | Avail: {rem.toFixed(2)} {str(snap.unit || "")}
                      </option>
                    );
                  })}
                </select>
              </div>

              {selectedLine && (
                <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: "10px 14px", marginBottom: 14, fontSize: 13 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                    <span className="muted">Original Billed Qty:</span>
                    <b>{selectedLineBilledQty.toFixed(2)} {str(selectedLineSnap?.unit || "")}</b>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                    <span className="muted">Previously Returned:</span>
                    <span style={{ color: selectedLineReturnedQty > 0 ? "#b45309" : "inherit" }}>
                      {selectedLineReturnedQty.toFixed(2)} {str(selectedLineSnap?.unit || "")}
                    </span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid #e2e8f0", paddingTop: 4 }}>
                    <span style={{ fontWeight: 600 }}>Max Returnable Now:</span>
                    <b style={{ color: selectedLineMaxReturn > 0 ? "#15803d" : "#b91c1c" }}>
                      {selectedLineMaxReturn.toFixed(2)} {str(selectedLineSnap?.unit || "")}
                    </b>
                  </div>
                </div>
              )}

              <div style={{ marginBottom: 14 }}>
                <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#334155", marginBottom: 6 }}>
                  Quantity to Return <span style={{ color: "#e11d48" }}>*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder={`Max ${selectedLineMaxReturn.toFixed(2)}`}
                  value={returnQty}
                  onChange={(e) => setReturnQty(e.target.value)}
                  disabled={returnBusy || selectedLineMaxReturn <= 0}
                  style={{
                    width: "100%",
                    borderRadius: 6,
                    border: "1px solid #cbd5e1",
                    padding: "8px 10px",
                    fontSize: 14,
                  }}
                />
                {selectedLineMaxReturn <= 0 && (
                  <span style={{ fontSize: 12, color: "#b91c1c", marginTop: 4, display: "block" }}>
                    This item line has already been fully returned.
                  </span>
                )}
              </div>

              <div style={{ marginBottom: 14 }}>
                <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#334155", marginBottom: 6 }}>
                  Reason Category <span style={{ color: "#e11d48" }}>*</span>
                </label>
                <select
                  value={returnReason}
                  onChange={(e) => setReturnReason(e.target.value)}
                  disabled={returnBusy}
                  style={{
                    width: "100%",
                    borderRadius: 6,
                    border: "1px solid #cbd5e1",
                    padding: "8px 10px",
                    fontSize: 14,
                    background: "#ffffff",
                  }}
                >
                  <option value="Unsold stock return">Unsold stock return</option>
                  <option value="Damaged / defective stock">Damaged / defective stock</option>
                  <option value="Expired goods return">Expired goods return</option>
                  <option value="Incorrect item billed">Incorrect item billed</option>
                  <option value="Customer refused delivery">Customer refused delivery</option>
                </select>
              </div>

              <div style={{ marginBottom: 18 }}>
                <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#334155", marginBottom: 6 }}>
                  Notes / Explanation (optional)
                </label>
                <input
                  type="text"
                  placeholder="Additional remarks or batch details"
                  value={returnNote}
                  onChange={(e) => setReturnNote(e.target.value)}
                  disabled={returnBusy}
                  style={{
                    width: "100%",
                    borderRadius: 6,
                    border: "1px solid #cbd5e1",
                    padding: "8px 10px",
                    fontSize: 14,
                  }}
                />
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
                <Button
                  type="button"
                  className="secondary"
                  disabled={returnBusy}
                  onClick={() => setShowReturnModal(false)}
                >
                  Cancel
                </Button>
                <button
                  type="submit"
                  disabled={returnBusy || selectedLineMaxReturn <= 0}
                  className="primary"
                  style={{
                    padding: "8px 16px",
                    borderRadius: 6,
                    fontWeight: 600,
                    cursor: returnBusy || selectedLineMaxReturn <= 0 ? "not-allowed" : "pointer",
                    opacity: returnBusy || selectedLineMaxReturn <= 0 ? 0.6 : 1,
                  }}
                >
                  {returnBusy ? "Recording Return…" : "Record Return"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}
