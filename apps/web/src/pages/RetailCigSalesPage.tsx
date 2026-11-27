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
  AlertCircle,
  Banknote,
  CheckCircle,
  CheckCircle2,
  CreditCard,
  ExternalLink,
  Eye,
  FileText,
  IndianRupee,
  Layers,
  Pencil,
  Plus,
  Search,
  Trash2,
  Users,
  X,
} from "lucide-react";
import {
  rowsSchema, rowSchema, commandResult, commands, cleanMoney, cleanDecimal,
  parseMultiAmounts, cleanIndianPhone, type CommandName,
  encodeCsvRows,
} from "@ledger/contracts";
import { api } from "../api";
import { Button, Field, Empty, Metric } from "../components/ui";
import { DraftReviewModal } from "../components/DraftReviewModal";
import { Documents } from "../components/Documents";
import { MasterForm } from "./MasterRecordsManager";
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


export function RetailCigSalesPage({
  date,
  masters,
  dashboard,
  owner: _owner,
  excludeSalesmanId,
  initialSalesmanId,
  onSelect,
  onStatement,
  addSalesmanOpen,
  setAddSalesmanOpen,
  restoreDraftRecord,
  onClearRestoreDraft,
  activeView: externalActiveView,
  onViewChange,
}: {
  date: string;
  masters: Row;
  dashboard?: Row;
  owner: boolean;
  excludeSalesmanId?: string;
  initialSalesmanId?: string | null;
  onSelect: (id: string) => void;
  onStatement: (id: string) => void;
  addSalesmanOpen: boolean;
  setAddSalesmanOpen: (open: boolean) => void;
  restoreDraftRecord?: Row | null;
  onClearRestoreDraft?: () => void;
  activeView?: "ledger" | "new_bill" | "receive_money" | "register" | "saved_drafts";
  onViewChange?: (view: "ledger" | "new_bill" | "receive_money" | "register" | "saved_drafts") => void;
}) {
  const qc = useQueryClient();
  const salesmenList = arr(masters.salesmen).filter(
    (s) => s.active && (!excludeSalesmanId || s.id !== excludeSalesmanId)
  );

  // Retail Cigs summary for all retail cigarette salesmen (excluding Mubashir)
  const retailSummaryQuery = useQuery({
    queryKey: ["retail-cig-summary", excludeSalesmanId || "", date],
    queryFn: () =>
      api(
        `retail-cig/summary?date=${encodeURIComponent(date)}${excludeSalesmanId ? `&excludeSalesmanId=${encodeURIComponent(excludeSalesmanId)}` : ""}`,
      ),
  });
  const retailStats = (retailSummaryQuery.data ?? {}) as Row;

  const [selectedSalesmanId, setSelectedSalesmanId] = useState<string>(
    initialSalesmanId || str(salesmenList[0]?.id ?? "")
  );

  useEffect(() => {
    if (initialSalesmanId) {
      setSelectedSalesmanId(initialSalesmanId);
      setBillSalesmanId(initialSalesmanId);
      setReceiveSalesmanId(initialSalesmanId);
    }
  }, [initialSalesmanId]);

  // Sub-views: "ledger" | "new_bill" | "receive_money" | "register" | "saved_drafts"
  const [internalView, setInternalView] = useState<
    "ledger" | "new_bill" | "receive_money" | "register" | "saved_drafts"
  >(externalActiveView ?? "ledger");
  const activeView = externalActiveView ?? internalView;
  const setActiveView = (nextView: "ledger" | "new_bill" | "receive_money" | "register" | "saved_drafts") => {
    setInternalView(nextView);
    onViewChange?.(nextView);
  };

  const switchView = (nextView: "ledger" | "new_bill" | "receive_money" | "register" | "saved_drafts") => {
    setBillSuccess(null);
    setBillError("");
    setReceiveSuccess("");
    setReceiveError("");
    if (nextView === "new_bill") {
      // Direct click on New Bill tab clears form completely
      setBillSalesmanId("");
      setBillRowIds([crypto.randomUUID()]);
      setBillRowProducts({});
      setQuantities({});
      setConfectioneryRows([]);
      setBillDiscount("");
      setBillNote("");
      setBillPaperRef("");
      setBillWithPayments(true);
      setBillCashPay("");
      setBillOnlinePay("");
      setBillPaymentNote("");
      setBillDraft(null);
      setBillDraftNotice("");
    }
    setActiveView(nextView);
  };

  // --- NEW BILL STATE ---
  const [billSalesmanId, setBillSalesmanId] = useState<string>(initialSalesmanId || "");
  useEffect(() => {
    if (selectedSalesmanId) {
      setBillSalesmanId(selectedSalesmanId);
    }
  }, [selectedSalesmanId]);

  const [billDate, setBillDate] = useState(date);
  const [billRowIds, setBillRowIds] = useState<string[]>(() => [crypto.randomUUID()]);
  const [billRowProducts, setBillRowProducts] = useState<Record<string, string>>({});
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [hasConfectionery, setHasConfectionery] = useState(false);
  const [confectioneryRows, setConfectioneryRows] = useState<ConfectioneryRowItem[]>([]);
  const [billDiscount, setBillDiscount] = useState("");

  const cigaretteProducts = useMemo(
    () => arr(masters.products).filter((x) => x.active && (x.category === "CG-01 CIGARETTE" || x.category === "cigarette" || !x.category)),
    [masters.products]
  );
  const confectioneryProducts = useMemo(
    () => arr(masters.products).filter((x) => x.active && (x.category === "CF-05 CONFECTIONERY" || x.category === "confectionery")),
    [masters.products]
  );

  const handleProductsScanned = (scannedProducts: Row[]) => {
    if (!scannedProducts.length) return;
    let firstTargetRowId: string | null = null;

    setBillRowIds((currentIds) => {
      const updatedIds = [...currentIds];
      const newProductsMap: Record<string, string> = {};

      for (const scannedProduct of scannedProducts) {
        const prodId = str(scannedProduct.id);
        const existingRowId = updatedIds.find((id) => (newProductsMap[id] || billRowProducts[id]) === prodId);

        if (existingRowId) {
          if (!firstTargetRowId) firstTargetRowId = existingRowId;
        } else {
          // Look for an empty row in currentIds that hasn't been assigned yet
          const emptyRowId = updatedIds.find((id) => !newProductsMap[id] && !billRowProducts[id]);
          if (emptyRowId) {
            newProductsMap[emptyRowId] = prodId;
            if (!firstTargetRowId) firstTargetRowId = emptyRowId;
          } else {
            const newId = crypto.randomUUID();
            updatedIds.push(newId);
            newProductsMap[newId] = prodId;
            if (!firstTargetRowId) firstTargetRowId = newId;
          }
        }
      }

      setBillRowProducts((prev) => ({ ...prev, ...newProductsMap }));
      return updatedIds;
    });

    setTimeout(() => {
      if (firstTargetRowId) {
        const el =
          (document.getElementById(`qty-input-${firstTargetRowId}`) as HTMLInputElement | null) ||
          (document.getElementById(`qty-input-m-${firstTargetRowId}`) as HTMLInputElement | null);
        if (el) {
          el.focus();
          el.select?.();
        }
      }
    }, 50);
  };

  const handleProductScanned = (scannedProduct: Row) => {
    handleProductsScanned([scannedProduct]);
  };

  const [barcodeNotFoundCode, setBarcodeNotFoundCode] = useState<string | null>(null);

  useGlobalBarcodeScanner({
    enabled: activeView === "new_bill",
    products: cigaretteProducts,
    onProductsScanned: handleProductsScanned,
    onRestoreQuantity: (rowId, prevVal) => {
      setQuantities((prev) => ({ ...prev, [rowId]: prevVal }));
    },
    onScanNotFound: (rawBarcode) => {
      setBarcodeNotFoundCode(rawBarcode);
    },
  });
  const [billNote, setBillNote] = useState("");
  const [billPaperRef, setBillPaperRef] = useState("");
  const [billWithPayments, setBillWithPayments] = useState(true);
  const [billCashPay, setBillCashPay] = useState("");
  const [billOnlinePay, setBillOnlinePay] = useState("");
  const [billPaymentNote, setBillPaymentNote] = useState("");
  const [billCashAccountId, setBillCashAccountId] = useState("");
  const [billBankAccountId, setBillBankAccountId] = useState("");
  const [billBusy, setBillBusy] = useState(false);
  const [billError, setBillError] = useState("");
  const [billSuccess, setBillSuccess] = useState<{ text: string; billNo?: string; billId?: string } | null>(null);
  const [billDraft, setBillDraft] = useState<{ id?: string; version?: number } | null>(null);
  const [billDraftNotice, setBillDraftNotice] = useState("");
  const [reviewDraftRecord, setReviewDraftRecord] = useState<Row | null>(null);

  // Query retail bill drafts
  const draftsQuery = useQuery({
    queryKey: ["drafts"],
    queryFn: () => api("drafts", rowsSchema),
  });
  const retailBillDrafts = (draftsQuery.data ?? []).filter(
    (d) => (d.data as Row)?.name === "bill",
  );

  // Helper to load draft into retail bill form
  const loadDraftIntoRetailBill = (draftRow: Row) => {
    const data = (draftRow.data ?? {}) as Row;
    const values = (data.values ?? {}) as Row;
    const sId = str(data.salesmanId || values.salesmanId || "");
    if (sId) {
      setBillSalesmanId(sId);
      setSelectedSalesmanId(sId);
    }
    const dDate = str(data.date || values.date || "");
    if (dDate) setBillDate(dDate);

    if (Array.isArray(data.rowIds) && data.rowIds.length > 0) {
      setBillRowIds(data.rowIds.map(String));
    } else if (data.rowProducts && typeof data.rowProducts === "object") {
      const keys = Object.keys(data.rowProducts);
      setBillRowIds(keys.length > 0 ? keys : [crypto.randomUUID()]);
    }
    if (data.rowProducts && typeof data.rowProducts === "object") {
      setBillRowProducts(data.rowProducts as Record<string, string>);
    }
    if (data.quantities && typeof data.quantities === "object") {
      setQuantities(data.quantities as Record<string, string>);
    }
    if (typeof data.hasConfectionery === "boolean") {
      setHasConfectionery(data.hasConfectionery);
    } else if (Array.isArray(data.confectioneryRows) && data.confectioneryRows.length > 0) {
      setHasConfectionery(true);
    } else {
      setHasConfectionery(false);
    }
    if (Array.isArray(data.confectioneryRows)) {
      setConfectioneryRows(data.confectioneryRows as ConfectioneryRowItem[]);
    } else {
      setConfectioneryRows([]);
    }
    setBillDiscount(str(data.discount || (data.values as Row | undefined)?.discount || ""));

    setBillNote(str(data.note || values.note || ""));
    setBillPaperRef(str(data.paperReference || values.paperReference || ""));

    const payment = (data.payment ?? {}) as Row;
    const withPay = data.withPayments !== undefined ? data.withPayments : (payment.withPayments !== undefined ? payment.withPayments : true);
    setBillWithPayments(Boolean(withPay));
    setBillCashPay(str(data.cashPay || payment.cashPay || ""));
    setBillOnlinePay(str(data.onlinePay || payment.onlinePay || ""));
    setBillPaymentNote(str(data.paymentNote || payment.bankRef || ""));
    if (data.cashAccountId || payment.cashId) {
      setBillCashAccountId(str(data.cashAccountId || payment.cashId));
    }
    if (data.bankAccountId || payment.bankId) {
      setBillBankAccountId(str(data.bankAccountId || payment.bankId));
    }

    const vNum = Number(draftRow.version);
    setBillDraft({ id: str(draftRow.id), version: !isNaN(vNum) && vNum > 0 ? vNum : 1 });
    setBillDraftNotice(`Restored draft from ${str(draftRow.created_at)}.`);
    setBillError("");
    setBillSuccess(null);
    setActiveView("new_bill");
  };

  useEffect(() => {
    if (restoreDraftRecord) {
      loadDraftIntoRetailBill(restoreDraftRecord);
      onClearRestoreDraft?.();
    }
  }, [restoreDraftRecord]);

  // --- RECEIVE MONEY STATE ---
  const [receiveSalesmanId, setReceiveSalesmanId] = useState<string>(
    selectedSalesmanId || str(salesmenList[0]?.id ?? "")
  );
  useEffect(() => {
    if (selectedSalesmanId) {
      setReceiveSalesmanId(selectedSalesmanId);
    }
  }, [selectedSalesmanId]);

  const [receivePaymentDate, setReceivePaymentDate] = useState(date);
  const [receiveCashAmount, setReceiveCashAmount] = useState("");
  const [receiveBankAmount, setReceiveBankAmount] = useState("");
  const [receiveCashAccountId, setReceiveCashAccountId] = useState("");
  const [receiveBankAccountId, setReceiveBankAccountId] = useState("");
  const [receiveNote, setReceiveNote] = useState("");
  const [receiveBusy, setReceiveBusy] = useState(false);
  const [receiveError, setReceiveError] = useState("");
  const [receiveSuccess, setReceiveSuccess] = useState("");

  const receiveCashVal = useMemo(() => {
    const c = cleanMoney(receiveCashAmount);
    return c && !isNaN(Number(c)) ? D(c) : D(0);
  }, [receiveCashAmount]);
  const receiveOnlineList = useMemo(() => parseMultiAmounts(receiveBankAmount), [receiveBankAmount]);
  const receiveOnlineVal = useMemo(() => {
    return receiveOnlineList.reduce((acc, curr) => acc.plus(D(curr)), D(0));
  }, [receiveOnlineList]);
  const receiveTotalVal = useMemo(() => receiveCashVal.plus(receiveOnlineVal), [receiveCashVal, receiveOnlineVal]);

  const billPayCashVal = useMemo(() => {
    const c = cleanMoney(billCashPay);
    return c && !isNaN(Number(c)) ? D(c) : D(0);
  }, [billCashPay]);
  const billPayOnlineList = useMemo(() => parseMultiAmounts(billOnlinePay), [billOnlinePay]);
  const billPayOnlineVal = useMemo(() => {
    return billPayOnlineList.reduce((acc, curr) => acc.plus(D(curr)), D(0));
  }, [billPayOnlineList]);
  const billPayTotalVal = useMemo(() => billPayCashVal.plus(billPayOnlineVal), [billPayCashVal, billPayOnlineVal]);

  // --- LEDGER SEARCH STATE ---
  const [ledgerSearch, setLedgerSearch] = useState("");
  const [ledgerFilter, setLedgerFilter] = useState<"all" | "due" | "advance">("all");

  const accounts = arr(masters.accounts);
  const defaultCash = str(accounts.find((a) => a.type === "cash")?.id ?? accounts[0]?.id ?? "");
  const defaultBank = str(accounts.find((a) => a.type === "bank")?.id ?? accounts[0]?.id ?? "");
  const activeBillCashId = billCashAccountId || defaultCash;
  const activeBillBankId = billBankAccountId || defaultBank;
  const activeReceiveCashId = receiveCashAccountId || defaultCash;
  const activeReceiveBankId = receiveBankAccountId || defaultBank;

  // Estimated bill total & subtotals
  const {
    cigSubtotal,
    cigTotalQty,
    confSubtotal,
    confTotalQty,
    grossSubtotal,
    estimatedDiscount,
    estimatedBillTotal,
    estimatedTotalQty,
  } = (() => {
    let sum = 0;
    let qtySum = 0;
    for (const rId of billRowIds) {
      const pId = billRowProducts[rId];
      const rawQ = (quantities[rId] ?? "").trim();
      const qStr = rawQ.startsWith(".") ? "0" + rawQ : rawQ;
      const q = Number(qStr);
      if (!isNaN(q) && q > 0) {
        qtySum += q;
      }
      const prod = arr(masters.products).find((x) => str(x.id) === pId);
      if (!prod || !prod.rate) continue;
      const r = Number(prod.rate);
      const b = Number(prod.basis || 1) || 1;
      if (isNaN(q) || isNaN(r) || q <= 0 || r <= 0) continue;
      sum += (q * r) / b;
    }
    let confSum = 0;
    let confQtySum = 0;
    if (hasConfectionery) {
      for (const cr of confectioneryRows) {
        const rawQ = cr.quantity.trim();
        const qStr = rawQ.startsWith(".") ? "0" + rawQ : rawQ;
        const q = Number(qStr);
        const rawR = cr.rate.trim();
        const rStr = rawR.startsWith(".") ? "0" + rawR : rawR;
        const r = Number(rStr);
        if (!isNaN(q) && q > 0) {
          confQtySum += q;
        }
        if (!isNaN(q) && !isNaN(r) && q > 0 && r > 0) {
          confSum += q * r;
        }
      }
    }
    const totalGross = sum + confSum;
    const cleanDisc = cleanMoney(billDiscount);
    const discNum = cleanDisc ? parseMoneyNumber(cleanDisc) : 0;
    const netSum = Math.max(0, totalGross - (isNaN(discNum) ? 0 : discNum));
    const totalQty = qtySum + confQtySum;
    const fmtQty = (q: number) =>
      Number.isInteger(q) ? String(q) : (Math.round(q * 100) / 100).toFixed(2);

    return {
      cigSubtotal: sum > 0 ? (Math.round(sum * 100) / 100).toFixed(2) : "0.00",
      cigTotalQty: fmtQty(qtySum),
      confSubtotal: confSum > 0 ? (Math.round(confSum * 100) / 100).toFixed(2) : "0.00",
      confTotalQty: fmtQty(confQtySum),
      grossSubtotal: totalGross > 0 ? (Math.round(totalGross * 100) / 100).toFixed(2) : "0.00",
      estimatedDiscount: discNum > 0 ? (Math.round(discNum * 100) / 100).toFixed(2) : "0.00",
      estimatedBillTotal: netSum > 0 ? (Math.round(netSum * 100) / 100).toFixed(2) : "0.00",
      estimatedTotalQty: fmtQty(totalQty),
    };
  })();

  const handleCreateBill = async (e?: React.SyntheticEvent) => {
    e?.preventDefault();
    setBillError("");
    setBillSuccess(null);

    if (!billSalesmanId) {
      setBillError("Please select a salesman.");
      return;
    }

    const lines: Array<{
      productId?: string;
      name?: string;
      code?: string;
      category?: string;
      quantity: string;
      rate?: string;
    }> = [];
    for (const rId of billRowIds) {
      const pId = billRowProducts[rId];
      const rawQ = (quantities[rId] ?? "").trim();
      const qStr = rawQ.startsWith(".") ? "0" + rawQ : rawQ;
      if (pId && Number(qStr) > 0) {
        lines.push({ productId: pId, quantity: qStr, category: "CG-01 CIGARETTE" });
      }
    }
    if (hasConfectionery) {
      for (const cr of confectioneryRows) {
        const rawQ = cr.quantity.trim();
        const qStr = rawQ.startsWith(".") ? "0" + rawQ : rawQ;
        const rawR = cr.rate.trim();
        const rStr = rawR.startsWith(".") ? "0" + rawR : rawR;
        if (Number(qStr) > 0 && Number(rStr) > 0 && (cr.productId || cr.name.trim())) {
          lines.push({
            ...(cr.productId ? { productId: cr.productId } : {}),
            name: cr.name.trim() || undefined,
            code: cr.code.trim() || undefined,
            category: "CF-05 CONFECTIONERY",
            quantity: qStr,
            rate: rStr,
          });
        }
      }
    }

    if (lines.length === 0) {
      setBillError("Please add at least one cigarette or confectionery item with quantity > 0.");
      return;
    }

    const cleanCash = cleanMoney(billCashPay);
    const cleanOnline = cleanMoney(billOnlinePay);
    const hasCash = Boolean(cleanCash && parseMoneyNumber(cleanCash) > 0);
    const hasOnline = Boolean(cleanOnline && parseMoneyNumber(cleanOnline) > 0);
    const shouldRecordPayment = billWithPayments && (hasCash || hasOnline);

    const sObj = salesmenList.find((s) => str(s.id) === billSalesmanId);
    setReviewDraftRecord({
      id: billDraft?.id || "",
      version: billDraft?.version,
      data: {
        name: "bill",
        salesmanId: billSalesmanId,
        salesmanName: sObj ? str(sObj.name) : "",
        date: billDate,
        rowIds: billRowIds,
        rowProducts: billRowProducts,
        quantities,
        hasConfectionery,
        confectioneryRows,
        discount: billDiscount,
        note: billNote,
        paperReference: billPaperRef,
        withPayments: shouldRecordPayment,
        cashPay: billCashPay,
        onlinePay: billOnlinePay,
        paymentNote: billPaymentNote,
        cashAccountId: activeBillCashId,
        bankAccountId: activeBillBankId,
      },
    });
  };

  const handleSaveDraft = async () => {
    setBillBusy(true);
    setBillError("");
    setBillDraftNotice("");
    try {
      const sObj = salesmenList.find((s) => str(s.id) === billSalesmanId);
      const vNum = billDraft?.version != null ? Number(billDraft.version) : undefined;
      const validVersion = vNum && !isNaN(vNum) && vNum > 0 ? vNum : undefined;
      const r = await api("drafts", rowSchema, {
        ...(billDraft?.id ? { id: billDraft.id, version: validVersion } : {}),
        data: {
          name: "bill",
          salesmanId: billSalesmanId,
          salesmanName: sObj ? str(sObj.name) : "",
          date: billDate,
          rowIds: billRowIds,
          rowProducts: billRowProducts,
          quantities,
          hasConfectionery,
          confectioneryRows,
          discount: billDiscount,
          note: billNote,
          paperReference: billPaperRef,
          withPayments: billWithPayments,
          cashPay: billCashPay,
          onlinePay: billOnlinePay,
          paymentNote: billPaymentNote,
          cashAccountId: billCashAccountId,
          bankAccountId: billBankAccountId,
          // Support generic CommandPage shape as well
          values: {
            salesmanId: billSalesmanId,
            salesmanName: sObj ? str(sObj.name) : "",
            date: billDate,
            note: billNote,
            paperReference: billPaperRef,
          },
          payment: {
            withPayments: billWithPayments,
            cashPay: billCashPay,
            onlinePay: billOnlinePay,
            cashId: billCashAccountId,
            bankId: billBankAccountId,
            bankRef: billPaymentNote,
          },
        },
      });
      const resVersion = Number(r.version);
      setBillDraft({ id: str(r.id), version: !isNaN(resVersion) && resVersion > 0 ? resVersion : 1 });
      setBillDraftNotice(`Draft saved successfully at ${new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}.`);
      await qc.invalidateQueries({ queryKey: ["drafts"] });
    } catch (e) {
      setBillError((e as Error).message);
    } finally {
      setBillBusy(false);
    }
  };

  const handleReceiveMoney = async (e: React.FormEvent) => {
    e.preventDefault();
    setReceiveError("");
    setReceiveSuccess("");

    if (!receiveSalesmanId) {
      setReceiveError("Please select a salesman.");
      return;
    }

    const cleanCash = cleanMoney(receiveCashAmount);
    const bankAmounts = parseMultiAmounts(receiveBankAmount);
    const hasCash = Boolean(cleanCash && parseMoneyNumber(cleanCash) > 0);
    const hasBank = bankAmounts.length > 0;
    if (!hasCash && !hasBank) {
      setReceiveError("Enter either a cash amount or at least one bank/online amount (separate multiple with + or /).");
      return;
    }

    setReceiveBusy(true);
    try {
      const receipts: Row[] = [];
      if (hasCash) {
        receipts.push({
          amount: cleanCash,
          accountId: activeReceiveCashId,
          method: "cash",
          actualDate: receivePaymentDate,
          reference: "",
          verified: false,
        });
      }
      if (hasBank) {
        bankAmounts.forEach((amt, idx) => {
          const suffix = bankAmounts.length > 1 ? ` (${idx + 1}/${bankAmounts.length})` : "";
          receipts.push({
            amount: amt,
            accountId: activeReceiveBankId,
            method: "online",
            actualDate: receivePaymentDate,
            reference: (receiveNote ? `${receiveNote}${suffix}` : `Online payment${suffix}`).trim(),
            verified: false,
          });
        });
      }

      await api(
        "commands/receiptBatch",
        commandResult,
        {
          date: receivePaymentDate,
          salesmanId: receiveSalesmanId,
          note: receiveNote,
          receipts,
        },
        "POST",
        crypto.randomUUID()
      );

      setReceiveSuccess("Payment recorded successfully.");
      setReceiveCashAmount("");
      setReceiveBankAmount("");
      setReceiveNote("");
      await qc.invalidateQueries();
    } catch (err) {
      setReceiveError((err as Error).message);
    } finally {
      setReceiveBusy(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {/* 1. Stats Metric Cards */}
      <div
        className="stats"
        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}
      >
        <Metric
          label="Customers Dues"
          value={retailStats.customerDues ?? "0.00"}
          caption={`Overall billed: ${rupees(retailStats.totalBilled ?? "0.00")} · Received: ${rupees(retailStats.totalReceived ?? "0.00")}`}
          accent
        />
        <Metric
          label="Total Products Sold"
          value={retailStats.todayQty ?? "0"}
          caption={`Today: ${retailStats.todayQty ?? "0"} · Overall: ${retailStats.totalQty ?? "0"}`}
          icon={FileText}
          tone="bills"
          isCurrency={false}
        />
        <Metric
          label="Today's Billed"
          value={retailStats.todayBilled ?? "0.00"}
          caption={formatBilledCaption(
            retailStats.todayGrossBilled ?? retailStats.todayBilled,
            retailStats.todayReversed,
            retailStats.todayReturned,
          )}
          tone="bills"
        />
        <Metric
          label="Today's Received"
          value={retailStats.todayReceived ?? "0.00"}
          caption={`Cash: ${rupees(retailStats.todayCashReceived ?? "0.00")} · Online: ${rupees(retailStats.todayOnlineReceived ?? "0.00")}`}
          icon={IndianRupee}
          tone="cash"
        />
      </div>

      {/* 3. Sub-Navigation Tabs */}
      <div className="direct-cig-tabs-line">
        <button
          type="button"
          className={`direct-cig-tab-btn ${activeView === "ledger" ? "active" : ""}`}
          onClick={() => switchView("ledger")}
        >
          <Users size={17} /> Salesmen / Ledger
        </button>
        <button
          type="button"
          className={`direct-cig-tab-btn ${activeView === "new_bill" ? "active" : ""}`}
          onClick={() => switchView("new_bill")}
        >
          <FileText size={17} /> New Bill
        </button>
        <button
          type="button"
          className={`direct-cig-tab-btn ${activeView === "receive_money" ? "active" : ""}`}
          onClick={() => switchView("receive_money")}
        >
          <IndianRupee size={17} /> Receive Money
        </button>
        <button
          type="button"
          className={`direct-cig-tab-btn ${activeView === "register" ? "active" : ""}`}
          onClick={() => switchView("register")}
        >
          <Layers size={17} /> Register
        </button>
        <button
          type="button"
          className={`direct-cig-tab-btn ${activeView === "saved_drafts" ? "active" : ""}`}
          onClick={() => switchView("saved_drafts")}
        >
          <Layers size={17} /> Saved Drafts {retailBillDrafts.length > 0 ? `(${retailBillDrafts.length})` : ""}
        </button>
      </div>

      {billSuccess && (
        <div
          style={{
            background: "#f0fdf4",
            border: "1px solid #86efac",
            borderRadius: 10,
            padding: "12px 16px",
            color: "#166534",
            marginBottom: 16,
            fontWeight: 600,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 8,
            boxShadow: "0 2px 4px rgba(22, 101, 52, 0.08)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <CheckCircle2 size={18} color="#16a34a" />
            <span>{billSuccess.text}</span>
            {billSuccess.billId ? (
              <button
                type="button"
                onClick={() => onSelect(billSuccess.billId!)}
                style={{
                  background: "#16a34a",
                  color: "#ffffff",
                  border: "none",
                  borderRadius: 6,
                  padding: "4px 12px",
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  transition: "background 0.15s ease",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "#15803d")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "#16a34a")}
                title="Click to view and print this bill"
              >
                <span>{billSuccess.billNo || "View Bill"}</span>
                <ExternalLink size={13} />
              </button>
            ) : (
              <strong style={{ color: "#166534" }}>{billSuccess.billNo}</strong>
            )}
          </div>
          <button
            type="button"
            onClick={() => setBillSuccess(null)}
            style={{ background: "none", border: "none", color: "#166534", cursor: "pointer", padding: "0 4px", fontSize: 16, lineHeight: 1 }}
            aria-label="Dismiss success message"
          >
            ✕
          </button>
        </div>
      )}

      {/* VIEW 1: SALESMEN LEDGER TABLE */}
      {activeView === "ledger" && (
        <section className="panel" style={{ padding: "16px 18px" }}>
          {addSalesmanOpen && (
            <div style={{ marginBottom: 20 }}>
              <MasterForm
                kind="salesmen"
                date={date}
                onDone={() => setAddSalesmanOpen(false)}
              />
            </div>
          )}

          <div className="direct-cig-ledger-header">
            <div>
              <h2 style={{ margin: 0, fontSize: 18 }}>Salesmen Dues & Ledger</h2>
              <p className="muted" style={{ margin: "4px 0 0", fontSize: 12 }}>
                Retail cigarette salesmen personally owe for billed stock. Tap any row to view statement.
              </p>
            </div>
            <div className="direct-cig-search-wrap">
              <input
                type="search"
                className="direct-cig-search-input"
                placeholder="Search salesman name or code…"
                value={ledgerSearch}
                onChange={(e) => setLedgerSearch(e.target.value)}
              />
              <div style={{ display: "inline-flex", gap: 4 }}>
                <Button
                  className={ledgerFilter === "all" ? "primary" : "secondary"}
                  onClick={() => setLedgerFilter("all")}
                  style={{ padding: "6px 12px", minHeight: 38, fontSize: 12 }}
                >
                  All
                </Button>
                <Button
                  className={ledgerFilter === "due" ? "primary" : "secondary"}
                  onClick={() => setLedgerFilter("due")}
                  style={{ padding: "6px 12px", minHeight: 38, fontSize: 12 }}
                >
                  Still to receive
                </Button>
                <Button
                  className={ledgerFilter === "advance" ? "primary" : "secondary"}
                  onClick={() => setLedgerFilter("advance")}
                  style={{ padding: "6px 12px", minHeight: 38, fontSize: 12 }}
                >
                  Advances
                </Button>
              </div>
            </div>
          </div>

          {(() => {
            const people = dashboard ? arr(dashboard.people) : arr(masters.salesmen);
            const visibleSalesmen = people
              .filter(
                (p) =>
                  !excludeSalesmanId || str(p.id) !== excludeSalesmanId
              )
              .filter((p) =>
                (str(p.name) + " " + str(p.code))
                  .toLowerCase()
                  .includes(ledgerSearch.toLowerCase())
              )
              .filter((p) => {
                const bal = str(p.balance ?? "0.00");
                if (ledgerFilter === "advance") return bal.startsWith("-");
                if (ledgerFilter === "due") return !bal.startsWith("-") && bal !== "0.00";
                return true;
              })
              .sort((a, b) => {
                const balA = parseFloat(str(a.balance ?? "0"));
                const balB = parseFloat(str(b.balance ?? "0"));
                return balB - balA; // Highest outstanding dues first
              });

            if (visibleSalesmen.length === 0) {
              return (
                <div style={{ padding: 30, textAlign: "center", color: "#64748b" }}>
                  <p>No salesmen match your search filter.</p>
                </div>
              );
            }

            return (
              <>
                {/* Desktop Table View */}
                <div className="direct-cig-table-desktop">
                  <div className="table-scroll">
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                      <thead>
                        <tr style={{ background: "#f8fafc", textAlign: "left", borderBottom: "2px solid #e2e8f0" }}>
                          <th style={{ padding: "10px 12px", fontSize: 12, fontWeight: 600, color: "#64748b" }}>SALESMAN CODE</th>
                          <th style={{ padding: "10px 12px", fontSize: 12, fontWeight: 600, color: "#64748b" }}>SALESMAN NAME</th>
                          <th style={{ padding: "10px 12px", fontSize: 12, fontWeight: 600, color: "#64748b", textAlign: "right" }}>OUTSTANDING DUE</th>
                          <th style={{ padding: "10px 12px", fontSize: 12, fontWeight: 600, color: "#64748b", textAlign: "center", minWidth: 240 }}>ACTIONS</th>
                        </tr>
                      </thead>
                      <tbody>
                        {visibleSalesmen.map((s) => {
                          const balStr = str(s.balance ?? "0.00");
                          const balNum = parseFloat(balStr);
                          const isAdvance = balStr.startsWith("-");
                          const hasDue = balNum > 0;

                          return (
                            <tr
                              key={str(s.id)}
                              style={{
                                borderBottom: "1px solid #f1f5f9",
                                cursor: "pointer",
                                background: "#ffffff",
                              }}
                              onClick={() => onStatement(str(s.id))}
                            >
                              <td style={{ padding: "10px 12px", fontFamily: "monospace", fontSize: 12, color: "#64748b" }}>
                                {str(s.code)}
                              </td>
                              <td style={{ padding: "10px 12px", fontWeight: 600, color: "#1e293b" }}>
                                {str(s.name)}
                              </td>
                              <td
                                style={{
                                  padding: "10px 12px",
                                  textAlign: "right",
                                  fontWeight: 700,
                                  fontSize: 14,
                                  color: isAdvance ? "#16a34a" : hasDue ? "#dc2626" : "#475569",
                                }}
                              >
                                {isAdvance ? `(Advance) ${rupees(s.balance)}` : rupees(s.balance)}
                              </td>
                              <td style={{ padding: "10px 12px", textAlign: "center" }}>
                                <div style={{ display: "inline-flex", gap: 6, alignItems: "center" }} onClick={(e) => e.stopPropagation()}>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setBillSalesmanId(str(s.id));
                                      setSelectedSalesmanId(str(s.id));
                                      setActiveView("new_bill");
                                    }}
                                    title={`Create new bill for ${str(s.name)}`}
                                    style={{
                                      background: "#f8fafc",
                                      border: "1px solid #cbd5e1",
                                      padding: "4px 8px",
                                      borderRadius: 6,
                                      fontSize: 11,
                                      fontWeight: 600,
                                      cursor: "pointer",
                                      color: "#0f172a",
                                      display: "inline-flex",
                                      alignItems: "center",
                                      gap: 3,
                                    }}
                                  >
                                    <Plus size={12} /> Bill
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setReceiveSalesmanId(str(s.id));
                                      setSelectedSalesmanId(str(s.id));
                                      setActiveView("receive_money");
                                    }}
                                    title={`Receive money from ${str(s.name)}`}
                                    style={{
                                      background: "#f8fafc",
                                      border: "1px solid #cbd5e1",
                                      padding: "4px 8px",
                                      borderRadius: 6,
                                      fontSize: 11,
                                      fontWeight: 600,
                                      cursor: "pointer",
                                      color: "#0f172a",
                                      display: "inline-flex",
                                      alignItems: "center",
                                      gap: 3,
                                    }}
                                  >
                                    <IndianRupee size={12} /> Receive
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => onStatement(str(s.id))}
                                    title={`View passbook statement for ${str(s.name)}`}
                                    style={{
                                      background: "#f8fafc",
                                      border: "1px solid #cbd5e1",
                                      padding: "4px 8px",
                                      borderRadius: 6,
                                      fontSize: 11,
                                      fontWeight: 600,
                                      cursor: "pointer",
                                      color: "#0f172a",
                                    }}
                                  >
                                    Statement →
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Mobile Cards View */}
                <div className="direct-cig-cards-mobile">
                  {visibleSalesmen.map((s) => {
                    const balStr = str(s.balance ?? "0.00");
                    const balNum = parseFloat(balStr);
                    const isAdvance = balStr.startsWith("-");
                    const hasDue = balNum > 0;

                    return (
                      <div
                        key={str(s.id)}
                        className="customer-mobile-card"
                        onClick={() => onStatement(str(s.id))}
                      >
                        <div className="customer-card-header">
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div className="customer-card-name">{str(s.name)}</div>
                            <div className="customer-card-code">Code: {str(s.code)}</div>
                          </div>
                          <span
                            className="customer-card-beat"
                            style={{
                              background: s.active ? "#f0fdf4" : "#f1f5f9",
                              color: s.active ? "#16a34a" : "#64748b",
                            }}
                          >
                            {s.active ? "Active" : "Inactive"}
                          </span>
                        </div>

                        <div style={{ margin: "8px 0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <span style={{ fontSize: 12, color: "#64748b", fontWeight: 600 }}>
                            {isAdvance ? "Advance Balance" : "Outstanding Due"}
                          </span>
                          <span
                            style={{
                              fontSize: 15,
                              fontWeight: 700,
                              color: isAdvance ? "#16a34a" : hasDue ? "#dc2626" : "#475569",
                            }}
                          >
                            {rupees(s.balance)}
                          </span>
                        </div>

                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            gap: 6,
                            paddingTop: 8,
                            borderTop: "1px solid #f1f5f9",
                            marginTop: 4,
                          }}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div style={{ display: "flex", gap: 6 }}>
                            <button
                              type="button"
                              onClick={() => {
                                setBillSalesmanId(str(s.id));
                                setSelectedSalesmanId(str(s.id));
                                setActiveView("new_bill");
                              }}
                              style={{
                                background: "#f8fafc",
                                border: "1px solid #cbd5e1",
                                padding: "5px 10px",
                                borderRadius: 6,
                                fontSize: 11,
                                fontWeight: 600,
                                color: "#0f172a",
                                cursor: "pointer",
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 4,
                              }}
                            >
                              <Plus size={12} /> Bill
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setReceiveSalesmanId(str(s.id));
                                setSelectedSalesmanId(str(s.id));
                                setActiveView("receive_money");
                              }}
                              style={{
                                background: "#f8fafc",
                                border: "1px solid #cbd5e1",
                                padding: "5px 10px",
                                borderRadius: 6,
                                fontSize: 11,
                                fontWeight: 600,
                                color: "#0f172a",
                                cursor: "pointer",
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 4,
                              }}
                            >
                              <IndianRupee size={12} /> Receive
                            </button>
                          </div>
                          <button
                            type="button"
                            onClick={() => onStatement(str(s.id))}
                            style={{
                              background: "none",
                              border: "none",
                              fontSize: 12,
                              fontWeight: 700,
                              color: "#64748b",
                              cursor: "pointer",
                              padding: "4px",
                            }}
                          >
                            Statement →
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            );
          })()}
        </section>
      )}

      {/* VIEW 2: NEW BILL */}
      {activeView === "new_bill" && (
        <section
          style={{
            background: "#ffffff",
            border: "1px solid #e2e8f0",
            borderRadius: 16,
            padding: "20px 18px",
            boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-start",
              flexWrap: "wrap",
              gap: 12,
              marginBottom: 16,
            }}
          >
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span
                  style={{
                    background: "#ffedd5",
                    color: "#c2410c",
                    padding: "4px 8px",
                    borderRadius: 6,
                    fontSize: 11,
                    fontWeight: 700,
                  }}
                >
                  INVOICE ENTRY
                </span>
                <h2 style={{ margin: 0, fontSize: 19, color: "#0f172a" }}>
                  Create New Bill for Salesman
                </h2>
              </div>
              <p className="muted" style={{ margin: "6px 0 0", fontSize: 12 }}>
                Products billed here are personally owed by the salesman to the business.
              </p>
            </div>
            {retailBillDrafts.length > 0 && (
              <Button
                className="secondary"
                type="button"
                onClick={() => switchView("saved_drafts")}
                style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}
              >
                Saved Drafts ({retailBillDrafts.length})
              </Button>
            )}
          </div>

          {billDraftNotice && (
            <div style={{ background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 10, padding: "10px 14px", color: "#1e40af", marginBottom: 14, fontSize: 13, fontWeight: 500, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span>{billDraftNotice}</span>
              <button
                type="button"
                onClick={() => {
                  setBillDraft(null);
                  setBillDraftNotice("");
                }}
                style={{ background: "none", border: "none", color: "#6b7280", cursor: "pointer", fontSize: 12, fontWeight: 600 }}
              >
                Clear draft association
              </button>
            </div>
          )}

          {billError && (
            <div role="alert" className="error" style={{ marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span>{billError}</span>
              <button
                type="button"
                onClick={() => setBillError("")}
                style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", padding: "0 4px", fontSize: 16, lineHeight: 1 }}
                aria-label="Dismiss error"
              >
                ✕
              </button>
            </div>
          )}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              // Accidental form submissions (e.g. from Enter keys) must NEVER post a live financial bill!
              // At most, save as draft so no financial ledger mutation occurs.
              handleSaveDraft();
            }}
            onKeyDown={(e) => {
              if ((e.key === "Enter" || e.keyCode === 13) && (e.target as HTMLElement)?.tagName !== "TEXTAREA") {
                // Prevent accidental submission when scanning or pressing Enter
                e.preventDefault();
              }
            }}
            style={{ display: "flex", flexDirection: "column", gap: 18 }}
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(220px, 3fr) minmax(130px, 1.2fr) minmax(240px, 4fr)",
                gap: 14,
                alignItems: "start",
                background: "#f8fafc",
                padding: "16px 16px",
                borderRadius: 12,
                border: "1px solid #e2e8f0",
              }}
              className="form-grid-mobile"
            >
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#334155", marginBottom: 6 }}>
                  SALESMAN (DEBTOR) *
                </label>
                <select
                  value={billSalesmanId}
                  onChange={(e) => setBillSalesmanId(e.target.value)}
                  required
                  style={{ width: "100%", padding: "9px 12px", borderRadius: 8, border: "1px solid #cbd5e1", fontSize: 14 }}
                >
                  <option value="">Select salesman…</option>
                  {salesmenList.map((s) => (
                    <option key={str(s.id)} value={str(s.id)}>
                      {str(s.name)} ({str(s.code)})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#334155", marginBottom: 6 }}>
                  BILL DATE *
                </label>
                <input
                  type="date"
                  value={billDate}
                  onChange={(e) => setBillDate(e.target.value)}
                  required
                  style={{ width: "100%", padding: "9px 10px", borderRadius: 8, border: "1px solid #cbd5e1", fontSize: 13, background: "#ffffff", fontWeight: 500 }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#334155", marginBottom: 6 }}>
                  BILL NOTES / REMARKS (OPTIONAL)
                </label>
                <input
                  type="text"
                  placeholder="e.g. Special order remarks, delivery note…"
                  value={billNote}
                  onChange={(e) => setBillNote(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "9px 12px",
                    borderRadius: 8,
                    border: "1px solid #cbd5e1",
                    fontSize: 13,
                    background: "#ffffff",
                  }}
                />
              </div>
            </div>

            {/* Barcode / Quick Code Scanner Input */}
            <BarcodeScannerInput
              products={cigaretteProducts}
              onProductsScanned={handleProductsScanned}
              externalNotFoundCode={barcodeNotFoundCode}
              onClearNotFound={() => setBarcodeNotFoundCode(null)}
              autoFocus={true}
            />

            {/* Bill Lines Desktop Table */}
            <div className="bill-lines-desktop" style={{ border: "1px solid #e2e8f0", borderRadius: 12, overflow: "visible" }}>
              <div className="table-scroll" style={{ overflow: "visible" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ background: "#f8fafc", textAlign: "left", borderBottom: "1px solid #e2e8f0" }}>
                      <th style={{ width: 40, textAlign: "center", fontSize: 12, color: "#64748b" }}>#</th>
                      <th style={{ width: 150, padding: "10px 12px", fontSize: 12, color: "#64748b" }}>PRODUCT ID</th>
                      <th style={{ minWidth: 280, padding: "10px 12px", fontSize: 12, color: "#64748b" }}>PRODUCT NAME</th>
                      <th style={{ width: 130, padding: "10px 12px", fontSize: 12, color: "#64748b" }}>QUANTITY</th>
                      <th style={{ width: 130, padding: "10px 12px", fontSize: 12, color: "#64748b" }}>RATE</th>
                      <th style={{ width: 140, textAlign: "right", padding: "10px 16px", fontSize: 12, color: "#64748b" }}>AMOUNT</th>
                      <th style={{ width: 50, textAlign: "center" }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {billRowIds.map((rowId, index) => {
                      const productId = billRowProducts[rowId] ?? "";
                      const p = cigaretteProducts.find((x) => str(x.id) === productId);
                      const quantity = quantities[rowId] ?? "";
                      const normQty = quantity.trim().startsWith(".") ? "0" + quantity.trim() : quantity.trim();
                      const lineAmount = (() => {
                        if (!p || !p.rate) return null;
                        const qNum = Number(normQty);
                        const rNum = Number(p.rate);
                        if (isNaN(qNum) || isNaN(rNum) || qNum <= 0 || rNum <= 0) return null;
                        const basisNum = Number(p.basis || 1) || 1;
                        return (Math.round((qNum * rNum / basisNum) * 100) / 100).toFixed(2);
                      })();
                      const disabledProductIds = [
                        ...billRowIds.filter((id) => id !== rowId && billRowProducts[id]).map((id) => billRowProducts[id]),
                        ...confectioneryRows.map((r) => r.productId).filter(Boolean),
                      ];

                      return (
                        <tr key={rowId} style={{ borderBottom: "1px solid #f1f5f9", background: index % 2 === 0 ? "#ffffff" : "#fafafa" }}>
                          <td style={{ textAlign: "center", color: "#94a3b8", fontSize: 13, fontWeight: 500 }}>
                            {index + 1}
                          </td>
                          <td style={{ padding: "8px 12px" }}>
                            <ProductIdSearchableSelect
                              products={cigaretteProducts}
                              selectedId={productId}
                              disabledIds={disabledProductIds}
                              onSelect={(selectedProdId) => {
                                setBillRowProducts((prev) => ({ ...prev, [rowId]: selectedProdId }));
                              }}
                            />
                          </td>
                          <td style={{ padding: "8px 12px" }}>
                            <ProductSearchableSelect
                              products={cigaretteProducts}
                              selectedId={productId}
                              disabledIds={disabledProductIds}
                              onSelect={(selectedProdId) => {
                                setBillRowProducts((prev) => ({ ...prev, [rowId]: selectedProdId }));
                              }}
                            />
                          </td>
                          <td style={{ padding: "8px 12px" }}>
                            <input
                              id={`qty-input-${rowId}`}
                              type="text"
                              inputMode="decimal"
                              placeholder="0"
                              value={quantity}
                              onChange={(e) => setQuantities((prev) => ({ ...prev, [rowId]: e.target.value }))}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.keyCode === 13) {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  // Jump back to scanner or next row
                                  const scanInput = document.querySelector('input[placeholder*="Scan barcode"]') as HTMLInputElement;
                                  if (scanInput) scanInput.focus();
                                }
                              }}
                              style={{ width: "100%", padding: "7px 10px", borderRadius: 8, border: "1px solid #cbd5e1", fontSize: 13 }}
                            />
                          </td>
                          <td style={{ padding: "8px 12px", fontSize: 13, color: "#64748b" }}>
                            {p?.rate ? rupees(p.rate) : "—"}
                          </td>
                          <td style={{ padding: "8px 16px", textAlign: "right", fontWeight: 700, fontSize: 14, color: "#0f172a" }}>
                            {lineAmount ? rupees(lineAmount) : "—"}
                          </td>
                          <td style={{ textAlign: "center" }}>
                            {billRowIds.length > 1 && (
                              <button
                                type="button"
                                onClick={() => {
                                  setBillRowIds((prev) => prev.filter((id) => id !== rowId));
                                  setBillRowProducts((prev) => {
                                    const next = { ...prev };
                                    delete next[rowId];
                                    return next;
                                  });
                                  setQuantities((prev) => {
                                    const next = { ...prev };
                                    delete next[rowId];
                                    return next;
                                  });
                                }}
                                style={{ background: "none", border: "none", color: "#dc2626", cursor: "pointer", padding: 4 }}
                                title="Delete row"
                              >
                                <Trash2 size={16} />
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div style={{ padding: "14px 20px", background: "#f8fafc", display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid #e2e8f0" }}>
                <Button
                  className="secondary"
                  type="button"
                  onClick={() => setBillRowIds((prev) => [...prev, crypto.randomUUID()])}
                  style={{ display: "flex", alignItems: "center", gap: 6 }}
                >
                  <Plus size={16} /> Add Product Line
                </Button>
                <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, paddingRight: 16, borderRight: "1px solid #cbd5e1" }}>
                    <span style={{ fontSize: 13, color: "#64748b", fontWeight: 500 }}>Cigarettes Qty:</span>
                    <strong style={{ fontSize: 16, color: "#0f172a" }}>{cigTotalQty} units</strong>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 13, color: "#64748b", fontWeight: 500 }}>Cigarettes Subtotal:</span>
                    <strong style={{ fontSize: 18, color: "#0f172a" }}>{rupees(cigSubtotal)}</strong>
                  </div>
                </div>
              </div>
            </div>

            {/* Bill Lines: Mobile */}
            <div className="bill-lines-mobile">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: "#475569", textTransform: "uppercase" }}>
                  Items ({billRowIds.length})
                </span>
              </div>

              {billRowIds.map((rowId, index) => {
                const productId = billRowProducts[rowId] ?? "";
                const p = cigaretteProducts.find((x) => str(x.id) === productId);
                const quantity = quantities[rowId] ?? "";
                const normQty = quantity.trim().startsWith(".") ? "0" + quantity.trim() : quantity.trim();
                const lineAmount = (() => {
                  if (!p || !p.rate) return null;
                  const qNum = Number(normQty);
                  const rNum = Number(p.rate);
                  if (isNaN(qNum) || isNaN(rNum) || qNum <= 0 || rNum <= 0) return null;
                  const basisNum = Number(p.basis || 1) || 1;
                  return (Math.round((qNum * rNum / basisNum) * 100) / 100).toFixed(2);
                })();
                const disabledProductIds = [
                  ...billRowIds.filter((id) => id !== rowId && billRowProducts[id]).map((id) => billRowProducts[id]),
                  ...confectioneryRows.map((r) => r.productId).filter(Boolean),
                ];

                return (
                  <div key={rowId} className={`bill-line-card-mobile ${p ? "active-line" : ""}`}>
                    <div className="bill-line-card-header">
                      <span style={{ fontSize: 12, fontWeight: 700, color: "#64748b" }}>
                        ITEM #{index + 1}
                      </span>
                      {billRowIds.length > 1 && (
                        <button
                          type="button"
                          onClick={() => {
                            setBillRowIds((prev) => prev.filter((id) => id !== rowId));
                            setBillRowProducts((prev) => {
                              const next = { ...prev };
                              delete next[rowId];
                              return next;
                            });
                            setQuantities((prev) => {
                              const next = { ...prev };
                              delete next[rowId];
                              return next;
                            });
                          }}
                          style={{ background: "none", border: "none", color: "#dc2626", cursor: "pointer", padding: "4px 8px" }}
                        >
                          Remove
                        </button>
                      )}
                    </div>

                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      <ProductSearchableSelect
                        products={cigaretteProducts}
                        selectedId={productId}
                        disabledIds={disabledProductIds}
                        onSelect={(selectedProdId) => {
                          setBillRowProducts((prev) => ({ ...prev, [rowId]: selectedProdId }));
                        }}
                      />

                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                        <div>
                          <label style={{ display: "block", fontSize: 11, color: "#64748b", marginBottom: 4 }}>Quantity:</label>
                          <input
                            id={`qty-input-m-${rowId}`}
                            type="text"
                            inputMode="decimal"
                            placeholder="0"
                            value={quantity}
                            onChange={(e) => setQuantities((prev) => ({ ...prev, [rowId]: e.target.value }))}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.keyCode === 13) {
                                e.preventDefault();
                                e.stopPropagation();
                                const scanInput = document.querySelector('input[placeholder*="Scan barcode"]') as HTMLInputElement;
                                if (scanInput) scanInput.focus();
                              }
                            }}
                            style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid #cbd5e1", fontSize: 14 }}
                          />
                        </div>
                        <div>
                          <label style={{ display: "block", fontSize: 11, color: "#64748b", marginBottom: 4 }}>Rate:</label>
                          <div style={{ padding: "8px 10px", background: "#f8fafc", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 13, color: "#64748b" }}>
                            {p?.rate ? rupees(p.rate) : "—"}
                          </div>
                        </div>
                      </div>

                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "#f8fafc", padding: "8px 12px", borderRadius: 8, border: "1px solid #e2e8f0" }}>
                        <span style={{ fontSize: 12, color: "#64748b" }}>Line Subtotal:</span>
                        <strong style={{ fontSize: 15, color: lineAmount ? "#0f172a" : "#94a3b8" }}>
                          {lineAmount ? rupees(lineAmount) : "₹0.00"}
                        </strong>
                      </div>
                    </div>
                  </div>
                );
              })}

              <Button
                className="secondary full"
                type="button"
                onClick={() => setBillRowIds((prev) => [...prev, crypto.randomUUID()])}
                style={{ minHeight: 44, marginTop: 4, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
              >
                <Plus size={16} /> Add Another Product Line
              </Button>

              <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 12, padding: "12px 16px", marginTop: 14, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <span style={{ fontSize: 12, fontWeight: 500, color: "#64748b" }}>Cigarettes Qty: </span>
                  <strong style={{ fontSize: 15, color: "#0f172a" }}>{cigTotalQty} units</strong>
                </div>
                <div>
                  <span style={{ fontSize: 12, fontWeight: 500, color: "#64748b" }}>Cigarettes Subtotal: </span>
                  <strong style={{ fontSize: 16, color: "#0f172a" }}>{rupees(cigSubtotal)}</strong>
                </div>
              </div>
            </div>

            {/* Confectionery Items Section */}
            <div
              style={{
                border: "1px solid",
                borderColor: hasConfectionery ? "#fed7aa" : "#e2e8f0",
                borderRadius: 12,
                padding: "14px 16px",
                background: hasConfectionery ? "#fffbeb" : "#f8fafc",
                transition: "background 0.15s ease, border-color 0.15s ease",
              }}
            >
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  fontSize: 13,
                  fontWeight: 650,
                  color: hasConfectionery ? "#9a3412" : "#334155",
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={hasConfectionery}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setHasConfectionery(checked);
                    if (checked && confectioneryRows.length === 0) {
                      setConfectioneryRows([
                        { rowId: crypto.randomUUID(), productId: "", code: "", name: "", quantity: "", rate: "", isManual: false },
                      ]);
                    }
                  }}
                  style={{ width: 17, height: 17, accentColor: "#ea580c", cursor: "pointer" }}
                />
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <span>🍬</span> Also include confectionery items with this entry
                </span>
              </label>

              {hasConfectionery && (
                <div style={{ marginTop: 14 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
                    <div>
                      <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "#9a3412" }}>
                        Confectionery Items
                      </h3>
                      <p style={{ margin: "2px 0 0", fontSize: 11, color: "#b45309" }}>
                        Chocolates, candies, mints, biscuits billed along with cigarettes.
                      </p>
                    </div>
                    <Button
                      className="secondary"
                      type="button"
                      onClick={() => {
                        setConfectioneryRows((prev) => [
                          ...prev,
                          { rowId: crypto.randomUUID(), productId: "", code: "", name: "", quantity: "", rate: "", isManual: false },
                        ]);
                      }}
                      style={{ fontSize: 12, padding: "5px 12px", background: "#ffffff", borderColor: "#fcd34d", color: "#9a3412", display: "flex", alignItems: "center", gap: 4 }}
                    >
                      <Plus size={14} /> Add Confectionery Item
                    </Button>
                  </div>

                  {confectioneryRows.length === 0 ? (
                    <div style={{ textAlign: "center", padding: "16px", color: "#b45309", fontSize: 12, background: "rgba(255,255,255,0.6)", borderRadius: 8, border: "1px dashed #fde68a" }}>
                      No confectionery items added. Click <b>+ Add Confectionery Item</b> if this bill includes chocolates, candies or snacks.
                    </div>
                  ) : (
                    <>
                      {/* Desktop Confectionery Table */}
                      <div className="bill-lines-desktop" style={{ background: "#ffffff", border: "1px solid #fde68a", borderRadius: 10, overflow: "visible" }}>
                        <table style={{ width: "100%", borderCollapse: "collapse" }}>
                          <thead>
                            <tr style={{ background: "#fef3c7", textAlign: "left", borderBottom: "1px solid #fde68a" }}>
                              <th style={{ width: 40, textAlign: "center", fontSize: 12, color: "#92400e" }}>#</th>
                              <th style={{ width: 130, padding: "8px 10px", fontSize: 12, color: "#92400e" }}>ID</th>
                              <th style={{ minWidth: 260, padding: "8px 10px", fontSize: 12, color: "#92400e" }}>NAME</th>
                              <th style={{ width: 120, padding: "8px 10px", fontSize: 12, color: "#92400e" }}>QUANTITY</th>
                              <th style={{ width: 130, padding: "8px 10px", fontSize: 12, color: "#92400e" }}>RATE / PIECE</th>
                              <th style={{ width: 130, textAlign: "right", padding: "8px 14px", fontSize: 12, color: "#92400e" }}>AMOUNT</th>
                              <th style={{ width: 44, textAlign: "center" }}></th>
                            </tr>
                          </thead>
                          <tbody>
                            {confectioneryRows.map((row, idx) => {
                              const qNum = Number(row.quantity.trim().startsWith(".") ? "0" + row.quantity.trim() : row.quantity.trim());
                              const rNum = Number(row.rate.trim().startsWith(".") ? "0" + row.rate.trim() : row.rate.trim());
                              const lineAmount = (!isNaN(qNum) && !isNaN(rNum) && qNum > 0 && rNum > 0)
                                ? (Math.round(qNum * rNum * 100) / 100).toFixed(2)
                                : null;
                              const disabledConfIds = [
                                ...confectioneryRows.filter((r) => r.rowId !== row.rowId && r.productId).map((r) => r.productId),
                                ...Object.values(billRowProducts).filter(Boolean),
                              ];

                              return (
                                <tr key={row.rowId} style={{ borderBottom: "1px solid #fef3c7" }}>
                                  <td style={{ textAlign: "center", color: "#b45309", fontSize: 12, fontWeight: 600 }}>
                                    {idx + 1}
                                  </td>
                                  <td style={{ padding: "6px 10px" }}>
                                    <input
                                      type="text"
                                      placeholder="e.g. CONF-01"
                                      value={row.code}
                                      onChange={(e) => {
                                        const val = e.target.value;
                                        setConfectioneryRows((prev) =>
                                          prev.map((r) => (r.rowId === row.rowId ? { ...r, code: val } : r))
                                        );
                                      }}
                                      style={{ width: "100%", padding: "6px 8px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 12, fontFamily: "monospace" }}
                                    />
                                  </td>
                                  <td style={{ padding: "6px 10px" }}>
                                    <ConfectionerySearchableSelect
                                      products={confectioneryProducts}
                                      selectedId={row.productId}
                                      selectedName={row.name}
                                      disabledIds={disabledConfIds}
                                      onSelectMaster={(p) => {
                                        setConfectioneryRows((prev) =>
                                          prev.map((r) =>
                                            r.rowId === row.rowId
                                              ? {
                                                ...r,
                                                productId: str(p.id),
                                                code: str(p.code),
                                                name: str(p.name),
                                                rate: str(p.rate || "0.00"),
                                                isManual: false,
                                              }
                                              : r
                                          )
                                        );
                                      }}
                                      onSelectManual={(customName) => {
                                        setConfectioneryRows((prev) =>
                                          prev.map((r) =>
                                            r.rowId === row.rowId
                                              ? {
                                                ...r,
                                                productId: "",
                                                code: r.code || "MANUAL",
                                                name: customName,
                                                isManual: true,
                                              }
                                              : r
                                          )
                                        );
                                      }}
                                    />
                                  </td>
                                  <td style={{ padding: "6px 10px" }}>
                                    <input
                                      type="text"
                                      inputMode="decimal"
                                      placeholder="0"
                                      value={row.quantity}
                                      onChange={(e) => {
                                        const val = e.target.value;
                                        setConfectioneryRows((prev) =>
                                          prev.map((r) => (r.rowId === row.rowId ? { ...r, quantity: val } : r))
                                        );
                                      }}
                                      style={{ width: "100%", padding: "6px 8px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 13 }}
                                    />
                                  </td>
                                  <td style={{ padding: "6px 10px" }}>
                                    <input
                                      type="text"
                                      inputMode="decimal"
                                      placeholder="0.00"
                                      value={row.rate}
                                      onChange={(e) => {
                                        const val = e.target.value;
                                        setConfectioneryRows((prev) =>
                                          prev.map((r) => (r.rowId === row.rowId ? { ...r, rate: val } : r))
                                        );
                                      }}
                                      style={{ width: "100%", padding: "6px 8px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 13, fontWeight: 600 }}
                                    />
                                  </td>
                                  <td style={{ padding: "6px 14px", textAlign: "right", fontWeight: 700, fontSize: 13, color: "#0f172a" }}>
                                    {lineAmount ? rupees(lineAmount) : "—"}
                                  </td>
                                  <td style={{ textAlign: "center" }}>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setConfectioneryRows((prev) => prev.filter((r) => r.rowId !== row.rowId));
                                      }}
                                      style={{ background: "none", border: "none", color: "#dc2626", cursor: "pointer", padding: 4 }}
                                      title="Remove confectionery line"
                                    >
                                      <Trash2 size={15} />
                                    </button>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                        <div style={{ padding: "12px 18px", background: "#fef9c3", display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid #fde68a" }}>
                          <span style={{ fontSize: 12, color: "#92400e", fontWeight: 600 }}>Confectionery Lines ({confectioneryRows.length})</span>
                          <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8, paddingRight: 16, borderRight: "1px solid #fcd34d" }}>
                              <span style={{ fontSize: 13, color: "#92400e", fontWeight: 500 }}>Confectionery Qty:</span>
                              <strong style={{ fontSize: 16, color: "#78350f" }}>{confTotalQty} pcs</strong>
                            </div>
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <span style={{ fontSize: 13, color: "#92400e", fontWeight: 500 }}>Confectionery Subtotal:</span>
                              <strong style={{ fontSize: 18, color: "#78350f" }}>{rupees(confSubtotal)}</strong>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Mobile Confectionery Cards */}
                      <div className="bill-lines-mobile" style={{ marginTop: 10 }}>
                        {confectioneryRows.map((row, idx) => {
                          const qNum = Number(row.quantity.trim().startsWith(".") ? "0" + row.quantity.trim() : row.quantity.trim());
                          const rNum = Number(row.rate.trim().startsWith(".") ? "0" + row.rate.trim() : row.rate.trim());
                          const lineAmount = (!isNaN(qNum) && !isNaN(rNum) && qNum > 0 && rNum > 0)
                            ? (Math.round(qNum * rNum * 100) / 100).toFixed(2)
                            : null;
                          const disabledConfIds = [
                            ...confectioneryRows.filter((r) => r.rowId !== row.rowId && r.productId).map((r) => r.productId),
                            ...Object.values(billRowProducts).filter(Boolean),
                          ];

                          return (
                            <div key={row.rowId} style={{ background: "#ffffff", border: "1px solid #fde68a", borderRadius: 10, padding: 12, marginBottom: 8 }}>
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                                <span style={{ fontSize: 12, fontWeight: 700, color: "#92400e" }}>CONFECTIONERY #{idx + 1}</span>
                                <button
                                  type="button"
                                  onClick={() => setConfectioneryRows((prev) => prev.filter((r) => r.rowId !== row.rowId))}
                                  style={{ background: "none", border: "none", color: "#dc2626", cursor: "pointer", fontSize: 12 }}
                                >
                                  Remove
                                </button>
                              </div>
                              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                                <ConfectionerySearchableSelect
                                  products={confectioneryProducts}
                                  selectedId={row.productId}
                                  selectedName={row.name}
                                  disabledIds={disabledConfIds}
                                  onSelectMaster={(p) => {
                                    setConfectioneryRows((prev) =>
                                      prev.map((r) =>
                                        r.rowId === row.rowId
                                          ? { ...r, productId: str(p.id), code: str(p.code), name: str(p.name), rate: str(p.rate || "0.00"), isManual: false }
                                          : r
                                      )
                                    );
                                  }}
                                  onSelectManual={(customName) => {
                                    setConfectioneryRows((prev) =>
                                      prev.map((r) =>
                                        r.rowId === row.rowId
                                          ? { ...r, productId: "", code: r.code || "MANUAL", name: customName, isManual: true }
                                          : r
                                      )
                                    );
                                  }}
                                />
                                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                                  <div>
                                    <label style={{ display: "block", fontSize: 10, color: "#64748b", marginBottom: 2 }}>ID/CODE:</label>
                                    <input
                                      type="text"
                                      placeholder="CONF-01"
                                      value={row.code}
                                      onChange={(e) => {
                                        const val = e.target.value;
                                        setConfectioneryRows((prev) => prev.map((r) => (r.rowId === row.rowId ? { ...r, code: val } : r)));
                                      }}
                                      style={{ width: "100%", padding: "6px 8px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 12 }}
                                    />
                                  </div>
                                  <div>
                                    <label style={{ display: "block", fontSize: 10, color: "#64748b", marginBottom: 2 }}>QTY:</label>
                                    <input
                                      type="text"
                                      inputMode="decimal"
                                      placeholder="0"
                                      value={row.quantity}
                                      onChange={(e) => {
                                        const val = e.target.value;
                                        setConfectioneryRows((prev) => prev.map((r) => (r.rowId === row.rowId ? { ...r, quantity: val } : r)));
                                      }}
                                      style={{ width: "100%", padding: "6px 8px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 12 }}
                                    />
                                  </div>
                                  <div>
                                    <label style={{ display: "block", fontSize: 10, color: "#64748b", marginBottom: 2 }}>RATE/PC:</label>
                                    <input
                                      type="text"
                                      inputMode="decimal"
                                      placeholder="0.00"
                                      value={row.rate}
                                      onChange={(e) => {
                                        const val = e.target.value;
                                        setConfectioneryRows((prev) => prev.map((r) => (r.rowId === row.rowId ? { ...r, rate: val } : r)));
                                      }}
                                      style={{ width: "100%", padding: "6px 8px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 12, fontWeight: 600 }}
                                    />
                                  </div>
                                </div>
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "#fef3c7", padding: "6px 10px", borderRadius: 6 }}>
                                  <span style={{ fontSize: 11, color: "#92400e" }}>Line Subtotal:</span>
                                  <strong style={{ fontSize: 13, color: "#92400e" }}>{lineAmount ? rupees(lineAmount) : "₹0.00"}</strong>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                        {confectioneryRows.length > 0 && (
                          <div style={{ background: "#fef9c3", border: "1px solid #fde68a", borderRadius: 10, padding: "10px 14px", marginTop: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <div>
                              <span style={{ fontSize: 12, fontWeight: 500, color: "#92400e" }}>Conf Qty: </span>
                              <strong style={{ fontSize: 14, color: "#78350f" }}>{confTotalQty} pcs</strong>
                            </div>
                            <div>
                              <span style={{ fontSize: 12, fontWeight: 500, color: "#92400e" }}>Conf Subtotal: </span>
                              <strong style={{ fontSize: 16, color: "#78350f" }}>{rupees(confSubtotal)}</strong>
                            </div>
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Bill Discount Card */}
            <div
              style={{
                border: "1px solid #e2e8f0",
                borderRadius: 12,
                padding: "14px 16px",
                background: "#f8fafc",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
                <div>
                  <label style={{ display: "block", fontSize: 13, fontWeight: 650, color: "#334155" }}>
                    Overall Bill Discount (₹)
                  </label>
                  <p style={{ margin: "2px 0 0", fontSize: 12, color: "#64748b" }}>
                    Optional flat rupee discount deducted from total bill
                  </p>
                </div>
                <div style={{ width: 180 }}>
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder="0.00"
                    value={billDiscount}
                    onChange={(e) => setBillDiscount(e.target.value)}
                    style={{
                      width: "100%",
                      padding: "8px 12px",
                      borderRadius: 8,
                      border: "1px solid #cbd5e1",
                      fontSize: 14,
                      fontWeight: 600,
                      textAlign: "right",
                    }}
                  />
                </div>
              </div>
            </div>

            {/* Overall Net Bill Total Summary */}
            <div
              style={{
                border: "2px solid #0284c7",
                borderRadius: 12,
                padding: "16px 20px",
                background: "linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%)",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                flexWrap: "wrap",
                gap: 16,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 13, color: "#0369a1", fontWeight: 600 }}>Total Bill Quantity:</span>
                <strong style={{ fontSize: 18, color: "#0c4a6e" }}>{estimatedTotalQty} units</strong>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
                {Number(estimatedDiscount) > 0 && (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, paddingRight: 16, borderRight: "1px solid #bae6fd" }}>
                    <span style={{ fontSize: 13, color: "#0369a1", fontWeight: 500 }}>Subtotal:</span>
                    <span style={{ fontSize: 16, color: "#0369a1" }}>{rupees(grossSubtotal)}</span>
                    <span style={{ fontSize: 13, color: "#dc2626", fontWeight: 600 }}>(-{rupees(estimatedDiscount)})</span>
                  </div>
                )}
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 14, color: "#0369a1", fontWeight: 600 }}>Net Bill Total:</span>
                  <strong style={{ fontSize: 22, color: "#0c4a6e" }}>{rupees(estimatedBillTotal)}</strong>
                </div>
              </div>
            </div>

            {/* Optional Immediate Payment Entry */}
            <div
              style={{
                border: "1px solid #e2e8f0",
                borderRadius: 12,
                padding: "14px 16px",
                background: billWithPayments ? "#f0fdf4" : "#f8fafc",
                transition: "background 0.15s ease",
              }}
            >
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  fontSize: 13,
                  fontWeight: 650,
                  color: billWithPayments ? "#166534" : "#334155",
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={billWithPayments}
                  onChange={(e) => setBillWithPayments(e.target.checked)}
                />
                Receive payment at time of billing
              </label>

              {billWithPayments && (
                <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 12 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
                    <div>
                      <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#334155", marginBottom: 4 }}>
                        Cash Amount (₹)
                      </label>
                      <input
                        type="text"
                        inputMode="decimal"
                        placeholder="0.00"
                        value={billCashPay}
                        onChange={(e) => setBillCashPay(e.target.value)}
                        style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid #cbd5e1", fontSize: 14 }}
                      />
                    </div>
                    <div>
                      <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#334155", marginBottom: 4 }}>
                        Online / Bank Amount(s) (₹)
                      </label>
                      <input
                        type="text"
                        placeholder="0.00 or e.g. 500 + 1,200"
                        value={billOnlinePay}
                        onChange={(e) => setBillOnlinePay(e.target.value)}
                        style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid #cbd5e1", fontSize: 14 }}
                      />
                      {(() => {
                        const parsed = parseMultiAmounts(billOnlinePay);
                        if (parsed.length > 1) {
                          const totalParsed = parsed.reduce((acc, curr) => acc.plus(curr), D(0)).toFixed(2);
                          return (
                            <div style={{ marginTop: 4, fontSize: 11, color: "#0369a1", display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center" }}>
                              <span>{parsed.length} split online records:</span>
                              {parsed.map((p, i) => (
                                <span key={i} style={{ background: "#e0f2fe", padding: "1px 6px", borderRadius: 4, fontWeight: 600 }}>
                                  ₹{p}
                                </span>
                              ))}
                              <strong style={{ color: "#0c4a6e" }}>(Total ₹{totalParsed})</strong>
                            </div>
                          );
                        }
                        return null;
                      })()}
                    </div>
                    <div>
                      <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#166534", marginBottom: 4 }}>
                        Total Payment (₹)
                      </label>
                      <div
                        style={{
                          width: "100%",
                          padding: "8px 12px",
                          borderRadius: 8,
                          border: "1px solid #86efac",
                          background: "#f0fdf4",
                          fontSize: 14,
                          fontWeight: 700,
                          color: "#15803d",
                          height: 38,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                        }}
                      >
                        <span>₹{billPayTotalVal.toFixed(2)}</span>
                        <span style={{ fontSize: 10, color: "#166534", fontWeight: 500 }}>
                          {billPayCashVal.gt(0) || billPayOnlineVal.gt(0) ? `${billPayCashVal.toFixed(2)} + ${billPayOnlineVal.toFixed(2)}` : ""}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div>
                    <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#334155", marginBottom: 4 }}>
                      Payment Remarks / Reference (Optional)
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. UPI Ref, Slip details…"
                      value={billPaymentNote}
                      onChange={(e) => setBillPaymentNote(e.target.value)}
                      style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid #cbd5e1", fontSize: 14 }}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Inline Message Banner (Full Width directly above action buttons) */}
            {billError && (
              <div
                role="alert"
                style={{
                  width: "100%",
                  background: "#fef2f2",
                  border: "1.5px solid #f87171",
                  borderRadius: 10,
                  padding: "12px 16px",
                  color: "#b91c1c",
                  fontSize: 13,
                  fontWeight: 650,
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  boxShadow: "0 2px 4px rgba(220, 38, 38, 0.08)",
                  marginTop: 10,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <AlertCircle size={19} color="#dc2626" style={{ flexShrink: 0 }} />
                  <span>{billError}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setBillError("")}
                  style={{ background: "none", border: "none", color: "#b91c1c", cursor: "pointer", padding: "0 4px", fontSize: 16, lineHeight: 1 }}
                  aria-label="Dismiss error"
                >
                  ✕
                </button>
              </div>
            )}

            {billDraftNotice && !billError && (
              <div
                style={{
                  width: "100%",
                  background: "#eff6ff",
                  border: "1.5px solid #93c5fd",
                  borderRadius: 10,
                  padding: "12px 16px",
                  color: "#1d4ed8",
                  fontSize: 13,
                  fontWeight: 650,
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  boxShadow: "0 2px 4px rgba(37, 99, 235, 0.08)",
                  marginTop: 10,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <CheckCircle2 size={19} color="#2563eb" style={{ flexShrink: 0 }} />
                  <span>{billDraftNotice}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setBillDraftNotice("")}
                  style={{ background: "none", border: "none", color: "#1d4ed8", cursor: "pointer", padding: "0 4px", fontSize: 16, lineHeight: 1 }}
                  aria-label="Dismiss notice"
                >
                  ✕
                </button>
              </div>
            )}

            {billSuccess && !billError && (
              <div
                style={{
                  width: "100%",
                  background: "#f0fdf4",
                  border: "1.5px solid #86efac",
                  borderRadius: 10,
                  padding: "12px 16px",
                  color: "#166534",
                  fontSize: 13,
                  fontWeight: 650,
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  boxShadow: "0 2px 4px rgba(22, 101, 52, 0.08)",
                  marginTop: 10,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <CheckCircle2 size={19} color="#16a34a" style={{ flexShrink: 0 }} />
                  <span>{billSuccess.text}</span>
                  {billSuccess.billId ? (
                    <button
                      type="button"
                      onClick={() => onSelect(billSuccess.billId!)}
                      style={{
                        background: "#16a34a",
                        color: "#ffffff",
                        border: "none",
                        borderRadius: 6,
                        padding: "4px 12px",
                        fontSize: 13,
                        fontWeight: 700,
                        cursor: "pointer",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 5,
                      }}
                    >
                      <span>{billSuccess.billNo || "View Bill"}</span>
                      <ExternalLink size={13} />
                    </button>
                  ) : (
                    <strong style={{ color: "#166534" }}>{billSuccess.billNo}</strong>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setBillSuccess(null)}
                  style={{ background: "none", border: "none", color: "#166534", cursor: "pointer", padding: "0 4px", fontSize: 16, lineHeight: 1 }}
                  aria-label="Dismiss success message"
                >
                  ✕
                </button>
              </div>
            )}

            <div className="form-actions-mobile" style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 8 }}>
              <Button className="secondary" type="button" onClick={() => setActiveView("ledger")}>
                Cancel
              </Button>
              <Button
                className="secondary"
                disabled={billBusy}
                type="button"
                onClick={handleSaveDraft}
              >
                Save draft
              </Button>
              <Button
                className="primary"
                disabled={billBusy}
                type="button"
                onClick={handleCreateBill}
                style={{ background: "#ea580c", borderColor: "#c2410c", minWidth: 170, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
              >
                <Eye size={15} /> Review & Post Bill
              </Button>
            </div>
          </form>
        </section>
      )}

      {/* VIEW 3: RECEIVE MONEY */}
      {activeView === "receive_money" && (
        <section
          style={{
            background: "#ffffff",
            border: "1px solid #e2e8f0",
            borderRadius: 16,
            padding: "20px 18px",
            boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
          }}
        >
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span
                style={{
                  background: "#dcfce7",
                  color: "#15803d",
                  padding: "4px 8px",
                  borderRadius: 6,
                  fontSize: 11,
                  fontWeight: 700,
                }}
              >
                COLLECTION RECEIPT
              </span>
              <h2 style={{ margin: 0, fontSize: 19, color: "#0f172a" }}>
                Receive Money from Salesman
              </h2>
            </div>
            <p className="muted" style={{ margin: "6px 0 0", fontSize: 12 }}>
              Physical cash deposited in drawer or verified digital payment reducing salesman's outstanding due.
            </p>
          </div>

          {receiveError && <p className="error" style={{ marginBottom: 16 }}>{receiveError}</p>}
          {receiveSuccess && (
            <div
              style={{
                background: "#f0fdf4",
                border: "1px solid #86efac",
                borderRadius: 10,
                padding: "12px 16px",
                color: "#166534",
                marginBottom: 20,
                fontWeight: 600,
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <CheckCircle2 size={18} color="#16a34a" /> {receiveSuccess}
            </div>
          )}

          <form onSubmit={handleReceiveMoney} style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                gap: 14,
                background: "#f8fafc",
                padding: 16,
                borderRadius: 12,
                border: "1px solid #e2e8f0",
              }}
            >
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#334155", marginBottom: 6 }}>
                  SELECT SALESMAN *
                </label>
                <select
                  value={receiveSalesmanId}
                  onChange={(e) => setReceiveSalesmanId(e.target.value)}
                  required
                  style={{ width: "100%", padding: "9px 12px", borderRadius: 8, border: "1px solid #cbd5e1", fontSize: 14 }}
                >
                  <option value="">Select salesman…</option>
                  {salesmenList.map((s) => (
                    <option key={str(s.id)} value={str(s.id)}>
                      {str(s.name)} ({str(s.code)})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#334155", marginBottom: 6 }}>
                  PAYMENT DATE *
                </label>
                <input
                  type="date"
                  value={receivePaymentDate}
                  onChange={(e) => setReceivePaymentDate(e.target.value)}
                  required
                  style={{ width: "100%", padding: "9px 12px", borderRadius: 8, border: "1px solid #cbd5e1", fontSize: 14 }}
                />
              </div>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                gap: 16,
              }}
            >
              <div style={{ background: "#ffffff", border: "1.5px solid #e2e8f0", borderRadius: 12, padding: "16px 16px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <Banknote size={16} color="#16a34a" />
                  <label style={{ fontSize: 13, fontWeight: 700, color: "#0f172a" }}>Cash Amount (₹)</label>
                </div>
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={receiveCashAmount}
                  onChange={(e) => setReceiveCashAmount(e.target.value)}
                  style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1.5px solid #cbd5e1", fontSize: 16, fontWeight: 700 }}
                />
                {accounts.filter((a) => a.type === "cash").length > 1 && (
                  <div style={{ marginTop: 8 }}>
                    <label style={{ fontSize: 11, color: "#64748b" }}>Deposited into Drawer:</label>
                    <select
                      value={activeReceiveCashId}
                      onChange={(e) => setReceiveCashAccountId(e.target.value)}
                      style={{ marginTop: 4, width: "100%", padding: "8px 10px", fontSize: 12, borderRadius: 6, border: "1px solid #cbd5e1" }}
                    >
                      {accounts.filter((a) => a.type === "cash").map((a) => (
                        <option key={str(a.id)} value={str(a.id)}>{str(a.name)}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              <div style={{ background: "#ffffff", border: "1.5px solid #e2e8f0", borderRadius: 12, padding: "16px 16px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <CreditCard size={16} color="#0284c7" />
                  <label style={{ fontSize: 13, fontWeight: 700, color: "#0f172a" }}>Bank / Online Amount (₹)</label>
                </div>
                <input
                  type="text"
                  placeholder="0.00 or e.g. 500 + 1,200"
                  value={receiveBankAmount}
                  onChange={(e) => setReceiveBankAmount(e.target.value)}
                  style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1.5px solid #cbd5e1", fontSize: 16, fontWeight: 700 }}
                />
                {(() => {
                  const parsed = receiveOnlineList;
                  if (parsed.length > 1) {
                    const totalParsed = receiveOnlineVal.toFixed(2);
                    return (
                      <div style={{ marginTop: 4, fontSize: 11, color: "#0369a1", display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center" }}>
                        <span>{parsed.length} split online records:</span>
                        {parsed.map((p, i) => (
                          <span key={i} style={{ background: "#e0f2fe", padding: "1px 6px", borderRadius: 4, fontWeight: 600 }}>
                            ₹{p}
                          </span>
                        ))}
                        <strong style={{ color: "#0c4a6e" }}>(Total ₹{totalParsed})</strong>
                      </div>
                    );
                  }
                  return (
                    <div style={{ marginTop: 3, fontSize: 11, color: "#64748b" }}>
                      Separate multiple transactions by comma or space
                    </div>
                  );
                })()}
                {accounts.filter((a) => a.type === "bank").length > 1 && (
                  <div style={{ marginTop: 8 }}>
                    <label style={{ fontSize: 11, color: "#64748b" }}>Received into Bank Account:</label>
                    <select
                      value={activeReceiveBankId}
                      onChange={(e) => setReceiveBankAccountId(e.target.value)}
                      style={{ marginTop: 4, width: "100%", padding: "8px 10px", fontSize: 12, borderRadius: 6, border: "1px solid #cbd5e1" }}
                    >
                      {accounts.filter((a) => a.type === "bank").map((a) => (
                        <option key={str(a.id)} value={str(a.id)}>{str(a.name)}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              <div
                style={{
                  background: "#f0fdf4",
                  border: "1.5px solid #86efac",
                  borderRadius: 12,
                  padding: "16px 16px",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                }}
              >
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                    <IndianRupee size={16} color="#16a34a" />
                    <label style={{ fontSize: 13, fontWeight: 700, color: "#166534" }}>Total Received (₹)</label>
                  </div>
                  <div style={{ fontSize: 24, fontWeight: 800, color: "#15803d", padding: "6px 0" }}>
                    ₹{receiveTotalVal.toFixed(2)}
                  </div>
                </div>
                <div style={{ fontSize: 11, color: "#166534", marginTop: 4 }}>
                  Cash: ₹{receiveCashVal.toFixed(2)} + Online: ₹{receiveOnlineVal.toFixed(2)}
                </div>
              </div>
            </div>

            <div>
              <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#334155", marginBottom: 6 }}>
                NOTE / REFERENCE (OPTIONAL)
              </label>
              <input
                type="text"
                placeholder="e.g. UPI Ref #, Slip number, or payment remark…"
                value={receiveNote}
                onChange={(e) => setReceiveNote(e.target.value)}
                style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid #cbd5e1", fontSize: 13 }}
              />
            </div>

            <div className="form-actions-mobile" style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
              <Button className="secondary" type="button" onClick={() => setActiveView("ledger")}>
                Cancel
              </Button>
              <Button
                className="primary"
                disabled={receiveBusy}
                type="submit"
                style={{ background: "#16a34a", borderColor: "#15803d" }}
              >
                {receiveBusy ? "Recording Receipt…" : "Save Payment"}
              </Button>
            </div>
          </form>

          {/* Verification section */}
          {dashboard && arr(dashboard.claims).length > 0 && (
            <div style={{ marginTop: 24, borderTop: "1px solid #e2e8f0", paddingTop: 16 }}>
              <h3 style={{ fontSize: 15, marginBottom: 10 }}>Awaiting Verification</h3>
              {arr(dashboard.claims).map((r) => (
                <div className="claim" key={str(r.id)} style={{ marginBottom: 8 }}>
                  <div>
                    <strong>{str(r.salesman_name)}</strong>
                    <small>
                      {str(r.account_name)} · reported {dateLabel(r.actual_date)} · {str(r.reference)}
                    </small>
                  </div>
                  <b>{rupees(r.amount)}</b>
                  <Button className="secondary" onClick={() => onSelect("verify:" + r.id)}>
                    Review
                  </Button>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* VIEW 4: CONSOLIDATED REGISTER (BILLS, RECEIPTS, RETURNS, REVERSALS) */}
      {activeView === "register" && (
        <Documents
          onSelect={onSelect}
          kind="bill,receipt,return,reversal"
          excludeSalesmanId={excludeSalesmanId}
          requireSalesman={true}
          title="Retail Salesman Register"
        />
      )}

      {activeView === "saved_drafts" && (
        <section className="panel" style={{ padding: "20px 22px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
            <div>
              <h2 style={{ margin: 0, fontSize: 18, color: "#0f172a" }}>Saved Drafts · Retail Salesman Bills</h2>
              <p className="muted" style={{ margin: "4px 0 0", fontSize: 12 }}>
                Drafts are kept safely in your ledger workspace without any financial impact. Resume to continue editing or post.
              </p>
            </div>
            <Button className="secondary" onClick={() => switchView("new_bill")} style={{ fontSize: 12 }}>
              <Plus size={14} /> New Bill
            </Button>
          </div>

          {retailBillDrafts.length === 0 ? (
            <Empty text="No saved drafts for retail salesman bills." />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {retailBillDrafts.map((dr) => {
                const dData = (dr.data ?? {}) as Row;
                const values = (dData.values ?? {}) as Row;
                const sName = dData.salesmanName || values.salesmanName
                  ? str(dData.salesmanName || values.salesmanName)
                  : "Unknown Salesman";
                const bDate = dData.date || values.date ? str(dData.date || values.date) : "No date";
                const rowCnt = Array.isArray(dData.rowIds)
                  ? dData.rowIds.length
                  : Object.keys(dData.rowProducts || {}).length || Object.keys(dData.quantities || {}).length;

                return (
                  <div
                    key={str(dr.id)}
                    onClick={() => setReviewDraftRecord(dr)}
                    style={{
                      background: "#f8fafc",
                      border: "1px solid #e2e8f0",
                      borderRadius: 12,
                      padding: "14px 16px",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: 12,
                      flexWrap: "wrap",
                      cursor: "pointer",
                      transition: "all 0.15s ease",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.borderColor = "#94a3b8";
                      e.currentTarget.style.background = "#f1f5f9";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = "#e2e8f0";
                      e.currentTarget.style.background = "#f8fafc";
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 15, color: "#0f172a", display: "flex", alignItems: "center", gap: 8 }}>
                        {sName}
                        <span style={{ fontSize: 11, background: "#e2e8f0", color: "#475569", padding: "2px 8px", borderRadius: 10, fontWeight: 600 }}>Draft</span>
                      </div>
                      <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>
                        Bill Date: <b>{bDate}</b> · {rowCnt} line item{rowCnt === 1 ? "" : "s"} · saved on {formatDateTime(dr.created_at || dr.createdAt)}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }} onClick={(e) => e.stopPropagation()}>
                      <Button
                        className="secondary"
                        onClick={async () => {
                          try {
                            await api(`drafts/${str(dr.id)}`, z.unknown(), undefined, "DELETE");
                            await qc.invalidateQueries({ queryKey: ["drafts"] });
                            if (billDraft?.id === str(dr.id)) {
                              setBillDraft(null);
                              setBillDraftNotice("");
                            }
                          } catch {
                            // ignore
                          }
                        }}
                        style={{ color: "#dc2626", borderColor: "#fca5a5", fontSize: 12, padding: "6px 12px" }}
                      >
                        <Trash2 size={14} /> Delete
                      </Button>
                      <Button
                        className="secondary"
                        onClick={() => {
                          loadDraftIntoRetailBill(dr);
                        }}
                        style={{ fontSize: 12, padding: "6px 12px" }}
                      >
                        <Pencil size={14} /> Edit
                      </Button>
                      <Button
                        className="primary"
                        onClick={() => {
                          setReviewDraftRecord(dr);
                        }}
                        style={{ fontSize: 12, padding: "6px 14px", display: "flex", alignItems: "center", gap: 6 }}
                        title="Review all products and details in this draft bill before posting"
                      >
                        <Eye size={14} /> Review Bill
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {reviewDraftRecord && (
        <DraftReviewModal
          draft={reviewDraftRecord}
          masters={masters}
          salesmanList={salesmenList}
          onClose={() => setReviewDraftRecord(null)}
          onResumeEdit={() => {
            const d = reviewDraftRecord;
            setReviewDraftRecord(null);
            if (d) loadDraftIntoRetailBill(d);
          }}
          onPostSuccess={({ id, number }) => {
            setReviewDraftRecord(null);
            setBillSuccess({
              text: "Bill created successfully! Number: ",
              billNo: number || "POSTED",
              billId: id,
            });
            setBillRowIds([crypto.randomUUID()]);
            setBillRowProducts({});
            setQuantities({});
            setBillNote("");
            setHasConfectionery(false);
            setConfectioneryRows([]);
            setBillDiscount("");
            setBillPaperRef("");
            setBillWithPayments(true);
            setBillCashPay("");
            setBillOnlinePay("");
            setBillPaymentNote("");
            setBillDraft(null);
            setBillDraftNotice("");
            setActiveView("new_bill");
            window.scrollTo({ top: 0, behavior: "smooth" });
            if (id) {
              onSelect(id);
            }
          }}
        />
      )}
    </div>
  );
}

