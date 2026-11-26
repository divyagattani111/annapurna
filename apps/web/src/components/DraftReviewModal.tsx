import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import Decimal from "decimal.js";
import { Pencil, RefreshCw, Trash2, AlertTriangle, ExternalLink, CheckCircle2, Plus, X, Receipt, Check } from "lucide-react";
import { rowsSchema, rowSchema, commandResult, commands, cleanMoney, cleanDecimal, previewResponse, parseMultiAmounts } from "@ledger/contracts";
import { api } from "../api";
import { Button } from "./ui";
import { D, type Row, str, arr, rupees, formatCents, parseCents, parseMoneyNumber } from "../utils/helpers";
import {
  CustomerSearchableSelect,
  ProductSearchableSelect,
  ConfectionerySearchableSelect,
  BarcodeScannerInput,
  type ConfectioneryRowItem,
  type DraftConfectioneryItem,
} from "./selectors";

export function DraftReviewModal({
  draft,
  masters,
  onClose,
  onResumeEdit,
  onPostSuccess,
  salesmanList,
  customerList,
}: {
  draft: Row;
  masters: Row;
  onClose: () => void;
  onResumeEdit: () => void;
  onPostSuccess: (res: { id?: string; number?: string; message?: string }) => void;
  salesmanList?: Row[];
  customerList?: Row[];
}) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const draftId = str(draft.id);
  const dData = (draft.data ?? {}) as Row;
  const values = (dData.values ?? {}) as Row;
  const salesmanId = str(dData.salesmanId || values.salesmanId || "");
  const customerId = str(dData.customerId || values.customerId || "");
  const isDirectCig = dData.name === "direct_cig_bill" || Boolean(customerId);
  const allSalesmen = salesmanList || arr(masters.salesmen);
  const salesmanObj = allSalesmen.find((s) => str(s.id) === salesmanId);
  const salesmanName = str(
    dData.salesmanName || values.salesmanName || salesmanObj?.name || "Unknown Salesman"
  );
  const customerName = isDirectCig
    ? str(
      dData.customerName ||
      (customerList || []).find((c) => str(c.id) === customerId)?.customer_name ||
      "Unknown Customer"
    )
    : "";

  const billDate = str(dData.date || values.date || "");
  const paperRef = str(dData.paperReference || values.paperReference || "");
  const note = str(dData.note || values.note || "");
  const billDiscount = str(dData.discount || (values as Row)?.discount || "");

  // Products
  const rowIds = Array.isArray(dData.rowIds)
    ? dData.rowIds.map(String)
    : Object.keys((dData.rowProducts as Record<string, string>) || {});
  const rowProducts = (dData.rowProducts ?? {}) as Record<string, string>;
  const quantities = (dData.quantities ?? {}) as Record<string, string>;
  const hasConfectionery = Boolean(
    dData.hasConfectionery ||
    (Array.isArray(dData.confectioneryRows) && dData.confectioneryRows.length > 0)
  );
  const confectioneryRows = Array.isArray(dData.confectioneryRows)
    ? (dData.confectioneryRows as DraftConfectioneryItem[])
    : [];

  // Payments
  const payment = (dData.payment ?? {}) as Row;
  const withPayments = Boolean(dData.withPayments ?? payment.withPayments);
  const cashPay = str(dData.cashPay || payment.cashPay || "");
  const onlinePay = str(dData.onlinePay || payment.onlinePay || "");
  const paymentNote = str(dData.paymentNote || payment.bankRef || "");
  const cashAccountId = str(dData.cashAccountId || payment.cashId || "");
  const bankAccountId = str(dData.bankAccountId || payment.bankId || "");

  // Map products
  const productMap = useMemo(() => {
    const map = new Map<string, Row>();
    for (const p of arr(masters.products)) {
      map.set(str(p.id), p);
    }
    return map;
  }, [masters.products]);

  // Build lines
  const lines = useMemo(() => {
    const res: Array<{
      productId?: string;
      name?: string;
      code?: string;
      category?: string;
      quantity: string;
      rate?: string;
    }> = [];

    for (const rId of rowIds) {
      const pId = rowProducts[rId];
      const rawQ = str(quantities[rId] ?? "").trim();
      const qStr = rawQ.startsWith(".") ? "0" + rawQ : rawQ;
      if (pId && Number(qStr) > 0) {
        res.push({ productId: pId, quantity: qStr, category: "CG-01 CIGARETTE" });
      }
    }

    if (hasConfectionery) {
      for (const cr of confectioneryRows) {
        const rawQ = str(cr.quantity ?? "").trim();
        const qStr = rawQ.startsWith(".") ? "0" + rawQ : rawQ;
        const rawR = str(cr.rate ?? "").trim();
        const rStr = rawR.startsWith(".") ? "0" + rawR : rawR;
        if (Number(qStr) > 0 && Number(rStr) > 0 && (cr.productId || (cr.name && str(cr.name).trim()))) {
          res.push({
            ...(cr.productId ? { productId: cr.productId } : {}),
            name: (cr.name && str(cr.name).trim()) || undefined,
            code: (cr.code && str(cr.code).trim()) || undefined,
            category: "CF-05 CONFECTIONERY",
            quantity: qStr,
            rate: rStr,
          });
        }
      }
    }
    return res;
  }, [rowIds, rowProducts, quantities, hasConfectionery, confectioneryRows]);

  // Receipts
  const billReceipts = useMemo(() => {
    const r: Row[] = [];
    if (withPayments) {
      const cleanCash = cleanMoney(cashPay);
      const onlineAmounts = parseMultiAmounts(onlinePay);
      const hasCash = Boolean(cleanCash && parseMoneyNumber(cleanCash) > 0);

      const defaultCash = arr(masters.accounts).find((a) => a.type === "cash")?.id || "";
      const defaultBank = arr(masters.accounts).find((a) => a.type === "bank")?.id || "";
      const activeCashId = cashAccountId || defaultCash;
      const activeBankId = bankAccountId || defaultBank;

      if (hasCash) {
        r.push({
          amount: cleanCash,
          accountId: activeCashId,
          method: "cash",
          actualDate: billDate,
          reference: "",
          verified: false,
        });
      }
      if (onlineAmounts.length > 0) {
        onlineAmounts.forEach((amt, idx) => {
          const suffix = onlineAmounts.length > 1 ? ` (${idx + 1}/${onlineAmounts.length})` : "";
          r.push({
            amount: amt,
            accountId: activeBankId,
            method: "online",
            actualDate: billDate,
            reference: (paymentNote ? `${paymentNote}${suffix}` : `Draft Online Payment${suffix}`).trim(),
            verified: false,
          });
        });
      }
    }
    return r;
  }, [withPayments, cashPay, onlinePay, cashAccountId, bankAccountId, masters.accounts, billDate, paymentNote]);

  const cleanBillDisc = cleanMoney(billDiscount);
  const previewPayload = useMemo(() => {
    return {
      date: billDate,
      note: note.trim(),
      salesmanId: salesmanId,
      ...(isDirectCig && customerId ? { customerId } : {}),
      lines,
      receipts: billReceipts,
      ...(!isDirectCig && paperRef ? { paperReference: paperRef } : {}),
      ...(cleanBillDisc && parseMoneyNumber(cleanBillDisc) > 0 ? { discount: cleanBillDisc } : {}),
      overrideReason: "",
    };
  }, [billDate, note, salesmanId, isDirectCig, customerId, lines, billReceipts, paperRef, cleanBillDisc]);

  // Query server preview quote
  const previewQuery = useQuery({
    queryKey: ["preview/bill", previewPayload],
    queryFn: () => api("preview/bill", previewResponse, previewPayload),
    enabled: lines.length > 0 && !!salesmanId && (!isDirectCig || !!customerId),
    staleTime: 5000,
  });

  const quote = previewQuery.data;
  const quoteLoading = previewQuery.isLoading;
  const quoteError = previewQuery.error ? (previewQuery.error as Error).message : "";

  // Accounts lookup for payments
  const cashAccName = useMemo(() => {
    const accId = cashAccountId || arr(masters.accounts).find((a) => a.type === "cash")?.id;
    return str(arr(masters.accounts).find((a) => str(a.id) === str(accId))?.name || "Cash In Hand");
  }, [cashAccountId, masters.accounts]);

  const bankAccName = useMemo(() => {
    const accId = bankAccountId || arr(masters.accounts).find((a) => a.type === "bank")?.id;
    return str(arr(masters.accounts).find((a) => str(a.id) === str(accId))?.name || "Bank Account");
  }, [bankAccountId, masters.accounts]);

  // Calculate line items for display
  const displayItems = useMemo(() => {
    return lines.map((line, idx) => {
      if (line.category === "confectionery" || line.category === "CF-05 CONFECTIONERY") {
        const qNum = Number(line.quantity) || 0;
        const rNum = Number(line.rate) || 0;
        const amt = (qNum * rNum).toFixed(2);
        return {
          id: `conf-${idx}`,
          name: line.name || "Confectionery Item",
          code: line.code || "",
          category: "Confectionery",
          quantity: line.quantity,
          unit: "pcs",
          rate: line.rate || "0",
          amount: amt,
        };
      }
      const prod = productMap.get(line.productId || "");
      const prodName = prod ? str(prod.name) : `Product ${line.productId}`;
      const prodCode = prod?.code ? str(prod.code) : "";
      const prodUnit = prod?.unit ? str(prod.unit) : "pkt";
      const qNum = Number(line.quantity) || 0;
      const rNum = Number(prod?.rate) || 0;
      const bNum = Number(prod?.basis || 1) || 1;
      const clientAmt = ((qNum * rNum) / bNum).toFixed(2);

      // Match server quote line if available
      const qLine = quote?.lines?.find((ql) => str(ql.productId) === str(line.productId));
      return {
        id: line.productId ? `${line.productId}-${idx}` : `item-${idx}`,
        name: prodName,
        code: prodCode,
        category: "Cigarette",
        quantity: line.quantity,
        unit: qLine?.unit ? str(qLine.unit) : prodUnit,
        rate: qLine?.effectiveRate ? str(qLine.effectiveRate) : (rNum > 0 ? String(rNum) : "—"),
        amount: qLine?.amount ? str(qLine.amount) : clientAmt,
      };
    });
  }, [lines, productMap, quote]);

  const handleConfirmPost = async () => {
    if (!quote?.quoteHash) return;
    setBusy(true);
    setError("");
    try {
      const postPayload = {
        ...previewPayload,
        expectedQuoteHash: quote.quoteHash,
      };
      const res = await api(
        "commands/bill",
        commandResult,
        postPayload,
        "POST",
        crypto.randomUUID()
      );

      // Delete draft on successful post
      if (draftId) {
        try {
          await api(`drafts/${draftId}`, z.unknown(), undefined, "DELETE");
        } catch {
          // ignore
        }
      }

      await qc.invalidateQueries({ queryKey: ["drafts"] });
      await qc.invalidateQueries();

      onPostSuccess({
        id: str(res.id),
        number: res.number || "POSTED",
        message: `Bill ${res.number || "POSTED"} confirmed and posted successfully!`,
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteDraft = async () => {
    if (!window.confirm("Are you sure you want to delete this draft?")) return;
    setBusy(true);
    setError("");
    try {
      await api(`drafts/${draftId}`, z.unknown(), undefined, "DELETE");
      await qc.invalidateQueries({ queryKey: ["drafts"] });
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const onlineAmountsList = parseMultiAmounts(onlinePay);
  const totalOnlinePaid = onlineAmountsList.reduce((acc, curr) => acc.plus(curr), D(0));
  const totalConfirmedPaid = withPayments
    ? (cleanMoney(cashPay) || "0.00")
    : "0.00";
  const billTotalNum = quote?.total
    ? Number(quote.total)
    : displayItems.reduce((acc, it) => acc + Number(it.amount || 0), 0) - Number(cleanBillDisc || 0);
  const balanceRemaining = (billTotalNum - Number(totalConfirmedPaid)).toFixed(2);

  const totalQuantityNum = displayItems.reduce((acc, it) => acc + (Number(it.quantity) || 0), 0);
  const totalQuantityFormatted = Number.isInteger(totalQuantityNum)
    ? String(totalQuantityNum)
    : (Math.round(totalQuantityNum * 100) / 100).toFixed(2);

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
        zIndex: 1000,
        padding: 16,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div
        style={{
          background: "#ffffff",
          borderRadius: 16,
          maxWidth: 680,
          width: "100%",
          maxHeight: "92vh",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.15), 0 10px 10px -5px rgba(0, 0, 0, 0.04)",
          overflow: "hidden",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div
          style={{
            padding: "18px 22px",
            borderBottom: "1px solid #e2e8f0",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            background: "#f8fafc",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div
              style={{
                width: 38,
                height: 38,
                borderRadius: 10,
                background: "#eff6ff",
                color: "#2563eb",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Receipt size={20} />
            </div>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: "#0f172a" }}>
                  {draftId ? "Review Saved Draft Bill" : "Review Bill Before Posting"}
                </h3>
                <span
                  style={{
                    fontSize: 11,
                    background: draftId ? "#fef3c7" : "#eff6ff",
                    color: draftId ? "#92400e" : "#1e40af",
                    padding: "2px 8px",
                    borderRadius: 10,
                    fontWeight: 600,
                  }}
                >
                  {draftId ? "Draft · Unposted" : "New Bill · Unposted"}
                </span>
              </div>
              <p style={{ margin: "2px 0 0", fontSize: 12, color: "#64748b" }}>
                Verify all line items, rates, and payments before confirming to the ledger.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            style={{
              background: "none",
              border: "none",
              fontSize: 22,
              cursor: "pointer",
              color: "#94a3b8",
              padding: 4,
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>

        {/* Modal Body - Scrollable */}
        <div style={{ padding: "20px 22px", overflowY: "auto", flex: 1, display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Metadata Card */}
          <div
            style={{
              background: "#f8fafc",
              border: "1px solid #e2e8f0",
              borderRadius: 12,
              padding: "14px 16px",
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
              gap: 12,
            }}
          >
            <div>
              <span style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em", color: "#64748b", fontWeight: 600 }}>
                {isDirectCig ? "Customer" : "Salesman (Debtor)"}
              </span>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#0f172a", marginTop: 2 }}>
                {isDirectCig ? customerName : salesmanName}
              </div>
              {isDirectCig && salesmanName && (
                <div style={{ fontSize: 11, color: "#64748b" }}>Route: {salesmanName}</div>
              )}
            </div>

            <div>
              <span style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em", color: "#64748b", fontWeight: 600 }}>
                Bill Date
              </span>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#0f172a", marginTop: 2 }}>
                {billDate || "—"}
              </div>
            </div>

            {paperRef && (
              <div>
                <span style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em", color: "#64748b", fontWeight: 600 }}>
                  Paper Ref #
                </span>
                <div style={{ fontSize: 14, fontWeight: 600, color: "#0f172a", marginTop: 2 }}>
                  {paperRef}
                </div>
              </div>
            )}

            {note && (
              <div style={{ gridColumn: "1 / -1" }}>
                <span style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em", color: "#64748b", fontWeight: 600 }}>
                  Note / Memo
                </span>
                <div style={{ fontSize: 13, color: "#334155", marginTop: 2 }}>
                  {note}
                </div>
              </div>
            )}
          </div>

          {/* Products Table */}
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <h4 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "#1e293b" }}>
                  Billed Products & Items ({displayItems.length})
                </h4>
                {displayItems.length > 0 && (
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      background: "#e0f2fe",
                      color: "#0369a1",
                      padding: "2px 8px",
                      borderRadius: 10,
                    }}
                  >
                    Total Qty: {totalQuantityFormatted}
                  </span>
                )}
              </div>
              {quoteLoading && (
                <span style={{ fontSize: 12, color: "#2563eb", display: "flex", alignItems: "center", gap: 4 }}>
                  <RefreshCw size={12} className="spin" /> Verifying ledger rates…
                </span>
              )}
            </div>

            {displayItems.length === 0 ? (
              <div style={{ padding: 20, textAlign: "center", background: "#f8fafc", borderRadius: 8, color: "#64748b", fontSize: 13 }}>
                No items recorded in this draft bill.
              </div>
            ) : (
              <div style={{ border: "1px solid #e2e8f0", borderRadius: 10, overflow: "hidden" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: "#f1f5f9", textAlign: "left", color: "#475569", borderBottom: "1px solid #e2e8f0" }}>
                      <th style={{ padding: "8px 12px", width: 36 }}>#</th>
                      <th style={{ padding: "8px 12px" }}>Product Description</th>
                      <th style={{ padding: "8px 12px", textAlign: "right" }}>Rate (₹)</th>
                      <th style={{ padding: "8px 12px", textAlign: "right" }}>Qty</th>
                      <th style={{ padding: "8px 12px", textAlign: "right" }}>Amount (₹)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayItems.map((item, i) => (
                      <tr
                        key={item.id}
                        style={{
                          borderBottom: "1px solid #f1f5f9",
                          background: i % 2 === 0 ? "#ffffff" : "#fcfcfd",
                        }}
                      >
                        <td style={{ padding: "10px 12px", color: "#94a3b8", fontSize: 12 }}>{i + 1}</td>
                        <td style={{ padding: "10px 12px" }}>
                          <div style={{ fontWeight: 600, color: "#0f172a" }}>{item.name}</div>
                          <div style={{ fontSize: 11, color: "#64748b" }}>
                            {item.category}{item.code ? ` · ${item.code}` : ""}
                          </div>
                        </td>
                        <td style={{ padding: "10px 12px", textAlign: "right", color: "#334155" }}>
                          {item.rate !== "—" ? rupees(item.rate) : "—"}
                        </td>
                        <td style={{ padding: "10px 12px", textAlign: "right", fontWeight: 600, color: "#0f172a" }}>
                          {item.quantity} <span style={{ fontSize: 11, color: "#64748b", fontWeight: 400 }}>{item.unit}</span>
                        </td>
                        <td style={{ padding: "10px 12px", textAlign: "right", fontWeight: 700, color: "#0f172a" }}>
                          {rupees(item.amount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{ background: "#f8fafc", fontWeight: 700, borderTop: "2px solid #e2e8f0" }}>
                      <td colSpan={3} style={{ padding: "10px 12px", textAlign: "right", color: "#475569", fontSize: 12, textTransform: "uppercase", letterSpacing: "0.03em" }}>
                        Total:
                      </td>
                      <td style={{ padding: "10px 12px", textAlign: "right", color: "#0369a1", fontSize: 13, fontWeight: 700 }}>
                        {totalQuantityFormatted}
                      </td>
                      <td style={{ padding: "10px 12px", textAlign: "right", color: "#0f172a", fontSize: 13, fontWeight: 700 }}>
                        {quote?.subtotal ? rupees(quote.subtotal) : rupees(displayItems.reduce((acc, it) => acc + Number(it.amount || 0), 0))}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>

          {/* Financial Breakdown Card */}
          <div
            style={{
              background: "#f8fafc",
              border: "1px solid #e2e8f0",
              borderRadius: 12,
              padding: "14px 16px",
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "#475569" }}>
              <span>Subtotal:</span>
              <span style={{ fontWeight: 600 }}>
                {quote?.subtotal ? rupees(quote.subtotal) : rupees(displayItems.reduce((acc, it) => acc + Number(it.amount || 0), 0))}
              </span>
            </div>

            {Boolean(cleanBillDisc && parseMoneyNumber(cleanBillDisc) > 0) && (
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "#dc2626" }}>
                <span>Overall Discount:</span>
                <span style={{ fontWeight: 600 }}>−{rupees(cleanBillDisc)}</span>
              </div>
            )}

            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: 16,
                fontWeight: 800,
                color: "#0f172a",
                borderTop: "1px solid #cbd5e1",
                paddingTop: 8,
                marginTop: 2,
              }}
            >
              <span>Total Bill Amount:</span>
              <span style={{ color: "#2563eb" }}>
                {quote?.total ? rupees(quote.total) : rupees(billTotalNum)}
              </span>
            </div>
          </div>

          {/* Account Outstanding & Ledger Impact Card */}
          {quote && (
            <div
              style={{
                background: "#f8fafc",
                border: "1px solid #cbd5e1",
                borderRadius: 12,
                padding: "14px 16px",
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 700, color: "#334155", textTransform: "uppercase", letterSpacing: "0.03em", marginBottom: 2 }}>
                {isDirectCig ? "Customer Outstanding & Settlement Impact:" : "Ledger Outstanding & Settlement Impact:"}
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "#475569" }}>
                <span>{isDirectCig ? "Previous Customer Outstanding:" : "Previous Outstanding Balance:"}</span>
                <span style={{ fontWeight: 600 }}>{rupees(quote.previous)}</span>
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "#0f172a" }}>
                <span>+ This Bill Amount:</span>
                <span style={{ fontWeight: 600 }}>+{rupees(quote.total)}</span>
              </div>

              {(() => {
                const quoteAny = quote as Row;
                const cashAmount = quoteAny.cashConfirmed !== undefined
                  ? str(quoteAny.cashConfirmed)
                  : billReceipts
                    .filter((r) => r.method === "cash")
                    .reduce((s, r) => s + (parseFloat(str(r.amount)) || 0), 0)
                    .toFixed(2);
                const onlineAmount = quoteAny.onlineConfirmed !== undefined
                  ? str(quoteAny.onlineConfirmed)
                  : billReceipts
                    .filter((r) => r.method === "online")
                    .reduce((s, r) => s + (parseFloat(str(r.amount)) || 0), 0)
                    .toFixed(2);

                const hasCash = Number(cashAmount) > 0;
                const hasOnline = Number(onlineAmount) > 0;

                return (
                  <>
                    {hasCash && (
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "#166534" }}>
                        <span>− Confirmed Cash Received:</span>
                        <span style={{ fontWeight: 600 }}>−{rupees(cashAmount)}</span>
                      </div>
                    )}
                    {hasOnline && (
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "#166534" }}>
                        <span>− Confirmed Online Received:</span>
                        <span style={{ fontWeight: 600 }}>−{rupees(onlineAmount)}</span>
                      </div>
                    )}
                    {!hasCash && !hasOnline && Boolean(Number(quote.confirmed) > 0) && (
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "#166534" }}>
                        <span>− Confirmed Received:</span>
                        <span style={{ fontWeight: 600 }}>−{rupees(quote.confirmed)}</span>
                      </div>
                    )}
                  </>
                );
              })()}

              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: 15,
                  fontWeight: 800,
                  color: "#0f172a",
                  borderTop: "1.5px solid #cbd5e1",
                  paddingTop: 8,
                  marginTop: 2,
                }}
              >
                <span>{isDirectCig ? "Projected Customer Outstanding:" : "Projected Ledger Outstanding:"}</span>
                <span style={{ color: Number(quote.projected) > 0 ? "#b45309" : "#166534" }}>
                  {rupees(quote.projected)}
                </span>
              </div>

              {/* Open / Pending Online Claims */}
              {(() => {
                const openList = arr((quote as Row).openClaims);
                const hasPendingOnThisBill = Boolean(Number(quote.pending) > 0);
                if (openList.length === 0 && !hasPendingOnThisBill) return null;
                return (
                  <div
                    style={{
                      background: "#fffbeb",
                      border: "1px solid #fde68a",
                      borderRadius: 8,
                      padding: "10px 14px",
                      marginTop: 4,
                      fontSize: 12,
                      color: "#92400e",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontWeight: 700, marginBottom: openList.length > 0 ? 6 : 0 }}>
                      <span style={{ textTransform: "uppercase", fontSize: 11, letterSpacing: "0.03em" }}>
                        ⏳ Pending Online Claims (Awaiting Bank Verification):
                      </span>
                      {hasPendingOnThisBill && (
                        <span style={{ color: "#b45309" }}>This Bill: {rupees(quote.pending)}</span>
                      )}
                    </div>
                    {openList.length > 0 && (
                      <div style={{ display: "flex", flexDirection: "column", gap: 5, marginTop: 6 }}>
                        {openList.map((oc) => (
                          <div
                            key={str(oc.id)}
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              fontSize: 12,
                              color: "#78350f",
                              background: "#fef3c7",
                              padding: "5px 8px",
                              borderRadius: 4,
                            }}
                          >
                            <span>
                              • {str(oc.actual_date)} — Ref: <b>{str(oc.reference || "Online Transfer")}</b>
                            </span>
                            <b>{rupees(oc.amount)}</b>
                          </div>
                        ))}
                      </div>
                    )}
                    <div style={{ fontSize: 11, color: "#a16207", marginTop: 6 }}>
                      {isDirectCig
                        ? "* Online payments will credit to the customer's ledger balance once bank verification is completed."
                        : "* Online payments will credit to the salesman's ledger balance once bank verification is completed."}
                    </div>
                  </div>
                );
              })()}
            </div>
          )}

          {/* Warnings / Errors */}
          {quoteError && (
            <div
              style={{
                background: "#fef2f2",
                border: "1px solid #fecaca",
                borderRadius: 8,
                padding: "10px 14px",
                display: "flex",
                alignItems: "center",
                gap: 8,
                color: "#991b1b",
                fontSize: 13,
              }}
            >
              <AlertTriangle size={16} />
              <span>{quoteError}</span>
            </div>
          )}

          {error && (
            <div
              style={{
                background: "#fef2f2",
                border: "1px solid #fecaca",
                borderRadius: 8,
                padding: "10px 14px",
                display: "flex",
                alignItems: "center",
                gap: 8,
                color: "#991b1b",
                fontSize: 13,
              }}
            >
              <AlertTriangle size={16} />
              <span>{error}</span>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div
          style={{
            padding: "14px 22px",
            borderTop: "1px solid #e2e8f0",
            display: "flex",
            justifyContent: draftId ? "space-between" : "flex-end",
            alignItems: "center",
            background: "#f8fafc",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          {draftId ? (
            <Button
              type="button"
              className="secondary"
              onClick={handleDeleteDraft}
              disabled={busy}
              style={{ color: "#dc2626", borderColor: "#fca5a5", fontSize: 13 }}
            >
              <Trash2 size={15} /> Delete Draft
            </Button>
          ) : null}

          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <Button
              type="button"
              className="secondary"
              onClick={onResumeEdit}
              disabled={busy}
              style={{ fontSize: 13 }}
            >
              <Pencil size={15} /> {draftId ? "Edit in Form" : "Back to Edit"}
            </Button>

            <Button
              type="button"
              className="primary"
              onClick={handleConfirmPost}
              disabled={busy || quoteLoading || Boolean(quoteError) || !quote?.quoteHash || displayItems.length === 0}
              style={{
                fontSize: 13,
                padding: "8px 18px",
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontWeight: 700,
              }}
            >
              {busy ? (
                <>
                  <RefreshCw size={15} className="spin" /> Posting Bill…
                </>
              ) : quoteLoading ? (
                <>
                  <RefreshCw size={15} className="spin" /> Verifying…
                </>
              ) : (
                <>
                  <Check size={16} /> Confirm & Post Bill
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

