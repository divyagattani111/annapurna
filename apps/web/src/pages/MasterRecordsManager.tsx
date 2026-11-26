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
  Download,
  Pencil,
  Plus,
  Search,
  Star,
  X,
  Trash2,
} from "lucide-react";
import {
  rowsSchema, rowSchema, commandResult, commands, cleanMoney, cleanDecimal,
  parseMultiAmounts, cleanIndianPhone, type CommandName,
  encodeCsvRows,
} from "@ledger/contracts";
import { api } from "../api";
import { Button, Field, Table } from "../components/ui";
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


export function MasterRecordsManager({
  masters,
  date,
  setAction,
}: {
  masters: Row;
  date: string;
  setAction: (n: CommandName) => void;
}) {
  const [activeTab, setActiveTab] = useState<"products" | "confectionery" | "salesmen" | "employees" | "foods_salesmen">("products");
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingItem, setEditingItem] = useState<{ type: string; id: string } | null>(null);
  const [status, setStatus] = useState("");
  const qc = useQueryClient();

  const [newConfCode, setNewConfCode] = useState("");
  const [newConfName, setNewConfName] = useState("");
  const [newConfRate, setNewConfRate] = useState("");
  const [confBusy, setConfBusy] = useState(false);

  // Load and manage employees from API
  const employeesQuery = useQuery({
    queryKey: ["employees"],
    queryFn: async () => {
      const r = await fetch("/api/v1/employees");
      return (await r.json()) as Array<{ id: string; name: string; role: string; phone?: string; active: boolean }>;
    },
  });
  const employees = employeesQuery.data ?? [];

  // Load and manage foods salesmen from API
  const foodsSalesmenQuery = useQuery({
    queryKey: ["foods-salesmen"],
    queryFn: async () => {
      const r = await fetch("/api/v1/foods-salesmen");
      return (await r.json()) as Array<{ id: string; name: string; territory?: string; phone?: string; active: boolean }>;
    },
  });
  const foodsSalesmen = foodsSalesmenQuery.data ?? [];

  // Load and manage ITC customers from API
  const customersQuery = useQuery({
    queryKey: ["itc-customers"],
    queryFn: async () => {
      const r = await fetch("/api/v1/itc/customers");
      return (await r.json()) as Array<{
        id: string;
        customer_id: string;
        customer_name: string;
        salesman_itc_id: string;
        salesman_name: string;
        beat_code: string;
        beat_name: string;
        salesman_id: string | null;
        active: boolean;
        is_gst: boolean;
      }>;
    },
  });
  const customers = customersQuery.data ?? [];

  const [newEmpName, setNewEmpName] = useState("");
  const [newEmpRole, setNewEmpRole] = useState("");
  const [newEmpPhone, setNewEmpPhone] = useState("");

  const [newFoodsName, setNewFoodsName] = useState("");
  const [newFoodsTerritory, setNewFoodsTerritory] = useState("");
  const [newFoodsPhone, setNewFoodsPhone] = useState("");

  const products = arr(masters.products);
  const cigaretteProducts = products.filter((p) => p.category === "CG-01 CIGARETTE" || p.category === "cigarette" || !p.category);
  const confectioneryProducts = products.filter((p) => p.category === "CF-05 CONFECTIONERY" || p.category === "confectionery");
  const salesmen = arr(masters.salesmen);
  const accounts = arr(masters.accounts);

  const [productFilter, setProductFilter] = useState<"all" | "focus" | "standard">("all");

  const toggleFocus = async (productId: string, currentIsFocus: boolean) => {
    setStatus("");
    try {
      await api(
        "products/" + productId + "/focus",
        rowSchema,
        { isFocusBrand: !currentIsFocus },
        "PATCH"
      );
      setStatus(
        currentIsFocus
          ? "Removed from Focus Brands."
          : "Marked as Focus Brand (prioritized to CDM first)."
      );
      await qc.invalidateQueries();
    } catch (e) {
      setStatus((e as Error).message);
    }
  };

  const toggleStatus = async (type: string, id: string, currentActive: boolean) => {
    setStatus("");
    try {
      if (type === "employees") {
        await api("employees/" + id, z.any(), { active: !currentActive }, "PATCH");
        await qc.invalidateQueries({ queryKey: ["employees"] });
        setStatus("Employee status updated.");
        return;
      }
      if (type === "foods_salesmen") {
        await api("foods-salesmen/" + id, z.any(), { active: !currentActive }, "PATCH");
        await qc.invalidateQueries({ queryKey: ["foods-salesmen"] });
        setStatus("Foods salesman status updated.");
        return;
      }
      if (type === "customers") {
        await fetch(`/api/v1/itc/customers/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ active: !currentActive }),
        });
        await qc.invalidateQueries({ queryKey: ["itc-customers"] });
        await qc.invalidateQueries({ queryKey: ["salesman-customers"] });
        await qc.invalidateQueries({ queryKey: ["direct-cig-summary"] });
        setStatus("Customer status updated.");
        return;
      }
      if (type === "salesmen") {
        const item = salesmen.find((s) => s.id === id);
        await api(
          "salesmen/" + id,
          rowSchema,
          {
            name: item?.name,
            creditLimit: item?.credit_limit,
            active: !currentActive,
            details: (item?.details as Row) ?? {},
          },
          "PATCH"
        );
      } else {
        await api("masters/" + type + "/" + id, rowSchema, { active: !currentActive }, "PATCH");
      }
      setStatus("Status updated; historical records preserved.");
      await qc.invalidateQueries();
    } catch (e) {
      setStatus((e as Error).message);
    }
  };

  return (
    <section className="panel" style={{ padding: "20px 24px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: "1.35rem", fontWeight: 700 }}>Configure master records</h2>
          <p className="muted small" style={{ margin: "4px 0 0" }}>
            Add, edit, set credit policies/effective rates, and activate or deactivate master items without losing historical records.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <Button
            className="secondary"
            onClick={() => {
              const exportData = {
                exportedAt: new Date().toISOString(),
                recordCounts: {
                  products: products.length,
                  salesmen: salesmen.length,
                  accounts: accounts.length,
                  employees: employees.length,
                  foodsSalesmen: foodsSalesmen.length,
                  customers: customers.length,
                },
                salesmen,
                products,
                moneyAccounts: accounts,
                employees,
                foodsSalesmen,
                customers,
              };
              const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = `master_records_${new Date().toISOString().slice(0, 10)}.json`;
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
              URL.revokeObjectURL(url);
            }}
            style={{ fontSize: "0.85rem", padding: "6px 14px", display: "inline-flex", alignItems: "center", gap: 6 }}
          >
            <Download size={15} /> Backup Masters JSON
          </Button>
          <Button className="secondary" onClick={() => setAction("opening")}>
            Approve opening entry
          </Button>
          <Button className="secondary" onClick={() => setAction("adjustment")}>
            Correcting adjustment
          </Button>
        </div>
      </div>

      {/* Sub Tabs: Products, Confectionery, Salesmen, Staff, Foods Salesmen */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid #e7e5e4", marginBottom: 18, flexWrap: "wrap", gap: 8 }}>
        <div style={{ display: "flex", gap: 20 }}>
          {(
            [
              ["products", "Cigarette Products", cigaretteProducts.length],
              ["confectionery", "Confectionery Master", confectioneryProducts.length],
              ["salesmen", "Salesmen", salesmen.length],
              ["employees", "Staff", employees.length],
              ["foods_salesmen", "Foods Salesmen", foodsSalesmen.length],
            ] as const
          ).map(([k, label, count]) => {
            const active = activeTab === k;
            return (
              <button
                key={k}
                type="button"
                onClick={() => {
                  setActiveTab(k);
                  setShowAddForm(false);
                  setEditingItem(null);
                  setStatus("");
                }}
                style={{
                  background: "none",
                  border: "none",
                  borderBottom: active ? "2.5px solid #c2410c" : "2.5px solid transparent",
                  padding: "10px 4px",
                  fontWeight: active ? 700 : 500,
                  fontSize: "0.92rem",
                  color: active ? "#9a3412" : "#78716c",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <span>{label}</span>
                <span
                  style={{
                    background: active ? "#ffedd5" : "#f5f5f4",
                    color: active ? "#9a3412" : "#a8a29e",
                    fontSize: "0.75rem",
                    padding: "1px 7px",
                    borderRadius: 12,
                    fontWeight: 600,
                  }}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>
        <Button
          className="primary"
          onClick={() => {
            setShowAddForm((prev) => !prev);
            setEditingItem(null);
          }}
          style={{ fontSize: "0.85rem", padding: "6px 14px", display: "inline-flex", alignItems: "center", gap: 6 }}
        >
          <Plus size={15} />
          {showAddForm
            ? "Cancel Add"
            : `Add new ${activeTab === "products" ? "cigarette product" : activeTab === "confectionery" ? "confectionery item" : activeTab === "salesmen" ? "salesman" : activeTab === "foods_salesmen" ? "foods salesman" : "employee"}`}
        </Button>
      </div>

      {status && (
        <p className="notice" role="status" style={{ marginBottom: 16 }}>
          {status}
        </p>
      )}

      {/* Inline Add Drawer */}
      {showAddForm && (
        <div style={{ background: "#fcfbf7", padding: "16px 20px", borderRadius: 12, border: "1px solid #e7e5e4", marginBottom: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <strong style={{ fontSize: "0.95rem" }}>
              Add new {activeTab === "products" ? "cigarette product" : activeTab === "confectionery" ? "confectionery item" : activeTab === "salesmen" ? "salesman" : activeTab === "foods_salesmen" ? "foods salesman" : "staff employee"}
            </strong>
          </div>
          {activeTab === "confectionery" ? (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!newConfName.trim()) return;
                setConfBusy(true);
                try {
                  const code = newConfCode.trim().toUpperCase() || `CONF-${String(confectioneryProducts.length + 1).padStart(2, "0")}`;
                  await api("products", rowSchema, {
                    code,
                    name: newConfName.trim(),
                    category: "CF-05 CONFECTIONERY",
                    unit: "piece",
                    baseUnit: "piece",
                    conversion: "1",
                    basis: "1",
                    rate: cleanDecimal(newConfRate) || "1.00",
                    effectiveDate: date,
                    fractional: false,
                    confirmed: true,
                  });
                  await qc.invalidateQueries();
                  setNewConfCode("");
                  setNewConfName("");
                  setNewConfRate("");
                  setShowAddForm(false);
                  setStatus(`Added new confectionery item ${code} (${newConfName.trim()}).`);
                } catch (err) {
                  setStatus((err as Error).message);
                } finally {
                  setConfBusy(false);
                }
              }}
            >
              <div className="form-grid">
                <Field label="Item Code / ID (optional, e.g. CONF-03)">
                  <input
                    value={newConfCode}
                    onChange={(e) => setNewConfCode(e.target.value)}
                    placeholder={`Auto: CONF-${String(confectioneryProducts.length + 1).padStart(2, "0")}`}
                  />
                </Field>
                <Field label="Confectionery Product Name *">
                  <input
                    value={newConfName}
                    onChange={(e) => setNewConfName(e.target.value)}
                    placeholder="e.g. Dairy Milk 10g, Halls Candy, TicTac Mint"
                    required
                  />
                </Field>
                <Field label="Default Selling Rate per Piece (₹) *">
                  <input
                    inputMode="decimal"
                    value={newConfRate}
                    onChange={(e) => setNewConfRate(e.target.value)}
                    placeholder="e.g. 10.00"
                    required
                  />
                </Field>
              </div>
              <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
                <Button type="submit" className="primary" disabled={confBusy} style={{ fontSize: "0.85rem", padding: "6px 14px" }}>
                  {confBusy ? "Adding..." : "Add Confectionery Item"}
                </Button>
                <Button className="secondary" onClick={() => setShowAddForm(false)} style={{ fontSize: "0.85rem", padding: "6px 14px" }}>
                  Cancel
                </Button>
              </div>
            </form>
          ) : activeTab === "employees" ? (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!newEmpName.trim()) return;
                try {
                  await api(
                    "employees",
                    z.any(),
                    {
                      name: newEmpName.trim(),
                      role: newEmpRole.trim() || "Staff / Helper",
                      phone: newEmpPhone.trim() || undefined,
                    },
                    "POST"
                  );
                  await qc.invalidateQueries({ queryKey: ["employees"] });
                  setNewEmpName("");
                  setNewEmpRole("");
                  setNewEmpPhone("");
                  setShowAddForm(false);
                  setStatus("New employee saved to database.");
                } catch (err) {
                  setStatus((err as Error).message);
                }
              }}
            >
              <div className="form-grid">
                <Field label="Employee Full Name *">
                  <input
                    value={newEmpName}
                    onChange={(e) => setNewEmpName(e.target.value)}
                    placeholder="e.g. Ramesh Kumar"
                    required
                  />
                </Field>
                <Field label="Designation / Role">
                  <input
                    value={newEmpRole}
                    onChange={(e) => setNewEmpRole(e.target.value)}
                    placeholder="e.g. Driver, Helper, Godown Worker"
                  />
                </Field>
                <Field label="Contact Phone">
                  <input
                    value={newEmpPhone}
                    onChange={(e) => setNewEmpPhone(e.target.value)}
                    placeholder="e.g. 9876543210"
                  />
                </Field>
              </div>
              <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
                <Button type="submit" className="primary" style={{ fontSize: "0.85rem", padding: "6px 14px" }}>
                  Save Employee
                </Button>
                <Button className="secondary" onClick={() => setShowAddForm(false)} style={{ fontSize: "0.85rem", padding: "6px 14px" }}>
                  Cancel
                </Button>
              </div>
            </form>
          ) : activeTab === "foods_salesmen" ? (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!newFoodsName.trim()) return;
                try {
                  await api(
                    "foods-salesmen",
                    z.any(),
                    {
                      name: newFoodsName.trim(),
                      territory: newFoodsTerritory.trim() || undefined,
                      phone: newFoodsPhone.trim() || undefined,
                    },
                    "POST"
                  );
                  await qc.invalidateQueries({ queryKey: ["foods-salesmen"] });
                  setNewFoodsName("");
                  setNewFoodsTerritory("");
                  setNewFoodsPhone("");
                  setShowAddForm(false);
                  setStatus("New foods salesman saved to database.");
                } catch (err) {
                  setStatus((err as Error).message);
                }
              }}
            >
              <div className="form-grid">
                <Field label="Foods Salesman Name *">
                  <input
                    value={newFoodsName}
                    onChange={(e) => setNewFoodsName(e.target.value)}
                    placeholder="e.g. Sunil Agrawal (Foods)"
                    required
                  />
                </Field>
                <Field label="Territory / Route">
                  <input
                    value={newFoodsTerritory}
                    onChange={(e) => setNewFoodsTerritory(e.target.value)}
                    placeholder="e.g. Main Market, Route 1"
                  />
                </Field>
                <Field label="Contact Phone">
                  <input
                    value={newFoodsPhone}
                    onChange={(e) => setNewFoodsPhone(e.target.value)}
                    placeholder="e.g. 9823011221"
                  />
                </Field>
              </div>
              <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
                <Button type="submit" className="primary" style={{ fontSize: "0.85rem", padding: "6px 14px" }}>
                  Save Foods Salesman
                </Button>
                <Button className="secondary" onClick={() => setShowAddForm(false)} style={{ fontSize: "0.85rem", padding: "6px 14px" }}>
                  Cancel
                </Button>
              </div>
            </form>
          ) : (
            <MasterForm
              kind={activeTab}
              date={date}
              onDone={() => {
                setShowAddForm(false);
              }}
            />
          )}
        </div>
      )}

      {/* Tab 1: Products */}
      {activeTab === "products" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {(() => {
            const focusCount = cigaretteProducts.filter((p) => p.is_focus_brand === true).length;
            const displayProducts = productFilter === "focus"
              ? cigaretteProducts.filter((p) => p.is_focus_brand === true)
              : productFilter === "standard"
                ? cigaretteProducts.filter((p) => !p.is_focus_brand)
                : cigaretteProducts;

            return (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6, flexWrap: "wrap", gap: 8 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <span style={{ fontSize: "0.85rem", color: "#64748b", fontWeight: 600 }}>Filter:</span>
                    <button
                      type="button"
                      onClick={() => setProductFilter("all")}
                      style={{
                        background: productFilter === "all" ? "#f1f5f9" : "none",
                        border: "1px solid",
                        borderColor: productFilter === "all" ? "#cbd5e1" : "transparent",
                        padding: "3px 10px",
                        borderRadius: 6,
                        fontSize: "0.82rem",
                        fontWeight: productFilter === "all" ? 700 : 500,
                        cursor: "pointer",
                        color: productFilter === "all" ? "#0f172a" : "#64748b",
                      }}
                    >
                      All Cigarettes ({cigaretteProducts.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setProductFilter("focus")}
                      style={{
                        background: productFilter === "focus" ? "#fef3c7" : "none",
                        border: "1px solid",
                        borderColor: productFilter === "focus" ? "#f59e0b" : "transparent",
                        padding: "3px 10px",
                        borderRadius: 6,
                        fontSize: "0.82rem",
                        fontWeight: productFilter === "focus" ? 700 : 500,
                        cursor: "pointer",
                        color: productFilter === "focus" ? "#92400e" : "#64748b",
                      }}
                    >
                      ⭐ Focus Brands ({focusCount})
                    </button>
                    <button
                      type="button"
                      onClick={() => setProductFilter("standard")}
                      style={{
                        background: productFilter === "standard" ? "#f1f5f9" : "none",
                        border: "1px solid",
                        borderColor: productFilter === "standard" ? "#cbd5e1" : "transparent",
                        padding: "3px 10px",
                        borderRadius: 6,
                        fontSize: "0.82rem",
                        fontWeight: productFilter === "standard" ? 700 : 500,
                        cursor: "pointer",
                        color: productFilter === "standard" ? "#0f172a" : "#64748b",
                      }}
                    >
                      Standard Brands ({cigaretteProducts.length - focusCount})
                    </button>
                  </div>
                  <div style={{ fontSize: "0.82rem", color: "#64748b" }}>
                    ⭐ Focus Brands are prioritized to CDM first during ITC export splitting.
                  </div>
                </div>

                {displayProducts.map((p) => {
                  const isEditing = editingItem?.type === "products" && editingItem?.id === str(p.id);
                  return (
                    <div
                      key={str(p.id)}
                      style={{
                        border: "1px solid #e7e5e4",
                        borderRadius: 12,
                        padding: "14px 18px",
                        background: p.active ? "#ffffff" : "#fafaf9",
                        opacity: p.active ? 1 : 0.75,
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                          <div>
                            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                              <strong style={{ fontSize: "1rem" }}>{str(p.name)}</strong>
                              <span style={{ fontSize: "0.78rem", background: "#f5f5f4", padding: "2px 6px", borderRadius: 4, fontFamily: "monospace", color: "#57534e" }}>
                                {str(p.code)}
                              </span>
                              {p.is_focus_brand === true && (
                                <span
                                  style={{
                                    fontSize: "0.75rem",
                                    fontWeight: 700,
                                    padding: "2px 8px",
                                    borderRadius: 12,
                                    background: "#fef3c7",
                                    color: "#92400e",
                                    border: "1px solid #fde68a",
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: 3,
                                  }}
                                >
                                  ⭐ Focus Brand
                                </span>
                              )}
                              <span
                                style={{
                                  fontSize: "0.75rem",
                                  fontWeight: 600,
                                  padding: "2px 8px",
                                  borderRadius: 12,
                                  background: p.active ? "#dcfce7" : "#f1f5f9",
                                  color: p.active ? "#166534" : "#64748b",
                                }}
                              >
                                {p.active ? "Active" : "Inactive"}
                              </span>
                            </div>
                            <div style={{ fontSize: "0.85rem", color: "#78716c", marginTop: 4, display: "flex", gap: 14, flexWrap: "wrap" }}>
                              <span>Rate: <b>₹{str(p.rate)}</b> / {str(p.unit)}</span>
                              <span>Effective: <b>{str(p.effective_date || "Original")}</b></span>
                              <span>Base: <b>{str(p.conversion)}</b> {str(p.base_unit)}</span>
                              <span>Fractional: <b>{p.fractional ? "Yes" : "No"}</b></span>
                              <span>Confirmed: <b>{p.confirmed ? "Yes" : "No"}</b></span>
                              {Boolean(p.itc_multiple) && <span>ITC Split: <b>{str(p.itc_multiple)} multiple</b></span>}
                              {Boolean(p.barcode) && (
                                <span>
                                  {str(p.barcode).split(/[\s,;]+/).filter(Boolean).length > 1 ? "Barcodes: " : "Barcode: "}
                                  <b style={{ fontFamily: "monospace" }}>
                                    {str(p.barcode).split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean).join(", ")}
                                  </b>
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                          <Button
                            className="secondary"
                            onClick={() => toggleFocus(str(p.id), p.is_focus_brand === true)}
                            title={p.is_focus_brand ? "Remove from focus brands" : "Set as focus brand (prioritize to CDM first)"}
                            aria-label={p.is_focus_brand ? "Remove from focus brands" : "Set as focus brand"}
                            style={{
                              padding: "5px 10px",
                              fontSize: "0.82rem",
                              background: p.is_focus_brand ? "#fffbeb" : undefined,
                              borderColor: p.is_focus_brand ? "#fcd34d" : undefined,
                              color: p.is_focus_brand ? "#b45309" : undefined,
                            }}
                          >
                            <Star size={14} fill={p.is_focus_brand ? "#f59e0b" : "none"} color={p.is_focus_brand ? "#f59e0b" : "currentColor"} />
                          </Button>
                          <Button
                            className="secondary"
                            onClick={() => {
                              setEditingItem(isEditing ? null : { type: "products", id: str(p.id) });
                            }}
                            style={{ fontSize: "0.82rem", padding: "5px 12px" }}
                          >
                            {isEditing ? "Close" : "Edit"}
                          </Button>
                          <Button
                            className="secondary"
                            onClick={() => toggleStatus("products", str(p.id), Boolean(p.active))}
                            style={{ fontSize: "0.82rem", padding: "5px 12px" }}
                          >
                            {p.active ? "Deactivate" : "Reactivate"}
                          </Button>
                        </div>
                      </div>
                      {isEditing && (
                        <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px dashed #e7e5e4" }}>
                          <ProductRateEditor
                            product={p}
                            date={date}
                            onDone={() => setEditingItem(null)}
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </>
            );
          })()}
        </div>
      )}

      {/* Tab: Confectionery Master */}
      {activeTab === "confectionery" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6, flexWrap: "wrap", gap: 8 }}>
            <div style={{ fontSize: "0.85rem", color: "#64748b" }}>
              Standard confectionery items (chocolates, candies, mints, biscuits) billed by pieces along with cigarettes.
            </div>
          </div>

          {confectioneryProducts.length === 0 ? (
            <div style={{ padding: "32px 0", textAlign: "center", color: "#78716c", background: "#f8fafc", borderRadius: 12, border: "1px dashed #cbd5e1", fontSize: "0.88rem" }}>
              No confectionery items in master yet. Click <b>+ Add new confectionery item</b> above to create one.
            </div>
          ) : (
            confectioneryProducts.map((p) => {
              const isEditing = editingItem?.type === "products" && editingItem?.id === str(p.id);
              return (
                <div
                  key={str(p.id)}
                  style={{
                    border: "1px solid #fed7aa",
                    borderRadius: 12,
                    padding: "14px 18px",
                    background: p.active ? "#ffffff" : "#fafaf9",
                    opacity: p.active ? 1 : 0.75,
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                          <strong style={{ fontSize: "1rem", color: "#0f172a" }}>{str(p.name)}</strong>
                          <span style={{ fontSize: "0.78rem", background: "#fef3c7", padding: "2px 6px", borderRadius: 4, fontFamily: "monospace", color: "#92400e" }}>
                            {str(p.code)}
                          </span>
                          <span
                            style={{
                              fontSize: "0.75rem",
                              fontWeight: 600,
                              padding: "2px 8px",
                              borderRadius: 12,
                              background: p.active ? "#dcfce7" : "#f1f5f9",
                              color: p.active ? "#166534" : "#64748b",
                            }}
                          >
                            {p.active ? "Active" : "Inactive"}
                          </span>
                        </div>
                        <div style={{ fontSize: "0.85rem", color: "#57534e", marginTop: 4, display: "flex", gap: 14, flexWrap: "wrap" }}>
                          <span>
                            Default Selling Rate: <strong style={{ color: "#0f172a" }}>₹{str(p.rate ?? "0.00")}</strong> / piece
                          </span>
                          <span>Fixed Unit: <b>piece</b></span>
                        </div>
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <Button
                        className="secondary"
                        onClick={() => {
                          setEditingItem(isEditing ? null : { type: "products", id: str(p.id) });
                        }}
                        style={{ fontSize: "0.82rem", padding: "5px 12px" }}
                      >
                        {isEditing ? "Close" : "Edit"}
                      </Button>
                      <Button
                        className="secondary"
                        onClick={() => toggleStatus("products", str(p.id), Boolean(p.active))}
                        style={{ fontSize: "0.82rem", padding: "5px 12px", color: p.active ? "#dc2626" : "#16a34a" }}
                      >
                        {p.active ? "Deactivate" : "Activate"}
                      </Button>
                    </div>
                  </div>
                  {isEditing && (
                    <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid #fde68a" }}>
                      <ProductRateEditor
                        product={p}
                        date={date}
                        onDone={() => setEditingItem(null)}
                      />
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Tab 2: Salesmen */}
      {activeTab === "salesmen" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {salesmen.map((s) => {
            const isEditing = editingItem?.type === "salesmen" && editingItem?.id === str(s.id);
            const phone = str(s.phone || (s.details as Row | undefined)?.phone);
            const route = str((s.details as Row | undefined)?.route);
            const limit = s.credit_limit !== null && s.credit_limit !== undefined
              ? `₹${str(s.credit_limit)}`
              : "No limit set";
            return (
              <div
                key={str(s.id)}
                style={{
                  border: "1px solid #e7e5e4",
                  borderRadius: 12,
                  padding: "14px 18px",
                  background: s.active ? "#ffffff" : "#fafaf9",
                  opacity: s.active ? 1 : 0.75,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <strong style={{ fontSize: "1rem" }}>{str(s.name)}</strong>
                      <span style={{ fontSize: "0.78rem", background: "#f5f5f4", padding: "2px 6px", borderRadius: 4, fontFamily: "monospace", color: "#57534e" }}>
                        {str(s.code)}
                      </span>
                      <span
                        style={{
                          fontSize: "0.75rem",
                          fontWeight: 600,
                          padding: "2px 8px",
                          borderRadius: 12,
                          background: s.active ? "#dcfce7" : "#f1f5f9",
                          color: s.active ? "#166534" : "#64748b",
                        }}
                      >
                        {s.active ? "Active" : "Inactive"}
                      </span>
                    </div>
                    <div style={{ display: "flex", gap: 16, marginTop: 4, fontSize: "0.85rem", color: "#78716c", flexWrap: "wrap" }}>
                      <span>Credit Policy: <b>{limit}</b></span>
                      {phone && <span>Phone: <b>{phone}</b></span>}
                      {route && <span>Route/Area: <b>{route}</b></span>}
                      {Boolean((s.details as Row | undefined)?.itc_id) && <span>ITC Salesman ID: <b>{str((s.details as Row).itc_id)}</b></span>}
                      {Boolean((s.details as Row | undefined)?.beat_name) && (
                        <span>
                          Beat: <b>{str((s.details as Row).beat_code)} - {str((s.details as Row).beat_name)}</b>
                        </span>
                      )}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <Button
                      className="secondary"
                      onClick={() => setEditingItem(isEditing ? null : { type: "salesmen", id: str(s.id) })}
                      style={{ fontSize: "0.82rem", padding: "5px 12px" }}
                    >
                      {isEditing ? "Close" : "Edit"}
                    </Button>
                    <Button
                      className="secondary"
                      onClick={() => toggleStatus("salesmen", str(s.id), s.active === true)}
                      style={{ fontSize: "0.82rem", padding: "5px 12px" }}
                    >
                      {s.active ? "Deactivate" : "Reactivate"}
                    </Button>
                  </div>
                </div>
                {isEditing && (
                  <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px dashed #e7e5e4" }}>
                    <SalesmanPolicyEditor
                      salesman={s}
                      onDone={() => setEditingItem(null)}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Tab 4: Employees */}
      {activeTab === "employees" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {employees.map((emp) => {
            const isEditing = editingItem?.type === "employees" && editingItem.id === emp.id;
            return (
              <div
                key={emp.id}
                style={{
                  border: "1px solid #e7e5e4",
                  borderRadius: 12,
                  padding: "14px 18px",
                  background: emp.active ? "#ffffff" : "#fafaf9",
                  opacity: emp.active ? 1 : 0.75,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <strong style={{ fontSize: "1rem" }}>{emp.name}</strong>
                      <span style={{ fontSize: "0.75rem", fontWeight: 600, padding: "2px 8px", borderRadius: 12, background: "#e0f2fe", color: "#0369a1" }}>
                        {emp.role}
                      </span>
                      <span
                        style={{
                          fontSize: "0.75rem",
                          fontWeight: 600,
                          padding: "2px 8px",
                          borderRadius: 12,
                          background: emp.active ? "#dcfce7" : "#f1f5f9",
                          color: emp.active ? "#166534" : "#64748b",
                        }}
                      >
                        {emp.active ? "Active" : "Inactive"}
                      </span>
                    </div>
                    <div style={{ display: "flex", gap: 16, marginTop: 4, fontSize: "0.85rem", color: "#78716c", flexWrap: "wrap" }}>
                      {emp.phone && <span>Phone: <b>{emp.phone}</b></span>}
                      <span>Ready for Salaries & Advances in Other Money</span>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <Button
                      className="secondary"
                      onClick={() => setEditingItem(isEditing ? null : { type: "employees", id: emp.id })}
                      style={{ fontSize: "0.82rem", padding: "5px 12px", display: "inline-flex", alignItems: "center", gap: 5 }}
                    >
                      <Pencil size={13} /> {isEditing ? "Close Edit" : "Edit"}
                    </Button>
                    <Button
                      className="secondary"
                      onClick={() => toggleStatus("employees", emp.id, emp.active)}
                      style={{ fontSize: "0.82rem", padding: "5px 12px" }}
                    >
                      {emp.active ? "Deactivate" : "Reactivate"}
                    </Button>
                  </div>
                </div>
                {isEditing && (
                  <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px dashed #e7e5e4" }}>
                    <EmployeeEditor
                      employee={emp}
                      onSave={async (updated) => {
                        try {
                          await api(
                            "employees/" + emp.id,
                            z.any(),
                            {
                              name: updated.name,
                              role: updated.role,
                              phone: updated.phone || undefined,
                            },
                            "PATCH"
                          );
                          await qc.invalidateQueries({ queryKey: ["employees"] });
                          setEditingItem(null);
                          setStatus(`Employee "${updated.name}" updated successfully.`);
                        } catch (err) {
                          setStatus((err as Error).message);
                        }
                      }}
                      onCancel={() => setEditingItem(null)}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Tab 5: Foods Salesmen */}
      {activeTab === "foods_salesmen" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {foodsSalesmen.map((fs) => {
            const isEditing = editingItem?.type === "foods_salesmen" && editingItem.id === fs.id;
            return (
              <div
                key={fs.id}
                style={{
                  border: "1px solid #e7e5e4",
                  borderRadius: 12,
                  padding: "14px 18px",
                  background: fs.active ? "#ffffff" : "#fafaf9",
                  opacity: fs.active ? 1 : 0.75,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <strong style={{ fontSize: "1rem" }}>{fs.name}</strong>
                      {fs.territory && (
                        <span style={{ fontSize: "0.75rem", fontWeight: 600, padding: "2px 8px", borderRadius: 12, background: "#fef3c7", color: "#92400e" }}>
                          {fs.territory}
                        </span>
                      )}
                      <span
                        style={{
                          fontSize: "0.75rem",
                          fontWeight: 600,
                          padding: "2px 8px",
                          borderRadius: 12,
                          background: fs.active ? "#dcfce7" : "#f1f5f9",
                          color: fs.active ? "#166534" : "#64748b",
                        }}
                      >
                        {fs.active ? "Active" : "Inactive"}
                      </span>
                    </div>
                    <div style={{ display: "flex", gap: 16, marginTop: 4, fontSize: "0.85rem", color: "#78716c", flexWrap: "wrap" }}>
                      {fs.phone && <span>Phone: <b>{fs.phone}</b></span>}
                      <span>Ready for Foods Collections in Foods tab</span>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <Button
                      className="secondary"
                      onClick={() => setEditingItem(isEditing ? null : { type: "foods_salesmen", id: fs.id })}
                      style={{ fontSize: "0.82rem", padding: "5px 12px", display: "inline-flex", alignItems: "center", gap: 5 }}
                    >
                      <Pencil size={13} /> {isEditing ? "Close Edit" : "Edit"}
                    </Button>
                    <Button
                      className="secondary"
                      onClick={() => toggleStatus("foods_salesmen", fs.id, fs.active)}
                      style={{ fontSize: "0.82rem", padding: "5px 12px" }}
                    >
                      {fs.active ? "Deactivate" : "Reactivate"}
                    </Button>
                  </div>
                </div>
                {isEditing && (
                  <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px dashed #e7e5e4" }}>
                    <FoodsSalesmanEditor
                      salesman={fs}
                      onSave={async (updated) => {
                        try {
                          await api(
                            "foods-salesmen/" + fs.id,
                            z.any(),
                            {
                              name: updated.name,
                              territory: updated.territory || undefined,
                              phone: updated.phone || undefined,
                            },
                            "PATCH"
                          );
                          await qc.invalidateQueries({ queryKey: ["foods-salesmen"] });
                          setEditingItem(null);
                          setStatus(`Foods salesman "${updated.name}" updated successfully.`);
                        } catch (err) {
                          setStatus((err as Error).message);
                        }
                      }}
                      onCancel={() => setEditingItem(null)}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}




export function EmployeeEditor({
  employee,
  onSave,
  onCancel,
}: {
  employee: { id: string; name: string; role: string; phone?: string; active: boolean };
  onSave: (updated: { id: string; name: string; role: string; phone?: string; active: boolean }) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(employee.name);
  const [role, setRole] = useState(employee.role);
  const [phone, setPhone] = useState(employee.phone ?? "");

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return;
        onSave({
          ...employee,
          name: name.trim(),
          role: role.trim() || "Staff / Helper",
          phone: phone.trim(),
        });
      }}
    >
      <div className="form-grid">
        <Field label="Employee Full Name *">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Ramesh Kumar"
            required
          />
        </Field>
        <Field label="Designation / Role">
          <input
            value={role}
            onChange={(e) => setRole(e.target.value)}
            placeholder="e.g. Driver, Helper, Godown Worker"
          />
        </Field>
        <Field label="Contact Phone">
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="e.g. 9876543210"
          />
        </Field>
      </div>
      <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
        <Button type="submit" className="primary" style={{ fontSize: "0.85rem", padding: "6px 14px" }}>
          Update Employee
        </Button>
        <Button className="secondary" onClick={onCancel} style={{ fontSize: "0.85rem", padding: "6px 14px" }}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

export function FoodsSalesmanEditor({
  salesman,
  onSave,
  onCancel,
}: {
  salesman: { id: string; name: string; territory?: string; phone?: string; active: boolean };
  onSave: (updated: { id: string; name: string; territory?: string; phone?: string; active: boolean }) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(salesman.name);
  const [territory, setTerritory] = useState(salesman.territory ?? "");
  const [phone, setPhone] = useState(salesman.phone ?? "");

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return;
        onSave({
          ...salesman,
          name: name.trim(),
          territory: territory.trim() || "All Routes",
          phone: phone.trim(),
        });
      }}
    >
      <div className="form-grid">
        <Field label="Foods Salesman Name *">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Sunil Agrawal (Foods)"
            required
          />
        </Field>
        <Field label="Territory / Route">
          <input
            value={territory}
            onChange={(e) => setTerritory(e.target.value)}
            placeholder="e.g. Main Market, Route 1"
          />
        </Field>
        <Field label="Contact Phone">
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="e.g. 9823011221"
          />
        </Field>
      </div>
      <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
        <Button type="submit" className="primary" style={{ fontSize: "0.85rem", padding: "6px 14px" }}>
          Update Foods Salesman
        </Button>
        <Button className="secondary" onClick={onCancel} style={{ fontSize: "0.85rem", padding: "6px 14px" }}>
          Cancel
        </Button>
      </div>
    </form>
  );
}


export function ProductRateEditor({
  product,
  date,
  onDone,
}: {
  product: Row;
  date: string;
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const [code, setCode] = useState(str(product.code ?? ""));
  const [name, setName] = useState(str(product.name ?? ""));
  const rawCat = str(product.category);
  const category = rawCat === "confectionery" || rawCat === "CF-05 CONFECTIONERY"
    ? "CF-05 CONFECTIONERY"
    : (rawCat || "CG-01 CIGARETTE");
  const isConf = category === "CF-05 CONFECTIONERY";
  const [rate, setRate] = useState(str(product.rate ?? ""));
  const [barcode, setBarcode] = useState(str(product.barcode ?? ""));
  const [effectiveDate, setEffectiveDate] = useState(date);
  const [fractional, setFractional] = useState(product.fractional === true);
  const [confirmed, setConfirmed] = useState(true);
  const defaultMultiple = product.itc_multiple
    ? Number(product.itc_multiple).toFixed(2)
    : str(product.code) === "3531"
      ? "0.40"
      : ["3692", "3624", "3757", "3759", "3053", "3752", "3652", "3653", "4546"].includes(str(product.code))
        ? "0.20"
        : "0.10";
  const [itcMultiple, setItcMultiple] = useState(defaultMultiple);
  const [isFocusBrand, setIsFocusBrand] = useState(product.is_focus_brand === true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        try {
          await api("products", rowSchema, {
            id: str(product.id),
            code: code.trim(),
            name: name.trim(),
            barcode: barcode
              .split(/[\s,;]+/)
              .map((s) => s.trim())
              .filter(Boolean)
              .join(", ") || null,
            category,
            unit: isConf ? "piece" : "m",
            baseUnit: isConf ? "piece" : "m",
            conversion: "1",
            basis: "1",
            rate: cleanDecimal(rate),
            effectiveDate,
            fractional,
            confirmed,
            itcMultiple: itcMultiple ? cleanDecimal(itcMultiple) : itcMultiple,
            isFocusBrand,
          });
          await qc.invalidateQueries();
          onDone();
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {/* Row 1: Effective date (small) | Category (small, read-only) | Code (small) | Name (remaining) */}
        <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div style={{ width: 135, flexShrink: 0 }}>
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#475569", marginBottom: 4 }}>
              Effective date *
            </label>
            <input
              type="date"
              value={effectiveDate}
              onChange={(e) => setEffectiveDate(e.target.value)}
              required
              style={{ width: "100%", padding: "7px 10px", fontSize: 13, borderRadius: 6, border: "1px solid #cbd5e1" }}
            />
          </div>
          <div style={{ width: 175, flexShrink: 0 }}>
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#475569", marginBottom: 4 }}>
              Category
            </label>
            <input
              type="text"
              value={category}
              readOnly
              style={{
                width: "100%",
                padding: "7px 10px",
                fontSize: 13,
                borderRadius: 6,
                border: "1px solid #cbd5e1",
                background: "#f1f5f9",
                color: "#475569",
                cursor: "not-allowed",
                fontWeight: 600,
              }}
            />
          </div>
          <div style={{ width: 110, flexShrink: 0 }}>
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#475569", marginBottom: 4 }}>
              Code *
            </label>
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
              placeholder="e.g. 3531"
              style={{
                width: "100%",
                padding: "7px 10px",
                fontSize: 13,
                borderRadius: 6,
                border: "1px solid #cbd5e1",
                fontFamily: "monospace",
                fontWeight: 700,
              }}
            />
          </div>
          <div style={{ flex: 1, minWidth: 200 }}>
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#475569", marginBottom: 4 }}>
              Name *
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              placeholder="Product name"
              style={{
                width: "100%",
                padding: "7px 10px",
                fontSize: 13,
                borderRadius: 6,
                border: "1px solid #cbd5e1",
                fontWeight: 600,
              }}
            />
          </div>
        </div>

        {/* Row 2: Fixed Unit (small) | Rate (₹ / m) * (small) | ITC Export Split Multiple * (small) | Barcodes / EANs (remaining) */}
        <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div style={{ width: 80, flexShrink: 0 }}>
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#475569", marginBottom: 4 }}>
              Fixed Unit
            </label>
            <input
              value={isConf ? "piece" : "m"}
              readOnly
              style={{
                width: "100%",
                padding: "7px 10px",
                fontSize: 13,
                borderRadius: 6,
                border: "1px solid #cbd5e1",
                background: "#f1f5f9",
                color: "#475569",
                cursor: "not-allowed",
                fontWeight: 600,
                textAlign: "center",
              }}
            />
          </div>
          <div style={{ width: 125, flexShrink: 0 }}>
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#475569", marginBottom: 4 }}>
              Rate (₹ / {isConf ? "piece" : "m"}) *
            </label>
            <input
              inputMode="decimal"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              placeholder="e.g. 15.00"
              required
              style={{ width: "100%", padding: "7px 10px", fontSize: 13, borderRadius: 6, border: "1px solid #cbd5e1", fontWeight: 600 }}
            />
          </div>
          <div style={{ width: 175, flexShrink: 0 }}>
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#475569", marginBottom: 4 }}>
              ITC Export Split Multiple *
            </label>
            <select
              value={itcMultiple}
              onChange={(e) => setItcMultiple(e.target.value)}
              style={{ width: "100%", padding: "7px 10px", fontSize: 13, borderRadius: 6, border: "1px solid #cbd5e1", fontWeight: 600 }}
            >
              <option value="0.40">0.40 multiple</option>
              <option value="0.20">0.20 multiple</option>
              <option value="0.10">0.10 multiple</option>
              <option value="1.00">1.00 multiple</option>
            </select>
          </div>
          <div style={{ flex: 1, minWidth: 200 }}>
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#475569", marginBottom: 4 }}>
              Barcodes / EANs (separated by space or comma)
            </label>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input
                value={barcode}
                onChange={(e) => setBarcode(e.target.value)}
                placeholder="e.g. 8901725123456, 8901725123457"
                style={{
                  flex: 1,
                  padding: "7px 10px",
                  fontSize: 13,
                  borderRadius: 6,
                  border: "1px solid #cbd5e1",
                  fontFamily: barcode ? "monospace" : "inherit",
                  fontWeight: barcode ? 700 : 400,
                }}
              />
              {barcode && (
                <button
                  type="button"
                  onClick={() => setBarcode("")}
                  style={{
                    background: "none",
                    border: "none",
                    color: "#94a3b8",
                    cursor: "pointer",
                    padding: "4px",
                  }}
                  title="Clear barcodes"
                >
                  <X size={16} />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
      <div style={{ display: "flex", gap: 16, margin: "10px 0", flexWrap: "wrap" }}>
        <label
          className="checkbox"
          style={{
            fontWeight: isFocusBrand ? 600 : 400,
            color: isFocusBrand ? "#b45309" : undefined,
          }}
        >
          <input
            type="checkbox"
            checked={isFocusBrand}
            onChange={(e) => setIsFocusBrand(e.target.checked)}
          />{" "}
          ⭐ Focus Brand (prioritize to CDM first during ITC export)
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={fractional}
            onChange={(e) => setFractional(e.target.checked)}
          />{" "}
          Fractional quantities allowed (e.g. 12.5 m)
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />{" "}
          Confirm unit and effective rate
        </label>
      </div>
      {error && <p className="error">{error}</p>}
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <Button className="primary" type="submit" disabled={busy}>
          {busy ? "Saving..." : "Save changes"}
        </Button>
        <Button className="secondary" type="button" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}


export function SalesmanPolicyEditor({
  salesman,
  onDone,
}: {
  salesman: Row;
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState(str(salesman.name));
  const [limit, setLimit] = useState(str(salesman.credit_limit));
  const [enabled, setEnabled] = useState(
    salesman.credit_limit !== null && salesman.credit_limit !== undefined,
  );
  const [phone, setPhone] = useState(
    str(salesman.phone || (salesman.details as Row | undefined)?.phone),
  );
  const [route, setRoute] = useState(str((salesman.details as Row | undefined)?.route));
  const [itcId, setItcId] = useState(str((salesman.details as Row | undefined)?.itc_id));
  const [beatCode, setBeatCode] = useState(str((salesman.details as Row | undefined)?.beat_code));
  const [beatName, setBeatName] = useState(str((salesman.details as Row | undefined)?.beat_name));
  const [active, setActive] = useState(salesman.active === true);

  // Customer Management State
  const customersQuery = useQuery({
    queryKey: ["salesman-customers", str(salesman.id)],
    queryFn: () => api(`itc/customers?salesmanId=${salesman.id}`, rowsSchema),
  });

  const [customerList, setCustomerList] = useState<Row[]>([]);
  const [selectedCustId, setSelectedCustId] = useState("");
  const [deletedCustIds, setDeletedCustIds] = useState<Set<string>>(new Set());
  const [addedCustomers, setAddedCustomers] = useState<{
    customerId: string;
    customerName: string;
    beatCode: string;
    beatName: string;
    isGst: boolean;
  }[]>([]);
  const [modifiedNameMap, setModifiedNameMap] = useState<Map<string, string>>(new Map());
  const [modifiedGstMap, setModifiedGstMap] = useState<Map<string, boolean>>(new Map());
  const [modifiedBeatCodeMap, setModifiedBeatCodeMap] = useState<Map<string, string>>(new Map());
  const [modifiedBeatNameMap, setModifiedBeatNameMap] = useState<Map<string, string>>(new Map());
  const [showAddCustomer, setShowAddCustomer] = useState(false);

  // New customer input in bottom
  const [newCustId, setNewCustId] = useState("");
  const [newCustName, setNewCustName] = useState("");
  const [newCustBeatCode, setNewCustBeatCode] = useState("");
  const [newCustBeatName, setNewCustBeatName] = useState("");
  const [newCustGst, setNewCustGst] = useState(false);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [changeSummary, setChangeSummary] = useState<string | null>(null);

  useEffect(() => {
    if (customersQuery.data) {
      setCustomerList(customersQuery.data);
      if (customersQuery.data.length > 0 && !selectedCustId) {
        setSelectedCustId(str(customersQuery.data[0].id));
      }
    }
  }, [customersQuery.data]);

  // Combined visible customers (initial minus deleted, plus added)
  const visibleCustomers: Row[] = [
    ...customerList
      .filter((c) => !deletedCustIds.has(str(c.id)))
      .map((c) => ({
        ...c,
        customer_name: modifiedNameMap.has(str(c.id))
          ? modifiedNameMap.get(str(c.id))
          : str(c.customer_name || ""),
        beat_code: modifiedBeatCodeMap.has(str(c.id))
          ? modifiedBeatCodeMap.get(str(c.id))
          : str(c.beat_code || ""),
        beat_name: modifiedBeatNameMap.has(str(c.id))
          ? modifiedBeatNameMap.get(str(c.id))
          : str(c.beat_name || ""),
        is_gst: modifiedGstMap.has(str(c.id))
          ? modifiedGstMap.get(str(c.id))
          : c.is_gst === true,
      })),
    ...addedCustomers.map((a, idx) => ({
      id: "temp-" + idx,
      customer_id: a.customerId,
      customer_name: a.customerName,
      beat_code: a.beatCode,
      beat_name: a.beatName,
      is_gst: a.isGst,
      isNew: true,
    })),
  ];

  const handleAddCustomer = () => {
    if (!newCustId.trim() || !newCustName.trim()) {
      alert("Please enter both Customer ID and Customer Name.");
      return;
    }
    const newIdx = addedCustomers.length;
    setAddedCustomers((prev) => [
      ...prev,
      {
        customerId: newCustId.trim(),
        customerName: newCustName.trim(),
        beatCode: newCustBeatCode.trim() || beatCode.trim(),
        beatName: newCustBeatName.trim() || beatName.trim(),
        isGst: newCustGst,
      },
    ]);
    setSelectedCustId("temp-" + newIdx);
    setNewCustId("");
    setNewCustName("");
    setNewCustBeatCode("");
    setNewCustBeatName("");
    setNewCustGst(false);
  };

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        setChangeSummary(null);

        try {
          const changes: string[] = [];
          if (name !== str(salesman.name)) changes.push(`Name changed to "${name}"`);
          if (phone !== str((salesman.details as Row | undefined)?.phone)) changes.push("Phone updated");
          if (route !== str((salesman.details as Row | undefined)?.route)) changes.push("Route updated");
          if (itcId !== str((salesman.details as Row | undefined)?.itc_id)) changes.push(`ITC ID updated to "${itcId}"`);
          if (beatCode !== str((salesman.details as Row | undefined)?.beat_code)) changes.push(`Beat Code updated to "${beatCode}"`);
          if (beatName !== str((salesman.details as Row | undefined)?.beat_name)) changes.push(`Beat Name updated to "${beatName}"`);
          if (active !== (salesman.active === true)) changes.push(`Active status: ${active ? "Active" : "Inactive"}`);

          if (enabled === (salesman.credit_limit !== null && salesman.credit_limit !== undefined)) {
            if (enabled && limit !== str(salesman.credit_limit)) {
              changes.push(`Credit limit set to ₹${limit}`);
            }
          } else {
            changes.push(enabled ? `Credit limit enforced: ₹${limit}` : "Credit limit disabled");
          }

          const parsedLimit = cleanDecimal(limit);
          await api(
            "salesmen/" + salesman.id,
            rowSchema,
            {
              name,
              creditLimit: (enabled && parsedLimit) || null,
              active,
              details: {
                ...(salesman.details as Row),
                phone,
                route,
                itc_id: itcId,
                itc_name: name,
                beat_code: beatCode,
                beat_name: beatName,
              },
            },
            "PATCH",
          );

          // Handle deleted customers
          for (const delId of deletedCustIds) {
            await fetch(`/api/v1/itc/customers/${delId}`, { method: "DELETE" });
          }
          if (deletedCustIds.size > 0) changes.push(`Removed ${deletedCustIds.size} customer(s)`);

          // Handle added customers
          for (const addC of addedCustomers) {
            await api(
              "itc/customers",
              rowSchema,
              {
                customerId: addC.customerId,
                customerName: addC.customerName,
                salesmanId: salesman.id,
                beatCode: addC.beatCode || beatCode || "",
                beatName: addC.beatName || beatName || "",
                isGst: addC.isGst,
              },
              "POST",
            );
          }
          if (addedCustomers.length > 0) changes.push(`Added ${addedCustomers.length} new customer(s)`);

          // Handle modified customers (customerName, GST tag, beatCode, beatName)
          const allModifiedIds = new Set([
            ...modifiedNameMap.keys(),
            ...modifiedGstMap.keys(),
            ...modifiedBeatCodeMap.keys(),
            ...modifiedBeatNameMap.keys(),
          ]);
          let updatedCustCount = 0;
          for (const modId of allModifiedIds) {
            if (!deletedCustIds.has(modId)) {
              const payload: Record<string, unknown> = {};
              if (modifiedNameMap.has(modId)) payload.customerName = modifiedNameMap.get(modId);
              if (modifiedGstMap.has(modId)) payload.isGst = modifiedGstMap.get(modId);
              if (modifiedBeatCodeMap.has(modId)) payload.beatCode = modifiedBeatCodeMap.get(modId);
              if (modifiedBeatNameMap.has(modId)) payload.beatName = modifiedBeatNameMap.get(modId);
              if (Object.keys(payload).length > 0) {
                await api(`itc/customers/${modId}`, rowSchema, payload, "PATCH");
                updatedCustCount++;
              }
            }
          }
          if (updatedCustCount > 0) changes.push(`Updated ${updatedCustCount} customer(s) details/beat`);

          await qc.invalidateQueries();
          setDeletedCustIds(new Set());
          setAddedCustomers([]);
          setModifiedNameMap(new Map());
          setModifiedGstMap(new Map());
          setModifiedBeatCodeMap(new Map());
          setModifiedBeatNameMap(new Map());
          customersQuery.refetch();

          if (changes.length === 0) changes.push("Details saved (no data values modified)");
          setChangeSummary(changes.join(" · "));
        } catch (err: unknown) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="form-grid">
        <Field label="Salesman display name">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </Field>
        <Field label="Phone number">
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="e.g. 9848012345"
          />
        </Field>
        <Field label="Route / delivery area">
          <input
            value={route}
            onChange={(e) => setRoute(e.target.value)}
            placeholder="e.g. Market Beat 1"
          />
        </Field>
        <Field label="ITC Salesman ID (for sync)">
          <input
            value={itcId}
            onChange={(e) => setItcId(e.target.value)}
            placeholder="e.g. 1HG2"
          />
        </Field>
        <Field label="Beat Code">
          <input
            value={beatCode}
            onChange={(e) => setBeatCode(e.target.value)}
            placeholder="e.g. 01"
          />
        </Field>
        <Field label="Beat Name">
          <input
            value={beatName}
            onChange={(e) => setBeatName(e.target.value)}
            placeholder="e.g. TOWN BEAT"
          />
        </Field>
      </div>

      <div style={{ margin: "14px 0" }}>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />{" "}
          Enforce Maximum Outstanding Credit Policy (₹)
        </label>
        <label className="checkbox" style={{ marginLeft: 20 }}>
          <input
            type="checkbox"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
          />{" "}
          Active (Salesman can be billed)
        </label>
      </div>

      {enabled && (
        <Field label="Maximum Outstanding Balance Limit (₹)">
          <input
            inputMode="decimal"
            value={limit}
            onChange={(e) => setLimit(e.target.value)}
            placeholder="e.g. 50000.00"
          />
        </Field>
      )}

      {/* Customers Section */}
      <div style={{ marginTop: 14, padding: "12px 14px", border: "1px solid #e2e8f0", borderRadius: 8, background: "#f8fafc" }}>
        {(() => {
          const distinctBeats = Array.from(new Set(visibleCustomers.map((c) => str(c.beat_code)).filter(Boolean)));
          const isMultiBeat = distinctBeats.length > 1;
          return (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, flexWrap: "wrap", gap: 6 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <strong style={{ fontSize: "0.9rem", color: "#334155" }}>
                  Assigned Customers ({visibleCustomers.length})
                </strong>
                <span style={{
                  fontSize: "0.74rem",
                  fontWeight: 600,
                  padding: "2px 8px",
                  borderRadius: 12,
                  background: isMultiBeat ? "#fef3c7" : "#e0f2fe",
                  color: isMultiBeat ? "#92400e" : "#0369a1",
                  border: isMultiBeat ? "1px solid #fde68a" : "1px solid #bae6fd",
                }}>
                  {isMultiBeat ? `Covers ${distinctBeats.length} Beats: ${distinctBeats.join(", ")}` : distinctBeats.length === 1 ? `Single Beat: Beat ${distinctBeats[0]}` : "No Beat Assigned"}
                </span>
              </div>
              <span style={{ fontSize: "0.78rem", color: "#64748b" }}>
                Used for ITC Export auto-split & capping
              </span>
            </div>
          );
        })()}

        {visibleCustomers.length > 0 ? (
          <div>
            {(() => {
              const cust = visibleCustomers.find((c) => str(c.id) === selectedCustId) || visibleCustomers[0];
              const effectiveCustId = cust ? str(cust.id) : "";
              return (
                <div style={{ background: "#ffffff", border: "1px solid #cbd5e1", borderRadius: 8, padding: "10px 12px", marginBottom: 10 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
                    <div style={{ flex: "1.2 1 180px", minWidth: 160 }}>
                      <label style={{ display: "block", fontSize: "0.72rem", color: "#64748b", fontWeight: 700, marginBottom: 3, textTransform: "uppercase" }}>
                        Select Customer ({visibleCustomers.length})
                      </label>
                      <select
                        value={effectiveCustId}
                        onChange={(e) => setSelectedCustId(e.target.value)}
                        style={{ width: "100%", padding: "5px 8px", borderRadius: 4, border: "1px solid #cbd5e1", fontSize: "0.84rem", background: "#f8fafc", height: 32 }}
                      >
                        {visibleCustomers.map((c) => {
                          const bCode = str(c.beat_code);
                          const bName = str(c.beat_name);
                          const beatDisplay = bCode || bName ? `Beat ${bCode || "—"} (${bName || "No name"})` : "No beat";
                          return (
                            <option key={str(c.id)} value={str(c.id)}>
                              {str(c.customer_name)} ({str(c.customer_id)}) — {beatDisplay}{c.is_gst ? " [GST]" : ""}{c.isNew ? " (New)" : ""}
                            </option>
                          );
                        })}
                      </select>
                    </div>

                    {cust && (
                      <>
                        <div style={{ flex: "1.5 1 180px", minWidth: 150 }}>
                          <label style={{ display: "block", fontSize: "0.72rem", color: "#64748b", fontWeight: 700, marginBottom: 3, textTransform: "uppercase" }}>
                            Customer Name
                          </label>
                          <input
                            value={str(cust.customer_name || "")}
                            onChange={(e) => {
                              const val = e.target.value;
                              if (effectiveCustId.startsWith("temp-")) {
                                const idx = parseInt(effectiveCustId.replace("temp-", ""), 10);
                                setAddedCustomers((prev) => prev.map((a, i) => (i === idx ? { ...a, customerName: val } : a)));
                              } else {
                                setModifiedNameMap((prev) => new Map(prev).set(effectiveCustId, val));
                              }
                            }}
                            placeholder="Customer name"
                            style={{ width: "100%", padding: "5px 8px", borderRadius: 4, border: "1px solid #cbd5e1", fontSize: "0.84rem", height: 32 }}
                          />
                        </div>

                        <div style={{ flex: "0.6 1 65px", minWidth: 60, maxWidth: 85 }}>
                          <label style={{ display: "block", fontSize: "0.72rem", color: "#64748b", fontWeight: 700, marginBottom: 3, textTransform: "uppercase" }}>
                            Beat Code
                          </label>
                          <input
                            value={str(cust.beat_code || "")}
                            onChange={(e) => {
                              const val = e.target.value;
                              if (effectiveCustId.startsWith("temp-")) {
                                const idx = parseInt(effectiveCustId.replace("temp-", ""), 10);
                                setAddedCustomers((prev) => prev.map((a, i) => (i === idx ? { ...a, beatCode: val } : a)));
                              } else {
                                setModifiedBeatCodeMap((prev) => new Map(prev).set(effectiveCustId, val));
                              }
                            }}
                            placeholder="e.g. 15"
                            style={{ width: "100%", padding: "5px 8px", borderRadius: 4, border: "1px solid #cbd5e1", fontSize: "0.84rem", height: 32 }}
                          />
                        </div>

                        <div style={{ flex: "1.2 1 130px", minWidth: 110 }}>
                          <label style={{ display: "block", fontSize: "0.72rem", color: "#64748b", fontWeight: 700, marginBottom: 3, textTransform: "uppercase" }}>
                            Beat Name
                          </label>
                          <input
                            value={str(cust.beat_name || "")}
                            onChange={(e) => {
                              const val = e.target.value;
                              if (effectiveCustId.startsWith("temp-")) {
                                const idx = parseInt(effectiveCustId.replace("temp-", ""), 10);
                                setAddedCustomers((prev) => prev.map((a, i) => (i === idx ? { ...a, beatName: val } : a)));
                              } else {
                                setModifiedBeatNameMap((prev) => new Map(prev).set(effectiveCustId, val));
                              }
                            }}
                            placeholder="e.g. MLG BEAT"
                            style={{ width: "100%", padding: "5px 8px", borderRadius: 4, border: "1px solid #cbd5e1", fontSize: "0.84rem", height: 32 }}
                          />
                        </div>

                        <Button
                          className="secondary"
                          type="button"
                          onClick={() => {
                            if (!effectiveCustId) return;
                            const newGst = !cust.is_gst;
                            if (effectiveCustId.startsWith("temp-")) {
                              const idx = parseInt(effectiveCustId.replace("temp-", ""), 10);
                              setAddedCustomers((prev) =>
                                prev.map((a, i) => (i === idx ? { ...a, isGst: newGst } : a))
                              );
                            } else {
                              setModifiedGstMap((prev) => new Map(prev).set(effectiveCustId, newGst));
                            }
                          }}
                          style={{
                            padding: "5px 10px",
                            fontSize: "0.8rem",
                            fontWeight: 600,
                            backgroundColor: cust.is_gst ? "#fef3c7" : "#f1f5f9",
                            color: cust.is_gst ? "#92400e" : "#475569",
                            borderColor: cust.is_gst ? "#f59e0b" : "#cbd5e1",
                            height: 32,
                            whiteSpace: "nowrap",
                          }}
                          title="Toggle GST status (GST customers are never capped during ITC export)"
                        >
                          {cust.is_gst ? "Tag: GST" : "Tag: Non-GST"}
                        </Button>

                        <Button
                          className="secondary"
                          type="button"
                          onClick={() => {
                            if (!effectiveCustId) return;
                            if (effectiveCustId.startsWith("temp-")) {
                              const idx = parseInt(effectiveCustId.replace("temp-", ""), 10);
                              setAddedCustomers((prev) => prev.filter((_, i) => i !== idx));
                            } else {
                              setDeletedCustIds((prev) => new Set(prev).add(effectiveCustId));
                            }
                            const remaining = visibleCustomers.filter((c) => str(c.id) !== effectiveCustId);
                            setSelectedCustId(remaining.length > 0 ? str(remaining[0].id) : "");
                          }}
                          style={{ color: "#dc2626", borderColor: "#fca5a5", padding: "5px 10px", fontSize: "0.8rem", height: 32, whiteSpace: "nowrap" }}
                          title="Remove customer from this salesman"
                        >
                          <Trash2 size={13} /> Delete
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              );
            })()}
          </div>
        ) : (
          <p style={{ fontSize: "0.85rem", color: "#64748b", margin: "6px 0 10px 0" }}>
            No customers currently assigned to this salesman. Check "+ Add new customer" below to add one.
          </p>
        )}

        <div style={{ marginTop: 6 }}>
          <label
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: "0.8rem",
              fontWeight: 600,
              cursor: "pointer",
              color: showAddCustomer ? "#0369a1" : "#475569",
              userSelect: "none",
              padding: "3px 8px",
              borderRadius: 5,
              background: showAddCustomer ? "#e0f2fe" : "transparent",
              border: showAddCustomer ? "1px solid #bae6fd" : "1px solid transparent",
              transition: "all 0.15s ease",
            }}
          >
            <input
              type="checkbox"
              checked={showAddCustomer}
              onChange={(e) => setShowAddCustomer(e.target.checked)}
              style={{ accentColor: "#0284c7", cursor: "pointer", width: 14, height: 14 }}
            />
            <span>+ Add new customer</span>
          </label>
        </div>

        {showAddCustomer && (
          <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap", marginTop: 8, padding: "10px 12px", background: "#f1f5f9", borderRadius: 6, border: "1px dashed #cbd5e1" }}>
            <div style={{ flex: 1, minWidth: 100 }}>
              <label style={{ display: "block", fontSize: "0.72rem", color: "#475569", marginBottom: 3, fontWeight: 700 }}>
                CUSTOMER ID
              </label>
              <input
                value={newCustId}
                onChange={(e) => setNewCustId(e.target.value)}
                placeholder="e.g. 1HGC999"
                style={{ width: "100%", padding: "5px 8px", borderRadius: 4, border: "1px solid #cbd5e1", fontSize: "0.84rem", height: 32, background: "#fff" }}
              />
            </div>
            <div style={{ flex: 2, minWidth: 140 }}>
              <label style={{ display: "block", fontSize: "0.72rem", color: "#475569", marginBottom: 3, fontWeight: 700 }}>
                CUSTOMER NAME / SHOP NAME
              </label>
              <input
                value={newCustName}
                onChange={(e) => setNewCustName(e.target.value)}
                placeholder="e.g. NEW SAI KIRANAM"
                style={{ width: "100%", padding: "5px 8px", borderRadius: 4, border: "1px solid #cbd5e1", fontSize: "0.84rem", height: 32, background: "#fff" }}
              />
            </div>
            <div style={{ flex: 1, minWidth: 70, maxWidth: 90 }}>
              <label style={{ display: "block", fontSize: "0.72rem", color: "#475569", marginBottom: 3, fontWeight: 700 }}>
                BEAT CODE
              </label>
              <input
                value={newCustBeatCode}
                onChange={(e) => setNewCustBeatCode(e.target.value)}
                placeholder={beatCode || "e.g. 15"}
                style={{ width: "100%", padding: "5px 8px", borderRadius: 4, border: "1px solid #cbd5e1", fontSize: "0.84rem", height: 32, background: "#fff" }}
              />
            </div>
            <div style={{ flex: 1.5, minWidth: 110 }}>
              <label style={{ display: "block", fontSize: "0.72rem", color: "#475569", marginBottom: 3, fontWeight: 700 }}>
                BEAT NAME
              </label>
              <input
                value={newCustBeatName}
                onChange={(e) => setNewCustBeatName(e.target.value)}
                placeholder={beatName || "e.g. MLG BEAT"}
                style={{ width: "100%", padding: "5px 8px", borderRadius: 4, border: "1px solid #cbd5e1", fontSize: "0.84rem", height: 32, background: "#fff" }}
              />
            </div>
            <div style={{ display: "flex", alignItems: "center", height: 32 }}>
              <label className="checkbox" style={{ fontSize: "0.8rem", fontWeight: 600, color: newCustGst ? "#92400e" : "#475569" }}>
                <input
                  type="checkbox"
                  checked={newCustGst}
                  onChange={(e) => setNewCustGst(e.target.checked)}
                />{" "}
                GST Customer
              </label>
            </div>
            <Button
              className="secondary"
              type="button"
              onClick={handleAddCustomer}
              style={{ fontSize: "0.82rem", padding: "5px 12px", background: "#fff", height: 32 }}
            >
              <Plus size={14} /> Add Customer
            </Button>
          </div>
        )}
      </div>

      {error && <p className="error" style={{ marginTop: 10 }}>{error}</p>}

      <div style={{ display: "flex", gap: 8, marginTop: 14, alignItems: "center" }}>
        <Button className="primary" type="submit" disabled={busy}>
          {busy ? "Saving..." : "Save details & credit policy"}
        </Button>
        <Button className="secondary" type="button" onClick={onDone}>
          Close
        </Button>
      </div>

      {changeSummary && (
        <div style={{ marginTop: 12, padding: "10px 14px", borderRadius: 8, background: "#f0fdf4", border: "1px solid #86efac", color: "#166534", fontSize: "0.88rem", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>✓ {changeSummary}</span>
          <button
            type="button"
            onClick={() => setChangeSummary(null)}
            style={{ background: "none", border: "none", cursor: "pointer", fontSize: "1.1rem", lineHeight: 1, color: "#166534", fontWeight: "bold", padding: "0 4px" }}
            aria-label="Close message"
          >
            ×
          </button>
        </div>
      )}
    </form>
  );
}


export function MasterForm({
  kind,
  date,
  onDone,
}: {
  kind: "products" | "salesmen" | "accounts";
  date: string;
  onDone: () => void;
}) {
  const [form, setForm] = useState<Record<string, string>>({
    effectiveDate: date,
    conversion: "1",
    basis: "1",
    type: "cash",
    fractional: "true",
    confirmed: "true",
    itcMultiple: "0.10",
    isFocusBrand: "false",
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();

  return (
    <form
      className="master-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        try {
          if (kind === "products") {
            await api(kind, rowSchema, {
              code: form.code?.trim(),
              name: form.name?.trim(),
              barcode: form.barcode
                ? form.barcode.split(/[\s,;]+/).map((s: string) => s.trim()).filter(Boolean).join(", ") || null
                : null,
              unit: "m",
              baseUnit: "m",
              conversion: "1",
              basis: "1",
              rate: form.rate?.trim(),
              effectiveDate: form.effectiveDate,
              fractional: form.fractional === "true",
              confirmed: true,
              itcMultiple: form.itcMultiple || "0.10",
              isFocusBrand: form.isFocusBrand === "true",
            });
          } else if (kind === "salesmen") {
            const limit = form.creditLimit?.trim();
            await api(kind, rowSchema, {
              code: form.code?.trim(),
              name: form.name?.trim(),
              active: true,
              creditLimit: limit || null,
              details: {
                phone: form.phone?.trim() ?? "",
                route: form.route?.trim() ?? "",
              },
            });
          } else {
            await api(kind, rowSchema, {
              name: form.name?.trim(),
              type: form.type || "cash",
              holder: form.holder?.trim(),
              allowOverdraft: false,
            });
          }
          await qc.invalidateQueries();
          setError("Saved.");
          onDone();
        } catch (err: unknown) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="form-grid">
        {(kind === "salesmen"
          ? ["code", "name", "phone", "route", "creditLimit"]
          : kind === "accounts"
            ? ["name", "type", "holder"]
            : ["code", "name", "barcode", "rate", "effectiveDate"]
        ).map((f) => (
          <Field
            key={f}
            label={
              f === "rate"
                ? "Rate (₹ / m) *"
                : f === "creditLimit"
                  ? "Credit Limit (₹, optional)"
                  : f === "barcode"
                    ? "Barcodes / EANs (Multiple allowed: space, comma, or newline separated)"
                    : f === "phone"
                      ? "Contact Phone (optional)"
                      : f === "route"
                        ? "Route / Area (optional)"
                        : f.replace(/([A-Z])/g, " $1") + " *"
            }
          >
            {f === "type" ? (
              <select
                value={form[f]}
                onChange={(e) => setForm({ ...form, [f]: e.target.value })}
              >
                <option value="cash">Physical cash</option>
                <option value="bank">Bank</option>
              </select>
            ) : (
              <input
                type={f === "effectiveDate" ? "date" : "text"}
                inputMode={f === "rate" || f === "creditLimit" ? "decimal" : undefined}
                value={form[f] ?? ""}
                onChange={(e) => setForm({ ...form, [f]: e.target.value })}
                placeholder={
                  f === "code"
                    ? "e.g. S01"
                    : f === "name"
                      ? "e.g. Rahul Sharma"
                      : f === "barcode"
                        ? "e.g. 8901725123456 8901725123457 or 8901725123456, 8901725123457"
                        : f === "creditLimit"
                          ? "e.g. 50000 (leave blank for none)"
                          : f === "phone"
                            ? "e.g. 9876543210"
                            : f === "route"
                              ? "e.g. North Market"
                              : undefined
                }
                required={f !== "creditLimit" && f !== "phone" && f !== "route" && f !== "barcode"}
              />
            )}
          </Field>
        ))}

        {kind === "products" && (
          <>
            <Field label="Fixed Unit">
              <input
                value="m"
                readOnly
                style={{ background: "#f5f5f4", color: "#57534e" }}
              />
            </Field>

            <Field label="ITC Export Split Multiple *">
              <select
                value={form.itcMultiple || "0.10"}
                onChange={(e) => setForm({ ...form, itcMultiple: e.target.value })}
                style={{ fontWeight: 600 }}
              >
                <option value="0.40">0.40 multiple (Goldflake SLK)</option>
                <option value="0.20">0.20 multiple (Classic / Bursts / Connect)</option>
                <option value="0.10">0.10 multiple (Standard / Other brands)</option>
                <option value="1.00">1.00 multiple (Whole units only)</option>
              </select>
            </Field>

            <label className="checkbox">
              <input
                type="checkbox"
                checked={form.isFocusBrand === "true"}
                onChange={(e) => setForm({ ...form, isFocusBrand: String(e.target.checked) })}
              />{" "}
              ⭐ Focus Brand (prioritize to CDM first during ITC export)
            </label>

            <label className="checkbox">
              <input
                type="checkbox"
                checked={form.fractional === "true"}
                onChange={(e) => setForm({ ...form, fractional: String(e.target.checked) })}
              />{" "}
              Fractional quantities allowed (e.g. 10.5 m)
            </label>

            <label className="checkbox">
              <input
                type="checkbox"
                checked={form.confirmed === "true"}
                onChange={(e) => setForm({ ...form, confirmed: String(e.target.checked) })}
              />{" "}
              Unit and rate confirmed
            </label>
          </>
        )}
      </div>

      {error && (
        <p role="status" className={error === "Saved." ? "success" : "error"}>
          {error}
        </p>
      )}

      <Button type="submit" className="primary" disabled={busy}>
        {busy ? "Saving…" : `Save ${kind === "products" ? "product configuration" : kind === "accounts" ? "money account" : "salesman"}`}
      </Button>
    </form>
  );
}
