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
import {
  D, str, arr, rupees, formatCents, parseCents, parseMoneyNumber,
  formatBilledCaption, dateLabel, timeOnlyLabel, formatDateTime, type Row,
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

// ─── Indian Rupee Number to Words Converter ─────────────────────────────────
function numberToIndianWords(amountStrOrNum: string | number): string {
  const num = Number(amountStrOrNum) || 0;
  if (num === 0) return "Zero Rupees Only";
  const absNum = Math.abs(num);
  const rupeesPart = Math.floor(absNum);
  const paisePart = Math.round((absNum - rupeesPart) * 100);

  const units = [
    "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
    "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen",
  ];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

  function convertBelowThousand(val: number): string {
    let s = "";
    if (val >= 100) {
      s += units[Math.floor(val / 100)] + " Hundred ";
      val %= 100;
    }
    if (val >= 20) {
      s += tens[Math.floor(val / 10)] + (val % 10 > 0 ? " " + units[val % 10] : "");
    } else if (val > 0) {
      s += units[val];
    }
    return s.trim();
  }

  let words = "";
  const crore = Math.floor(rupeesPart / 10000000);
  let rem = rupeesPart % 10000000;
  const lakh = Math.floor(rem / 100000);
  rem %= 100000;
  const thousand = Math.floor(rem / 1000);
  rem %= 1000;
  const hundredAndBelow = rem;

  if (crore > 0) words += convertBelowThousand(crore) + " Crore ";
  if (lakh > 0) words += convertBelowThousand(lakh) + " Lakh ";
  if (thousand > 0) words += convertBelowThousand(thousand) + " Thousand ";
  if (hundredAndBelow > 0) words += convertBelowThousand(hundredAndBelow);

  words = words.trim();
  if (words) words += " Rupees";
  if (paisePart > 0) {
    words += (words ? " and " : "") + convertBelowThousand(paisePart) + " Paise";
  }
  return words + " Only";
}

function triggerPrintWithPageStyle(pageCss: string) {
  let styleEl = document.getElementById("dynamic-print-page-style") as HTMLStyleElement | null;
  if (!styleEl) {
    styleEl = document.createElement("style");
    styleEl.id = "dynamic-print-page-style";
    document.head.appendChild(styleEl);
  }
  styleEl.innerHTML = `@media print { @page { ${pageCss} } }`;
  window.print();
}

// ─── Dedicated Print View: Vertical A5 Bill ─────────────────────────────────
function BillA5View({
  d,
  data,
  billLines,
  copyLabel,
}: {
  d: Row;
  data: Row | undefined;
  billLines: Row[];
  copyLabel?: string;
}) {
  const businessName = str(data?.businessName ?? "Annapurna Sales Corporation");
  const profile = (data?.businessProfile as Row | undefined) || {};
  const address = str(profile.address ?? "");
  const phone = str(profile.phone ?? "");
  const gst = str(profile.gstin ?? profile.gst ?? "");

  const receiptsList = arr(data?.receipts);
  const cashFromReceipts = receiptsList
    .filter((r) => (r as Row).method === "cash")
    .reduce((s, r) => s.plus(str((r as Row).amount || "0")), D(0));
  const onlineFromReceipts = receiptsList
    .filter((r) => (r as Row).method === "online")
    .reduce((s, r) => s.plus(str((r as Row).amount || "0")), D(0));

  const cashPayVal = data?.cashConfirmed !== undefined
    ? str(data.cashConfirmed)
    : (cashFromReceipts.gt(0) ? cashFromReceipts.toFixed(2) : undefined);
  const onlinePayVal = data?.onlineConfirmed !== undefined
    ? str(data.onlineConfirmed)
    : (onlineFromReceipts.gt(0) ? onlineFromReceipts.toFixed(2) : undefined);

  const totalPaid = D(cashPayVal || "0").plus(onlinePayVal || "0").plus(str(data?.confirmed || "0"));

  return (
    <div
      className="print-template-a5-vertical"
      style={{
        border: "1px solid #0f172a",
        borderRadius: 4,
        padding: "8px 12px",
        background: "#ffffff",
        marginBottom: 8,
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", borderBottom: "1.5px solid #0f172a", paddingBottom: 6, marginBottom: 8 }}>
        <div>
          <h1 style={{ margin: "0 0 2px", fontSize: 15, fontWeight: 800, color: "#0f172a" }}>
            {businessName}
          </h1>
          {(address || phone || gst) && (
            <div style={{ fontSize: 9, color: "#475569", lineHeight: 1.25 }}>
              {address && <div>{address}</div>}
              {(phone || gst) && <div>{phone ? `Phone: ${phone}` : ""} {gst ? `· GSTIN: ${gst}` : ""}</div>}
            </div>
          )}
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 9, fontWeight: 800, textTransform: "uppercase", background: "#0f172a", color: "#ffffff", padding: "2px 6px", borderRadius: 3, display: "inline-block", marginBottom: 3 }}>
            TAX INVOICE / CASH MEMO
          </div>
          {copyLabel && (
            <div style={{ fontSize: 8.5, fontWeight: 700, color: "#64748b" }}>
              [{copyLabel}]
            </div>
          )}
        </div>
      </div>

      {/* Bill & Customer Metadata */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 12px", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 4, padding: "5px 8px", marginBottom: 8, fontSize: "7.5pt" }}>
        <div>
          <div>Invoice #: <strong>{str(d.number)}</strong></div>
          <div>Date: <strong>{dateLabel(d.business_date)}</strong></div>
          <div>Salesman: <strong>{str(data?.salesmanName || "Route Salesman")}</strong></div>
        </div>
        <div>
          <div>Customer: <strong>{str(data?.customerName || "Counter Sale")}</strong></div>
          {Boolean(data?.customerBeat) && <div>Beat / Area: <strong>{str(data?.customerBeat)}</strong></div>}
          {Boolean(data?.customerPhone) && <div>Phone: <strong>{str(data?.customerPhone)}</strong></div>}
        </div>
      </div>

      {/* Item Lines Table (Rate removed per user request for compact bill printing) */}
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "7.5pt", marginBottom: 8 }}>
        <thead>
          <tr style={{ background: "#f1f5f9", borderTop: "1px solid #0f172a", borderBottom: "1px solid #0f172a" }}>
            <th style={{ padding: "2.5px 4px", textAlign: "left", width: 22 }}>#</th>
            <th style={{ padding: "2.5px 4px", textAlign: "left" }}>Product / Item</th>
            <th style={{ padding: "2.5px 4px", textAlign: "right", width: 55 }}>Qty</th>
            <th style={{ padding: "2.5px 4px", textAlign: "right", width: 65 }}>Amount</th>
          </tr>
        </thead>
        <tbody>
          {billLines.map((l, idx) => {
            const snap = (l.snapshot as Row) || {};
            const name = str(snap.name || l.name || "Item");
            const qty = str(l.quantity).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
            const unit = str(snap.unit || "unit");
            const hasDisc = Boolean(snap.discountAmount && Number(snap.discountAmount) > 0);
            return (
              <tr key={str(l.id || idx)} style={{ borderBottom: "1px solid #f1f5f9" }}>
                <td style={{ padding: "2.5px 4px", color: "#64748b" }}>{idx + 1}</td>
                <td style={{ padding: "2.5px 4px", fontWeight: 600 }}>
                  {name}
                  {hasDisc && <span style={{ color: "#dc2626", fontSize: "6.5pt", marginLeft: 4 }}>(Disc: -{rupees(snap.discountAmount)})</span>}
                </td>
                <td style={{ padding: "2.5px 4px", textAlign: "right", whiteSpace: "nowrap" }}>{qty} {unit}</td>
                <td style={{ padding: "2.5px 4px", textAlign: "right", fontWeight: 700 }}>{rupees(l.amount)}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          {Boolean(data?.billDiscount && Number(data.billDiscount) > 0) && (
            <>
              <tr style={{ borderTop: "1px solid #cbd5e1" }}>
                <td colSpan={3} style={{ padding: "2px 4px", textAlign: "right", color: "#475569" }}>Subtotal:</td>
                <td style={{ padding: "2px 4px", textAlign: "right", fontWeight: 600 }}>{rupees(data?.subtotal ?? d.amount)}</td>
              </tr>
              <tr>
                <td colSpan={3} style={{ padding: "2px 4px", textAlign: "right", color: "#dc2626" }}>Bill Discount:</td>
                <td style={{ padding: "2px 4px", textAlign: "right", color: "#dc2626", fontWeight: 600 }}>-{rupees(data?.billDiscount)}</td>
              </tr>
            </>
          )}
          <tr style={{ borderTop: "1.5px solid #0f172a", background: "#f8fafc", fontWeight: 800 }}>
            <td colSpan={2} style={{ padding: "3.5px 4px" }}>Net Total ({billLines.length} items)</td>
            <td style={{ padding: "3.5px 4px", textAlign: "right" }}>
              {billLines.reduce((s, l) => s + (parseFloat(str(l.quantity || "0")) || 0), 0).toFixed(2).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "")}
            </td>
            <td style={{ padding: "3.5px 4px", textAlign: "right", fontSize: "8.5pt", color: "#0f172a" }}>
              {rupees(d.amount)}
            </td>
          </tr>
        </tfoot>
      </table>

      {/* Account Balance Summary */}
      {data?.previousBalance !== undefined && (
        <div style={{ background: "#f8fafc", border: "1px solid #cbd5e1", borderRadius: 4, padding: "5px 8px", marginBottom: 8, fontSize: "7.5pt" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2px 12px" }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span>Previous Balance:</span>
              <strong>{rupees(data.previousBalance)}</strong>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span>Current Bill Value:</span>
              <strong>{rupees(d.amount)}</strong>
            </div>
            {Number(cashPayVal || 0) > 0 && (
              <div style={{ display: "flex", justifyContent: "space-between", color: "#166534" }}>
                <span>Cash Paid On-Spot:</span>
                <strong>{rupees(cashPayVal)}</strong>
              </div>
            )}
            {Number(onlinePayVal || 0) > 0 && (
              <div style={{ display: "flex", justifyContent: "space-between", color: "#166534" }}>
                <span>Online Paid On-Spot:</span>
                <strong>{rupees(onlinePayVal)}</strong>
              </div>
            )}
            {!cashPayVal && !onlinePayVal && Number(data.confirmed || 0) > 0 && (
              <div style={{ display: "flex", justifyContent: "space-between", color: "#166534" }}>
                <span>Paid On-Spot:</span>
                <strong>{rupees(str(data.confirmed))}</strong>
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "space-between", gridColumn: "span 2", borderTop: "1px dashed #cbd5e1", paddingTop: 3, marginTop: 2, fontWeight: 800, fontSize: "8.5pt" }}>
              <span>Net Balance Due:</span>
              <span style={{ color: "#0f172a" }}>{rupees(data.issueBalance)}</span>
            </div>
          </div>
        </div>
      )}

      {/* Terms & Signatures */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginTop: 8, paddingTop: 4, borderTop: "1px dashed #cbd5e1", fontSize: "7.5pt" }}>
        <div style={{ width: "50%", color: "#64748b", lineHeight: 1.25 }}>
          <div>• Goods received in good condition.</div>
          <div>• Subject to local business jurisdiction.</div>
          <div style={{ marginTop: 14, borderTop: "1px solid #94a3b8", width: "85%", paddingTop: 2 }}>
            Customer Signature
          </div>
        </div>
        <div style={{ width: "45%", textAlign: "right", color: "#0f172a" }}>
          <div>For <strong>{businessName}</strong></div>
          <div style={{ marginTop: 20, borderTop: "1px solid #0f172a", paddingTop: 2 }}>
            Authorized Signatory
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Dedicated Print View: 3" (80mm) Thermal POS Slip ───────────────────────
function BillThermalView({
  d,
  data,
  billLines,
}: {
  d: Row;
  data: Row | undefined;
  billLines: Row[];
}) {
  const businessName = str(data?.businessName ?? "Annapurna Sales Corporation");
  const profile = (data?.businessProfile as Row | undefined) || {};
  const address = str(profile.address ?? "");
  const phone = str(profile.phone ?? "");

  const receiptsList = arr(data?.receipts);
  const cashFromReceipts = receiptsList
    .filter((r) => (r as Row).method === "cash")
    .reduce((s, r) => s.plus(str((r as Row).amount || "0")), D(0));
  const onlineFromReceipts = receiptsList
    .filter((r) => (r as Row).method === "online")
    .reduce((s, r) => s.plus(str((r as Row).amount || "0")), D(0));

  const cashPayVal = data?.cashConfirmed !== undefined
    ? str(data.cashConfirmed)
    : (cashFromReceipts.gt(0) ? cashFromReceipts.toFixed(2) : undefined);
  const onlinePayVal = data?.onlineConfirmed !== undefined
    ? str(data.onlineConfirmed)
    : (onlineFromReceipts.gt(0) ? onlineFromReceipts.toFixed(2) : undefined);

  return (
    <div className="print-template-thermal" style={{ fontSize: "7.5pt" }}>
      <div style={{ textAlign: "center", marginBottom: 4 }}>
        <div style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase" }}>{businessName}</div>
        {address && <div style={{ fontSize: "7pt" }}>{address}</div>}
        {phone && <div style={{ fontSize: "7pt" }}>Ph: {phone}</div>}
        <div style={{ fontSize: "7.5pt", fontWeight: 700, margin: "2px 0" }}>* CASH / CREDIT MEMO *</div>
      </div>

      <div className="dotted-line" />

      <div style={{ fontSize: "7.5pt", lineHeight: 1.25 }}>
        <div>Bill #: <b>{str(d.number)}</b></div>
        <div>Date: <b>{dateLabel(d.business_date)}</b></div>
        <div>Customer: <b>{str(data?.customerName || "Counter")}</b></div>
        {Boolean(data?.customerBeat) && <div>Beat: {str(data?.customerBeat)}</div>}
        <div>Salesman: {str(data?.salesmanName || "-")}</div>
      </div>

      <div className="dotted-line" />

      <table style={{ width: "100%", fontSize: "7pt", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ borderBottom: "1px dashed #000" }}>
            <th style={{ textAlign: "left", padding: "2px 0" }}>Item</th>
            <th style={{ textAlign: "right", padding: "2px 0" }}>Qty</th>
            <th style={{ textAlign: "right", padding: "2px 0" }}>Amt</th>
          </tr>
        </thead>
        <tbody>
          {billLines.map((l, i) => {
            const snap = (l.snapshot as Row) || {};
            const name = str(snap.name || l.name || "Item");
            const qty = str(l.quantity).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
            return (
              <tr key={i}>
                <td style={{ padding: "2px 0", maxWidth: 110, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {name}
                </td>
                <td style={{ textAlign: "right", padding: "2px 0" }}>{qty}</td>
                <td style={{ textAlign: "right", padding: "2px 0", fontWeight: 700 }}>{rupees(l.amount)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="dotted-line" />

      <div style={{ fontSize: "7.5pt", lineHeight: 1.35 }}>
        {Boolean(data?.billDiscount && Number(data.billDiscount) > 0) && (
          <>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span>Subtotal:</span>
              <span>{rupees(data?.subtotal ?? d.amount)}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span>Discount:</span>
              <span>-{rupees(data?.billDiscount)}</span>
            </div>
          </>
        )}
        <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 800, fontSize: "8.5pt" }}>
          <span>Net Bill Amount:</span>
          <span>{rupees(d.amount)}</span>
        </div>
        {data?.previousBalance !== undefined && (
          <>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span>Previous Balance:</span>
              <span>{rupees(data.previousBalance)}</span>
            </div>
            {Number(cashPayVal || 0) > 0 && (
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span>Paid Cash:</span>
                <span>{rupees(cashPayVal)}</span>
              </div>
            )}
            {Number(onlinePayVal || 0) > 0 && (
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span>Paid Online:</span>
                <span>{rupees(onlinePayVal)}</span>
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 800, borderTop: "1px dashed #000", marginTop: 2, paddingTop: 2 }}>
              <span>Current Due:</span>
              <span>{rupees(data.issueBalance)}</span>
            </div>
          </>
        )}
      </div>

      <div className="dotted-line" />

      <div style={{ textAlign: "center", fontSize: "7pt", marginTop: 4, lineHeight: 1.35 }}>
        <div>Thank You! Visit Again</div>
        <div style={{ marginTop: 12 }}>Customer Sign: _________________</div>
      </div>
    </div>
  );
}

// ─── Dedicated Print View: Vertical A5 Receipt (No Product Table!) ────────────
function ReceiptA5View({
  d,
  data,
  copyLabel,
}: {
  d: Row;
  data: Row | undefined;
  copyLabel?: string;
}) {
  const businessName = str(data?.businessName ?? "Annapurna Sales Corporation");
  const profile = (data?.businessProfile as Row | undefined) || {};
  const address = str(profile.address ?? "");
  const phone = str(profile.phone ?? "");
  const gst = str(profile.gstin ?? profile.gst ?? "");

  const prevBal = D(cleanMoney(str(data?.previousBalance || "0")) || "0");
  const receivedAmt = D(cleanMoney(str(data?.currentAmountReceived || d.amount || "0")) || "0");
  const overallDue = data?.overallOutstanding !== undefined
    ? D(cleanMoney(str(data.overallOutstanding)) || "0")
    : prevBal.minus(receivedAmt);

  const method = str(data?.method || "cash").toUpperCase();
  const ref = str(data?.reference || "");
  const note = str(data?.note || data?.remarks || "");

  return (
    <div
      className="print-template-a5-vertical"
      style={{
        border: "1px solid #0f172a",
        borderRadius: 4,
        padding: "8px 12px",
        background: "#ffffff",
        marginBottom: 8,
        fontSize: "7.5pt",
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", borderBottom: "1.5px solid #0f172a", paddingBottom: 6, marginBottom: 8 }}>
        <div>
          <h1 style={{ margin: "0 0 2px", fontSize: 14, fontWeight: 800, color: "#0f172a" }}>
            {businessName}
          </h1>
          {(address || phone || gst) && (
            <div style={{ fontSize: "7.5pt", color: "#475569", lineHeight: 1.25 }}>
              {address && <div>{address}</div>}
              {(phone || gst) && <div>{phone ? `Phone: ${phone}` : ""} {gst ? `· GSTIN: ${gst}` : ""}</div>}
            </div>
          )}
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: "8.5pt", fontWeight: 800, textTransform: "uppercase", background: "#0f172a", color: "#ffffff", padding: "2px 6px", borderRadius: 3, display: "inline-block", marginBottom: 3 }}>
            PAYMENT RECEIPT
          </div>
          {copyLabel && (
            <div style={{ fontSize: "7.5pt", fontWeight: 700, color: "#64748b" }}>
              [{copyLabel}]
            </div>
          )}
        </div>
      </div>

      {/* Metadata */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 12px", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 4, padding: "5px 8px", marginBottom: 10, fontSize: "7.5pt" }}>
        <div>
          <div>Receipt #: <strong>{str(d.number)}</strong></div>
          <div>Date: <strong>{dateLabel(d.business_date)}</strong></div>
          <div>Salesman: <strong>{str(data?.salesmanName || "-")}</strong></div>
        </div>
        <div>
          <div>Customer: <strong>{str(data?.customerName || "-")}</strong></div>
          {Boolean(data?.customerBeat) && <div>Beat / Area: <strong>{str(data?.customerBeat)}</strong></div>}
          <div>Payment Mode: <strong>{method}</strong> {ref ? `(Ref: ${ref})` : ""}</div>
        </div>
      </div>

      {/* Financial Details Box - Previous balance, Received, Overall outstanding */}
      <div style={{ border: "1.5px solid #0f172a", borderRadius: 5, padding: "8px 12px", background: "#ffffff", marginBottom: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingBottom: 5, borderBottom: "1px solid #e2e8f0" }}>
          <span style={{ fontSize: "8pt", color: "#475569" }}>Previous Customer Balance:</span>
          <strong style={{ fontSize: "9pt", color: "#0f172a" }}>{rupees(prevBal.toString())}</strong>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 0", background: "#f0fdf4", margin: "6px -12px", paddingLeft: 12, paddingRight: 12, borderTop: "1px solid #bbf7d0", borderBottom: "1px solid #bbf7d0" }}>
          <div>
            <div style={{ fontSize: "7pt", textTransform: "uppercase", color: "#166534", fontWeight: 700 }}>
              Current Amount Received:
            </div>
            <div style={{ fontSize: "8pt", fontStyle: "italic", color: "#166534", fontWeight: 600 }}>
              {numberToIndianWords(receivedAmt.toString())}
            </div>
          </div>
          <strong style={{ fontSize: "13pt", color: "#15803d", fontWeight: 800 }}>
            {rupees(receivedAmt.toString())}
          </strong>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: 5, borderTop: "1px solid #e2e8f0" }}>
          <span style={{ fontSize: "8.5pt", fontWeight: 700, color: "#0f172a" }}>Overall Outstanding Balance:</span>
          <strong style={{ fontSize: "10.5pt", fontWeight: 800, color: overallDue.gt(0) ? "#b91c1c" : "#166534" }}>
            {rupees(overallDue.toString())}
          </strong>
        </div>
      </div>

      {note && (
        <div style={{ fontSize: "7.5pt", color: "#475569", marginBottom: 8 }}>
          <strong>Note / Remarks:</strong> {note}
        </div>
      )}

      {/* Signatures */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginTop: 12, paddingTop: 4, borderTop: "1px dashed #cbd5e1", fontSize: "7.5pt" }}>
        <div style={{ width: "45%" }}>
          <div style={{ height: 32, borderBottom: "1px solid #94a3b8", marginBottom: 2 }} />
          <div>Customer / Payer Signature</div>
        </div>
        <div style={{ width: "45%", textAlign: "right" }}>
          <div>For <strong>{businessName}</strong></div>
          <div style={{ height: 24, borderBottom: "1px solid #0f172a", marginBottom: 2 }} />
          <div>Authorized Signatory / Receiver</div>
        </div>
      </div>

      <div style={{ textAlign: "center", fontSize: "6.5pt", color: "#94a3b8", marginTop: 6 }}>
        Official Payment Acknowledgment · Record #{str(d.number)}
      </div>
    </div>
  );
}

// ─── Dedicated Print View: 3" Thermal Receipt Slip ──────────────────────────
function ReceiptThermalView({
  d,
  data,
}: {
  d: Row;
  data: Row | undefined;
}) {
  const businessName = str(data?.businessName ?? "Annapurna Sales Corporation");
  const prevBal = D(cleanMoney(str(data?.previousBalance || "0")) || "0");
  const receivedAmt = D(cleanMoney(str(data?.currentAmountReceived || d.amount || "0")) || "0");
  const overallDue = data?.overallOutstanding !== undefined
    ? D(cleanMoney(str(data.overallOutstanding)) || "0")
    : prevBal.minus(receivedAmt);

  return (
    <div className="print-template-thermal" style={{ fontSize: "7.5pt" }}>
      <div style={{ textAlign: "center", marginBottom: 4 }}>
        <div style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase" }}>{businessName}</div>
        <div style={{ fontSize: "7.5pt", fontWeight: 700, margin: "2px 0" }}>* PAYMENT RECEIPT *</div>
      </div>
      <div className="dotted-line" />
      <div style={{ fontSize: "7.5pt", lineHeight: 1.25 }}>
        <div>Receipt #: <b>{str(d.number)}</b></div>
        <div>Date: <b>{dateLabel(d.business_date)}</b></div>
        <div>Customer: <b>{str(data?.customerName || "-")}</b></div>
        {Boolean(data?.customerBeat) && <div>Beat: {str(data?.customerBeat)}</div>}
        <div>Salesman: {str(data?.salesmanName || "-")}</div>
        <div>Mode: <b>{str(data?.method || "cash").toUpperCase()}</b></div>
      </div>
      <div className="dotted-line" />
      <div style={{ fontSize: "7.5pt", lineHeight: 1.35 }}>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span>Previous Balance:</span>
          <span>{rupees(prevBal.toString())}</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 800, fontSize: "8.5pt" }}>
          <span>Amount Received:</span>
          <span>{rupees(receivedAmt.toString())}</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 800, borderTop: "1px dashed #000", marginTop: 2, paddingTop: 2 }}>
          <span>Overall Outstanding:</span>
          <span>{rupees(overallDue.toString())}</span>
        </div>
      </div>
      <div className="dotted-line" />
      <div style={{ textAlign: "center", fontSize: "7pt", marginTop: 4, lineHeight: 1.35 }}>
        <div>Thank You!</div>
        <div style={{ marginTop: 12 }}>Authorized Sign: _________________</div>
      </div>
    </div>
  );
}

// ─── Dedicated Print View: Horizontal A5 Voucher (210mm x 148mm Landscape) ───
function VoucherHorizontalA5View({
  d,
  data,
  signatureAttachment,
  copyLabel,
}: {
  d: Row;
  data: Row | undefined;
  signatureAttachment?: Row;
  copyLabel?: string;
}) {
  const businessName = str(data?.businessName ?? "Annapurna Sales Corporation");
  const profile = (data?.businessProfile as Row | undefined) || {};
  const address = str(profile.address ?? "Official Payment Voucher");

  const voucherTitle = d.kind === "salary"
    ? "Salary Payment Voucher"
    : d.kind === "employee_receipt"
      ? "Employee Receipt Voucher"
      : d.kind === "loan"
        ? "Staff Advance Voucher"
        : "Cash Expense Voucher";

  const personName = str(data?.employeeName ?? data?.payee ?? data?.counterparty ?? "-");
  const categoryName = str(data?.category ?? (d.kind === "salary" ? "Monthly Salary" : d.kind === "loan" ? "Staff Loan" : "Expense"));
  const notes = str(data?.note ?? data?.remarks ?? data?.reason ?? "-");

  return (
    <div className="print-template-voucher-horizontal">
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", borderBottom: "2px solid #0f172a", paddingBottom: 8, marginBottom: 10 }}>
        <div>
          <h1 style={{ margin: "0 0 2px", fontSize: 16, fontWeight: 800, color: "#0f172a" }}>
            {businessName}
          </h1>
          <p style={{ margin: 0, fontSize: 9.5, color: "#475569" }}>{address}</p>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ background: "#0f172a", color: "#ffffff", padding: "3px 10px", borderRadius: 4, fontSize: 10, fontWeight: 800, letterSpacing: 0.5, textTransform: "uppercase", display: "inline-block", marginBottom: 3 }}>
            {voucherTitle}
          </div>
          {copyLabel && (
            <div style={{ fontSize: 9, fontWeight: 700, color: "#64748b" }}>
              [{copyLabel}]
            </div>
          )}
          <div style={{ fontSize: 9.5, fontWeight: 700, color: "#0f172a" }}>
            Voucher #: <strong>{str(d.number)}</strong> · Date: <strong>{dateLabel(d.business_date)}</strong>
          </div>
        </div>
      </div>

      {Boolean(d.reversed) && (
        <div style={{ background: "#fee2e2", border: "1px solid #ef4444", color: "#b91c1c", padding: "4px 8px", borderRadius: 4, fontWeight: 700, marginBottom: 8, textAlign: "center", fontSize: 9 }}>
          ⚠️ THIS VOUCHER HAS BEEN OFFICIALLY REVERSED
        </div>
      )}

      {/* Particulars Grid */}
      <div style={{ background: "#f8fafc", border: "1px solid #cbd5e1", borderRadius: 6, padding: "8px 12px", marginBottom: 10 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: "6px 16px" }}>
          <div>
            <div style={{ fontSize: 8, textTransform: "uppercase", color: "#64748b", fontWeight: 700 }}>
              Paid To / Employee
            </div>
            <strong style={{ fontSize: 13, color: "#0f172a" }}>{personName}</strong>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 8, textTransform: "uppercase", color: "#64748b", fontWeight: 700 }}>
              Payment Category
            </div>
            <strong style={{ fontSize: 11, color: "#0f172a" }}>{categoryName}</strong>
          </div>
          <div style={{ gridColumn: "span 2", display: "flex", justifyContent: "space-between", alignItems: "center", background: "#ffffff", border: "1.5px solid #0f172a", borderRadius: 5, padding: "6px 12px", marginTop: 4 }}>
            <div>
              <div style={{ fontSize: 8, textTransform: "uppercase", color: "#64748b", fontWeight: 700 }}>
                Amount Paid
              </div>
              <div style={{ fontSize: 9, fontStyle: "italic", color: "#334155", fontWeight: 600 }}>
                {numberToIndianWords(str(d.amount))}
              </div>
            </div>
            <div style={{ fontSize: 16, fontWeight: 800, color: "#166534" }}>
              {rupees(d.amount)}
            </div>
          </div>
          {notes && notes !== "-" && (
            <div style={{ gridColumn: "span 2", fontSize: 8.5, color: "#475569", marginTop: 2 }}>
              <strong>Remarks:</strong> {notes}
            </div>
          )}
        </div>
      </div>

      {/* Signature Row */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 30, marginTop: 14 }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ height: 42, borderBottom: "1.5px solid #0f172a", display: "flex", alignItems: "flex-end", justifyContent: "center", paddingBottom: 2, marginBottom: 4 }}>
            {signatureAttachment ? (
              <img
                src={"/api/v1/attachments/" + signatureAttachment.id}
                alt="Signature"
                style={{ maxHeight: 38, maxWidth: "100%", objectFit: "contain" }}
              />
            ) : (
              <span style={{ fontSize: 8, color: "#94a3b8" }}>(Sign upon receipt)</span>
            )}
          </div>
          <strong style={{ fontSize: 9, color: "#0f172a", display: "block" }}>
            Employee / Payee Signature
          </strong>
          <small style={{ fontSize: 8, color: "#64748b" }}>{personName}</small>
        </div>

        <div style={{ textAlign: "center" }}>
          <div style={{ height: 42, borderBottom: "1.5px solid #0f172a", display: "flex", alignItems: "flex-end", justifyContent: "center", paddingBottom: 2, marginBottom: 4 }}>
            <span style={{ fontSize: 8, color: "#94a3b8" }}>(Authorized Stamp / Sign)</span>
          </div>
          <strong style={{ fontSize: 9, color: "#0f172a", display: "block" }}>
            Authorized Signatory
          </strong>
          <small style={{ fontSize: 8, color: "#64748b" }}>For {businessName}</small>
        </div>
      </div>

      <div style={{ textAlign: "center", fontSize: 7.5, color: "#94a3b8", marginTop: 8 }}>
        Voucher Record #{str(d.number)} · Immutable Audit Ledger
      </div>
    </div>
  );
}

