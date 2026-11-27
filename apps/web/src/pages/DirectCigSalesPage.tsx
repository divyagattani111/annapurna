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
  ArrowLeftRight,
  Calendar,
  CheckCircle,
  CheckCircle2,
  Copy,
  CreditCard,
  ExternalLink,
  Eye,
  FileText,
  IndianRupee,
  Layers,
  Package,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plus,
  Printer,
  RefreshCw,
  Search,
  Star,
  Trash2,
  Users,
  Wallet,
  X,
} from "lucide-react";
import {
  rowsSchema, rowSchema, commandResult, commands, cleanMoney, cleanDecimal,
  parseMultiAmounts, cleanIndianPhone, type CommandName,
  encodeCsvRows,
} from "@ledger/contracts";
import { api } from "../api";
import { Button, Field, Empty, DocLink, Metric } from "../components/ui";
import { DraftReviewModal } from "../components/DraftReviewModal";
import { Documents } from "../components/Documents";
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


export function DirectCigSalesPage({
  date,
  masters,
  owner: _owner,
  onSelect,
  onCustomerStatement,
  restoreDraftRecord,
  onClearRestoreDraft,
  lockedSalesmanId,
  activeView: externalActiveView,
  onViewChange,
  initialBillCustomerId,
  initialReceiveCustomerId,
  onClearInitialBillCustomer,
  onClearInitialReceiveCustomer,
  initialSalesmanId,
}: {
  date: string;
  masters: Row;
  owner: boolean;
  onSelect: (id: string) => void;
  onCustomerStatement: (customerId: string) => void;
  restoreDraftRecord?: Row | null;
  onClearRestoreDraft?: () => void;
  lockedSalesmanId?: string;
  activeView?: "ledger" | "new_bill" | "receive_money" | "loading_sheet" | "register" | "saved_drafts" | "handovers";
  onViewChange?: (view: "ledger" | "new_bill" | "receive_money" | "loading_sheet" | "register" | "saved_drafts" | "handovers") => void;
  initialBillCustomerId?: string | null;
  initialReceiveCustomerId?: string | null;
  onClearInitialBillCustomer?: () => void;
  onClearInitialReceiveCustomer?: () => void;
  initialSalesmanId?: string | null;
}) {
  const qc = useQueryClient();
  const isMubashirOrDirect = (s: Row) => {
    return str(s.name).trim().toUpperCase() === "MUBASHIR SALESMAN";
  };

  const allActiveSalesmen = arr(masters.salesmen).filter((s) => s.active);
  // In Mudashir / Direct Route tab, only display Mubashir / direct route salesman
  const directSalesmen = allActiveSalesmen.filter(
    (s) => isMubashirOrDirect(s) || (lockedSalesmanId && str(s.id) === lockedSalesmanId),
  );
  const salesmenList = directSalesmen.length > 0 ? directSalesmen : allActiveSalesmen;
  const mubashir = directSalesmen[0] || allActiveSalesmen.find(isMubashirOrDirect) || salesmenList[0];

  const defaultSalesmanId = lockedSalesmanId || (mubashir ? str(mubashir.id) : str(salesmenList[0]?.id ?? ""));
  const [selectedSalesmanId, setSelectedSalesmanId] = useState<string>(defaultSalesmanId);
  useEffect(() => {
    if (lockedSalesmanId) {
      setSelectedSalesmanId(lockedSalesmanId);
    } else if (mubashir && (!selectedSalesmanId || !salesmenList.some((s) => str(s.id) === selectedSalesmanId))) {
      setSelectedSalesmanId(str(mubashir.id));
    }
  }, [lockedSalesmanId, mubashir, salesmenList, selectedSalesmanId]);
  const [selectedBeat, setSelectedBeat] = useState("");
  const [searchTerm, setSearchTerm] = useState("");

  // Sub-view: "ledger" | "new_bill" | "receive_money" | "loading_sheet" | "register" | "saved_drafts" | "handovers"
  const [internalView, setInternalView] = useState<"ledger" | "new_bill" | "receive_money" | "loading_sheet" | "register" | "saved_drafts" | "handovers">(externalActiveView ?? "ledger");
  const activeView = externalActiveView ?? internalView;
  const setActiveView = (nextView: "ledger" | "new_bill" | "receive_money" | "loading_sheet" | "register" | "saved_drafts" | "handovers") => {
    setInternalView(nextView);
    onViewChange?.(nextView);
  };

  // Loading sheet state
  const [loadingSheetFrom, setLoadingSheetFrom] = useState(date);
  const [loadingSheetTo, setLoadingSheetTo] = useState(date);
  const [loadingSheetScope, setLoadingSheetScope] = useState<"route" | "all">("route");
  const [showReversedBills, setShowReversedBills] = useState(false);
  const [hasManuallySelectedBills, setHasManuallySelectedBills] = useState(false);
  const [selectedBillIds, setSelectedBillIds] = useState<string[]>([]);
  const [loadingSheetBillSearch, setLoadingSheetBillSearch] = useState("");
  const [copyFeedback, setCopyFeedback] = useState(false);
  const [loadingSheetBillsCollapsed, setLoadingSheetBillsCollapsed] = useState(false);

  const switchView = (nextView: "ledger" | "new_bill" | "receive_money" | "loading_sheet" | "register" | "saved_drafts" | "handovers") => {
    setBillSuccess(null);
    setBillError("");
    setPaySuccess("");
    setPayError("");
    setHandoverModalOpen(false);
    if (nextView === "new_bill") {
      // Direct click on New Bill clears customer and all line items
      setBillCustomerId("");
      setBillRowIds([crypto.randomUUID()]);
      setBillRowProducts({});
      setQuantities({});
      setConfectioneryRows([]);
      setBillDiscount("");
      setBillWithPayments(true);
      setBillCashPay("");
      setBillOnlinePay("");
      setBillPaymentNote("");
      setBillDraft(null);
      setBillDraftNotice("");
    }
    setActiveView(nextView);
  };

  // Query summary & customer balances
  const summaryQuery = useQuery({
    queryKey: ["direct-cig-summary", selectedSalesmanId, selectedBeat, date],
    queryFn: () =>
      api(
        `direct-cig/summary?salesmanId=${encodeURIComponent(selectedSalesmanId)}&beat=${encodeURIComponent(selectedBeat)}&date=${encodeURIComponent(date)}`,
      ),
  });

  const rawCustomers = arr(summaryQuery.data?.customers);
  const customers = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    const filtered = term
      ? rawCustomers.filter((c) => {
        const name = str(c.customer_name).toLowerCase();
        const code = str(c.customer_id).toLowerCase();
        const beatName = str(c.beat_name).toLowerCase();
        return name.includes(term) || code.includes(term) || beatName.includes(term);
      })
      : rawCustomers;

    return [...filtered].sort((a, b) => {
      const balA = parseFloat(str(a.balance ?? "0"));
      const balB = parseFloat(str(b.balance ?? "0"));
      return balB - balA; // Highest outstanding dues first
    });
  }, [rawCustomers, searchTerm]);
  const stats = (summaryQuery.data?.stats ?? {}) as Row;
  const beats = arr(summaryQuery.data?.beats);

  // Forms state
  // New Direct Bill state
  const [billCustomerId, setBillCustomerId] = useState("");
  const [billNote, setBillNote] = useState("");
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

  // Query drafts for direct bills
  const directDraftsQuery = useQuery({
    queryKey: ["drafts"],
    queryFn: () => api("drafts", rowsSchema),
  });
  const directCigDrafts = (directDraftsQuery.data ?? []).filter(
    (d) => (d.data as Row)?.name === "direct_cig_bill",
  );

  // Helper to load a draft into form
  const loadDraftIntoBill = (draftRow: Row) => {
    const data = (draftRow.data ?? {}) as Row;
    if (data.salesmanId) setSelectedSalesmanId(str(data.salesmanId));
    if (data.customerId) setBillCustomerId(str(data.customerId));
    setBillNote(str(data.note || ""));
    if (data.date) setBillDate(str(data.date));
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
    setBillWithPayments(data.withPayments !== undefined ? Boolean(data.withPayments) : true);
    setBillCashPay(str(data.cashPay || ""));
    setBillOnlinePay(str(data.onlinePay || ""));
    setBillPaymentNote(str(data.paymentNote || ""));
    if (data.cashAccountId) setBillCashAccountId(str(data.cashAccountId));
    if (data.bankAccountId) setBillBankAccountId(str(data.bankAccountId));
    const vNum = Number(draftRow.version);
    setBillDraft({ id: str(draftRow.id), version: !isNaN(vNum) && vNum > 0 ? vNum : 1 });
    setBillDraftNotice(`Restored draft from ${str(draftRow.created_at)}.`);
    setBillError("");
    setBillSuccess(null);
    setActiveView("new_bill");
  };

  // Restore draft passed from parent if any
  useEffect(() => {
    if (restoreDraftRecord) {
      loadDraftIntoBill(restoreDraftRecord);
      onClearRestoreDraft?.();
    }
  }, [restoreDraftRecord]);

  // Direct Receive Money state
  const [receiveCustomerId, setReceiveCustomerId] = useState("");

  useEffect(() => {
    if (initialBillCustomerId) {
      setBillCustomerId(initialBillCustomerId);
      setSelectedBeat("");
      onClearInitialBillCustomer?.();
    }
  }, [initialBillCustomerId]);

  useEffect(() => {
    if (initialReceiveCustomerId) {
      setReceiveCustomerId(initialReceiveCustomerId);
      setSelectedBeat("");
      onClearInitialReceiveCustomer?.();
    }
  }, [initialReceiveCustomerId]);

  useEffect(() => {
    if (initialSalesmanId) {
      setSelectedSalesmanId(initialSalesmanId);
    }
  }, [initialSalesmanId]);
  const [paymentDate, setPaymentDate] = useState(date);
  const [cashAmount, setCashAmount] = useState("");
  const [bankAmount, setBankAmount] = useState("");
  const [selectedCashAccountId, setSelectedCashAccountId] = useState("");
  const [selectedBankAccountId, setSelectedBankAccountId] = useState("");
  const [paymentNote, setPaymentNote] = useState("");
  const [payBusy, setPayBusy] = useState(false);
  const [payError, setPayError] = useState("");
  const [paySuccess, setPaySuccess] = useState("");
  const [customerPageOffset, setCustomerPageOffset] = useState(0);
  const CUSTOMER_PAGE_SIZE = 15;

  const receiveCashVal = useMemo(() => {
    const c = cleanMoney(cashAmount);
    return c && !isNaN(Number(c)) ? D(c) : D(0);
  }, [cashAmount]);
  const receiveOnlineList = useMemo(() => parseMultiAmounts(bankAmount), [bankAmount]);
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

  const accounts = arr(masters.accounts) as Array<{ id: string; name?: string; holder?: string; type?: string; [key: string]: unknown }>;
  const mudhasirBankAcc = accounts.find(
    (a) =>
      a.type === "bank" &&
      (String(a.name ?? "").toLowerCase().includes("mudhasir") ||
        String(a.name ?? "").toLowerCase().includes("mubashir") ||
        String(a.holder ?? "").toLowerCase().includes("mudhasir") ||
        String(a.holder ?? "").toLowerCase().includes("mubashir")),
  );
  const managerCashAcc = accounts.find(
    (a) =>
      a.type === "cash" &&
      (String(a.name ?? "").toLowerCase().includes("manager") ||
        (!String(a.name ?? "").toLowerCase().includes("mudhasir") &&
          !String(a.name ?? "").toLowerCase().includes("mubashir"))),
  ) ?? accounts.find((a) => a.type === "cash");
  const defaultCash = str(managerCashAcc?.id ?? accounts.find((a) => a.type === "cash")?.id ?? accounts[0]?.id ?? "");
  const defaultBank = str(mudhasirBankAcc?.id ?? accounts.find((a) => a.type === "bank")?.id ?? accounts[0]?.id ?? "");
  const activeCashAccountId = selectedCashAccountId || defaultCash;
  const activeBankAccountId = selectedBankAccountId || defaultBank;

  // Client estimated bill total & subtotals
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

    if (!selectedSalesmanId) {
      setBillError("Please select a salesman route.");
      return;
    }
    if (!billCustomerId) {
      setBillError("Please select a customer.");
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

    const sObj = salesmenList.find((s) => str(s.id) === selectedSalesmanId);
    const custObj = customers.find((c) => str(c.id) === billCustomerId);
    setReviewDraftRecord({
      id: billDraft?.id || "",
      version: billDraft?.version,
      data: {
        name: "direct_cig_bill",
        salesmanId: selectedSalesmanId,
        salesmanName: sObj ? str(sObj.name) : "",
        customerId: billCustomerId,
        customerName: custObj ? str(custObj.customer_name) : "",
        date: billDate,
        rowIds: billRowIds,
        rowProducts: billRowProducts,
        quantities,
        hasConfectionery,
        confectioneryRows,
        discount: billDiscount,
        note: billNote,
        withPayments: shouldRecordPayment,
        cashPay: billCashPay,
        onlinePay: billOnlinePay,
        paymentNote: billPaymentNote,
        cashAccountId: billCashAccountId || defaultCash,
        bankAccountId: billBankAccountId || defaultBank,
      },
    });
  };

  const handleSaveDraft = async () => {
    setBillBusy(true);
    setBillError("");
    setBillDraftNotice("");
    try {
      const custObj = customers.find((c) => str(c.id) === billCustomerId);
      const vNum = billDraft?.version != null ? Number(billDraft.version) : undefined;
      const validVersion = vNum && !isNaN(vNum) && vNum > 0 ? vNum : undefined;
      const r = await api("drafts", rowSchema, {
        ...(billDraft?.id ? { id: billDraft.id, version: validVersion } : {}),
        data: {
          name: "direct_cig_bill",
          salesmanId: selectedSalesmanId,
          customerId: billCustomerId,
          customerName: custObj ? str(custObj.customer_name) : "",
          date: billDate,
          note: billNote,
          rowIds: billRowIds,
          rowProducts: billRowProducts,
          quantities,
          hasConfectionery,
          confectioneryRows,
          discount: billDiscount,
          withPayments: billWithPayments,
          cashPay: billCashPay,
          onlinePay: billOnlinePay,
          paymentNote: billPaymentNote,
          cashAccountId: billCashAccountId,
          bankAccountId: billBankAccountId,
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
    setPayError("");
    setPaySuccess("");

    if (!selectedSalesmanId) {
      setPayError("Please select a salesman route.");
      return;
    }
    if (!receiveCustomerId) {
      setPayError("Please select a customer.");
      return;
    }

    const cleanCash = cleanMoney(cashAmount);
    const bankAmounts = parseMultiAmounts(bankAmount);
    const hasCash = Boolean(cleanCash && parseMoneyNumber(cleanCash) > 0);
    const hasBank = bankAmounts.length > 0;
    if (!hasCash && !hasBank) {
      setPayError("Enter either a cash amount or at least one bank/online amount (separate multiple with + or /).");
      return;
    }

    if (hasCash && !activeCashAccountId) {
      setPayError("No cash receiving account found in master accounts.");
      return;
    }
    if (hasBank && !activeBankAccountId) {
      setPayError("No bank receiving account found in master accounts.");
      return;
    }

    setPayBusy(true);
    try {
      const receipts: Row[] = [];
      if (hasCash) {
        receipts.push({
          amount: cleanCash,
          accountId: activeCashAccountId,
          method: "cash",
          actualDate: paymentDate,
          reference: "",
          verified: false,
        });
      }
      if (hasBank) {
        bankAmounts.forEach((amt, idx) => {
          const suffix = bankAmounts.length > 1 ? ` (${idx + 1}/${bankAmounts.length})` : "";
          receipts.push({
            amount: amt,
            accountId: activeBankAccountId,
            method: "online",
            actualDate: paymentDate,
            reference: (paymentNote ? `${paymentNote}${suffix}` : `Direct Cigarette Online Payment${suffix}`).trim(),
            verified: false,
          });
        });
      }

      await api(
        "commands/receiptBatch",
        commandResult,
        {
          date: paymentDate,
          salesmanId: selectedSalesmanId,
          customerId: receiveCustomerId,
          note: paymentNote,
          receipts,
        },
        "POST",
        crypto.randomUUID(),
      );

      setPaySuccess("Customer payment recorded successfully.");
      setCashAmount("");
      setBankAmount("");
      setPaymentNote("");
      await qc.invalidateQueries();
      summaryQuery.refetch();
    } catch (err) {
      setPayError((err as Error).message);
    } finally {
      setPayBusy(false);
    }
  };

  // Handover state
  const [handoverModalOpen, setHandoverModalOpen] = useState(false);
  const [handoverAmount, setHandoverAmount] = useState("");
  const [handoverNote, setHandoverNote] = useState("");
  const [handoverBusy, setHandoverBusy] = useState(false);
  const [handoverError, setHandoverError] = useState("");
  const [handoverSuccess, setHandoverSuccess] = useState("");

  const cashInHand = str(stats.cashInHand ?? "0.00");
  const onlineInAccount = str(stats.onlineInAccount ?? "0.00");
  const handoversHistory = arr(summaryQuery.data?.handovers);

  const handleInitiateHandover = async (e: React.FormEvent) => {
    e.preventDefault();
    setHandoverError("");
    setHandoverSuccess("");
    const cleanAmt = cleanMoney(handoverAmount);
    const entered = parseMoneyNumber(cleanAmt);
    if (isNaN(entered) || entered <= 0) {
      setHandoverError("Please enter a valid cash amount to transfer.");
      return;
    }
    const maxHand = parseMoneyNumber(cashInHand);
    if (entered > maxHand && maxHand > 0) {
      setHandoverError(`Amount exceeds current cash in hand of ${rupees(cashInHand)}.`);
      return;
    }
    setHandoverBusy(true);
    try {
      await api(
        "commands/initiateCashHandover",
        commandResult,
        {
          date,
          salesmanId: selectedSalesmanId,
          amount: cleanAmt,
          salesmanNote: handoverNote.trim() || undefined,
        },
        "POST",
        crypto.randomUUID(),
      );
      setHandoverSuccess(`Cash handover of ${rupees(cleanAmt)} initiated. Awaiting manager confirmation.`);
      setHandoverAmount("");
      setHandoverNote("");
      setHandoverModalOpen(false);
      await qc.invalidateQueries();
      summaryQuery.refetch();
    } catch (err) {
      setHandoverError((err as Error).message);
    } finally {
      setHandoverBusy(false);
    }
  };

  const selectedBillCustomer = customers.find((c) => str(c.id) === billCustomerId);
  const selectedReceiveCustomer = customers.find((c) => str(c.id) === receiveCustomerId);

  // Loading Sheet / Bill Products Queries & Processing
  const loadingSheetBillsQuery = useQuery({
    queryKey: [
      "loading-sheet-bills",
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
    enabled: activeView === "loading_sheet",
  });

  const loadingBills = useMemo(() => {
    const list = arr(loadingSheetBillsQuery.data).filter((b) => showReversedBills || !b.reversed);
    if (!loadingSheetBillSearch.trim()) return list;
    const q = loadingSheetBillSearch.toLowerCase().trim();
    return list.filter((b) => {
      const num = str(b.number).toLowerCase();
      const cName = str((b.data as Row)?.customerName || (b.data as Row)?.customerRef || "").toLowerCase();
      const sName = str(b.salesman_name || "").toLowerCase();
      return num.includes(q) || cName.includes(q) || sName.includes(q);
    });
  }, [loadingSheetBillsQuery.data, loadingSheetBillSearch, showReversedBills]);

  const reversedBillsCount = useMemo(() => {
    return arr(loadingSheetBillsQuery.data).filter((b) => b.reversed).length;
  }, [loadingSheetBillsQuery.data]);

  // Auto-select all available bills on initial load unless user has explicitly customized selection
  useEffect(() => {
    if (!hasManuallySelectedBills && loadingBills.length > 0 && selectedBillIds.length === 0) {
      setSelectedBillIds(loadingBills.map((b) => str(b.id)));
    }
  }, [loadingBills, hasManuallySelectedBills, selectedBillIds.length]);

  const loadingSheetLinesQuery = useQuery({
    queryKey: ["loading-sheet-lines", selectedBillIds],
    queryFn: async () => {
      if (selectedBillIds.length === 0) return [];
      return api<Row[]>("documents/lines", rowsSchema, { documentIds: selectedBillIds });
    },
    enabled: activeView === "loading_sheet" && selectedBillIds.length > 0,
  });

  const aggregatedProducts = useMemo(() => {
    const lines = arr(loadingSheetLinesQuery.data);
    const map = new Map<
      string,
      {
        id: string;
        name: string;
        code: string;
        category: string;
        unit: string;
        rate: string;
        quantity: Decimal;
        grossQuantity: Decimal;
        returnedQuantity: Decimal;
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
      const retQty = D(cleanDecimal(l.returned_quantity) || "0");
      const netQty = Decimal.max(0, qty.minus(retQty));
      const amt = D(cleanMoney(l.amount) || "0");
      const unitPrice = qty.gt(0) ? amt.div(qty) : D(0);
      const netAmt = unitPrice.times(netQty);

      const existing = map.get(key);
      if (existing) {
        existing.quantity = existing.quantity.plus(netQty);
        existing.grossQuantity = existing.grossQuantity.plus(qty);
        existing.returnedQuantity = existing.returnedQuantity.plus(retQty);
        existing.amount = existing.amount.plus(netAmt);
        if (docNum && !existing.billNumbers.includes(docNum)) {
          existing.billNumbers.push(docNum);
        }
      } else {
        map.set(key, {
          id: key,
          name,
          code,
          category,
          unit,
          rate,
          quantity: netQty,
          grossQuantity: qty,
          returnedQuantity: retQty,
          amount: netAmt,
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
  }, [loadingSheetLinesQuery.data]);

  const totalLoadedQty = useMemo(() => {
    return aggregatedProducts.reduce((sum, p) => sum.plus(p.quantity), D(0));
  }, [aggregatedProducts]);

  const totalLoadedAmount = useMemo(() => {
    return aggregatedProducts.reduce((sum, p) => sum.plus(p.amount), D(0));
  }, [aggregatedProducts]);

  const handleCopyList = () => {
    if (aggregatedProducts.length === 0) return;
    const salesmanName = "MUBASHIR SALESMAN";
    const dateStr =
      !loadingSheetFrom && !loadingSheetTo
        ? "All Dates"
        : loadingSheetFrom === loadingSheetTo
          ? loadingSheetFrom
          : `${loadingSheetFrom || "Start"} to ${loadingSheetTo || "End"}`;

    const lines: string[] = [];
    lines.push(`Product Loading Sheet - ${salesmanName}`);
    lines.push(`Date: ${dateStr} | Bills: ${selectedBillIds.length}`);
    lines.push(`----------------------------------------`);
    lines.push(`#\tProduct Name\tTotal Qty\tMRP / Rate\tTotal Value\tBills`);
    aggregatedProducts.forEach((p, idx) => {
      const retDetail = p.returnedQuantity.gt(0) ? ` (Billed: ${p.grossQuantity.toString()}, Ret: ${p.returnedQuantity.toString()})` : "";
      lines.push(
        `${idx + 1}\t${p.name}${p.code ? ` (${p.code})` : ""}\t${p.quantity.toString()} ${p.unit}${retDetail}\t₹${p.rate}\t₹${p.amount.toFixed(2)}\t${p.billNumbers.length} bills`,
      );
    });
    lines.push(`----------------------------------------`);
    lines.push(`Grand Total:\t\t${totalLoadedQty.toString()}\t\t₹${totalLoadedAmount.toFixed(2)}\t${selectedBillIds.length} bills`);

    navigator.clipboard.writeText(lines.join("\n"));
    setCopyFeedback(true);
    setTimeout(() => setCopyFeedback(false), 2500);
  };

  const toggleAllBills = () => {
    setHasManuallySelectedBills(true);
    if (selectedBillIds.length === loadingBills.length) {
      setSelectedBillIds([]);
    } else {
      setSelectedBillIds(loadingBills.map((b) => str(b.id)));
    }
  };

  const toggleBill = (id: string) => {
    setHasManuallySelectedBills(true);
    setSelectedBillIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {/* 1. Route & Beat Filter Section */}
      <div className="direct-cig-header no-print" style={{ padding: "14px 18px" }}>
        <div className="direct-cig-filters">
          <div>
            <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5 }}>
              Salesman Route
            </label>
            <div style={{ marginTop: 6 }}>
              <select
                className="direct-cig-select"
                value={selectedSalesmanId}
                disabled={!!lockedSalesmanId || salesmenList.length <= 1}
                onChange={(e) => {
                  setSelectedSalesmanId(e.target.value);
                  setSelectedBeat("");
                  setBillCustomerId("");
                  setReceiveCustomerId("");
                }}
              >
                {salesmenList.map((s) => (
                  <option key={str(s.id)} value={str(s.id)}>
                    {str(s.name)} {str((s.details as Row)?.itc_id) ? `(${str((s.details as Row)?.itc_id)})` : ""}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5 }}>
              Beat / Area Filter
            </label>
            <div style={{ marginTop: 6 }}>
              <select
                className="direct-cig-select"
                value={selectedBeat}
                onChange={(e) => {
                  setSelectedBeat(e.target.value);
                  setCustomerPageOffset(0);
                }}
              >
                <option value="">All Beats ({beats.length})</option>
                {beats.map((b) => (
                  <option key={str(b.code)} value={str(b.code)}>
                    {str(b.name) || `Beat ${str(b.code)}`}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* 2. Metric Stats Boxes Directly Below including Cash in Hand */}
      <div className="stats no-print" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
        <Metric
          label="Customers Dues"
          value={stats.customerDues ?? stats.totalBalance ?? "0.00"}
          caption={`Overall billed: ${rupees(stats.totalBilled ?? "0.00")} · Received: ${rupees(stats.totalReceived ?? "0.00")}`}
          accent
        />
        <Metric
          label="Cash in Hand (Mudhasir)"
          value={cashInHand}
          caption="Current route cash balance"
          icon={Wallet}
          tone="cash"
        />
        <Metric
          label="Online Account (Mudhasir)"
          value={onlineInAccount}
          caption="Verified route bank collections"
          icon={CreditCard}
          tone="cash"
        />
        <Metric
          label="Total Products Sold"
          value={stats.todayQty ?? "0"}
          caption={`Today: ${stats.todayQty ?? "0"} · Overall: ${stats.totalQty ?? "0"}`}
          icon={FileText}
          tone="bills"
          isCurrency={false}
        />
        <Metric
          label="Today's Billed"
          value={stats.todayBilled ?? "0.00"}
          caption={formatBilledCaption(
            stats.todayGrossBilled ?? stats.todayBilled,
            stats.todayReversed,
            stats.todayReturned,
          )}
          tone="bills"
        />
      </div>

      {handoverSuccess && (
        <div className="notice no-print" role="status" style={{ margin: "4px 0" }}>
          {handoverSuccess}
        </div>
      )}
      {handoverError && (
        <div className="error no-print" role="alert" style={{ margin: "4px 0" }}>
          {handoverError}
        </div>
      )}

      {/* 3. Navigation Tabs (Line tab style) */}
      <div className="direct-cig-tabs-line no-print">
        <button
          type="button"
          className={`direct-cig-tab-btn ${activeView === "ledger" ? "active" : ""}`}
          onClick={() => switchView("ledger")}
        >
          <Users size={17} /> Ledger
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
          <IndianRupee size={17} /> Receive
        </button>
        <button
          type="button"
          className={`direct-cig-tab-btn ${activeView === "loading_sheet" ? "active" : ""}`}
          onClick={() => switchView("loading_sheet")}
        >
          <Package size={17} /> Loading Sheet {selectedBillIds.length > 0 ? `(${selectedBillIds.length})` : ""}
        </button>
        <button
          type="button"
          className={`direct-cig-tab-btn ${activeView === "handovers" ? "active" : ""}`}
          onClick={() => switchView("handovers")}
        >
          <ArrowLeftRight size={17} /> Settlements & History
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
          <Layers size={17} /> Saved Drafts {directCigDrafts.length > 0 ? `(${directCigDrafts.length})` : ""}
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

      {/* VIEW 1: CUSTOMER LEDGER & BALANCES TABLE */}
      {activeView === "ledger" && (
        <section className="panel" style={{ padding: "16px 18px" }}>
          <div className="direct-cig-ledger-header">
            <div>
              <h2 style={{ margin: 0, fontSize: 18 }}>Customer Dues & Ledger</h2>
              <p className="muted" style={{ margin: "4px 0 0", fontSize: 12 }}>
                Customers under this salesman route owe directly to the business. Tap any customer to view full transaction statement.
              </p>
            </div>
            <div className="direct-cig-search-wrap">
              <input
                type="search"
                className="direct-cig-search-input"
                placeholder="Search customer name or ID…"
                value={searchTerm}
                onChange={(e) => {
                  setSearchTerm(e.target.value);
                  setCustomerPageOffset(0);
                }}
              />
              <Button
                className="secondary"
                onClick={() => summaryQuery.refetch()}
                title="Refresh customer balances"
                style={{ padding: "8px 12px", minHeight: 40 }}
              >
                <RefreshCw size={15} /> <span className="hidden sm:inline">Refresh</span>
              </Button>
            </div>
          </div>

          {summaryQuery.isLoading ? (
            <p style={{ padding: 16 }}>Loading customer balances…</p>
          ) : customers.length === 0 ? (
            <div style={{ padding: 30, textAlign: "center", color: "#64748b" }}>
              <p>{searchTerm.trim() ? "No customers match your search." : "No customers found for this selection."}</p>
            </div>
          ) : (
            <>
              {/* DESKTOP TABLE VIEW (hidden on screens < 768px) */}
              <div className="direct-cig-table-desktop">
                <div className="table-scroll">
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ background: "#f8fafc", textAlign: "left", borderBottom: "2px solid #e2e8f0" }}>
                        <th style={{ padding: "10px 12px", fontSize: 12, fontWeight: 600, color: "#64748b" }}>CUSTOMER CODE</th>
                        <th style={{ padding: "10px 12px", fontSize: 12, fontWeight: 600, color: "#64748b" }}>CUSTOMER NAME</th>
                        <th style={{ padding: "10px 12px", fontSize: 12, fontWeight: 600, color: "#64748b" }}>BEAT / AREA</th>
                        <th style={{ padding: "10px 12px", fontSize: 12, fontWeight: 600, color: "#64748b", textAlign: "right" }}>OUTSTANDING DUE</th>
                        <th style={{ padding: "10px 12px", fontSize: 12, fontWeight: 600, color: "#64748b", textAlign: "center", minWidth: 220 }}>ACTIONS</th>
                      </tr>
                    </thead>
                    <tbody>
                      {customers
                        .slice(customerPageOffset, customerPageOffset + CUSTOMER_PAGE_SIZE)
                        .map((c) => {
                          const balNum = parseFloat(str(c.balance || "0"));
                          const hasDue = balNum > 0;
                          return (
                            <tr
                              key={str(c.id)}
                              style={{
                                borderBottom: "1px solid #f1f5f9",
                                cursor: "pointer",
                                background: "#ffffff",
                              }}
                              onClick={() => onCustomerStatement(str(c.id))}
                            >
                              <td style={{ padding: "10px 12px", fontFamily: "monospace", fontSize: 12, color: "#64748b" }}>
                                {str(c.customer_id)}
                              </td>
                              <td style={{ padding: "10px 12px", fontWeight: 600, color: "#1e293b" }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                  <span>{str(c.customer_name)}</span>
                                  {c.is_gst ? (
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
                              <td style={{ padding: "10px 12px", fontSize: 13, color: "#475569" }}>
                                <span style={{ background: "#f1f5f9", padding: "2px 6px", borderRadius: 4 }}>
                                  {str(c.beat_name) || `Beat ${str(c.beat_code)}`}
                                </span>
                              </td>
                              <td
                                style={{
                                  padding: "10px 12px",
                                  textAlign: "right",
                                  fontWeight: 700,
                                  fontSize: 14,
                                  color: hasDue ? "#dc2626" : "#475569",
                                }}
                              >
                                {rupees(c.balance)}
                              </td>
                              <td style={{ padding: "10px 12px", textAlign: "center" }}>
                                <div style={{ display: "inline-flex", gap: 6, alignItems: "center" }} onClick={(e) => e.stopPropagation()}>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setBillCustomerId(str(c.id));
                                      setActiveView("new_bill");
                                    }}
                                    title={`Create new direct bill for ${str(c.customer_name)}`}
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
                                      setReceiveCustomerId(str(c.id));
                                      setActiveView("receive_money");
                                    }}
                                    title={`Receive money from ${str(c.customer_name)}`}
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
                                    onClick={() => onCustomerStatement(str(c.id))}
                                    title={`View statement for ${str(c.customer_name)}`}
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

              {/* MOBILE CARDS VIEW (visible on screens < 768px) */}
              <div className="direct-cig-cards-mobile">
                {customers
                  .slice(customerPageOffset, customerPageOffset + CUSTOMER_PAGE_SIZE)
                  .map((c) => {
                    const balNum = parseFloat(str(c.balance || "0"));
                    const hasDue = balNum > 0;
                    return (
                      <div
                        key={str(c.id)}
                        className="customer-mobile-card"
                        onClick={() => onCustomerStatement(str(c.id))}
                      >
                        <div className="customer-card-header">
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div className="customer-card-name">{str(c.customer_name)}</div>
                            <div className="customer-card-code">ID: {str(c.customer_id)}</div>
                          </div>
                          <span className="customer-card-beat">
                            {str(c.beat_name) || `Beat ${str(c.beat_code)}`}
                          </span>
                        </div>

                        <div className="customer-card-stats" style={{ gridTemplateColumns: "1fr", padding: "10px 14px", background: hasDue ? "#fef2f2" : "#f0fdf4", border: `1px solid ${hasDue ? "#fecaca" : "#bbf7d0"}` }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <span style={{ fontSize: 12, fontWeight: 600, color: hasDue ? "#991b1b" : "#166534" }}>Outstanding Due</span>
                            <span
                              style={{
                                fontSize: 16,
                                fontWeight: 800,
                                color: hasDue ? "#dc2626" : "#16a34a",
                              }}
                            >
                              {rupees(c.balance)}
                            </span>
                          </div>
                        </div>

                        {/* Action buttons row */}
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            gap: 8,
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
                                setBillCustomerId(str(c.id));
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
                                setReceiveCustomerId(str(c.id));
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
                            onClick={() => onCustomerStatement(str(c.id))}
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

              {/* PAGINATION (Responsive for mobile & desktop) */}
              <div
                className="pagination pagination-mobile"
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "12px 14px",
                  background: "#f8fafc",
                  border: "1px solid #e2e8f0",
                  borderRadius: 10,
                  marginTop: 12,
                }}
              >
                <div className="button-group">
                  <Button
                    className="secondary"
                    disabled={customerPageOffset === 0}
                    onClick={() => setCustomerPageOffset((prev) => Math.max(0, prev - CUSTOMER_PAGE_SIZE))}
                    style={{ minHeight: 38 }}
                  >
                    ← Previous
                  </Button>
                  <Button
                    className="secondary"
                    disabled={customerPageOffset + CUSTOMER_PAGE_SIZE >= customers.length}
                    onClick={() => setCustomerPageOffset((prev) => prev + CUSTOMER_PAGE_SIZE)}
                    style={{ minHeight: 38 }}
                  >
                    Next →
                  </Button>
                </div>
                <span style={{ fontSize: 12, color: "#475569" }}>
                  Page <b>{Math.floor(customerPageOffset / CUSTOMER_PAGE_SIZE) + 1}</b> · Showing <b>{customers.length ? customerPageOffset + 1 : 0}–{Math.min(customerPageOffset + CUSTOMER_PAGE_SIZE, customers.length)}</b> of <b>{customers.length}</b>
                </span>
              </div>
            </>
          )}
        </section>
      )}

      {/* VIEW 2: NEW DIRECT BILL */}
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
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span style={{ background: "#ffedd5", color: "#c2410c", padding: "4px 8px", borderRadius: 6, fontSize: 11, fontWeight: 700 }}>
                  INVOICE ENTRY
                </span>
                <h2 style={{ margin: 0, fontSize: 19, color: "#0f172a" }}>Create New Direct Customer Bill</h2>
              </div>
              <p className="muted" style={{ margin: "6px 0 0", fontSize: 12 }}>
                Items billed here post directly to the customer's ledger under route: <b>{str(salesmenList.find((s) => str(s.id) === selectedSalesmanId)?.name || "this route")}</b>.
              </p>
            </div>
            {directCigDrafts.length > 0 && (
              <Button
                className="secondary"
                type="button"
                onClick={() => switchView("saved_drafts")}
                style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}
              >
                Saved Drafts ({directCigDrafts.length})
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
            {/* Customer & Date Selection Cards */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(240px, 3fr) minmax(130px, 1.2fr) minmax(240px, 4fr)",
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
                  SELECT CUSTOMER *
                </label>
                <CustomerSearchableSelect
                  customers={customers}
                  selectedId={billCustomerId}
                  onSelect={(id) => setBillCustomerId(id)}
                  placeholder="Search customer by name, code or beat…"
                />
                {selectedBillCustomer && (
                  <div style={{ marginTop: 8, fontSize: 12, color: "#64748b", display: "flex", gap: 14, flexWrap: "wrap" }}>
                    <span>Beat: <b>{str(selectedBillCustomer.beat_name) || `Beat ${str(selectedBillCustomer.beat_code)}`}</b></span>
                    <span>Current Due: <b style={{ color: parseFloat(str(selectedBillCustomer.balance || "0")) > 0 ? "#dc2626" : "#16a34a" }}>{rupees(selectedBillCustomer.balance)}</b></span>
                  </div>
                )}
              </div>

              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#334155", marginBottom: 6 }}>
                  BILL DATE *
                </label>
                <input
                  type="date"
                  value={billDate}
                  onChange={(e) => setBillDate(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "9px 10px",
                    borderRadius: 8,
                    border: "1px solid #cbd5e1",
                    fontSize: 13,
                    background: "#ffffff",
                    fontWeight: 500,
                  }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#334155", marginBottom: 6 }}>
                  BILL NOTES / REMARKS (OPTIONAL)
                </label>
                <input
                  type="text"
                  placeholder="e.g. Special order remarks, delivery note, customer request…"
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

            {/* Bill Lines: DESKTOP TABLE */}
            <div className="bill-lines-desktop" style={{ border: "1px solid #e2e8f0", borderRadius: 12, overflow: "visible", boxShadow: "0 1px 2px rgba(0,0,0,0.02)" }}>
              <div className="table-scroll" style={{ overflow: "visible" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ background: "#f8fafc", textAlign: "left", borderBottom: "1.5px solid #e2e8f0" }}>
                      <th style={{ width: 44, textAlign: "center", padding: "10px 8px", fontSize: 12, color: "#64748b" }}>#</th>
                      <th style={{ width: 150, padding: "10px 12px", fontSize: 12, color: "#64748b" }}>PRODUCT ID</th>
                      <th style={{ minWidth: 280, padding: "10px 12px", fontSize: 12, color: "#64748b" }}>PRODUCT NAME</th>
                      <th style={{ width: 130, padding: "10px 12px", fontSize: 12, color: "#64748b" }}>QUANTITY (m)</th>
                      <th style={{ width: 130, padding: "10px 12px", fontSize: 12, color: "#64748b" }}>RATE / m</th>
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
                              placeholder="e.g. 0.2"
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

            {/* Bill Lines: MOBILE TOUCH-FRIENDLY CARDS (< 768px) */}
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
                      <div>
                        <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#64748b", marginBottom: 4 }}>
                          SELECT PRODUCT
                        </label>
                        <ProductSearchableSelect
                          products={cigaretteProducts}
                          selectedId={productId}
                          disabledIds={disabledProductIds}
                          onSelect={(selectedProdId) => {
                            setBillRowProducts((prev) => ({ ...prev, [rowId]: selectedProdId }));
                          }}
                        />
                      </div>

                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, alignItems: "center" }}>
                        <div>
                          <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#64748b", marginBottom: 4 }}>
                            QUANTITY (m)
                          </label>
                          <input
                            id={`qty-input-m-${rowId}`}
                            type="text"
                            inputMode="decimal"
                            placeholder="e.g. 0.2"
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
                            style={{ width: "100%", padding: "9px 10px", borderRadius: 8, border: "1.5px solid #cbd5e1", fontSize: 14, fontWeight: 600 }}
                          />
                        </div>

                        <div style={{ background: "#f8fafc", padding: "8px 10px", borderRadius: 8, border: "1px solid #f1f5f9" }}>
                          <div style={{ fontSize: 10, color: "#64748b", fontWeight: 700 }}>RATE / BASIS</div>
                          <div style={{ fontSize: 12, fontWeight: 600, color: "#334155", marginTop: 2 }}>
                            {p?.rate ? `${rupees(p.rate)} / ${p.basis || 1}m` : "—"}
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
                  style={{ width: 17, height: 17, accentColor: "#16a34a", cursor: "pointer" }}
                />
                Also record money received with this entry
              </label>

              {billWithPayments && (
                <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 12 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
                    <div style={{ background: "#ffffff", border: "1px solid #cbd5e1", borderRadius: 10, padding: "12px 14px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                        <Wallet size={15} color="#059669" />
                        <label style={{ fontSize: 12, fontWeight: 700, color: "#0f172a" }}>Cash amount received (₹)</label>
                      </div>
                      <input
                        type="text"
                        inputMode="decimal"
                        placeholder="0.00"
                        value={billCashPay}
                        onChange={(e) => setBillCashPay(e.target.value)}
                        style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 14, fontWeight: 600 }}
                      />
                      {accounts.filter((a) => a.type === "cash").length > 1 && (
                        <div style={{ marginTop: 6 }}>
                          <select
                            value={billCashAccountId || defaultCash}
                            onChange={(e) => setBillCashAccountId(e.target.value)}
                            style={{ width: "100%", padding: "5px 8px", fontSize: 11, borderRadius: 6, border: "1px solid #cbd5e1" }}
                          >
                            {accounts.filter((a) => a.type === "cash").map((a) => (
                              <option key={str(a.id)} value={str(a.id)}>{str(a.name)}</option>
                            ))}
                          </select>
                        </div>
                      )}
                    </div>

                    <div style={{ background: "#ffffff", border: "1px solid #cbd5e1", borderRadius: 10, padding: "12px 14px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                        <CreditCard size={15} color="#0284c7" />
                        <label style={{ fontSize: 12, fontWeight: 700, color: "#0f172a" }}>Online / Bank amount(s) (₹)</label>
                      </div>
                      <input
                        type="text"
                        placeholder="0.00 or e.g. 500 + 1,200"
                        value={billOnlinePay}
                        onChange={(e) => setBillOnlinePay(e.target.value)}
                        style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 14, fontWeight: 600 }}
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
                      {accounts.filter((a) => a.type === "bank").length > 1 && (
                        <div style={{ marginTop: 6 }}>
                          <select
                            value={billBankAccountId || defaultBank}
                            onChange={(e) => setBillBankAccountId(e.target.value)}
                            style={{ width: "100%", padding: "5px 8px", fontSize: 11, borderRadius: 6, border: "1px solid #cbd5e1" }}
                          >
                            {accounts.filter((a) => a.type === "bank").map((a) => (
                              <option key={str(a.id)} value={str(a.id)}>{str(a.name)}</option>
                            ))}
                          </select>
                        </div>
                      )}
                    </div>

                    <div style={{ background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 10, padding: "12px 14px", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
                      <div>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                          <IndianRupee size={15} color="#16a34a" />
                          <label style={{ fontSize: 12, fontWeight: 700, color: "#166534" }}>Total Received (₹)</label>
                        </div>
                        <div style={{ fontSize: 18, fontWeight: 800, color: "#15803d", padding: "4px 0" }}>
                          ₹{billPayTotalVal.toFixed(2)}
                        </div>
                      </div>
                      <div style={{ fontSize: 11, color: "#166534" }}>
                        Cash: ₹{billPayCashVal.toFixed(2)} + Online: ₹{billPayOnlineVal.toFixed(2)}
                      </div>
                    </div>
                  </div>

                  <div>
                    <input
                      type="text"
                      placeholder="Payment remarks / reference (e.g. UPI ref #, cheque #)"
                      value={billPaymentNote}
                      onChange={(e) => setBillPaymentNote(e.target.value)}
                      style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid #cbd5e1", fontSize: 12 }}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Inline Message Banner for New Bill (Full Width directly above action buttons) */}
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
                  boxShadow: "0 2px 4px rgba(220, 38, 38, 0.08)",
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

            <div className="form-actions-mobile" style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
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
                style={{ background: "#ea580c", borderColor: "#c2410c", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
              >
                <Eye size={15} /> Review & Post Bill ({rupees(estimatedBillTotal)})
              </Button>
            </div>
          </form>
        </section>
      )}

      {/* VIEW 3: RECEIVE CUSTOMER MONEY */}
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
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span style={{ background: "#dcfce7", color: "#166534", padding: "4px 8px", borderRadius: 6, fontSize: 11, fontWeight: 700 }}>
                  COLLECTION ENTRY
                </span>
                <h2 style={{ margin: 0, fontSize: 19, color: "#0f172a" }}>Receive Money from Customer</h2>
              </div>
              <p className="muted" style={{ margin: "6px 0 0", fontSize: 12 }}>
                Record money collected from a direct customer. Credits their individual account immediately.
              </p>
            </div>
          </div>

          {payError && <p className="error" style={{ marginBottom: 16 }}>{payError}</p>}
          {paySuccess && (
            <div style={{ background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 10, padding: "12px 16px", color: "#166534", marginBottom: 20, fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}>
              <CheckCircle2 size={18} color="#16a34a" /> {paySuccess}
            </div>
          )}

          <form onSubmit={handleReceiveMoney} style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
                gap: 14,
                background: "#f8fafc",
                padding: "16px 16px",
                borderRadius: 12,
                border: "1px solid #e2e8f0",
              }}
            >
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#334155", marginBottom: 6 }}>
                  SELECT CUSTOMER *
                </label>
                <CustomerSearchableSelect
                  customers={customers}
                  selectedId={receiveCustomerId}
                  onSelect={(id) => setReceiveCustomerId(id)}
                  placeholder="Search customer to credit…"
                />
                {selectedReceiveCustomer && (
                  <div style={{ marginTop: 8, fontSize: 12, color: "#64748b", display: "flex", gap: 14, flexWrap: "wrap" }}>
                    <span>Beat: <b>{str(selectedReceiveCustomer.beat_name) || `Beat ${str(selectedReceiveCustomer.beat_code)}`}</b></span>
                    <span>Outstanding Due: <b style={{ color: parseFloat(str(selectedReceiveCustomer.balance || "0")) > 0 ? "#dc2626" : "#16a34a" }}>{rupees(selectedReceiveCustomer.balance)}</b></span>
                  </div>
                )}
              </div>

              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#334155", marginBottom: 6 }}>
                  PAYMENT DATE *
                </label>
                <input
                  type="date"
                  value={paymentDate}
                  onChange={(e) => setPaymentDate(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "9px 12px",
                    borderRadius: 10,
                    border: "1px solid #cbd5e1",
                    fontSize: 13,
                    background: "#ffffff",
                    fontWeight: 500,
                  }}
                />
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14 }}>
              <div style={{ background: "#ffffff", border: "1.5px solid #e2e8f0", borderRadius: 12, padding: "16px 16px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <Wallet size={16} color="#059669" />
                  <label style={{ fontSize: 13, fontWeight: 700, color: "#0f172a" }}>Cash Amount (₹)</label>
                </div>
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={cashAmount}
                  onChange={(e) => setCashAmount(e.target.value)}
                  style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1.5px solid #cbd5e1", fontSize: 16, fontWeight: 700 }}
                />
              </div>

              <div style={{ background: "#ffffff", border: "1.5px solid #e2e8f0", borderRadius: 12, padding: "16px 16px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <CreditCard size={16} color="#0284c7" />
                  <label style={{ fontSize: 13, fontWeight: 700, color: "#0f172a" }}>Bank / Online Amount (₹)</label>
                </div>
                <input
                  type="text"
                  placeholder="0.00 or e.g. 500 + 1,200"
                  value={bankAmount}
                  onChange={(e) => setBankAmount(e.target.value)}
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
                placeholder="e.g. UPI Ref #, Cheque number, or payment remark…"
                value={paymentNote}
                onChange={(e) => setPaymentNote(e.target.value)}
                style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid #cbd5e1", fontSize: 13 }}
              />
            </div>

            {/* Inline Message Banner for Payment (Full Width directly above action buttons) */}
            {payError && (
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
                  <span>{payError}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setPayError("")}
                  style={{ background: "none", border: "none", color: "#b91c1c", cursor: "pointer", padding: "0 4px", fontSize: 16, lineHeight: 1 }}
                  aria-label="Dismiss error"
                >
                  ✕
                </button>
              </div>
            )}

            {paySuccess && !payError && (
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
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <CheckCircle2 size={19} color="#16a34a" style={{ flexShrink: 0 }} />
                  <span>{paySuccess}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setPaySuccess("")}
                  style={{ background: "none", border: "none", color: "#166534", cursor: "pointer", padding: "0 4px", fontSize: 16, lineHeight: 1 }}
                  aria-label="Dismiss success message"
                >
                  ✕
                </button>
              </div>
            )}

            <div className="form-actions-mobile" style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
              <Button className="secondary" type="button" onClick={() => setActiveView("ledger")}>
                Cancel
              </Button>
              <Button
                className="primary"
                disabled={payBusy}
                type="submit"
                style={{ background: "#16a34a", borderColor: "#15803d" }}
              >
                {payBusy ? "Recording Receipt…" : "Save Payment"}
              </Button>
            </div>
          </form>
        </section>
      )}

      {/* VIEW: LOADING SHEET & PRODUCTS SUMMARY */}
      {activeView === "loading_sheet" && (
        <section className="panel" style={{ padding: "20px 22px" }}>
          {/* Top Header & Date Range Bar */}
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
                  Product Loading Sheet
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
                  MUBASHIR SALESMAN
                </span>
              </div>
              <p className="muted" style={{ margin: "4px 0 0", fontSize: 13 }}>
                Select bills across the date range to aggregate all required products, quantities, and MRP/rates for vehicle loading.
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
              {/* Salesman Scope Toggle */}
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
                <span style={{ fontSize: 12, fontWeight: 700, color: "#475569" }}>Route:</span>
                <div style={{ display: "flex", gap: 4 }}>
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
                    MUBASHIR SALESMAN
                  </button>
                  {salesmenList.length > 1 && (
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
                      setLoadingSheetFrom(date);
                      setLoadingSheetTo(date);
                    }}
                    style={{
                      padding: "4px 8px",
                      fontSize: 11,
                      fontWeight: 600,
                      borderRadius: 5,
                      border: "1px solid #cbd5e1",
                      background: loadingSheetFrom === date && loadingSheetTo === date ? "#0284c7" : "#ffffff",
                      color: loadingSheetFrom === date && loadingSheetTo === date ? "#ffffff" : "#475569",
                      cursor: "pointer",
                    }}
                  >
                    Today
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const prev = new Date(date + "T12:00:00+05:30");
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
                      const past = new Date(date + "T12:00:00+05:30");
                      past.setDate(past.getDate() - 7);
                      setLoadingSheetFrom(past.toISOString().slice(0, 10));
                      setLoadingSheetTo(date);
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
                {selectedBillIds.length} <span style={{ fontSize: 12, fontWeight: 500, color: "#64748b" }}>of {loadingBills.length}</span>
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
                Total Quantity to Load
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

          {/* Main 2-Column Split: Bills on Left (40%), Products on Right (60%) */}
          <div
            className="loading-sheet-grid"
            style={{ gridTemplateColumns: loadingSheetBillsCollapsed ? "52px 1fr" : undefined }}
          >
            {/* LEFT COLUMN: BILL SELECTOR */}
            {loadingSheetBillsCollapsed ? (
              <div
                className="no-print"
                onClick={() => setLoadingSheetBillsCollapsed(false)}
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
                    setLoadingSheetBillsCollapsed(false);
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
                    <small style={{ color: "#64748b" }}>Check bills to include in sheet</small>
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
                      onClick={() => setLoadingSheetBillsCollapsed(true)}
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
                      style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "#94a3b8" }}
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
                  {loadingSheetBillsQuery.isLoading ? (
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
                              onChange={() => { }} // parent onClick handles toggle
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
                                ) : b.returned ? (
                                  <span
                                    style={{
                                      fontSize: 10,
                                      fontWeight: 700,
                                      color: "#b45309",
                                      background: "#fef3c7",
                                      padding: "1px 5px",
                                      borderRadius: 4,
                                    }}
                                  >
                                    RETURNED
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

            {/* RIGHT COLUMN: AGGREGATED PRODUCTS & LOADING SHEET */}
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
                    Products to Load ({aggregatedProducts.length})
                  </h3>
                  <small style={{ color: "#64748b" }}>
                    Combined items across {selectedBillIds.length} selected bills
                  </small>
                </div>

                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <Button
                    className="secondary"
                    type="button"
                    onClick={() => setLoadingSheetBillsCollapsed((prev) => !prev)}
                    style={{ fontSize: 12, padding: "6px 10px", display: "flex", alignItems: "center", gap: 5 }}
                    title={loadingSheetBillsCollapsed ? "Expand bills sidebar" : "Collapse bills to sidebar rail"}
                  >
                    {loadingSheetBillsCollapsed ? <PanelLeftOpen size={14} /> : <PanelLeftClose size={14} />}
                    {loadingSheetBillsCollapsed ? "Expand Bills" : "Collapse Bills"}
                  </Button>
                  <Button
                    className="secondary"
                    type="button"
                    disabled={aggregatedProducts.length === 0}
                    onClick={handleCopyList}
                    style={{ fontSize: 12, padding: "6px 12px", display: "flex", alignItems: "center", gap: 6 }}
                  >
                    <Copy size={14} />
                    {copyFeedback ? "✓ Copied Table!" : "Copy Table"}
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
                      styleEl.innerHTML = `@media print { @page { size: A4 portrait; margin: 5mm 6mm; } }`;
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
                    No Bills Selected Yet
                  </div>
                  <p style={{ fontSize: 13, color: "#64748b", margin: "4px 0 0" }}>
                    Select one or more bills on the left to see the aggregated products and quantities to load.
                  </p>
                </div>
              ) : loadingSheetLinesQuery.isLoading ? (
                <div style={{ padding: 40, textAlign: "center", color: "#64748b", fontSize: 14 }}>
                  Fetching and combining product lines…
                </div>
              ) : loadingSheetLinesQuery.isError ? (
                <div style={{ padding: 30, textAlign: "center", color: "#dc2626", background: "#fef2f2", borderRadius: 10, border: "1px solid #fecaca" }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>Failed to fetch bill products</div>
                  <div style={{ fontSize: 12, marginTop: 4, color: "#7f1d1d" }}>
                    {(loadingSheetLinesQuery.error as Error)?.message || "Error communicating with server"}
                  </div>
                  <Button
                    className="secondary"
                    type="button"
                    onClick={() => loadingSheetLinesQuery.refetch()}
                    style={{ marginTop: 12, fontSize: 12 }}
                  >
                    Retry Loading Products
                  </Button>
                </div>
              ) : aggregatedProducts.length === 0 ? (
                <div style={{ padding: 30, textAlign: "center", color: "#94a3b8", fontSize: 13 }}>
                  The selected bills do not have any product lines recorded.
                </div>
              ) : (
                <>
                  {/* PRINT-ONLY CLEAN COMPACT HEADER */}
                  <div className="print-only" style={{ marginBottom: 10 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", borderBottom: "2px solid #0f172a", paddingBottom: 6, marginBottom: 6 }}>
                      <div>
                        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: "#0f172a", textTransform: "uppercase" }}>
                          Van Loading Sheet (Packing Checklist)
                        </h2>
                        <div style={{ fontSize: 10, color: "#334155", marginTop: 2 }}>
                          Route / Salesman: <strong>MUBASHIR SALESMAN</strong>
                        </div>
                      </div>
                      <div style={{ textAlign: "right", fontSize: 9.5, color: "#334155", lineHeight: 1.3 }}>
                        <div>Date: <strong>{!loadingSheetFrom && !loadingSheetTo ? "All Dates" : loadingSheetFrom === loadingSheetTo ? loadingSheetFrom : `${loadingSheetFrom || "Start"} to ${loadingSheetTo || "End"}`}</strong></div>
                        <div>Bills: <strong>{selectedBillIds.length}</strong> · SKUs: <strong>{aggregatedProducts.length}</strong></div>
                      </div>
                    </div>
                  </div>

                  {/* STRUCTURED ITEMIZED BREAKDOWN TABLE */}
                  <div className="loading-sheet-table-wrap" style={{ overflowX: "auto", border: "1px solid #e2e8f0", borderRadius: 8 }}>
                    <table className="ledger-table loading-sheet-table print-template-loading-sheet" style={{ width: "100%", fontSize: 12 }}>
                      <thead>
                        <tr style={{ background: "#f1f5f9", textAlign: "left" }}>
                          <th className="print-only" style={{ padding: "4px 6px", width: 26, textAlign: "center" }}>✓</th>
                          <th style={{ padding: "6px 8px", width: 32 }}>#</th>
                          <th style={{ padding: "6px 8px" }}>PRODUCT NAME</th>
                          <th style={{ padding: "6px 8px", textAlign: "right" }}>BILLED QTY</th>
                          <th style={{ padding: "6px 8px", textAlign: "right" }}>RATE</th>
                          <th style={{ padding: "6px 8px", textAlign: "right" }}>TOTAL VALUE</th>
                          <th style={{ padding: "6px 8px", textAlign: "center" }}>IN BILLS</th>
                        </tr>
                      </thead>
                      <tbody>
                        {aggregatedProducts.map((p, idx) => (
                          <tr
                            key={p.id}
                            style={{
                              borderBottom: "1px solid #f1f5f9",
                              background: idx % 2 === 0 ? "#ffffff" : "#fbfcfe",
                            }}
                          >
                            <td className="print-only" style={{ padding: "3px 4px", textAlign: "center", fontSize: 11, color: "#94a3b8" }}>
                              ☐
                            </td>
                            <td style={{ padding: "4px 8px", color: "#94a3b8", fontSize: 10 }}>
                              {idx + 1}
                            </td>
                            <td style={{ padding: "4px 8px", fontWeight: 600, color: "#0f172a" }}>
                              {p.name}
                              {p.code ? (
                                <small style={{ color: "#64748b", marginLeft: 4 }}>({p.code})</small>
                              ) : null}
                            </td>
                            <td
                              style={{
                                padding: "4px 8px",
                                textAlign: "right",
                                fontWeight: 800,
                                color: p.quantity.isZero() ? "#94a3b8" : "#0369a1",
                              }}
                            >
                              <div>{p.quantity.toString()} {p.unit}</div>
                              {p.returnedQuantity.gt(0) ? (
                                <div style={{ fontSize: 9, fontWeight: 600, color: "#d97706" }}>
                                  ({p.grossQuantity.toString()} billed - {p.returnedQuantity.toString()} ret)
                                </div>
                              ) : null}
                            </td>
                            <td style={{ padding: "4px 8px", textAlign: "right" }}>
                              {rupees(p.rate)}
                            </td>
                            <td
                              style={{
                                padding: "4px 8px",
                                textAlign: "right",
                                fontWeight: 700,
                                color: "#166534",
                              }}
                            >
                              {rupees(p.amount.toString())}
                            </td>
                            <td style={{ padding: "4px 8px", textAlign: "center" }}>
                              <span
                                style={{
                                  fontSize: 10,
                                  color: "#475569",
                                  background: "#e2e8f0",
                                  padding: "2px 6px",
                                  borderRadius: 8,
                                }}
                                title={`Present in: ${p.billNumbers.join(", ")}`}
                              >
                                {p.billNumbers.length} {p.billNumbers.length === 1 ? "bill" : "bills"}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr style={{ background: "#f8fafc", fontWeight: 800, borderTop: "2px solid #cbd5e1" }}>
                          <td className="print-only" style={{ padding: "6px" }}></td>
                          <td colSpan={2} style={{ padding: "6px 8px", textAlign: "right", textTransform: "uppercase", fontSize: 11, color: "#475569" }}>
                            Grand Total:
                          </td>
                          <td style={{ padding: "6px 8px", textAlign: "right", color: "#0369a1", fontSize: 13 }}>
                            {totalLoadedQty.toString()}
                          </td>
                          <td style={{ padding: "6px 8px", textAlign: "right" }}></td>
                          <td style={{ padding: "6px 8px", textAlign: "right", color: "#166534", fontSize: 13 }}>
                            {rupees(totalLoadedAmount.toString())}
                          </td>
                          <td style={{ padding: "6px 8px", textAlign: "center", fontSize: 10, color: "#64748b" }}>
                            {selectedBillIds.length} bills
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>

                  {/* PRINT-ONLY SIGNATURE FOOTER */}
                  <div className="print-only" style={{ marginTop: 20, paddingTop: 10, borderTop: "1px dashed #cbd5e1", fontSize: 9 }}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 30 }}>
                      <div>
                        <div style={{ height: 35, borderBottom: "1px solid #0f172a", marginBottom: 4 }} />
                        <strong>Loaded By (Warehouse Dispatch Sign):</strong>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ height: 35, borderBottom: "1px solid #0f172a", marginBottom: 4 }} />
                        <strong>Received / Checked By (Driver / Salesman Sign):</strong>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </section>
      )}

      {/* VIEW 4: CONSOLIDATED ROUTE REGISTER (BILLS, RECEIPTS, RETURNS, REVERSALS) */}
      {activeView === "register" && (
        <Documents
          onSelect={onSelect}
          kind="bill,receipt,return,reversal"
          salesmanId={selectedSalesmanId}
          title={`Route Register (${str(salesmenList.find((s) => str(s.id) === selectedSalesmanId)?.name || "This Route")})`}
        />
      )}

      {/* VIEW 5: CASH HANDOVERS & SETTLEMENTS */}
      {activeView === "handovers" && (
        <section className="panel" style={{ padding: "20px 22px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 14, marginBottom: 18 }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <h2 style={{ margin: 0, fontSize: 18, color: "#0f172a" }}>Cash Settlements & Handover History</h2>
                <span
                  style={{
                    background: "#dcfce7",
                    color: "#166534",
                    fontSize: 11,
                    fontWeight: 700,
                    padding: "3px 8px",
                    borderRadius: 6,
                  }}
                >
                  Direct Flow
                </span>
              </div>
              <p className="muted" style={{ margin: "4px 0 0", fontSize: 12 }}>
                Cash collected by salesman appears directly in manager's dashboard and moves to business physical till upon manager confirmation.
              </p>
            </div>
          </div>

          {/* Quick summary banner */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
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
                Cash Currently In Hand
              </small>
              <div style={{ fontSize: 20, fontWeight: 800, color: "#0f172a", marginTop: 2 }}>
                {rupees(cashInHand)}
              </div>
              <small style={{ color: "#64748b", fontSize: 11 }}>Awaiting physical receipt by manager into till</small>
            </div>
            <div>
              <small style={{ color: "#64748b", textTransform: "uppercase", fontSize: 11, fontWeight: 700 }}>
                Online Account (UPI)
              </small>
              <div style={{ fontSize: 20, fontWeight: 800, color: "#0369a1", marginTop: 2 }}>
                {rupees(onlineInAccount)}
              </div>
              <small style={{ color: "#64748b", fontSize: 11 }}>Awaiting transfer by manager to receiving bank</small>
            </div>
          </div>

          {handoversHistory.length === 0 ? (
            <Empty text="No cash handover records found for this salesman." />
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="ledger-table" style={{ width: "100%", fontSize: 13 }}>
                <thead>
                  <tr style={{ background: "#f1f5f9", textAlign: "left" }}>
                    <th style={{ padding: "10px 12px" }}>Date</th>
                    <th style={{ padding: "10px 12px" }}>Account</th>
                    <th style={{ padding: "10px 12px" }}>Handed Over</th>
                    <th style={{ padding: "10px 12px" }}>Accepted</th>
                    <th style={{ padding: "10px 12px" }}>Status</th>
                    <th style={{ padding: "10px 12px" }}>Salesman Note</th>
                    <th style={{ padding: "10px 12px" }}>Manager Note / Verification</th>
                  </tr>
                </thead>
                <tbody>
                  {handoversHistory.map((h) => {
                    const status = str(h.status);
                    const accountDisplay = str(
                      h.source_account_name && h.account_name && h.source_account_name !== h.account_name
                        ? `${str(h.source_account_name)} ➔ ${str(h.account_name)}`
                        : str(h.account_name || (str(h.method) === "online" ? "Demo receiving bank" : "Demo manager cash")) || "—"
                    );
                    return (
                      <tr key={str(h.id)} style={{ borderBottom: "1px solid #f1f5f9" }}>
                        <td style={{ padding: "10px 12px", whiteSpace: "nowrap" }}>
                          <div>{str(h.date)}</div>
                          {h.created_at ? (
                            <div style={{ fontSize: 11, color: "#94a3b8" }}>{timeOnlyLabel(h.created_at)}</div>
                          ) : null}
                        </td>
                        <td style={{ padding: "10px 12px", fontWeight: 500, color: "#0f172a" }}>
                          {accountDisplay}
                        </td>
                        <td style={{ padding: "10px 12px", fontWeight: 700 }}>
                          {rupees(h.amount)}
                        </td>
                        <td style={{ padding: "10px 12px" }}>
                          {h.accepted_amount ? (
                            <span style={{ fontWeight: 700, color: "#166534" }}>
                              {rupees(h.accepted_amount)}
                            </span>
                          ) : (
                            <span style={{ color: "#94a3b8" }}>—</span>
                          )}
                        </td>
                        <td style={{ padding: "10px 12px" }}>
                          {status === "pending" && (
                            <span
                              style={{
                                background: "#fef3c7",
                                color: "#b45309",
                                padding: "3px 8px",
                                borderRadius: 6,
                                fontSize: 11,
                                fontWeight: 700,
                              }}
                            >
                              🟡 PENDING CONFIRMATION
                            </span>
                          )}
                          {status === "confirmed" && (
                            <span
                              style={{
                                background: "#dcfce7",
                                color: "#166534",
                                padding: "3px 8px",
                                borderRadius: 6,
                                fontSize: 11,
                                fontWeight: 700,
                              }}
                            >
                              🟢 RECEIVED & CLEARED
                            </span>
                          )}
                          {status === "rejected" && (
                            <span
                              style={{
                                background: "#fee2e2",
                                color: "#991b1b",
                                padding: "3px 8px",
                                borderRadius: 6,
                                fontSize: 11,
                                fontWeight: 700,
                              }}
                            >
                              🔴 DISPUTED / REJECTED
                            </span>
                          )}
                        </td>
                        <td style={{ padding: "10px 12px", color: "#475569" }}>
                          {str(h.salesman_note) || "—"}
                        </td>
                        <td style={{ padding: "10px 12px", color: "#475569" }}>
                          {str(h.manager_note) || (h.verified_at ? `Verified on ${formatDateTime(h.verified_at)}` : "—")}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* Transfer Cash Modal */}
      {handoverModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15, 23, 42, 0.6)",
            backdropFilter: "blur(4px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: 16,
          }}
        >
          <div
            style={{
              background: "#ffffff",
              borderRadius: 16,
              maxWidth: 480,
              width: "100%",
              padding: 24,
              boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <ArrowLeftRight size={20} color="#2563eb" />
                <h3 style={{ margin: 0, fontSize: 17, color: "#0f172a" }}>Transfer Cash to Manager</h3>
              </div>
              <button
                type="button"
                style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#64748b" }}
                onClick={() => setHandoverModalOpen(false)}
              >
                ×
              </button>
            </div>

            <p style={{ margin: "0 0 16px", fontSize: 13, color: "#64748b" }}>
              Hand over physical cash collected to the manager. You can transfer full or partial amount. The manager will count and confirm receipt into the business till.
            </p>

            <div
              style={{
                background: "#f0fdf4",
                border: "1px solid #bbf7d0",
                borderRadius: 10,
                padding: "10px 14px",
                marginBottom: 16,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <div>
                <small style={{ color: "#166534", fontSize: 11, fontWeight: 700, textTransform: "uppercase" }}>
                  Available In Hand
                </small>
                <div style={{ fontSize: 17, fontWeight: 800, color: "#15803d" }}>
                  {rupees(cashInHand)}
                </div>
              </div>
              <Button
                type="button"
                className="secondary"
                style={{ fontSize: 11, padding: "4px 8px" }}
                onClick={() => setHandoverAmount(cashInHand !== "0.00" ? cashInHand : "")}
              >
                Transfer Full
              </Button>
            </div>

            <form onSubmit={handleInitiateHandover} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <Field label="Cash Amount to Transfer (₹) * (Supports Partial Amount)">
                <input
                  type="text"
                  inputMode="decimal"
                  value={handoverAmount}
                  onChange={(e) => setHandoverAmount(e.target.value)}
                  placeholder="e.g. 10000.00"
                  required
                  autoFocus
                />
              </Field>

              <Field label="Handover Note / Remarks (Optional)">
                <input
                  type="text"
                  value={handoverNote}
                  onChange={(e) => setHandoverNote(e.target.value)}
                  placeholder="e.g. Morning beat collections, 20x500 notes"
                />
              </Field>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 6 }}>
                <Button
                  type="button"
                  className="secondary"
                  disabled={handoverBusy}
                  onClick={() => setHandoverModalOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  className="primary"
                  disabled={handoverBusy}
                >
                  {handoverBusy ? "Initiating Handover…" : `Send ${rupees(handoverAmount || "0")} to Manager`}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
      {activeView === "saved_drafts" && (
        <section className="panel" style={{ padding: "20px 22px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
            <div>
              <h2 style={{ margin: 0, fontSize: 18, color: "#0f172a" }}>Saved Drafts · Mudashir New Bills</h2>
              <p className="muted" style={{ margin: "4px 0 0", fontSize: 12 }}>
                Drafts are saved locally in the database with no financial effect. Resume anytime to complete and post.
              </p>
            </div>
            <Button className="secondary" onClick={() => switchView("new_bill")} style={{ fontSize: 12 }}>
              <Plus size={14} /> New Bill
            </Button>
          </div>

          {directCigDrafts.length === 0 ? (
            <Empty text="No saved drafts for Mudashir bills." />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {directCigDrafts.map((dr) => {
                const dData = (dr.data ?? {}) as Row;
                const cName = dData.customerName ? str(dData.customerName) : "Unknown Customer";
                const bDate = dData.date ? str(dData.date) : "No date";
                const rowCnt = Array.isArray(dData.rowIds) ? dData.rowIds.length : Object.keys(dData.rowProducts || {}).length;

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
                        {cName}
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
                          loadDraftIntoBill(dr);
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
          customerList={customers}
          salesmanList={salesmenList}
          onClose={() => setReviewDraftRecord(null)}
          onResumeEdit={() => {
            const d = reviewDraftRecord;
            setReviewDraftRecord(null);
            if (d) loadDraftIntoBill(d);
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
            setBillWithPayments(true);
            setBillCashPay("");
            setBillOnlinePay("");
            setBillPaymentNote("");
            setBillDraft(null);
            setBillDraftNotice("");
            summaryQuery.refetch();
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

