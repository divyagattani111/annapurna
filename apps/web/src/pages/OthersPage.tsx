import React, { useState, useEffect, useMemo } from "react";
import Decimal from "decimal.js";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Utensils,
  Tv,
  Receipt,
  ArrowLeftRight,
  HandCoins,
  Printer,
  ChevronDown,
  ChevronUp,
  Clock,
  CheckCircle2,
  AlertCircle,
  Building2,
  Wallet,
  ArrowRight,
  PlusCircle,
  Sparkles,
  Users,
} from "lucide-react";
import {
  commandResult,
  rowsSchema,
  cleanMoney,
  parseMultiAmounts,
} from "@ledger/contracts";
import { api } from "../api";
import { Button, Field, Empty } from "../components/ui";
import { Documents, SignaturePad } from "../components/Documents";
import {
  D,
  str,
  arr,
  rupees,
  parseMoneyNumber,
  formatDateTime,
  type Row,
} from "../utils/helpers";

interface OthersPageProps {
  date: string;
  masters: Row;
  owner: boolean;
  onSelect: (id: string) => void;
}

export function OthersPage({
  date,
  masters,
  owner,
  onSelect,
}: OthersPageProps) {
  const [activeTab, setActiveTab] = useState<
    "foods" | "sony" | "expense" | "transfer" | "receive"
  >("foods");

  return (
    <>
      {/* Top Tab Bar inside Others */}
      <section className="panel" style={{ paddingBottom: 8, marginBottom: 16 }}>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 12,
            borderBottom: "1px solid #e7e5e4",
            paddingBottom: 4,
          }}
        >
          {[
            {
              id: "foods" as const,
              label: "Foods Collection",
              icon: Utensils,
              color: "#16a34a",
            },
            {
              id: "sony" as const,
              label: "Sony Collection",
              icon: Tv,
              color: "#7c3aed",
            },
            {
              id: "expense" as const,
              label: "Expenses & Staff Salary",
              icon: Receipt,
              color: "#ea580c",
            },
            {
              id: "transfer" as const,
              label: "Cash to Bank Transfer",
              icon: ArrowLeftRight,
              color: "#0284c7",
            },
            {
              id: "receive" as const,
              label: "Receive Money from Staff",
              icon: HandCoins,
              color: "#8b5cf6",
            },
          ].map((tab) => {
            const Icon = tab.icon;
            const isSelected = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                style={{
                  background: isSelected ? "#fafaf9" : "transparent",
                  border: "none",
                  borderRadius: "8px 8px 0 0",
                  padding: "10px 16px",
                  fontSize: "14px",
                  fontWeight: isSelected ? 700 : 500,
                  color: isSelected ? tab.color : "#57534e",
                  borderBottom: isSelected
                    ? `3px solid ${tab.color}`
                    : "3px solid transparent",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  transition: "all 0.15s ease",
                }}
              >
                <Icon size={18} style={{ color: isSelected ? tab.color : "#a8a29e" }} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </section>

      {/* Tab 1: Foods Collection */}
      {activeTab === "foods" && (
        <FoodsCollectionTab
          date={date}
          masters={masters}
          onSelect={onSelect}
        />
      )}

      {/* Tab 2: Sony Collection */}
      {activeTab === "sony" && (
        <SonyCollectionTab
          date={date}
          masters={masters}
          onSelect={onSelect}
        />
      )}

      {/* Tab 2: Expenses & Staff Salary (Money Out) */}
      {activeTab === "expense" && (
        <ExpensesAndSalaryTab
          date={date}
          masters={masters}
          owner={owner}
          onSelect={onSelect}
        />
      )}

      {/* Tab 3: Cash to Bank Transfer */}
      {activeTab === "transfer" && (
        <CashToBankTransferTab
          date={date}
          masters={masters}
          onSelect={onSelect}
        />
      )}

      {/* Tab 4: Receive Money from Staff (Money In) */}
      {activeTab === "receive" && (
        <ReceiveFromStaffTab
          date={date}
          masters={masters}
          onSelect={onSelect}
        />
      )}
    </>
  );
}

/* ===================================================================================
   SUB-TAB 1: FOODS COLLECTION
=================================================================================== */

function FoodsCollectionTab({
  date,
  masters,
  onSelect,
}: {
  date: string;
  masters: Row;
  onSelect: (id: string) => void;
}) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [showOptionalDetails, setShowOptionalDetails] = useState(false);

  const accounts = arr(masters.accounts);
  const cashAccounts = accounts.filter((a) => a.type === "cash");
  const bankAccounts = accounts.filter((a) => a.type === "bank");
  const defaultCash = str(cashAccounts[0]?.id ?? "");
  const defaultBank = str(bankAccounts[0]?.id ?? "");

  // Load foods salesmen
  const foodsSalesmenQuery = useQuery({
    queryKey: ["foods-salesmen"],
    queryFn: async () => {
      const r = await fetch("/api/v1/foods-salesmen");
      return (await r.json()) as Array<{
        id: string;
        name: string;
        territory?: string;
        phone?: string;
        active: boolean;
      }>;
    },
  });
  const foodsSalesmen = (foodsSalesmenQuery.data ?? []).filter((f) => f.active);

  // Form states
  const [selectedSalesman, setSelectedSalesman] = useState("");
  const [collectionDate, setCollectionDate] = useState(date);
  const [billNo, setBillNo] = useState("");
  const [foodItems, setFoodItems] = useState("");
  const [cashAmount, setCashAmount] = useState("");
  const [cashAccountId, setCashAccountId] = useState(defaultCash);
  const [bankAmount, setBankAmount] = useState("");
  const [bankAccountId, setBankAccountId] = useState(defaultBank);
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (!cashAccountId && defaultCash) setCashAccountId(defaultCash);
    if (!bankAccountId && defaultBank) setBankAccountId(defaultBank);
  }, [defaultCash, defaultBank, cashAccountId, bankAccountId]);

  // Query today's foods receipts for summary cards and live feed
  const todayReceiptsQuery = useQuery({
    queryKey: ["documents", "foods_receipt", date],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("kind", "foods_receipt");
      params.set("limit", "100");
      return (await api(`documents?${params.toString()}`, rowsSchema)) as Row[];
    },
  });

  const allReceipts = todayReceiptsQuery.data ?? [];
  const todayReceipts = allReceipts.filter(
    (r) => str(r.business_date) === date || str(r.date) === date
  );

  const todayCashTotal = todayReceipts.reduce((acc, r) => {
    const d = (r.data as Row) || {};
    return d.method === "cash" ? acc.plus(D(str(r.amount ?? "0"))) : acc;
  }, D(0));

  const todayBankTotal = todayReceipts.reduce((acc, r) => {
    const d = (r.data as Row) || {};
    return d.method === "online" ? acc.plus(D(str(r.amount ?? "0"))) : acc;
  }, D(0));

  const todayGrandTotal = todayCashTotal.plus(todayBankTotal);

  // Group today's receipts by salesman (Salesman-wise summary)
  const salesmanSummaries = useMemo(() => {
    const map = new Map<
      string,
      {
        name: string;
        cash: Decimal;
        online: Decimal;
        total: Decimal;
        count: number;
        receipts: Row[];
      }
    >();

    for (const r of todayReceipts) {
      const rowData = (r.data as Row) || {};
      const name = str(rowData.foodsSalesman ?? r.salesman_name ?? "Foods Salesman");
      const isOnline = rowData.method === "online";
      const amt = D(str(r.amount ?? "0"));

      if (!map.has(name)) {
        map.set(name, {
          name,
          cash: D(0),
          online: D(0),
          total: D(0),
          count: 0,
          receipts: [],
        });
      }
      const item = map.get(name)!;
      if (isOnline) {
        item.online = item.online.plus(amt);
      } else {
        item.cash = item.cash.plus(amt);
      }
      item.total = item.total.plus(amt);
      item.count += 1;
      item.receipts.push(r);
    }

    return Array.from(map.values()).sort((a, b) =>
      b.total.minus(a.total).toNumber()
    );
  }, [todayReceipts]);

  const pendingSalesmen = useMemo(() => {
    const recordedNames = new Set(
      salesmanSummaries.map((s) => s.name.toLowerCase().trim())
    );
    return foodsSalesmen.filter(
      (f) => !recordedNames.has(f.name.toLowerCase().trim())
    );
  }, [foodsSalesmen, salesmanSummaries]);

  // Calculations for current inputs
  const parsedBankAmounts = parseMultiAmounts(bankAmount);
  const totalBankParsed = parsedBankAmounts.reduce(
    (acc, curr) => acc.plus(curr),
    D(0)
  );
  const cleanCash = cleanMoney(cashAmount);
  const cashVal = cleanCash && !isNaN(Number(cleanCash)) ? D(cleanCash) : D(0);
  const currentTotal = cashVal.plus(totalBankParsed);

  // Handle clicking on a salesman to auto-select in dropdown
  const handleSelectSalesman = (name: string) => {
    const trimmed = name.trim();
    const matched = foodsSalesmen.find(
      (f) => f.name.toLowerCase().trim() === trimmed.toLowerCase()
    );
    setSelectedSalesman(matched ? matched.name : trimmed);
  };

  const handleFoodsSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");

    if (!selectedSalesman) {
      setError("Please select the foods salesman.");
      return;
    }

    const cashNum = cashVal.toNumber();
    const bankNum = totalBankParsed.toNumber();

    if (cashNum <= 0 && bankNum <= 0) {
      setError("Please enter at least one amount (cash or bank/online).");
      return;
    }

    setBusy(true);
    try {
      const salesmanObj = foodsSalesmen.find(
        (f) => f.name === selectedSalesman || f.id === selectedSalesman
      );
      const foodsSalesmanId = salesmanObj?.id;
      const foodsDisplayName = salesmanObj?.name || selectedSalesman;
      const messages: string[] = [];

      if (cashNum > 0) {
        await api(
          "commands/foodsReceipt",
          commandResult,
          {
            date: collectionDate,
            foodsSalesman: foodsDisplayName,
            foodsSalesmanId,
            billNo: billNo.trim(),
            foodItems: foodItems.trim(),
            method: "cash",
            cashAmount: cleanCash,
            bankAmount: "0.00",
            cashAccountId: cashAccountId || defaultCash || undefined,
            note: notes.trim(),
          },
          "POST",
          crypto.randomUUID()
        );
        messages.push(`Cash ₹${cleanCash} posted to Cash Drawer`);
      }

      if (bankNum > 0) {
        await api(
          "commands/foodsReceipt",
          commandResult,
          {
            date: collectionDate,
            foodsSalesman: foodsDisplayName,
            foodsSalesmanId,
            billNo: billNo.trim(),
            foodItems: foodItems.trim(),
            method: "online",
            cashAmount: "0.00",
            bankAmount: totalBankParsed.toFixed(2),
            bankAmounts:
              parsedBankAmounts.length > 0 ? parsedBankAmounts : undefined,
            bankAccountId: bankAccountId || defaultBank || undefined,
            verified: false,
            note: notes.trim(),
          },
          "POST",
          crypto.randomUUID()
        );
        messages.push(
          `Online ₹${totalBankParsed.toFixed(2)}${parsedBankAmounts.length > 1
            ? ` (${parsedBankAmounts.length} split items)`
            : ""
          } queued for verification`
        );
      }

      setSuccess(`Foods collection recorded: ${messages.join(" and ")}.`);
      setBillNo("");
      setFoodItems("");
      setCashAmount("");
      setBankAmount("");
      setNotes("");
      setShowOptionalDetails(false);
      await qc.invalidateQueries();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Modern Top Metrics Row */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          gap: 12,
        }}
      >
        <div
          style={{
            background: "#f0fdf4",
            border: "1px solid #bbf7d0",
            borderRadius: 8,
            padding: "12px 16px",
          }}
        >
          <div style={{ fontSize: 12, color: "#166534", fontWeight: 600 }}>
            Today's Foods Total
          </div>
          <div style={{ fontSize: 22, fontWeight: 800, color: "#15803d" }}>
            {rupees(todayGrandTotal.toFixed(2))}
          </div>
          <div style={{ fontSize: 11, color: "#15803d", marginTop: 2 }}>
            {todayReceipts.length} collection entries recorded today
          </div>
        </div>

        <div
          style={{
            background: "#fff",
            border: "1px solid #e7e5e4",
            borderRadius: 8,
            padding: "12px 16px",
          }}
        >
          <div style={{ fontSize: 12, color: "#78716c", fontWeight: 600 }}>
            Cash Collections
          </div>
          <div style={{ fontSize: 20, fontWeight: 700, color: "#44403c" }}>
            {rupees(todayCashTotal.toFixed(2))}
          </div>
          <div style={{ fontSize: 11, color: "#a8a29e", marginTop: 2 }}>
            Deposited to physical drawer
          </div>
        </div>

        <div
          style={{
            background: "#f0f9ff",
            border: "1px solid #bae6fd",
            borderRadius: 8,
            padding: "12px 16px",
          }}
        >
          <div style={{ fontSize: 12, color: "#0369a1", fontWeight: 600 }}>
            Bank / Online (UPI)
          </div>
          <div style={{ fontSize: 20, fontWeight: 700, color: "#0284c7" }}>
            {rupees(todayBankTotal.toFixed(2))}
          </div>
          <div style={{ fontSize: 11, color: "#0284c7", marginTop: 2 }}>
            Routed to bank verification queue
          </div>
        </div>
      </div>

      {/* Two-Column Layout: Salesman-wise Today's Collections (Left - 1/3) & Quick Entry Form (Right - 2/3) */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(280px, 1fr) minmax(360px, 2fr)",
          gap: 16,
        }}
        className="form-grid-mobile"
      >
        {/* Left Side: Salesman-wise Today's Collections (1/3 of width) */}
        <section className="panel" style={{ margin: 0, padding: "14px 16px" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 12,
              borderBottom: "1px solid #f5f5f4",
              paddingBottom: 8,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Users size={16} style={{ color: "#15803d" }} />
              <div>
                <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "#292524" }}>
                  Salesman-wise Today's Collection
                </h3>
                <div style={{ fontSize: 11, color: "#166534", marginTop: 1 }}>
                  Click salesman to select in form
                </div>
              </div>
            </div>
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                background: "#f0fdf4",
                color: "#166534",
                padding: "2px 8px",
                borderRadius: 12,
              }}
            >
              {salesmanSummaries.length} {salesmanSummaries.length === 1 ? "salesman" : "salesmen"}
            </span>
          </div>

          {salesmanSummaries.length === 0 ? (
            <div
              style={{
                padding: "16px 12px",
                textAlign: "center",
                background: "#fafaf9",
                border: "1px dashed #d6d3d1",
                borderRadius: 8,
                marginBottom: 10,
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 600, color: "#57534e" }}>
                No collections recorded yet today
              </div>
              <div style={{ fontSize: 11.5, color: "#a8a29e", marginTop: 3 }}>
                Click any salesman below to select & record.
              </div>
            </div>
          ) : (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 8,
                maxHeight: 440,
                overflowY: "auto",
                paddingRight: 2,
              }}
            >
              {salesmanSummaries.map((s) => {
                const isSelected =
                  selectedSalesman.trim().toLowerCase() === s.name.trim().toLowerCase();
                return (
                  <div
                    key={s.name}
                    onClick={() => handleSelectSalesman(s.name)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        handleSelectSalesman(s.name);
                      }
                    }}
                    title={`Click to select ${s.name} in Foods Salesman dropdown`}
                    style={{
                      background: isSelected ? "#f0fdf4" : "#fff",
                      border: isSelected ? "2px solid #16a34a" : "1px solid #e7e5e4",
                      borderRadius: 8,
                      padding: "9px 12px",
                      boxShadow: isSelected
                        ? "0 0 0 1px #16a34a, 0 2px 6px rgba(22, 163, 74, 0.15)"
                        : "0 1px 2px rgba(0,0,0,0.02)",
                      cursor: "pointer",
                      transition: "all 0.15s ease",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        marginBottom: 7,
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span
                          style={{
                            fontSize: 13.5,
                            fontWeight: 700,
                            color: isSelected ? "#15803d" : "#1c1917",
                          }}
                        >
                          {s.name}
                        </span>
                        {isSelected && (
                          <span
                            style={{
                              fontSize: 10,
                              fontWeight: 700,
                              background: "#16a34a",
                              color: "#fff",
                              padding: "1px 6px",
                              borderRadius: 10,
                            }}
                          >
                            Selected ✓
                          </span>
                        )}
                        <span
                          style={{
                            fontSize: 10.5,
                            color: "#78716c",
                            background: "#f5f5f4",
                            padding: "1px 6px",
                            borderRadius: 10,
                          }}
                        >
                          {s.count} {s.count === 1 ? "entry" : "entries"}
                        </span>
                      </div>

                      <div
                        style={{
                          fontSize: 15,
                          fontWeight: 800,
                          color: "#15803d",
                        }}
                      >
                        {rupees(s.total.toFixed(2))}
                      </div>
                    </div>

                    {/* Cash vs Online Split Badges */}
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "1fr 1fr",
                        gap: 8,
                        fontSize: 11.5,
                      }}
                    >
                      <div
                        style={{
                          background: "#fffbeb",
                          border: "1px solid #fef3c7",
                          borderRadius: 6,
                          padding: "4px 8px",
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                        }}
                      >
                        <span style={{ color: "#92400e", fontWeight: 600 }}>💵 Cash:</span>
                        <strong style={{ color: "#78350f" }}>{rupees(s.cash.toFixed(2))}</strong>
                      </div>

                      <div
                        style={{
                          background: "#f0f9ff",
                          border: "1px solid #e0f2fe",
                          borderRadius: 6,
                          padding: "4px 8px",
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                        }}
                      >
                        <span style={{ color: "#0369a1", fontWeight: 600 }}>📱 Online:</span>
                        <strong style={{ color: "#0c4a6e" }}>{rupees(s.online.toFixed(2))}</strong>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Pending Salesmen without collections today */}
          {pendingSalesmen.length > 0 && (
            <div
              style={{
                marginTop: 12,
                paddingTop: 10,
                borderTop: "1px dashed #e7e5e4",
              }}
            >
              <div
                style={{
                  fontSize: 10.5,
                  fontWeight: 600,
                  color: "#a8a29e",
                  marginBottom: 6,
                  textTransform: "uppercase",
                  letterSpacing: 0.5,
                }}
              >
                Not yet collected today:
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {pendingSalesmen.map((f) => {
                  const isSelected =
                    selectedSalesman.trim().toLowerCase() === f.name.trim().toLowerCase();
                  return (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => handleSelectSalesman(f.name)}
                      style={{
                        background: isSelected ? "#15803d" : "#f5f5f4",
                        color: isSelected ? "#fff" : "#78716c",
                        border: isSelected ? "1px solid #15803d" : "1px solid #e7e5e4",
                        borderRadius: 16,
                        padding: "3px 10px",
                        fontSize: 11,
                        fontWeight: isSelected ? 700 : 500,
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: 4,
                        transition: "all 0.15s ease",
                      }}
                      title={`Click to select ${f.name} in Foods Salesman dropdown`}
                    >
                      {isSelected ? "✓ " : "+ "}
                      {f.name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </section>

        {/* Right Side: Modern Foods Entry Form */}
        <section className="panel" style={{ margin: 0 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 16,
              borderBottom: "1px solid #f5f5f4",
              paddingBottom: 8,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Utensils size={18} style={{ color: "#16a34a" }} />
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "#292524" }}>
                Record Foods Collection
              </h3>
            </div>
            <span style={{ fontSize: 12, color: "#78716c" }}>
              Date: <strong>{collectionDate}</strong>
            </span>
          </div>

          <form onSubmit={handleFoodsSubmit}>
            {/* Salesman Quick Chips */}
            {foodsSalesmen.length > 0 && (
              <div style={{ marginBottom: 14 }}>
                <label
                  style={{
                    display: "block",
                    fontSize: 12,
                    fontWeight: 600,
                    color: "#57534e",
                    marginBottom: 6,
                  }}
                >
                  Quick Select Salesman:
                </label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {foodsSalesmen.map((f) => {
                    const isSelected =
                      selectedSalesman.trim().toLowerCase() === f.name.trim().toLowerCase() ||
                      selectedSalesman === f.id;
                    return (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => handleSelectSalesman(f.name)}
                        style={{
                          background: isSelected ? "#15803d" : "#f5f5f4",
                          color: isSelected ? "#fff" : "#44403c",
                          border: isSelected ? "1px solid #15803d" : "1px solid #e7e5e4",
                          borderRadius: 20,
                          padding: "4px 12px",
                          fontSize: 12,
                          fontWeight: isSelected ? 700 : 500,
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          gap: 4,
                          transition: "all 0.1s ease",
                        }}
                      >
                        {isSelected ? "✓ " : ""}
                        {f.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Field label="Foods Salesman *">
                <select
                  value={selectedSalesman}
                  onChange={(e) => setSelectedSalesman(e.target.value)}
                  required
                >
                  <option value="">Select salesman…</option>
                  {foodsSalesmen.map((f) => (
                    <option key={f.id} value={f.name}>
                      {f.name}
                    </option>
                  ))}
                  {selectedSalesman &&
                    !foodsSalesmen.some(
                      (f) => f.name.toLowerCase().trim() === selectedSalesman.toLowerCase().trim()
                    ) && (
                      <option value={selectedSalesman}>{selectedSalesman}</option>
                    )}
                </select>
              </Field>

              <Field label="Collection Date *">
                <input
                  type="date"
                  value={collectionDate}
                  onChange={(e) => setCollectionDate(e.target.value)}
                  required
                />
              </Field>
            </div>

            <div style={{ marginTop: 10 }}>
              <Field label="Notes / Remarks">
                <input
                  placeholder="e.g. Afternoon collection, route remarks, slip reference…"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </Field>
            </div>

            {/* Split Amount Box */}
            <div
              style={{
                background: "#fafaf9",
                border: "1px solid #e7e5e4",
                borderRadius: 8,
                padding: "12px 14px",
                marginTop: 8,
                marginBottom: 12,
              }}
            >
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 12,
                  marginBottom: 10,
                }}
              >
                <div>
                  <label
                    style={{
                      display: "block",
                      fontSize: 12,
                      fontWeight: 600,
                      color: "#44403c",
                      marginBottom: 4,
                    }}
                  >
                    💵 Cash Received (₹)
                  </label>
                  <input
                    inputMode="decimal"
                    placeholder="0.00"
                    value={cashAmount}
                    onChange={(e) => setCashAmount(e.target.value)}
                    style={{ fontSize: 15, fontWeight: 600 }}
                  />
                </div>

                <div>
                  <label
                    style={{
                      display: "block",
                      fontSize: 12,
                      fontWeight: 600,
                      color: "#0369a1",
                      marginBottom: 4,
                    }}
                  >
                    📱 Bank / Online (UPI) (₹)
                  </label>
                  <input
                    placeholder="e.g. 500 + 1200"
                    value={bankAmount}
                    onChange={(e) => setBankAmount(e.target.value)}
                    style={{ fontSize: 15, fontWeight: 600 }}
                  />
                </div>
              </div>

              {/* Split info pill if multiple online amounts entered */}
              {parsedBankAmounts.length > 1 && (
                <div
                  style={{
                    fontSize: 11,
                    color: "#0369a1",
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 4,
                    alignItems: "center",
                    marginBottom: 8,
                  }}
                >
                  <span>Split online entries:</span>
                  {parsedBankAmounts.map((amt, idx) => (
                    <span
                      key={idx}
                      style={{
                        background: "#e0f2fe",
                        padding: "1px 6px",
                        borderRadius: 4,
                        fontWeight: 600,
                      }}
                    >
                      ₹{amt}
                    </span>
                  ))}
                </div>
              )}

              {/* Total Calculation Banner */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "8px 12px",
                  borderRadius: 6,
                  background: currentTotal.gt(0) ? "#f0fdf4" : "#f5f5f4",
                  border: currentTotal.gt(0)
                    ? "1.5px solid #86efac"
                    : "1px solid #e7e5e4",
                  color: currentTotal.gt(0) ? "#15803d" : "#78716c",
                  fontWeight: 700,
                  fontSize: 15,
                }}
              >
                <span>Total Received</span>
                <span style={{ fontSize: 18, fontWeight: 800 }}>
                  ₹{currentTotal.toFixed(2)}
                </span>
              </div>
            </div>

            {/* Optional Collapsible Details */}
            <div style={{ marginBottom: 12 }}>
              <button
                type="button"
                onClick={() => setShowOptionalDetails(!showOptionalDetails)}
                style={{
                  background: "none",
                  border: "none",
                  color: "#0284c7",
                  fontSize: 12,
                  fontWeight: 600,
                  padding: "4px 0",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                {showOptionalDetails ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                {showOptionalDetails ? "Hide bill & item details" : "+ Add bill number or food items (optional)"}
              </button>

              {showOptionalDetails && (
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 10,
                    marginTop: 8,
                    padding: 10,
                    background: "#fafaf9",
                    borderRadius: 6,
                  }}
                >
                  <Field label="Bill No">
                    <input
                      placeholder="e.g. FOOD-8821"
                      value={billNo}
                      onChange={(e) => setBillNo(e.target.value)}
                    />
                  </Field>

                  <Field label="Food Items">
                    <input
                      placeholder="e.g. Spices, Atta, Grains"
                      value={foodItems}
                      onChange={(e) => setFoodItems(e.target.value)}
                    />
                  </Field>
                </div>
              )}
            </div>

            {error && <p role="alert" className="error">{error}</p>}
            {success && <p role="status" className="notice">{success}</p>}

            <div style={{ marginTop: 14, display: "flex", justifyContent: "flex-end" }}>
              <Button
                className="primary"
                disabled={busy}
                type="submit"
                style={{ padding: "10px 24px", width: "100%" }}
              >
                {busy ? "Recording…" : "Save Foods Collection"}
              </Button>
            </div>
          </form>
        </section>
      </div>

      {/* Full Foods Register */}
      <Documents
        onSelect={onSelect}
        kind="foods_receipt"
        title="Foods Collections Register"
      />
    </div>
  );
}

/* ===================================================================================
   SUB-TAB: SONY COLLECTION
=================================================================================== */

function SonyCollectionTab({
  date,
  masters,
  onSelect,
}: {
  date: string;
  masters: Row;
  onSelect: (id: string) => void;
}) {
  const qc = useQueryClient();
  const accounts = arr(masters.accounts);
  const defaultCash = str(accounts.find((a) => a.type === "cash")?.id ?? "");
  const defaultBank = str(accounts.find((a) => a.type === "bank")?.id ?? "");

  const [collectionDate, setCollectionDate] = useState(date);
  const [area, setArea] = useState("");
  const [cashAmount, setCashAmount] = useState("");
  const [bankAmount, setBankAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [createdDocId, setCreatedDocId] = useState<string | null>(null);

  const sonyReceiptsQuery = useQuery({
    queryKey: ["documents", "sony_receipt"],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("kind", "sony_receipt");
      params.set("limit", "100");
      return (await api(`documents?${params.toString()}`, rowsSchema)) as Row[];
    },
  });

  const allReceipts = sonyReceiptsQuery.data ?? [];
  const todayReceipts = allReceipts.filter(
    (r) => str(r.business_date) === date || str(r.date) === date
  );

  const todayCashTotal = todayReceipts.reduce((acc, r) => {
    const d = (r.data as Row) || {};
    return d.method === "cash" ? acc.plus(D(str(r.amount ?? "0"))) : acc;
  }, D(0));

  const todayBankTotal = todayReceipts.reduce((acc, r) => {
    const d = (r.data as Row) || {};
    return d.method === "online" ? acc.plus(D(str(r.amount ?? "0"))) : acc;
  }, D(0));

  const todayGrandTotal = todayCashTotal.plus(todayBankTotal);

  const handleSonySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");
    setCreatedDocId(null);

    const cleanCash = cleanMoney(cashAmount);
    const parsedBankAmounts = parseMultiAmounts(bankAmount);
    const totalBankParsed = parsedBankAmounts.reduce(
      (acc, curr) => acc.plus(D(curr)),
      D(0)
    );

    const cashNum = cleanCash ? parseMoneyNumber(cleanCash) : 0;
    const bankNum = totalBankParsed.toNumber();

    if (cashNum <= 0 && bankNum <= 0) {
      setError("Please enter at least one collection amount (Cash or Online).");
      return;
    }
    if (!area.trim()) {
      setError("Please enter the area.");
      return;
    }

    setBusy(true);
    try {
      const messages: string[] = [];
      let lastId: string | null = null;

      if (cashNum > 0) {
        const res = await api(
          "commands/sonyReceipt",
          commandResult,
          {
            date: collectionDate,
            area: area.trim(),
            method: "cash",
            cashAmount: cleanCash,
            bankAmount: "0.00",
            cashAccountId: defaultCash || undefined,
            note: notes.trim(),
          },
          "POST",
          crypto.randomUUID()
        );
        if (res?.id) lastId = res.id;
        messages.push(`Cash ₹${cleanCash} deposited to Cash Drawer`);
      }

      if (bankNum > 0) {
        const res = await api(
          "commands/sonyReceipt",
          commandResult,
          {
            date: collectionDate,
            area: area.trim(),
            method: "online",
            cashAmount: "0.00",
            bankAmount: totalBankParsed.toFixed(2),
            bankAmounts: parsedBankAmounts.length > 0 ? parsedBankAmounts : undefined,
            bankAccountId: defaultBank || undefined,
            verified: false,
            note: notes.trim(),
          },
          "POST",
          crypto.randomUUID()
        );
        if (res?.id) lastId = res.id;
        messages.push(
          `Online ₹${totalBankParsed.toFixed(2)}${parsedBankAmounts.length > 1
            ? ` (${parsedBankAmounts.length} split items)`
            : ""
          } queued for bank verification`
        );
      }

      setSuccess(`Sony collection (${area.trim()}) recorded: ${messages.join(" and ")}.`);
      if (lastId) setCreatedDocId(lastId);
      setArea("");
      setCashAmount("");
      setBankAmount("");
      setNotes("");
      await qc.invalidateQueries();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Top Metrics Row: Total, Cash, Online */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          gap: 12,
        }}
      >
        <div
          style={{
            background: "#faf5ff",
            border: "1px solid #e9d5ff",
            borderRadius: 8,
            padding: "12px 16px",
          }}
        >
          <div style={{ fontSize: 12, color: "#7c3aed", fontWeight: 600 }}>
            Today's Sony Total
          </div>
          <div style={{ fontSize: 22, fontWeight: 800, color: "#6b21a8" }}>
            {rupees(todayGrandTotal.toFixed(2))}
          </div>
          <div style={{ fontSize: 11, color: "#9333ea", marginTop: 2 }}>
            {todayReceipts.length} collection entries recorded today
          </div>
        </div>

        <div
          style={{
            background: "#f0fdf4",
            border: "1px solid #bbf7d0",
            borderRadius: 8,
            padding: "12px 16px",
          }}
        >
          <div style={{ fontSize: 12, color: "#166534", fontWeight: 600 }}>
            Cash Collections
          </div>
          <div style={{ fontSize: 20, fontWeight: 700, color: "#15803d" }}>
            {rupees(todayCashTotal.toFixed(2))}
          </div>
          <div style={{ fontSize: 11, color: "#15803d", marginTop: 2 }}>
            Deposited to physical Cash Drawer
          </div>
        </div>

        <div
          style={{
            background: "#f0f9ff",
            border: "1px solid #bae6fd",
            borderRadius: 8,
            padding: "12px 16px",
          }}
        >
          <div style={{ fontSize: 12, color: "#0369a1", fontWeight: 600 }}>
            Bank / Online (UPI)
          </div>
          <div style={{ fontSize: 20, fontWeight: 700, color: "#0284c7" }}>
            {rupees(todayBankTotal.toFixed(2))}
          </div>
          <div style={{ fontSize: 11, color: "#0284c7", marginTop: 2 }}>
            Routed to bank verification queue
          </div>
        </div>
      </div>

      {/* Sony Collection Entry Form */}
      <section className="panel" style={{ paddingBottom: 16 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 16,
            borderBottom: "1px solid #f5f5f4",
            paddingBottom: 8,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Tv size={18} style={{ color: "#7c3aed" }} />
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "#292524" }}>
              Record Sony Collection
            </h3>
          </div>
          <span style={{ fontSize: 12, color: "#78716c" }}>
            Date: <strong>{collectionDate}</strong>
          </span>
        </div>

        <form onSubmit={handleSonySubmit}>
          {/* Line 1: Date, Area, Notes */}
          <div
            className="form-grid-mobile"
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(140px, 1fr) minmax(200px, 1.3fr) minmax(200px, 1.7fr)",
              gap: "0 16px",
              alignItems: "end",
            }}
          >
            <Field label="Date *">
              <input
                type="date"
                value={collectionDate}
                onChange={(e) => setCollectionDate(e.target.value)}
                required
              />
            </Field>

            <Field label="Area *">
              <input
                placeholder="e.g. Adoni, Yemmiganur, Market…"
                value={area}
                onChange={(e) => setArea(e.target.value)}
                required
              />
            </Field>

            <Field label="Notes / Remarks">
              <input
                placeholder="e.g. Counter collection, slip #, remarks…"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </Field>
          </div>

          {/* Line 2: Cash Amount, Online Amount, Submit Button */}
          <div
            className="form-grid-mobile"
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(180px, 1.2fr) minmax(180px, 1.5fr) minmax(160px, 1.3fr)",
              gap: "0 16px",
              alignItems: "end",
            }}
          >
            <Field label="💵 Cash Amount (₹)">
              <input
                inputMode="decimal"
                placeholder="0.00"
                value={cashAmount}
                onChange={(e) => setCashAmount(e.target.value)}
              />
            </Field>

            <Field label="📱 Bank / Online (UPI) Amount (₹)">
              <input
                placeholder="0.00 or 1500 + 500"
                value={bankAmount}
                onChange={(e) => setBankAmount(e.target.value)}
              />
            </Field>

            <div style={{ margin: "15px 0", display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
              <Button
                className="primary"
                disabled={busy}
                type="submit"
                style={{
                  width: "100%",
                  height: 38,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontWeight: 600,
                  background: "#7c3aed",
                  borderColor: "#7c3aed",
                }}
              >
                {busy ? "Recording…" : "Record Sony Collection"}
              </Button>
            </div>
          </div>

          {error && <p role="alert" className="error" style={{ marginTop: 12 }}>{error}</p>}
          {success && (
            <div
              role="status"
              className="notice"
              style={{
                marginTop: 12,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                flexWrap: "wrap",
                gap: 10,
              }}
            >
              <span>{success}</span>
              {createdDocId && (
                <Button
                  type="button"
                  className="primary"
                  style={{ fontSize: 13, padding: "6px 14px" }}
                  onClick={() => onSelect(createdDocId)}
                >
                  <Printer size={15} style={{ marginRight: 6 }} /> View & Print Voucher
                </Button>
              )}
            </div>
          )}
        </form>
      </section>

      {/* Sony Collection Register Table below */}
      <section className="panel" style={{ paddingBottom: 16 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 14,
            borderBottom: "1px solid #f5f5f4",
            paddingBottom: 8,
          }}
        >
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "#292524" }}>
            Sony Collections Register
          </h3>
          <span style={{ fontSize: 12, color: "#78716c" }}>
            Total entries: <strong>{allReceipts.length}</strong>
          </span>
        </div>

        {allReceipts.length === 0 ? (
          <Empty text="No Sony collections recorded yet." />
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: "#fafaf9", borderBottom: "2px solid #e7e5e4", textAlign: "left" }}>
                  <th style={{ padding: "8px 12px", color: "#57534e", fontWeight: 600 }}>Date</th>
                  <th style={{ padding: "8px 12px", color: "#57534e", fontWeight: 600 }}>Voucher #</th>
                  <th style={{ padding: "8px 12px", color: "#57534e", fontWeight: 600 }}>Area</th>
                  <th style={{ padding: "8px 12px", color: "#57534e", fontWeight: 600 }}>Method</th>
                  <th style={{ padding: "8px 12px", color: "#57534e", fontWeight: 600, textAlign: "right" }}>Cash (₹)</th>
                  <th style={{ padding: "8px 12px", color: "#57534e", fontWeight: 600, textAlign: "right" }}>Online (₹)</th>
                  <th style={{ padding: "8px 12px", color: "#57534e", fontWeight: 600, textAlign: "right" }}>Total</th>
                  <th style={{ padding: "8px 12px", color: "#57534e", fontWeight: 600 }}>Notes</th>
                  <th style={{ padding: "8px 12px", color: "#57534e", fontWeight: 600, textAlign: "center" }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {allReceipts.map((r) => {
                  const dataObj = (r.data as Row) || {};
                  const isReversed = !!r.reverses || !!r.reversed_by;
                  const isOnline = dataObj.method === "online";
                  const cashVal = str(dataObj.cashAmount ?? (isOnline ? "0.00" : r.amount ?? "0"));
                  const bankVal = str(dataObj.bankAmount ?? (isOnline ? r.amount ?? "0" : "0.00"));
                  return (
                    <tr
                      key={str(r.id)}
                      style={{
                        borderBottom: "1px solid #f5f5f4",
                        textDecoration: isReversed ? "line-through" : "none",
                        opacity: isReversed ? 0.6 : 1,
                      }}
                    >
                      <td style={{ padding: "8px 12px", color: "#44403c" }}>
                        {str(r.business_date ?? r.date ?? "—")}
                      </td>
                      <td style={{ padding: "8px 12px", fontWeight: 600, color: "#0c4a6e" }}>
                        {str(r.number ?? "—")}
                      </td>
                      <td style={{ padding: "8px 12px", color: "#292524", fontWeight: 600 }}>
                        <span
                          style={{
                            background: "#faf5ff",
                            color: "#7c3aed",
                            padding: "2px 8px",
                            borderRadius: 4,
                            fontSize: 12,
                            fontWeight: 600,
                          }}
                        >
                          {str(dataObj.area ?? "—")}
                        </span>
                      </td>
                      <td style={{ padding: "8px 12px" }}>
                        <span
                          style={{
                            background: isOnline ? "#f0f9ff" : "#f0fdf4",
                            color: isOnline ? "#0284c7" : "#15803d",
                            border: isOnline ? "1px solid #bae6fd" : "1px solid #bbf7d0",
                            padding: "2px 8px",
                            borderRadius: 12,
                            fontSize: 11,
                            fontWeight: 600,
                          }}
                        >
                          {isOnline ? "Online (UPI)" : "Physical Cash"}
                        </span>
                      </td>
                      <td style={{ padding: "8px 12px", textAlign: "right", color: "#44403c" }}>
                        {parseMoneyNumber(cashVal) > 0 ? rupees(cashVal) : "—"}
                      </td>
                      <td style={{ padding: "8px 12px", textAlign: "right", color: "#0284c7" }}>
                        {parseMoneyNumber(bankVal) > 0 ? rupees(bankVal) : "—"}
                      </td>
                      <td style={{ padding: "8px 12px", textAlign: "right", fontWeight: 700, color: "#15803d" }}>
                        {rupees(str(r.amount ?? "0"))}
                      </td>
                      <td style={{ padding: "8px 12px", color: "#78716c", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {str(dataObj.note ?? r.note ?? "—")}
                      </td>
                      <td style={{ padding: "8px 12px", textAlign: "center" }}>
                        <Button
                          type="button"
                          className="secondary"
                          style={{ fontSize: 11, padding: "3px 8px" }}
                          onClick={() => onSelect(str(r.id))}
                        >
                          <Printer size={13} style={{ marginRight: 4 }} /> View
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

/* ===================================================================================
   SUB-TAB 3: EXPENSES & STAFF SALARY (MONEY OUT)
=================================================================================== */

function ExpensesAndSalaryTab({
  date,
  masters,
  owner,
  onSelect,
}: {
  date: string;
  masters: Row;
  owner: boolean;
  onSelect: (id: string) => void;
}) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [createdDocId, setCreatedDocId] = useState<string | null>(null);

  const accounts = arr(masters.accounts);
  const defaultCash = str(accounts.find((a) => a.type === "cash")?.id ?? "");

  // Employees query
  const employeesQuery = useQuery({
    queryKey: ["employees"],
    queryFn: async () => {
      const r = await fetch("/api/v1/employees");
      return (await r.json()) as Array<{
        id: string;
        name: string;
        role: string;
        phone?: string;
        active: boolean;
      }>;
    },
  });
  const employeeOptions = (employeesQuery.data ?? []).filter((e) => e.active);

  // Foods salesmen query
  const foodsSalesmenQuery = useQuery({
    queryKey: ["foods-salesmen"],
    queryFn: async () => {
      const r = await fetch("/api/v1/foods-salesmen");
      return (await r.json()) as Array<{
        id: string;
        name: string;
        territory?: string;
        phone?: string;
        active: boolean;
      }>;
    },
  });
  const foodsSalesmen = (foodsSalesmenQuery.data ?? []).filter((f) => f.active);
  const cigSalesmen = arr(masters.salesmen).filter((s) => s.active !== false);

  const allStaffRecipients = [
    ...employeeOptions.map((e) => ({
      id: `emp:${e.id}`,
      name: e.name,
      subtitle: e.role ? `(${e.role})` : "",
      group: "employee" as const,
      employeeId: e.id,
    })),
    ...foodsSalesmen.map((f) => ({
      id: `foods:${f.id}`,
      name: f.name,
      subtitle: f.territory ? `(${f.territory})` : "(Foods)",
      group: "foods" as const,
      employeeId: undefined,
    })),
    ...cigSalesmen.map((c) => ({
      id: `cig:${str(c.id)}`,
      name: str(c.name),
      subtitle: c.code ? `(${c.code})` : "(Cig)",
      group: "cig" as const,
      employeeId: undefined,
    })),
  ];

  // Unified Smart Form State
  const EXPENSE_CATEGORIES = [
    "Cig Return Packet",
    "Hamali",
    "Diesel / Vehicle Fuel",
    "Shop / Godown Rent",
    "Electricity / Utilities",
    "Transport / Freight",
    "Repairs & Maintenance",
    "Stationery & Printing",
    "Tea, Snacks & Refreshment",
    "Packaging Materials",
    "Miscellaneous Expense",
  ];

  const [category, setCategory] = useState<string>("staff_advance");
  const [amount, setAmount] = useState("");
  const [payee, setPayee] = useState("");
  const [staffMember, setStaffMember] = useState("");
  const [salaryPeriod, setSalaryPeriod] = useState("");
  const [notes, setNotes] = useState("");
  const [payoutDate, setPayoutDate] = useState(date);
  const [signatureBlob, setSignatureBlob] = useState<Blob | null>(null);

  const payoutAccount = defaultCash;

  const isStaffSalary = category === "staff_salary";
  const isStaffAdvance = category === "staff_advance";
  const isOperatingExpense = !isStaffSalary && !isStaffAdvance;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");
    setCreatedDocId(null);

    const cleanAmt = cleanMoney(amount);
    if (!cleanAmt || parseMoneyNumber(cleanAmt) <= 0) {
      setError("Please enter a valid amount.");
      return;
    }
    if (!payoutAccount) {
      setError("No cash account found to record payout.");
      return;
    }

    setBusy(true);
    try {
      if (isStaffSalary) {
        if (!staffMember.trim()) {
          setError("Please select the staff member.");
          setBusy(false);
          return;
        }
        const selectedRecipient = allStaffRecipients.find(
          (r) => r.id === staffMember || r.name.toLowerCase() === staffMember.trim().toLowerCase()
        );
        const empDisplayName = selectedRecipient?.name || staffMember.trim();
        const employeeId = selectedRecipient?.employeeId;

        const docResult = await api(
          "commands/salary",
          commandResult,
          {
            date: payoutDate,
            payee: empDisplayName,
            employeeId,
            period: salaryPeriod.trim() || "Regular Salary",
            amount: cleanAmt,
            setoff: "0",
            accountId: payoutAccount,
            note: notes.trim(),
          },
          "POST",
          crypto.randomUUID()
        );
        if (docResult?.id) {
          setCreatedDocId(docResult.id);
          setSuccess(`Staff salary recorded successfully as #${docResult.number ?? ""}.`);
        } else {
          setSuccess("Staff salary recorded successfully.");
        }
        setAmount("");
        setNotes("");
        setSalaryPeriod("");
      } else if (isStaffAdvance) {
        if (!staffMember.trim()) {
          setError("Please select the staff member.");
          setBusy(false);
          return;
        }
        const selectedRecipient = allStaffRecipients.find(
          (r) => r.id === staffMember || r.name.toLowerCase() === staffMember.trim().toLowerCase()
        );
        const empDisplayName = selectedRecipient?.name || staffMember.trim();
        const employeeId = selectedRecipient?.employeeId;

        const docResult: { id?: string; number?: string; amount?: string } | null = await api(
          "commands/loan",
          commandResult,
          {
            date: payoutDate,
            direction: "staff",
            counterparty: empDisplayName,
            employeeId,
            accountId: payoutAccount,
            amount: cleanAmt,
            note: notes.trim(),
          },
          "POST",
          crypto.randomUUID()
        );
        if (docResult?.id) {
          setCreatedDocId(docResult.id);
          setSuccess(`Staff advance recorded successfully as #${docResult.number ?? ""}.`);
        } else {
          setSuccess("Staff advance recorded successfully.");
        }

        if (docResult?.id && signatureBlob) {
          try {
            const sigFile = new File([signatureBlob], "employee-signature.png", {
              type: "image/png",
            });
            const form = new FormData();
            form.set("file", sigFile);
            await fetch("/api/v1/attachments/" + docResult.id, {
              method: "POST",
              body: form,
            });
          } catch (uploadErr) {
            console.error("Signature upload failed", uploadErr);
          }
        }
        setAmount("");
        setNotes("");
        setSignatureBlob(null);
      } else {
        // Business Operating Expense
        const payeeVal = payee.trim() || category;
        const docResult = await api(
          "commands/expense",
          commandResult,
          {
            date: payoutDate,
            category: category,
            payee: payeeVal,
            amount: cleanAmt,
            note: notes.trim(),
            legs: [{ accountId: payoutAccount, amount: cleanAmt }],
          },
          "POST",
          crypto.randomUUID()
        );
        if (docResult?.id) {
          setCreatedDocId(docResult.id);
          setSuccess(`Operating expense for ${category} recorded successfully as #${docResult.number ?? ""}.`);
        } else {
          setSuccess(`Operating expense for ${category} recorded successfully.`);
        }
        setAmount("");
        setPayee("");
        setNotes("");
      }
      await qc.invalidateQueries();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <section className="panel" style={{ paddingBottom: 16 }}>
        {/* Header with Title and Current Date */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 12,
            borderBottom: "1px solid #f5f5f4",
            paddingBottom: 8,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Receipt size={18} style={{ color: "#ea580c" }} />
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "#292524" }}>
              Record Money Out / Expense / Staff Payout
            </h3>
          </div>
          <span style={{ fontSize: 12, color: "#78716c" }}>
            Date: <strong>{payoutDate}</strong>
          </span>
        </div>

        {/* Single Unified Form - 2 Lines Max */}
        <form onSubmit={handleSubmit}>
          <div
            className="form-grid-mobile"
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(200px, 1.2fr) minmax(220px, 1.5fr) minmax(130px, 1fr)",
              gap: "0 16px",
              alignItems: "end",
            }}
          >
            {/* --- LINE 1 --- */}
            {/* Col 1: Category Selector */}
            <Field label="Payout Category / Purpose *">
              <select
                value={category}
                onChange={(e) => {
                  setCategory(e.target.value);
                  setError("");
                  setSuccess("");
                }}
                required
              >
                <optgroup label="👥 Staff & Employee Payments">
                  <option value="staff_advance">Staff Advance / Loan</option>
                  <option value="staff_salary">Staff Monthly Salary</option>
                </optgroup>
                <optgroup label="🏢 Business Operating Expenses">
                  {EXPENSE_CATEGORIES.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </optgroup>
              </select>
            </Field>

            {/* Col 2: Recipient / Employee Field (Context-Aware) */}
            {isOperatingExpense ? (
              <Field label="Recipient / Payee *">
                <input
                  placeholder="e.g. Bharat Petroleum, Landlord, Electricity Dept…"
                  value={payee}
                  onChange={(e) => setPayee(e.target.value)}
                  required
                />
              </Field>
            ) : (
              <Field label="Staff Member *">
                <select
                  value={staffMember}
                  onChange={(e) => setStaffMember(e.target.value)}
                  required
                >
                  <option value="">Choose recipient / staff member…</option>
                  <optgroup label="👨‍💼 Staff & Employees">
                    {employeeOptions.map((e) => (
                      <option key={`emp-${e.id}`} value={`emp:${e.id}`}>
                        {e.name} {e.role ? `(${e.role})` : ""}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="🍞 Foods Salesmen">
                    {foodsSalesmen.map((f) => (
                      <option key={`foods-${f.id}`} value={`foods:${f.id}`}>
                        {f.name} {f.territory ? `(${f.territory})` : "(Foods Salesman)"}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="🚬 Cigarette Salesmen">
                    {cigSalesmen.map((s) => (
                      <option key={`cig-${str(s.id)}`} value={`cig:${str(s.id)}`}>
                        {str(s.name)} {s.code ? `(${s.code})` : "(Cig Salesman)"}
                      </option>
                    ))}
                  </optgroup>
                </select>
              </Field>
            )}

            {/* Col 3: Date */}
            <Field label="Date *">
              <input
                type="date"
                value={payoutDate}
                onChange={(e) => setPayoutDate(e.target.value)}
                required
              />
            </Field>

            {/* --- LINE 2 --- */}
            {/* Col 1 (or Col 1+2 for operating expense): Amount */}
            <div style={{ gridColumn: isOperatingExpense ? "span 2" : "span 1" }}>
              <Field label="Amount (₹) *">
                <input
                  inputMode="decimal"
                  placeholder="0.00"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  required
                />
              </Field>
            </div>

            {/* Col 2: Context Field for Salary or Advance */}
            {isStaffSalary && (
              <Field label="Salary Month / Period">
                <input
                  placeholder="e.g. November 2026"
                  value={salaryPeriod}
                  onChange={(e) => setSalaryPeriod(e.target.value)}
                />
              </Field>
            )}

            {isStaffAdvance && (
              <Field label="Advance Purpose / Remarks">
                <input
                  placeholder="e.g. Medical emergency, festival advance…"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </Field>
            )}

            {/* Col 3: Action Submit Button */}
            <div style={{ margin: "15px 0", display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
              <Button
                className="primary"
                disabled={busy}
                type="submit"
                style={{
                  width: "100%",
                  height: 38,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontWeight: 600,
                }}
              >
                {busy
                  ? "Recording…"
                  : isStaffSalary
                    ? "Save Salary"
                    : isStaffAdvance
                      ? (owner ? "Disburse Advance" : "Submit Request")
                      : "Record Expense"}
              </Button>
            </div>
          </div>

          {/* If Staff Advance, show Signature Pad */}
          {isStaffAdvance && (
            <div style={{ marginTop: 10 }}>
              <label
                style={{
                  display: "block",
                  fontSize: 12,
                  fontWeight: 600,
                  color: "#57534e",
                  marginBottom: 6,
                }}
              >
                Staff Signature Acknowledgment
              </label>
              <SignaturePad
                key={createdDocId ?? "sigpad"}
                onChange={(blob) => setSignatureBlob(blob)}
                onClear={() => setSignatureBlob(null)}
              />
            </div>
          )}

          {error && <p role="alert" className="error" style={{ marginTop: 12 }}>{error}</p>}
          {success && (
            <div
              role="status"
              className="notice"
              style={{
                marginTop: 12,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                flexWrap: "wrap",
                gap: 10,
              }}
            >
              <span>{success}</span>
              {createdDocId && (
                <Button
                  type="button"
                  className="primary"
                  style={{ fontSize: 13, padding: "6px 14px" }}
                  onClick={() => onSelect(createdDocId)}
                >
                  <Printer size={15} style={{ marginRight: 6 }} /> View & Print Payment Voucher
                </Button>
              )}
            </div>
          )}
        </form>
      </section>

      {/* Relevant register table */}
      <Documents
        onSelect={onSelect}
        kind="expense,salary,loan"
        title="Expenses & Salary Register"
      />
    </div>
  );
}

/* ===================================================================================
   SUB-TAB 3: CASH TO BANK TRANSFER
=================================================================================== */

function CashToBankTransferTab({
  date,
  masters,
  onSelect,
}: {
  date: string;
  masters: Row;
  onSelect: (id: string) => void;
}) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const accounts = arr(masters.accounts);
  const defaultCash = str(accounts.find((a) => a.type === "cash")?.id ?? "");
  const defaultBank = str(accounts.find((a) => a.type === "bank")?.id ?? "");

  const [transferFrom, setTransferFrom] = useState<string>(defaultCash);
  const [transferTo, setTransferTo] = useState<string>(defaultBank);
  const [transferAmount, setTransferAmount] = useState("");
  const [transferDate, setTransferDate] = useState(date);
  const [transferNotes, setTransferNotes] = useState("");

  useEffect(() => {
    if (!transferFrom && defaultCash) setTransferFrom(defaultCash);
    if (!transferTo && defaultBank) setTransferTo(defaultBank);
  }, [defaultCash, defaultBank, transferFrom, transferTo]);

  const sourceAccount = accounts.find((a) => str(a.id) === transferFrom);
  const destAccount = accounts.find((a) => str(a.id) === transferTo);

  const handleTransferSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");
    const cleanAmt = cleanMoney(transferAmount);
    if (!cleanAmt || parseMoneyNumber(cleanAmt) <= 0) {
      setError("Please enter a valid transfer amount.");
      return;
    }
    if (transferFrom === transferTo) {
      setError("Source and destination accounts must be different.");
      return;
    }

    setBusy(true);
    try {
      await api(
        "commands/transfer",
        commandResult,
        {
          date: transferDate,
          sourceId: transferFrom,
          destinationId: transferTo,
          amount: cleanAmt,
          note: transferNotes,
        },
        "POST",
        crypto.randomUUID()
      );
      setSuccess("Cash to bank transfer recorded successfully.");
      setTransferAmount("");
      setTransferNotes("");
      await qc.invalidateQueries();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <section className="panel" style={{ paddingBottom: 16 }}>
        {/* Header with Title and Date */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 16,
            borderBottom: "1px solid #f5f5f4",
            paddingBottom: 8,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <ArrowLeftRight size={18} style={{ color: "#0284c7" }} />
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "#292524" }}>
              Cash to Bank Transfer (Deposit)
            </h3>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 12, color: "#78716c" }}>Date:</span>
            <input
              type="date"
              value={transferDate}
              onChange={(e) => setTransferDate(e.target.value)}
              required
              style={{
                fontSize: 12,
                fontWeight: 600,
                padding: "3px 8px",
                borderRadius: 6,
                border: "1px solid #d6d3d1",
              }}
            />
          </div>
        </div>

        <form onSubmit={handleTransferSubmit}>
          {/* Top Row: Visual Flow (Left) beside Big Amount Input (Right) */}
          <div
            className="form-grid-mobile"
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(300px, 1.3fr) minmax(220px, 1fr)",
              gap: 16,
              alignItems: "center",
              marginBottom: 14,
            }}
          >
            {/* Visual Flow Indicator */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "14px 20px",
                background: "#f0f9ff",
                border: "1px solid #bae6fd",
                borderRadius: 8,
                gap: 12,
              }}
            >
              <div style={{ textAlign: "left" }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: "#0369a1", textTransform: "uppercase" }}>
                  From (Source)
                </div>
                <div style={{ fontSize: 15, fontWeight: 700, color: "#0c4a6e", marginTop: 2 }}>
                  {sourceAccount ? str(sourceAccount.name) : "Demo manager cash"}
                </div>
              </div>

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 32,
                  height: 32,
                  borderRadius: "50%",
                  background: "#0284c7",
                  color: "#fff",
                  flexShrink: 0,
                }}
              >
                <ArrowRight size={18} />
              </div>

              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: "#0369a1", textTransform: "uppercase" }}>
                  To (Destination)
                </div>
                <div style={{ fontSize: 15, fontWeight: 700, color: "#0c4a6e", marginTop: 2 }}>
                  {destAccount ? str(destAccount.name) : "Demo receiving bank"}
                </div>
              </div>
            </div>

            {/* Transfer Amount in Big */}
            <div>
              <label
                style={{
                  display: "block",
                  fontSize: 12,
                  fontWeight: 600,
                  color: "#57534e",
                  marginBottom: 6,
                }}
              >
                Transfer Amount (₹) *
              </label>
              <div style={{ position: "relative" }}>
                <span
                  style={{
                    position: "absolute",
                    left: 14,
                    top: "50%",
                    transform: "translateY(-50%)",
                    fontSize: 22,
                    fontWeight: 700,
                    color: "#0284c7",
                    pointerEvents: "none",
                  }}
                >
                  ₹
                </span>
                <input
                  inputMode="decimal"
                  placeholder="0.00"
                  value={transferAmount}
                  onChange={(e) => setTransferAmount(e.target.value)}
                  required
                  autoFocus
                  style={{
                    width: "100%",
                    fontSize: 24,
                    fontWeight: 800,
                    padding: "10px 14px 10px 38px",
                    height: 52,
                    borderRadius: 8,
                    border: "2px solid #0284c7",
                    background: "#fff",
                    color: "#0c4a6e",
                  }}
                />
              </div>
            </div>
          </div>

          {/* Just beneath: Transfer Notes / Cheque / Bank Deposit Slip Ref */}
          <Field label="Transfer Notes / Cheque / Bank Deposit Slip Ref">
            <input
              placeholder="e.g. SBI Cash deposit slip #1049, Counter cash deposit by manager…"
              value={transferNotes}
              onChange={(e) => setTransferNotes(e.target.value)}
              style={{ height: 40 }}
            />
          </Field>

          {error && <p role="alert" className="error" style={{ marginTop: 12 }}>{error}</p>}
          {success && <p role="status" className="notice" style={{ marginTop: 12 }}>{success}</p>}

          {/* And then that button */}
          <div
            style={{
              marginTop: 16,
              display: "flex",
              justifyContent: "flex-end",
            }}
          >
            <Button
              className="primary"
              disabled={busy}
              type="submit"
              style={{
                padding: "10px 24px",
                fontSize: 14,
                fontWeight: 600,
                background: "#0284c7",
                borderColor: "#0284c7",
              }}
            >
              {busy ? "Recording…" : "Complete Cash to Bank Transfer"}
            </Button>
          </div>
        </form>
      </section>

      {/* Relevant register table */}
      <Documents
        onSelect={onSelect}
        kind="transfer,deposit"
        title="Transfers & Deposits Register"
      />
    </div>
  );
}

/* ===================================================================================
   SUB-TAB 4: RECEIVE MONEY FROM STAFF (MONEY IN / ADVANCE RECOVERY)
=================================================================================== */

function ReceiveFromStaffTab({
  date,
  masters,
  onSelect,
}: {
  date: string;
  masters: Row;
  onSelect: (id: string) => void;
}) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [createdDocId, setCreatedDocId] = useState<string | null>(null);

  const accounts = arr(masters.accounts);
  const defaultCash = str(accounts.find((a) => a.type === "cash")?.id ?? "");

  // Employees query
  const employeesQuery = useQuery({
    queryKey: ["employees"],
    queryFn: async () => {
      const r = await fetch("/api/v1/employees");
      return (await r.json()) as Array<{
        id: string;
        name: string;
        role: string;
        phone?: string;
        active: boolean;
      }>;
    },
  });
  const employeeOptions = (employeesQuery.data ?? []).filter((e) => e.active);

  // Foods salesmen query
  const foodsSalesmenQuery = useQuery({
    queryKey: ["foods-salesmen"],
    queryFn: async () => {
      const r = await fetch("/api/v1/foods-salesmen");
      return (await r.json()) as Array<{
        id: string;
        name: string;
        territory?: string;
        phone?: string;
        active: boolean;
      }>;
    },
  });
  const foodsSalesmen = (foodsSalesmenQuery.data ?? []).filter((f) => f.active);
  const cigSalesmen = arr(masters.salesmen).filter((s) => s.active !== false);

  const allStaffRecipients = [
    ...employeeOptions.map((e) => ({
      id: `emp:${e.id}`,
      name: e.name,
      subtitle: e.role ? `(${e.role})` : "",
      group: "employee" as const,
      employeeId: e.id,
    })),
    ...foodsSalesmen.map((f) => ({
      id: `foods:${f.id}`,
      name: f.name,
      subtitle: f.territory ? `(${f.territory})` : "(Foods)",
      group: "foods" as const,
      employeeId: undefined,
    })),
    ...cigSalesmen.map((c) => ({
      id: `cig:${str(c.id)}`,
      name: str(c.name),
      subtitle: c.code ? `(${c.code})` : "(Cig)",
      group: "cig" as const,
      employeeId: undefined,
    })),
  ];

  // Form states
  const [empName, setEmpName] = useState("");
  const [empAmount, setEmpAmount] = useState("");
  const [empAccount, setEmpAccount] = useState<string>(defaultCash);
  const [empDate, setEmpDate] = useState(date);
  const [empNotes, setEmpNotes] = useState("");
  const [signatureBlob, setSignatureBlob] = useState<Blob | null>(null);

  useEffect(() => {
    if (!empAccount && defaultCash) setEmpAccount(defaultCash);
  }, [defaultCash, empAccount]);

  const handleReceiveSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");
    setCreatedDocId(null);

    if (!empName.trim()) {
      setError("Please select the staff member.");
      return;
    }
    const cleanAmt = cleanMoney(empAmount);
    if (!cleanAmt || parseMoneyNumber(cleanAmt) <= 0) {
      setError("Please enter a valid amount.");
      return;
    }
    if (!empAccount) {
      setError("Please select the receiving account.");
      return;
    }

    setBusy(true);
    try {
      const selectedRecipient = allStaffRecipients.find(
        (r) => r.id === empName || r.name.toLowerCase() === empName.trim().toLowerCase()
      );
      const empDisplayName = selectedRecipient?.name || empName.trim();
      const employeeId = selectedRecipient?.employeeId;

      const docResult = (await api(
        "commands/employeeReceipt",
        commandResult,
        {
          date: empDate,
          employeeName: empDisplayName,
          employeeId,
          amount: cleanAmt,
          accountId: empAccount,
          note: empNotes,
        },
        "POST",
        crypto.randomUUID()
      )) as { id?: string; number?: string; amount?: string };

      if (docResult?.id && signatureBlob) {
        try {
          const sigFile = new File([signatureBlob], "employee-signature.png", {
            type: "image/png",
          });
          const form = new FormData();
          form.set("file", sigFile);
          await fetch("/api/v1/attachments/" + docResult.id, {
            method: "POST",
            body: form,
          });
        } catch (uploadErr) {
          console.error("Signature upload failed", uploadErr);
        }
      }

      if (docResult?.id) {
        setCreatedDocId(docResult.id);
        setSuccess(
          `Money received from employee recorded successfully as #${docResult.number ?? ""}. Added to account!`
        );
      }

      setEmpAmount("");
      setEmpNotes("");
      setSignatureBlob(null);
      await qc.invalidateQueries();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <section className="panel" style={{ paddingBottom: 16 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 16,
            borderBottom: "1px solid #f5f5f4",
            paddingBottom: 8,
          }}
        >
          <HandCoins size={18} style={{ color: "#8b5cf6" }} />
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "#292524" }}>
            Receive Money from Staff (Advance Repayment / Cash Return)
          </h3>
        </div>

        <form onSubmit={handleReceiveSubmit}>
          <div className="form-grid">
            <Field label="Staff Member *">
              <select
                value={empName}
                onChange={(e) => setEmpName(e.target.value)}
                required
              >
                <option value="">Choose recipient / staff member…</option>
                <optgroup label="👨‍💼 Staff & Employees">
                  {employeeOptions.map((e) => (
                    <option key={`rec-emp-${e.id}`} value={`emp:${e.id}`}>
                      {e.name} {e.role ? `(${e.role})` : ""}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="🍞 Foods Salesmen">
                  {foodsSalesmen.map((f) => (
                    <option key={`rec-foods-${f.id}`} value={`foods:${f.id}`}>
                      {f.name} {f.territory ? `(${f.territory})` : "(Foods Salesman)"}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="🚬 Cigarette Salesmen">
                  {cigSalesmen.map((s) => (
                    <option key={`rec-cig-${str(s.id)}`} value={`cig:${str(s.id)}`}>
                      {str(s.name)} {s.code ? `(${s.code})` : "(Cig Salesman)"}
                    </option>
                  ))}
                </optgroup>
              </select>
            </Field>

            <Field label="Amount Received (₹) *">
              <input
                inputMode="decimal"
                placeholder="0.00"
                value={empAmount}
                onChange={(e) => setEmpAmount(e.target.value)}
                required
              />
            </Field>

            <Field label="Date *">
              <input
                type="date"
                value={empDate}
                onChange={(e) => setEmpDate(e.target.value)}
                required
              />
            </Field>

            <Field label="Received Into Account *">
              <select
                value={empAccount}
                onChange={(e) => setEmpAccount(e.target.value)}
                required
              >
                <option value="">Choose account…</option>
                {accounts.map((a) => (
                  <option key={str(a.id)} value={str(a.id)}>
                    {str(a.name)} ({str(a.type)})
                  </option>
                ))}
              </select>
            </Field>

            <div style={{ gridColumn: "1 / -1" }}>
              <Field label="Reason / Notes">
                <input
                  placeholder="e.g. Salary advance repayment, returned excess unspent cash…"
                  value={empNotes}
                  onChange={(e) => setEmpNotes(e.target.value)}
                />
              </Field>
            </div>
          </div>

          <div style={{ marginTop: 14 }}>
            <SignaturePad
              key={createdDocId ?? "sigpad"}
              onChange={(blob) => setSignatureBlob(blob)}
              onClear={() => setSignatureBlob(null)}
            />
          </div>

          {error && <p role="alert" className="error">{error}</p>}
          {success && (
            <div
              role="status"
              className="notice"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                flexWrap: "wrap",
                gap: 10,
              }}
            >
              <span>{success}</span>
              {createdDocId && (
                <Button
                  type="button"
                  className="primary"
                  style={{ fontSize: 13, padding: "6px 14px" }}
                  onClick={() => onSelect(createdDocId)}
                >
                  <Printer size={15} style={{ marginRight: 6 }} /> View & Print Receipt Voucher
                </Button>
              )}
            </div>
          )}

          <div
            style={{
              marginTop: 20,
              display: "flex",
              justifyContent: "flex-end",
            }}
          >
            <Button
              className="primary"
              disabled={busy}
              type="submit"
              style={{ padding: "10px 24px" }}
            >
              {busy ? "Recording…" : "Record Money Received"}
            </Button>
          </div>
        </form>
      </section>

      {/* Relevant register table */}
      <Documents
        onSelect={onSelect}
        kind="employee_receipt,repay"
        title="Staff Receipts & Repayments Register"
      />
    </div>
  );
}