export function DocumentDetail(props: {
  id: string;
  currentDate?: string;
  onBack: () => void;
  setAction: (n: CommandName) => void;
  owner: boolean;
  onSelect?: (id: string) => void;
}) {
  if (props.id === "audit") {
    return <AuditView onBack={props.onBack} onSelect={props.onSelect} />;
  }
  if (props.id.includes(":")) {
    return null;
  }
  return <DocumentRecordDetail key={props.id} {...props} />;
}

function DocumentRecordDetail({
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
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["document", id],
    queryFn: () => api("documents/" + id),
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

  // Print format state
  const [billPrintFormat, setBillPrintFormat] = useState<"a5_vertical" | "thermal" | "a4_dual">("a5_vertical");
  const [voucherPrintFormat, setVoucherPrintFormat] = useState<"h_a5" | "dual_a4">("h_a5");
  const [receiptPrintFormat, setReceiptPrintFormat] = useState<"a5_vertical" | "thermal" | "a4_dual">("a5_vertical");

  const d = q.data,
    data = d?.data as Row | undefined;

  const isVoucher =
    d?.kind === "salary" ||
    d?.kind === "employee_receipt" ||
    d?.kind === "loan" ||
    d?.kind === "expense";

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
  const isReceipt = d?.kind === "receipt";

  // Dynamic @page styling injection for exact paper dimensions & orientation
  useEffect(() => {
    let styleEl = document.getElementById("dynamic-print-page-style") as HTMLStyleElement | null;
    if (!styleEl) {
      styleEl = document.createElement("style");
      styleEl.id = "dynamic-print-page-style";
      document.head.appendChild(styleEl);
    }
    let pageCss = "size: A4 portrait; margin: 6mm 8mm;";
    if (isBill) {
      if (billPrintFormat === "a5_vertical") pageCss = "size: A5 portrait; margin: 5mm 6mm;";
      else if (billPrintFormat === "thermal") pageCss = "size: 80mm auto; margin: 2mm 3mm;";
      else if (billPrintFormat === "a4_dual") pageCss = "size: A4 landscape; margin: 6mm 6mm;";
    } else if (isReceipt) {
      if (receiptPrintFormat === "a5_vertical") pageCss = "size: A5 portrait; margin: 5mm 6mm;";
      else if (receiptPrintFormat === "thermal") pageCss = "size: 80mm auto; margin: 2mm 3mm;";
      else if (receiptPrintFormat === "a4_dual") pageCss = "size: A4 landscape; margin: 6mm 6mm;";
    } else if (isVoucher) {
      if (voucherPrintFormat === "h_a5") pageCss = "size: A5 landscape; margin: 5mm 8mm;";
      else if (voucherPrintFormat === "dual_a4") pageCss = "size: A4 portrait; margin: 6mm 8mm;";
    }
    styleEl.innerHTML = `@media print { @page { ${pageCss} } }`;
    return () => {
      const el = document.getElementById("dynamic-print-page-style");
      if (el) el.remove();
    };
  }, [isBill, isReceipt, isVoucher, billPrintFormat, receiptPrintFormat, voucherPrintFormat]);
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
          {isBill && (
            <div style={{ display: "inline-flex", alignItems: "center", gap: 3, background: "#f8fafc", padding: "3px 6px", borderRadius: 8, border: "1px solid #cbd5e1" }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: "#475569", marginRight: 2 }}>Format:</span>
              <button
                type="button"
                onClick={() => setBillPrintFormat("a5_vertical")}
                style={{
                  background: billPrintFormat === "a5_vertical" ? "#0f172a" : "#ffffff",
                  color: billPrintFormat === "a5_vertical" ? "#ffffff" : "#334155",
                  border: "1px solid " + (billPrintFormat === "a5_vertical" ? "#0f172a" : "#cbd5e1"),
                  borderRadius: 5,
                  padding: "4px 8px",
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                📄 Vertical A5
              </button>
              <button
                type="button"
                onClick={() => setBillPrintFormat("thermal")}
                style={{
                  background: billPrintFormat === "thermal" ? "#0f172a" : "#ffffff",
                  color: billPrintFormat === "thermal" ? "#ffffff" : "#334155",
                  border: "1px solid " + (billPrintFormat === "thermal" ? "#0f172a" : "#cbd5e1"),
                  borderRadius: 5,
                  padding: "4px 8px",
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                🧾 3" Thermal Slip
              </button>
              <button
                type="button"
                onClick={() => setBillPrintFormat("a4_dual")}
                style={{
                  background: billPrintFormat === "a4_dual" ? "#0f172a" : "#ffffff",
                  color: billPrintFormat === "a4_dual" ? "#ffffff" : "#334155",
                  border: "1px solid " + (billPrintFormat === "a4_dual" ? "#0f172a" : "#cbd5e1"),
                  borderRadius: 5,
                  padding: "4px 8px",
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                📑 2-on-A4 (Dual)
              </button>
            </div>
          )}

          {isReceipt && (
            <div style={{ display: "inline-flex", alignItems: "center", gap: 3, background: "#f8fafc", padding: "3px 6px", borderRadius: 8, border: "1px solid #cbd5e1" }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: "#475569", marginRight: 2 }}>Format:</span>
              <button
                type="button"
                onClick={() => setReceiptPrintFormat("a5_vertical")}
                style={{
                  background: receiptPrintFormat === "a5_vertical" ? "#0f172a" : "#ffffff",
                  color: receiptPrintFormat === "a5_vertical" ? "#ffffff" : "#334155",
                  border: "1px solid " + (receiptPrintFormat === "a5_vertical" ? "#0f172a" : "#cbd5e1"),
                  borderRadius: 5,
                  padding: "4px 8px",
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                📄 Vertical A5
              </button>
              <button
                type="button"
                onClick={() => setReceiptPrintFormat("thermal")}
                style={{
                  background: receiptPrintFormat === "thermal" ? "#0f172a" : "#ffffff",
                  color: receiptPrintFormat === "thermal" ? "#ffffff" : "#334155",
                  border: "1px solid " + (receiptPrintFormat === "thermal" ? "#0f172a" : "#cbd5e1"),
                  borderRadius: 5,
                  padding: "4px 8px",
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                🧾 3" Thermal Slip
              </button>
              <button
                type="button"
                onClick={() => setReceiptPrintFormat("a4_dual")}
                style={{
                  background: receiptPrintFormat === "a4_dual" ? "#0f172a" : "#ffffff",
                  color: receiptPrintFormat === "a4_dual" ? "#ffffff" : "#334155",
                  border: "1px solid " + (receiptPrintFormat === "a4_dual" ? "#0f172a" : "#cbd5e1"),
                  borderRadius: 5,
                  padding: "4px 8px",
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                📑 2-on-A4 (Dual)
              </button>
            </div>
          )}

          {isVoucher && (
            <div style={{ display: "inline-flex", alignItems: "center", gap: 3, background: "#f8fafc", padding: "3px 6px", borderRadius: 8, border: "1px solid #cbd5e1" }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: "#475569", marginRight: 2 }}>Format:</span>
              <button
                type="button"
                onClick={() => setVoucherPrintFormat("h_a5")}
                style={{
                  background: voucherPrintFormat === "h_a5" ? "#0f172a" : "#ffffff",
                  color: voucherPrintFormat === "h_a5" ? "#ffffff" : "#334155",
                  border: "1px solid " + (voucherPrintFormat === "h_a5" ? "#0f172a" : "#cbd5e1"),
                  borderRadius: 5,
                  padding: "4px 8px",
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                📄 Horizontal A5
              </button>
              <button
                type="button"
                onClick={() => setVoucherPrintFormat("dual_a4")}
                style={{
                  background: voucherPrintFormat === "dual_a4" ? "#0f172a" : "#ffffff",
                  color: voucherPrintFormat === "dual_a4" ? "#ffffff" : "#334155",
                  border: "1px solid " + (voucherPrintFormat === "dual_a4" ? "#0f172a" : "#cbd5e1"),
                  borderRadius: 5,
                  padding: "4px 8px",
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                📑 2-on-A4 (Top/Bottom)
              </button>
            </div>
          )}

          <Button
            className="secondary"
            onClick={() => {
              let pageCss = "size: A4 portrait; margin: 6mm 8mm;";
              if (isBill) {
                if (billPrintFormat === "a5_vertical") pageCss = "size: A5 portrait; margin: 5mm 6mm;";
                else if (billPrintFormat === "thermal") pageCss = "size: 80mm auto; margin: 2mm 3mm;";
                else if (billPrintFormat === "a4_dual") pageCss = "size: A4 landscape; margin: 6mm 6mm;";
              } else if (isReceipt) {
                if (receiptPrintFormat === "a5_vertical") pageCss = "size: A5 portrait; margin: 5mm 6mm;";
                else if (receiptPrintFormat === "thermal") pageCss = "size: 80mm auto; margin: 2mm 3mm;";
                else if (receiptPrintFormat === "a4_dual") pageCss = "size: A4 landscape; margin: 6mm 6mm;";
              } else if (isVoucher) {
                if (voucherPrintFormat === "h_a5") pageCss = "size: A5 landscape; margin: 5mm 8mm;";
                else if (voucherPrintFormat === "dual_a4") pageCss = "size: A4 portrait; margin: 6mm 8mm;";
              }
              triggerPrintWithPageStyle(pageCss);
            }}
          >
            <Printer size={16} /> Print {isVoucher ? "Voucher" : isBill ? "Bill" : isReceipt ? "Receipt" : "Record"}
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
        <div className="no-print">
          {isVoucher ? (
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
          )}
        </div>
      ) : (
        <p>Loading saved record…</p>
      )}

      {/* ─── DEDICATED PRINT TEMPLATES (PRINT-ONLY) ─── */}
      {d && (
        <div className="print-only">
          {isBill ? (
            billPrintFormat === "thermal" ? (
              <BillThermalView d={d as Row} data={data} billLines={billLines} />
            ) : billPrintFormat === "a4_dual" ? (
              <div className="print-template-a4-dual">
                <div className="dual-col-left">
                  <BillA5View d={d as Row} data={data} billLines={billLines} copyLabel="CUSTOMER COPY" />
                </div>
                <div className="dual-col-right">
                  <BillA5View d={d as Row} data={data} billLines={billLines} copyLabel="ACCOUNTS COPY" />
                </div>
              </div>
            ) : (
              <BillA5View d={d as Row} data={data} billLines={billLines} copyLabel="ORIGINAL - CUSTOMER COPY" />
            )
          ) : isReceipt ? (
            receiptPrintFormat === "thermal" ? (
              <ReceiptThermalView d={d as Row} data={data} />
            ) : receiptPrintFormat === "a4_dual" ? (
              <div className="print-template-a4-dual">
                <div className="dual-col-left">
                  <ReceiptA5View d={d as Row} data={data} copyLabel="CUSTOMER COPY" />
                </div>
                <div className="dual-col-right">
                  <ReceiptA5View d={d as Row} data={data} copyLabel="OFFICE COPY" />
                </div>
              </div>
            ) : (
              <ReceiptA5View d={d as Row} data={data} copyLabel="ORIGINAL - CUSTOMER COPY" />
            )
          ) : isVoucher ? (
            voucherPrintFormat === "dual_a4" ? (
              <div className="print-template-voucher-dual-a4">
                <div className="voucher-copy-wrap">
                  <VoucherHorizontalA5View d={d as Row} data={data} signatureAttachment={signatureAttachment} copyLabel="ORIGINAL" />
                </div>
                <div className="cut-divider">
                  ✂ - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - ✂
                </div>
                <div className="voucher-copy-wrap">
                  <VoucherHorizontalA5View d={d as Row} data={data} signatureAttachment={signatureAttachment} copyLabel="DUPLICATE - OFFICE COPY" />
                </div>
              </div>
            ) : (
              <VoucherHorizontalA5View d={d as Row} data={data} signatureAttachment={signatureAttachment} copyLabel="OFFICIAL VOUCHER" />
            )
          ) : (
            <ReceiptA5View d={d as Row} data={data} copyLabel={str(d.kind).toUpperCase()} />
          )}
        </div>
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
