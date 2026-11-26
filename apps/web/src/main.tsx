import React, {
  useEffect,
  useRef,
  useState,
  useId,
  useCallback,
  useMemo,
  createContext,
  useContext,
} from "react";
import Decimal from "decimal.js";
import { createRoot } from "react-dom/client";
import { getProductBarcodes, matchProductsByScanOrCode, matchProductByScanOrCode, useGlobalBarcodeScanner } from "./utils/barcodeScanner";
import { RetailCigSalesPage } from "./pages/RetailCigSalesPage";
import { DirectCigSalesPage } from "./pages/DirectCigSalesPage";
import { DocumentDetail, WhatsAppShareModal } from "./pages/DocumentDetail";
import { MasterRecordsManager, MasterForm } from "./pages/MasterRecordsManager";
import { api, client } from "./api";
import { usePackPcsSynced, getPackPcsMap, savePackPcsMap, saveProductPackPcs, getProductPackPcs } from "./utils/packPcs";
import { Button, selectKeys, Field, Empty, Table, NoteTooltip, DocLink, Metric } from "./components/ui";
import { Documents, SignaturePad } from "./components/Documents";
import { DraftReviewModal } from "./components/DraftReviewModal";
import { StockVerificationReport, ReportExplorer, BookExplorer, ItcExportPage, PublicDocumentView } from "./pages/ReportsPage";
import { CustomerSearchableSelect, ProductIdSearchableSelect, ProductSearchableSelect, ConfectionerySearchableSelect, BarcodeScannerInput, type ConfectioneryRowItem, type DraftConfectioneryItem } from "./components/selectors";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { z } from "zod";
import {
  encodeCsvRows,
  dashboardResponse,
  documentResponse,
  documentListResponse,
  statementResponse,
  previewResponse,
  bookResponse,
  rowSchema,
  rowsSchema,
  commandResult,
  commands,
  cleanMoney,
  cleanDecimal,
  parseMultiAmounts,
  cleanIndianPhone,
  type CommandName,
} from "@ledger/contracts";
import {
  BookOpen,
  LayoutDashboard,
  Users,
  FileText,
  ArrowLeftRight,
  BarChart3,
  Settings,
  Plus,
  LogOut,
  Check,
  Clock,
  Printer,
  RefreshCw,
  IndianRupee,
  TrendingDown,
  LockKeyhole,
  Unlock,
  Wallet,
  CreditCard,
  CalendarDays,
  Download,
  Layers,
  Store,
  Search,
  CheckCircle2,
  Trash2,
  Pencil,
  Star,
  Receipt,
  Banknote,
  Calendar,
  X,
  PanelLeftClose,
  PanelLeftOpen,
  Barcode,
  ScanBarcode,
  ExternalLink,
  Package,
  Copy,
  AlertTriangle,
  Eye,
  Utensils,
  MessageCircle,
} from "lucide-react";
import "./style.css";
import { D, type Row, str, arr, parseCents, parseMoneyNumber, formatCents, rupees, formatBilledCaption, dateLabel, timeOnlyLabel, formatDateTime } from "./utils/helpers";
function Login() {
  const qc = useQueryClient(),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <main className="login">
      <div className="login-brand">
        <BookOpen size={36} />
        <h1>
          A clearer day.
          <br />A balanced book.
        </h1>
        <p>Your business, one reliable record at a time.</p>
      </div>
      <form
        className="panel"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            await api("auth/sign-in/email", rowSchema, { email, password });
            await qc.invalidateQueries({ queryKey: ["me"] });
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="eyebrow">SALES & MONEY BOOK</div>
        <h2>Welcome back</h2>
        <p className="muted">Sign in to your business records.</p>
        <Field label="Email">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="username"
          />
        </Field>
        <Field label="Password">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
          />
        </Field>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <Button type="submit" className="primary" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </Button>
        <p className="small muted">
          Access is set up by your business owner. No public registration.
        </p>
      </form>
    </main>
  );
}
const nav = [
  ["Home", LayoutDashboard],
  ["Retail", Users],
  ["Mudashir", Store],
  ["Foods", Utensils],
  ["Other Money", ArrowLeftRight],
  ["Reports", BarChart3],
  ["Settings", Settings],
] as const;
const WorkflowBusyContext = createContext<
  React.Dispatch<React.SetStateAction<boolean>>
>(() => { });
const commandSection: Partial<Record<CommandName, string>> = {
  bill: "Retail",
  close: "Daily Close",
  receipt: "Retail",
  receiptBatch: "Retail",
  deposit: "Cash & Bank",
  transfer: "Cash & Bank",
  resolveDeposit: "Cash & Bank",
  reconcile: "Cash & Bank",
  reopen: "Daily Close",
  expense: "Other Money",
  salary: "Other Money",
  loan: "Other Money",
  repay: "Other Money",
  owner: "Other Money",
  refund: "Other Money",
  unidentified: "Other Money",
  identify: "Other Money",
};

function App() {
  const me = useQuery({
    queryKey: ["me"],
    queryFn: () => api("me"),
    retry: false,
    refetchOnWindowFocus: false,
  });
  const [page, setPage] = useState("Home");
  const [reportTab, setReportTab] = useState("transactions");
  const [action, setAction] = useState<CommandName | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [, setSelectedHistory] = useState<string[]>([]);
  const [selectedSalesmanId, setSelectedSalesmanId] = useState<string | null>(null);
  const [draftRecord, setDraftRecord] = useState<Row | null>(null);
  const [directBillDraftRecord, setDirectBillDraftRecord] = useState<Row | null>(null);
  const [directBillCustomerId, setDirectBillCustomerId] = useState<string | null>(null);
  const [directReceiveCustomerId, setDirectReceiveCustomerId] = useState<string | null>(null);
  const [retailBillDraftRecord, setRetailBillDraftRecord] = useState<Row | null>(null);
  const [retailActiveView, setRetailActiveView] = useState<
    "ledger" | "new_bill" | "receive_money" | "register" | "saved_drafts"
  >("ledger");
  const [directActiveView, setDirectActiveView] = useState<
    "ledger" | "new_bill" | "receive_money" | "loading_sheet" | "register" | "saved_drafts" | "handovers"
  >("ledger");
  const [draftsOpen, setDraftsOpen] = useState(false);
  const [itcExportOpen, setItcExportOpen] = useState(false);
  const [addSalesmanOpen, setAddSalesmanOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [workflowBusy, setWorkflowBusy] = useState(false);

  const openCommand = useCallback(
    (name: CommandName) => {
      if (workflowBusy) return;
      if (action !== name) setDraftRecord(null);
      setAction(name);
      setDraftsOpen(false);
    },
    [workflowBusy, action],
  );

  const openDocument = useCallback((id: string | null) => {
    if (id === null) {
      setSelected(null);
      setSelectedHistory([]);
      return;
    }
    setSelected((prev) => {
      if (prev && prev !== id) {
        setSelectedHistory((h) => [...h, prev]);
      }
      return id;
    });
  }, []);

  const goBackDocument = useCallback(() => {
    setSelectedHistory((prev) => {
      if (prev.length > 0) {
        const next = [...prev];
        const lastId = next.pop()!;
        setSelected(lastId);
        return next;
      }
      const wasBills = page === "Bills";
      setSelected(null);
      if (wasBills) {
        openCommand("bill");
      }
      return [];
    });
  }, [page, openCommand]);
  const isSalesmanUser = (me.data as Row)?.role === "salesman";
  const navigate = (destination: string) => {
    if (workflowBusy) return;
    if (isSalesmanUser) {
      if (destination !== "Mudashir") return;
      setAction(null);
      setDraftRecord(null);
      setDirectBillDraftRecord(null);
      setDraftsOpen(false);
      setItcExportOpen(false);
      setSelected(null);
      setSelectedHistory([]);
      setPage("Mudashir");
      window.scrollTo(0, 0);
      return;
    }
    if (destination === "New bill") {
      setPage("Retail");
      setRetailActiveView("new_bill");
      window.scrollTo(0, 0);
      return;
    }
    if (destination === "Receive Money") {
      setPage("Retail");
      setRetailActiveView("receive_money");
      window.scrollTo(0, 0);
      return;
    }
    if (destination === "Salesmen") {
      setPage("Retail");
      setRetailActiveView("ledger");
      window.scrollTo(0, 0);
      return;
    }
    if (destination === "Daily Close") {
      openCommand("close");
      return;
    }
    setAction(null);
    setDraftRecord(null);
    setDirectBillDraftRecord(null);
    setRetailBillDraftRecord(null);
    setDraftsOpen(false);
    setItcExportOpen(false);
    setSelected(null);
    setSelectedHistory([]);
    setPage(destination);
    window.scrollTo(0, 0);
  };
  useEffect(() => {
    const shortcut = (e: KeyboardEvent) => {
      if (e.key === "F2") {
        e.preventDefault();
        if (!isSalesmanUser) openCommand("bill");
      }
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, [openCommand, isSalesmanUser]);
  const masters = useQuery({
    queryKey: ["masters"],
    queryFn: () => api("masters"),
    enabled: !!me.data,
  }),
    dash = useQuery({
      queryKey: ["dashboard"],
      queryFn: () => api("dashboard"),
      enabled: !!me.data,
    });
  usePackPcsSynced(!!me.data);
  if (me.isPending) return <div className="loading">Opening your book…</div>;
  if (me.isError) return <Login />;

  const m = me.data,
    business = m.business as Row,
    md = masters.data ?? {},
    d = dash.data,
    date = str(m.date),
    owner = m.role === "owner",
    isSalesman = m.role === "salesman",
    mubashirSalesman = arr(md.salesmen).find(
      (s) =>
        str((s.details as Row)?.is_direct_route) === "true" ||
        str((s.details as Row)?.direct_route) === "true" ||
        str((s.details as Row)?.isDirectRoute) === "true" ||
        str(s.name).toLowerCase().includes("mubashir") ||
        str(s.name).toLowerCase().includes("muddasir") ||
        str((s.details as Row)?.itc_id) === "1HG2",
    ),
    mubashirSalesmanId = mubashirSalesman ? str(mubashirSalesman.id) : undefined,
    workflowOpen = !!(
      action ||
      draftsOpen ||
      selected?.startsWith("statement:") ||
      selected?.startsWith("customer-statement:") ||
      selected?.startsWith("verify:")
    ),
    activePage = isSalesman
      ? "Mudashir"
      : action
        ? (commandSection[action] ?? page)
        : selected
          ? page === "Bills"
            ? "Retail"
            : page
          : page;
  return (
    <WorkflowBusyContext.Provider value={setWorkflowBusy}>
      <div
        className={
          `${page === "Home" && !selected && !workflowOpen ? "app-shell home-shell" : "app-shell"}${sidebarCollapsed ? " sidebar-collapsed" : ""}`
        }
      >
        <aside>
          <div className="sidebar-header">
            <a
              className="brand"
              href="#"
              onClick={(e) => {
                e.preventDefault();
                navigate("Home");
              }}
              title={str(business.name) || "Sales & Money Book"}
            >
              <span className="brand-icon" aria-hidden="true">
                {str(business.name)
                  .split(/\s+/)
                  .filter(Boolean)
                  .slice(0, 2)
                  .map((word) => word[0])
                  .join("")
                  .toUpperCase() || "SM"}
              </span>
              <span className="brand-copy">
                <strong>Sales & Money Book</strong>
                <small>{str(business.name)}</small>
              </span>
            </a>
            <button
              type="button"
              className="sidebar-toggle-btn"
              onClick={() => setSidebarCollapsed((prev) => !prev)}
              aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              {sidebarCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
            </button>
          </div>
          <div className="workspace-profile">
            <div>
              <strong>{owner ? "Owner workspace" : "Manager workspace"}</strong>
              <small>
                {str(business.mode) === "live"
                  ? "Business records"
                  : "Fictional demo records"}
              </small>
            </div>
            <span className="role-badge">{owner ? "OWNER" : "MANAGER"}</span>
          </div>
          <nav aria-label="Main navigation">
            {nav.map(([label, Icon]) => (
              <Button
                key={label}
                disabled={workflowBusy}
                aria-current={activePage === label ? "page" : undefined}
                className={
                  activePage === label
                    ? "nav-item active"
                    : "nav-item"
                }
                title={sidebarCollapsed ? (label === "Home" ? "Dashboard" : label) : undefined}
                onClick={() => navigate(label)}
              >
                <Icon size={19} />
                <span className="nav-label">{label === "Home" ? "Dashboard" : label}</span>
              </Button>
            ))}
          </nav>
          <div className="sidebar-bottom">
            <Button
              aria-label="Sign out"
              disabled={workflowBusy}
              className="sign-out"
              title={sidebarCollapsed ? "Sign Out" : undefined}
              onClick={async () => {
                await api("auth/sign-out", rowSchema, {});
                client.clear();
                location.reload();
              }}
            >
              <LogOut size={19} /> <span className="nav-label">Sign Out</span>
            </Button>
          </div>
        </aside>
        <div className="main-wrap">
          <header>
            <div className="header-left">
              <span>{dateLabel(date)} · Asia/Kolkata</span>
              <span className={d?.dayClosed ? "day-state closed" : "day-state"}>
                {!d
                  ? "CHECKING DATE…"
                  : d.dayClosed
                    ? "DAY CLOSED"
                    : "DAY OPEN"}
              </span>
            </div>
            <span className="mode">
              {str(business.mode).toUpperCase()} ·{" "}
              {business.mode === "live"
                ? "Business records"
                : "Fictional records"}
            </span>
          </header>
          <main className={workflowOpen ? "workflow-main" : undefined}>
            <div className="page-content" hidden={workflowOpen}>
              <div className="page-heading">
                <div>
                  {page !== "Home" && (
                    <div className="eyebrow">
                      {dateLabel(date)} · ASIA/KOLKATA
                    </div>
                  )}
                  <h1>
                    {selected
                      ? page === "Bills"
                        ? "Bill Record"
                        : `${page} Record`
                      : isSalesman
                        ? "Mudashir Direct Route"
                        : page === "Home"
                          ? owner
                            ? "Your business at a glance"
                            : "Manager Daily Desk"
                          : page}
                  </h1>
                  <p className="muted">
                    {selected ? (
                      "View and print the complete audit history and document details for this record."
                    ) : page === "Home" ? (
                      <>
                        Business Date:{" "}
                        <b className="business-date">{dateLabel(date)}</b>
                        <span
                          className={
                            d?.dayClosed ? "day-state closed" : "day-state"
                          }
                        >
                          {!d
                            ? "CHECKING DATE…"
                            : d.dayClosed
                              ? "DAY CLOSED"
                              : "DAY OPEN"}
                        </span>
                      </>
                    ) : page === "Retail" ? (
                      "Salesmen ledger, new cigarette bills, customer collections and registers."
                    ) : page === "Mudashir" ? (
                      "Direct cigarette sales, customer billing, dues and collections for route customers."
                    ) : page === "Foods" ? (
                      "Foods salesmen collections, bills, items and registers."
                    ) : page === "Other Money" ? (
                      "Expenses, employee salaries & advances, and cash/bank transfers."
                    ) : (
                      "Keep every record clear, connected and accounted for."
                    )}
                  </p>
                </div>
                <div className="actions">
                  {page === "Salesmen" && (
                    <>
                      <Button
                        className="primary"
                        onClick={() => navigate("New bill")}
                      >
                        <Plus size={18} /> New bill
                      </Button>
                      <Button
                        className="secondary"
                        onClick={() => navigate("Receive Money")}
                      >
                        <IndianRupee size={16} /> Receive Money
                      </Button>
                    </>
                  )}
                  {page === "Home" && (
                    <>
                      <Button
                        className="secondary"
                        onClick={() => {
                          setItcExportOpen(true);
                          setTimeout(() => {
                            const el = document.getElementById("itc-export-section");
                            if (el) {
                              el.scrollIntoView({ behavior: "smooth", block: "start" });
                            }
                          }, 50);
                        }}
                        title="Review bills, filter by date and export ITC upload CSV"
                      >
                        <Download size={16} /> <span>Export ITC Excel</span>
                      </Button>
                      <span className="dashboard-date">
                        <CalendarDays size={16} /> {dateLabel(date)}
                      </span>
                    </>
                  )}
                </div>
              </div>
              {(masters.isError || dash.isError) && (
                <div role="alert" className="error">
                  Unable to refresh records.{" "}
                  {str((masters.error ?? dash.error)?.message)}{" "}
                  <Button
                    onClick={() => {
                      masters.refetch();
                      dash.refetch();
                    }}
                  >
                    Retry
                  </Button>
                </div>
              )}
              <div style={{ display: selected ? "none" : undefined }}>
                {page === "Home" ? (
                  d ? (
                    <Dashboard
                      data={d}
                      owner={owner}
                      setAction={openCommand}
                      setPage={navigate}
                      onStatement={(id) => {
                        setSelectedSalesmanId(id);
                        setRetailActiveView("ledger");
                        setPage("Retail");
                        openDocument("statement:" + id);
                      }}
                      onDrafts={() => setDraftsOpen(true)}
                      onOpenReport={(tab) => {
                        setReportTab(tab);
                        setPage("Reports");
                      }}
                    />
                  ) : (
                    <p>Loading balances…</p>
                  )
                ) : page === "Retail" ? (
                  <RetailCigSalesPage
                    date={date}
                    masters={md}
                    dashboard={d}
                    owner={owner}
                    excludeSalesmanId={mubashirSalesmanId}
                    initialSalesmanId={selectedSalesmanId}
                    onSelect={openDocument}
                    onStatement={(id: string) => openDocument("statement:" + id)}
                    addSalesmanOpen={addSalesmanOpen}
                    setAddSalesmanOpen={setAddSalesmanOpen}
                    restoreDraftRecord={retailBillDraftRecord}
                    onClearRestoreDraft={() => setRetailBillDraftRecord(null)}
                    activeView={retailActiveView}
                    onViewChange={setRetailActiveView}
                  />
                ) : page === "Salesmen" ? (
                  <Salesmen
                    owner={owner}
                    data={d}
                    masters={md}
                    date={date}
                    add={addSalesmanOpen}
                    setAdd={setAddSalesmanOpen}
                    initialSelectedId={selectedSalesmanId}
                    onStatement={(id: string) => openDocument("statement:" + id)}
                    onSelectRecord={openDocument}
                  />
                ) : page === "Bills" ? (
                  <Documents onSelect={openDocument} kind="bill" excludeSalesmanId={mubashirSalesmanId} />
                ) : page === "Receive Money" ? (
                  <ReceiveMoneyPage
                    date={date}
                    masters={md}
                    dashboard={d}
                    excludeSalesmanId={mubashirSalesmanId}
                    onSelect={openDocument}
                    onGoToSalesman={(salesmanId) => {
                      setSelectedSalesmanId(salesmanId);
                      setRetailActiveView("ledger");
                      setPage("Retail");
                      openDocument(null);
                    }}
                  />
                ) : (isSalesman || page === "Mudashir") ? (
                  <DirectCigSalesPage
                    date={date}
                    masters={md}
                    owner={owner}
                    onSelect={openDocument}
                    onCustomerStatement={(custId: string) => openDocument("customer-statement:" + custId)}
                    restoreDraftRecord={directBillDraftRecord}
                    onClearRestoreDraft={() => setDirectBillDraftRecord(null)}
                    lockedSalesmanId={isSalesman ? (str(m.salesmanId) || mubashirSalesmanId) : undefined}
                    activeView={directActiveView}
                    onViewChange={setDirectActiveView}
                    initialBillCustomerId={directBillCustomerId}
                    initialReceiveCustomerId={directReceiveCustomerId}
                    onClearInitialBillCustomer={() => setDirectBillCustomerId(null)}
                    onClearInitialReceiveCustomer={() => setDirectReceiveCustomerId(null)}
                    initialSalesmanId={selectedSalesmanId}
                  />
                ) : page === "Foods" ? (
                  <FoodsPage
                    date={date}
                    masters={md}
                    owner={owner}
                    onSelect={openDocument}
                  />
                ) : page === "Other Money" ? (
                  <OtherMoneyPage
                    date={date}
                    masters={md}
                    owner={owner}
                    onSelect={openDocument}
                  />
                ) : page === "Cash & Bank" ? (
                  <>
                    <BookExplorer masters={md} date={date} onSelect={openDocument} />
                    <div className="stats">
                      {d &&
                        arr(d.accounts).map((a) => (
                          <Metric
                            key={str(a.id)}
                            label={str(a.name)}
                            value={a.balance}
                            caption={`${str(a.holder)} · book balance`}
                          />
                        ))}
                    </div>
                    <section className="panel">
                      <h2>Move, check & close</h2>
                      <div className="operation-grid">
                        {(
                          [
                            "transfer",
                            "deposit",
                            "resolveDeposit",
                            "reconcile",
                            "close",
                            ...(owner ? ["reopen"] : []),
                          ] as CommandName[]
                        ).map((n) => (
                          <Button
                            key={n}
                            className="secondary"
                            onClick={() => openCommand(n)}
                          >
                            {labels[n]}
                          </Button>
                        ))}
                      </div>
                    </section>
                    <section className="panel">
                      <h2>Money in transit</h2>
                      <Table
                        rows={d ? arr(d.transit) : []}
                        columns={[
                          ["account", "Transit account"],
                          ["balance", "Still in transit", true],
                        ]}
                      />
                    </section>
                    <section className="panel">
                      <h2>Daily close history · today</h2>
                      <Table
                        rows={d ? arr(d.closes) : []}
                        columns={[
                          ["account_name", "Cash account"],
                          ["created_at", "Closed At"],
                          ["expected", "Book cash", true],
                          ["counted", "Counted", true],
                          ["difference", "Difference", true],
                          ["state", "Status"],
                          ["reason", "Explanation"],
                        ]}
                      />
                    </section>
                    <Documents onSelect={openDocument} />
                  </>
                ) : page === "Reports" ? (
                  <ReportExplorer
                    masters={md}
                    onSelect={openDocument}
                    activeTab={reportTab}
                    setActiveTab={setReportTab}
                  />
                ) : (
                  <SettingsPage
                    masters={md}
                    date={date}
                    owner={owner}
                    setAction={openCommand}
                  />
                )}
              </div>
              {selected ? (
                <DocumentDetail
                  id={selected}
                  currentDate={date}
                  onBack={goBackDocument}
                  setAction={openCommand}
                  owner={owner}
                  onSelect={openDocument}
                />
              ) : null}
            </div>
            {action && (
              <CommandPage
                key={action}
                name={action}
                restore={draftRecord}
                date={date}
                masters={md}
                dashboard={d ?? {}}
                owner={owner}
                onClose={() => {
                  setAction(null);
                  setDraftRecord(null);
                }}
                onGoToSalesman={(salesmanId) => {
                  setAction(null);
                  setDraftRecord(null);
                  setSelectedSalesmanId(salesmanId);
                  setPage("Retail");
                  openDocument(null);
                }}
                onSelect={(docId) => {
                  if (action === "bill") {
                    setPage("Retail");
                  } else if (action && commandSection[action]) {
                    setPage(commandSection[action]!);
                  }
                  setAction(null);
                  openDocument(docId);
                }}
              />
            )}{" "}
            {itcExportOpen && !action && (
              <ItcExportPage
                initialDate={date}
                onClose={() => setItcExportOpen(false)}
                onSelect={openDocument}
              />
            )}
            {!action && !draftsOpen && selected?.startsWith("statement:") && (
              <StatementPage
                id={selected.slice(10)}
                onClose={goBackDocument}
                date={date}
                onSelectRecord={openDocument}
                onNewBill={(salesmanId) => {
                  setSelected(null);
                  setSelectedHistory([]);
                  setSelectedSalesmanId(salesmanId);
                  if (page === "Mudashir" || salesmanId === mubashirSalesmanId) {
                    setDirectActiveView("new_bill");
                    setPage("Mudashir");
                  } else {
                    setRetailActiveView("new_bill");
                    setPage("Retail");
                  }
                }}
                onReceiveMoney={(salesmanId) => {
                  setSelected(null);
                  setSelectedHistory([]);
                  setSelectedSalesmanId(salesmanId);
                  if (page === "Mudashir" || salesmanId === mubashirSalesmanId) {
                    setDirectActiveView("receive_money");
                    setPage("Mudashir");
                  } else {
                    setRetailActiveView("receive_money");
                    setPage("Retail");
                  }
                }}
              />
            )}{" "}
            {!action && !draftsOpen && selected?.startsWith("customer-statement:") && (
              <CustomerStatementPage
                customerId={selected.slice(19)}
                onClose={goBackDocument}
                date={date}
                onSelectRecord={openDocument}
                onNewBill={(custId, salesmanId) => {
                  setSelected(null);
                  setSelectedHistory([]);
                  if (salesmanId) setSelectedSalesmanId(salesmanId);
                  setDirectBillCustomerId(custId);
                  setDirectActiveView("new_bill");
                  setPage("Mudashir");
                }}
                onReceiveMoney={(custId, salesmanId) => {
                  setSelected(null);
                  setSelectedHistory([]);
                  if (salesmanId) setSelectedSalesmanId(salesmanId);
                  setDirectReceiveCustomerId(custId);
                  setDirectActiveView("receive_money");
                  setPage("Mudashir");
                }}
              />
            )}{" "}
            {!action && !draftsOpen && selected?.startsWith("verify:") && (
              <VerificationPage
                id={selected.slice(7)}
                date={date}
                dashboard={d}
                onClose={goBackDocument}
              />
            )}
          </main>
          <footer>
            Sales & Money Book{" "}
            <span>Operational ledger · tax invoice format not configured</span>
          </footer>
        </div>
      </div>
    </WorkflowBusyContext.Provider>
  );
}
function Dashboard({
  data: d,
  owner,
  setAction: _setAction,
  setPage,
  onStatement: _onStatement,
  onDrafts: _onDrafts,
  onOpenReport: _onOpenReport,
}: {
  data: Row;
  owner: boolean;
  setAction: (name: CommandName) => void;
  setPage: (page: string) => void;
  onStatement: (id: string) => void;
  onDrafts: () => void;
  onOpenReport?: (tab: string) => void;
}) {
  const qc = useQueryClient();
  const cash = arr(d.accounts).filter((a) => a.type === "cash"),
    banks = arr(d.accounts).filter((a) => a.type === "bank");
  const isDayClosed = d.dayClosed === true;

  // Inline Daily Close state for the dashboard
  const [isClosingOpen, setIsClosingOpen] = useState(false);
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [reopenReason, setReopenReason] = useState("");
  const [isReopenOpen, setIsReopenOpen] = useState(false);
  const [closeBusy, setCloseBusy] = useState(false);
  const [closeError, setCloseError] = useState("");
  const [closeSuccess, setCloseSuccess] = useState("");

  // Inbound Cash Handovers state on Dashboard
  const pendingHandovers = arr(d.pendingHandovers);
  const [reviewingHandover, setReviewingHandover] = useState<Row | null>(null);
  const [handoverActionType, setHandoverActionType] = useState<"accept" | "reject">("accept");
  const [handoverAcceptedAmount, setHandoverAcceptedAmount] = useState("");
  const [handoverAccountId, setHandoverAccountId] = useState("");
  const [handoverNote, setHandoverNote] = useState("");
  const [handoverBusy, setHandoverBusy] = useState(false);
  const [handoverError, setHandoverError] = useState("");
  const [handoverSuccess, setHandoverSuccess] = useState("");

  const defaultHandoverCashAccount = str(cash[0]?.id ?? "");

  const openAcceptHandover = (h: Row) => {
    setReviewingHandover(h);
    setHandoverActionType("accept");
    setHandoverAcceptedAmount(str(h.amount));
    setHandoverAccountId(defaultHandoverCashAccount);
    setHandoverNote("");
    setHandoverError("");
    setHandoverSuccess("");
  };

  const handleConfirmHandover = async () => {
    if (!reviewingHandover) return;
    const targetAccountId = handoverAccountId || defaultHandoverCashAccount;
    if (!targetAccountId) {
      setHandoverError("Please select a physical cash till account.");
      return;
    }
    const enteredAmt = parseMoneyNumber(handoverAcceptedAmount);
    const maxAmt = parseMoneyNumber(reviewingHandover.amount);
    if (isNaN(enteredAmt) || enteredAmt <= 0) {
      setHandoverError("Please enter a valid accepted cash amount.");
      return;
    }
    if (enteredAmt > maxAmt) {
      setHandoverError(`Accepted amount cannot exceed the handed over amount of ${rupees(reviewingHandover.amount)}.`);
      return;
    }
    setHandoverBusy(true);
    setHandoverError("");
    try {
      await api(
        "commands/confirmCashHandover",
        commandResult,
        {
          handoverId: str(reviewingHandover.id),
          acceptedAmount: cleanMoney(handoverAcceptedAmount),
          accountId: targetAccountId,
          date: str(d.date),
          managerNote: handoverNote.trim() || undefined,
        },
        "POST",
        crypto.randomUUID(),
      );
      setHandoverSuccess(
        `Successfully accepted ${rupees(enteredAmt.toFixed(2))} cash into physical drawer!`
      );
      setReviewingHandover(null);
      await qc.invalidateQueries();
    } catch (err: unknown) {
      setHandoverError(err instanceof Error ? err.message : String(err));
    } finally {
      setHandoverBusy(false);
    }
  };

  const handleRejectHandover = async () => {
    if (!reviewingHandover) return;
    if (!handoverNote.trim() || handoverNote.trim().length < 3) {
      setHandoverError("Please enter a reason for rejecting the handover (at least 3 characters).");
      return;
    }
    setHandoverBusy(true);
    setHandoverError("");
    try {
      await api(
        "commands/rejectCashHandover",
        commandResult,
        {
          handoverId: str(reviewingHandover.id),
          reason: handoverNote.trim(),
        },
        "POST",
        crypto.randomUUID(),
      );
      setHandoverSuccess("Cash handover rejected.");
      setReviewingHandover(null);
      await qc.invalidateQueries();
    } catch (err: unknown) {
      setHandoverError(err instanceof Error ? err.message : String(err));
    } finally {
      setHandoverBusy(false);
    }
  };

  const handleCloseDay = async (e: React.FormEvent) => {
    e.preventDefault();
    setCloseBusy(true);
    setCloseError("");
    setCloseSuccess("");
    try {
      const activeCashAccounts = cash.filter((a) => a.active !== false);
      const activeBankAccounts = banks.filter((a) => a.active !== false);
      const allAccountsToClose = [...activeCashAccounts, ...activeBankAccounts];

      for (const a of allAccountsToClose) {
        const id = str(a.id);
        const countedStr = (counts[id] ?? "").trim();
        if (!countedStr) {
          throw new Error(`Please enter the counted/verified balance for ${str(a.name)}.`);
        }
        const expectedCents = parseCents(a.balance);
        const countedCents = parseCents(countedStr);
        const diffCents = countedCents - expectedCents;
        if (diffCents !== 0n && (reasons[id] ?? "").trim().length < 3) {
          throw new Error(`Explanation is required (at least 3 characters) for difference in ${str(a.name)}.`);
        }
      }
      const payload = {
        date: str(d.date),
        counts: allAccountsToClose.map((a) => {
          const id = str(a.id);
          const countedCents = parseCents(counts[id] ?? "");
          return {
            accountId: id,
            counted: formatCents(countedCents),
            reason: (reasons[id] ?? "").trim(),
          };
        }),
      };
      await api("commands/close", commandResult, payload, "POST", crypto.randomUUID());
      setCloseSuccess("Business date closed and locked successfully for both physical cash and bank.");
      setIsClosingOpen(false);
      await qc.invalidateQueries();
    } catch (err: unknown) {
      setCloseError(err instanceof Error ? err.message : String(err));
    } finally {
      setCloseBusy(false);
    }
  };

  const handleReopenDay = async (e: React.FormEvent) => {
    e.preventDefault();
    setCloseBusy(true);
    setCloseError("");
    setCloseSuccess("");
    try {
      if (reopenReason.trim().length < 3) {
        throw new Error("Reason for reopening must be at least 3 characters.");
      }
      await api(
        "commands/reopen",
        commandResult,
        { date: str(d.date), reason: reopenReason.trim() },
        "POST",
        crypto.randomUUID()
      );
      setCloseSuccess("Business date reopened successfully.");
      setIsReopenOpen(false);
      setReopenReason("");
      await qc.invalidateQueries();
    } catch (err: unknown) {
      setCloseError(err instanceof Error ? err.message : String(err));
    } finally {
      setCloseBusy(false);
    }
  };
  const seg = (d.segments as Row) ?? {};
  const todayBilled = seg.today_billed ?? "0.00";
  const todayRetailBilled = seg.today_retail_billed ?? "0.00";
  const todayMudashirBilled = seg.today_mubashir_billed ?? "0.00";
  const totalDues = seg.total_dues ?? d.due ?? "0.00";
  const retailDues = seg.retail_dues ?? "0.00";
  const mudashirDues = seg.mubashir_dues ?? "0.00";

  const summary = (d.summary as Row) ?? {};
  const cashRec = summary.cash_collections ?? "0.00";
  const onlineRec = summary.online_collections ?? "0.00";
  const totalRec = summary.collections ?? D(str(cashRec)).plus(D(str(onlineRec))).toFixed(2);
  const expensesAndLoans = summary.expenses_and_loans ?? D(str(summary.expenses ?? "0.00")).plus(D(str(summary.loans ?? "0.00"))).toFixed(2);
  const expensesOnly = summary.expenses ?? "0.00";
  const loansOnly = summary.loans ?? "0.00";

  return (
    <div className="dashboard">
      <div className="quick-actions dashboard-actions">
        {(
          [
            ["Retail", "Retail", "Salesmen & wholesale", Users, "action-retail"],
            ["Mudashir", "Mudashir", "Direct cig sales & beats", Store, "action-mudashir"],
            ["Foods", "Foods", "Foods collections & salesmen", Utensils, "action-foods"],
            ["Other Money", "Other Money", "Expenses, loans & salaries", ArrowLeftRight, "action-other"],
            ["Reports", "Reports", "Statements & ledger views", BarChart3, "action-reports"],
            ["Settings", "Settings", "Masters & configuration", Settings, "action-settings"],
          ] as const
        ).map(([targetPage, label, caption, Icon, actionClass]) => (
          <Button
            key={targetPage}
            className={`dashboard-action ${actionClass}`}
            onClick={() => setPage(targetPage)}
          >
            <Icon size={24} aria-hidden="true" />
            <strong>{label}</strong>
            <small>{caption}</small>
          </Button>
        ))}
      </div>
      <div className="stats daily-stats">
        <Metric
          label="Total Outstanding Dues (Retail + Mudashir)"
          value={totalDues}
          caption={`Retail: ${rupees(retailDues)} · Mudashir: ${rupees(mudashirDues)}`}
          icon={TrendingDown}
          tone="expense"
        />
        <Metric
          label="Todays Cig Sales (Retail + Mudashir)"
          value={todayBilled}
          caption={`Retail: ${rupees(todayRetailBilled)} · Mudashir: ${rupees(todayMudashirBilled)}`}
          icon={FileText}
          tone="bills"
        />
        <Metric
          label="Todays Received (Cash + Online)"
          value={totalRec}
          caption={`Cash: ${rupees(cashRec)} · Online: ${rupees(onlineRec)}`}
          icon={IndianRupee}
          tone="cash"
        />
        <Metric
          label="Todays Expenses + Loans"
          value={expensesAndLoans}
          caption={`Expenses: ${rupees(expensesOnly)} · Loans: ${rupees(loansOnly)}`}
          icon={ArrowLeftRight}
          tone="online"
        />
      </div>
      <div className="dashboard-main-grid" style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
        {/* Row 1: Side-by-side 2-column grid for Physical Cash & Mudhasir Inbound Collections */}
        <div
          className="dashboard-cash-row"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))",
            gap: "20px",
            alignItems: "start",
          }}
        >
          {/* Left Column: Compact Physical Cash & Daily Close */}
          <section className="panel physical-cash-panel" style={{ minHeight: "auto", margin: 0, padding: "16px 20px" }}>
            <div className="section-title" style={{ marginBottom: 12 }}>
              <div>
                <h2 style={{ fontSize: 17, margin: 0 }}>Physical Cash & Daily Close</h2>
                <p className="cash-subtitle" style={{ fontSize: 12, margin: "2px 0 0" }}>Physical drawer reconciliation & day closing</p>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span className={isDayClosed ? "day-state closed" : "day-state"} style={{ fontSize: 11, padding: "3px 8px" }}>
                  {isDayClosed ? "DAY CLOSED" : "DAY OPEN"}
                </span>
                <Wallet size={20} aria-hidden="true" />
              </div>
            </div>

            {closeSuccess && (
              <div className="notice" role="status" style={{ marginBottom: 10, fontSize: 13, padding: "8px 12px" }}>
                {closeSuccess}
              </div>
            )}
            {closeError && (
              <div className="error" role="alert" style={{ marginBottom: 10, fontSize: 13, padding: "8px 12px" }}>
                {closeError}
              </div>
            )}
            {cash.length ? (
              (() => {
                const primaryCash = cash[0];
                const primaryBank = banks[0];
                return (
                  <div
                    className="drawer-card compact-drawer-card"
                    key={str(primaryCash.id)}
                    style={{
                      padding: "10px 14px",
                      borderRadius: 10,
                      marginBottom: 8,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                    }}
                  >
                    <div>
                      <strong style={{ fontSize: 14, marginBottom: 2, display: "block" }}>{str(primaryCash.name)}</strong>
                      <b style={{ fontSize: 18, display: "block" }}>{rupees(primaryCash.balance)}</b>
                    </div>
                    {primaryBank && (
                      <div style={{ textAlign: "right" }}>
                        <strong style={{ fontSize: 14, marginBottom: 2, display: "block" }}>{str(primaryBank.name)}</strong>
                        <b style={{ fontSize: 18, display: "block" }}>{rupees(primaryBank.balance)}</b>
                      </div>
                    )}
                  </div>
                );
              })()
            ) : (
              <Empty text="No physical cash account configured." />
            )}

            {isDayClosed ? (
              <div className="drawer-footer" style={{ flexDirection: "column", alignItems: "stretch", gap: 8, marginTop: 8, paddingTop: 10, borderTop: "1px solid #f1f5f9" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                  <p style={{ margin: 0, fontSize: 12, color: "#64748b" }}>
                    <LockKeyhole size={14} style={{ verticalAlign: "middle", marginRight: 4, display: "inline" }} />
                    This business date is locked. Financial entries cannot be posted.
                  </p>
                  {owner && !isReopenOpen && (
                    <Button
                      className="secondary"
                      style={{ padding: "5px 12px", fontSize: 12 }}
                      onClick={() => {
                        setIsReopenOpen(true);
                        setCloseError("");
                        setCloseSuccess("");
                      }}
                    >
                      <Unlock size={13} /> Reopen Date
                    </Button>
                  )}
                </div>
                {owner && isReopenOpen && (
                  <form onSubmit={handleReopenDay} style={{ marginTop: 8, padding: 12, background: "#fef3c7", borderRadius: 8 }}>
                    <Field label="Reason for reopening (min 3 chars) *">
                      <input
                        value={reopenReason}
                        onChange={(e) => setReopenReason(e.target.value)}
                        placeholder="e.g. Correct late night cash discrepancy"
                        required
                        minLength={3}
                      />
                    </Field>
                    <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                      <Button type="submit" className="primary" disabled={closeBusy}>
                        {closeBusy ? "Reopening…" : "Confirm Reopen"}
                      </Button>
                      <Button
                        type="button"
                        className="secondary"
                        disabled={closeBusy}
                        onClick={() => setIsReopenOpen(false)}
                      >
                        Cancel
                      </Button>
                    </div>
                  </form>
                )}
              </div>
            ) : (
              <div className="drawer-footer" style={{ flexDirection: "column", alignItems: "stretch", gap: 8, marginTop: 8, paddingTop: 10, borderTop: "1px solid #f1f5f9" }}>
                {!isClosingOpen ? (
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                    <p style={{ margin: 0, fontSize: 12, color: "#64748b" }}>Close and lock business day for both physical cash drawer and bank accounts.</p>
                    <Button
                      className="primary"
                      style={{ padding: "6px 14px", fontSize: 12 }}
                      onClick={() => {
                        setIsClosingOpen(true);
                        setCloseError("");
                        setCloseSuccess("");
                        // Pre-populate count with current expected balance for convenience
                        const initialCounts: Record<string, string> = {};
                        [...cash, ...banks].forEach((a) => {
                          const id = str(a.id);
                          if (!counts[id]) {
                            initialCounts[id] = formatCents(parseCents(a.balance));
                          }
                        });
                        if (Object.keys(initialCounts).length) {
                          setCounts((prev) => ({ ...initialCounts, ...prev }));
                        }
                      }}
                    >
                      <LockKeyhole size={14} /> Close Today (Cash & Bank)
                    </Button>
                  </div>
                ) : (
                  <form onSubmit={handleCloseDay} style={{ borderTop: "1px solid #e2e8f0", paddingTop: 10 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                      <strong style={{ fontSize: 13 }}>Daily Cash & Bank Reconciliation</strong>
                      <Button
                        type="button"
                        className="text-link"
                        style={{ fontSize: 12 }}
                        onClick={() => setIsClosingOpen(false)}
                        disabled={closeBusy}
                      >
                        Cancel
                      </Button>
                    </div>

                    {[...cash, ...banks].map((a) => {
                      const id = str(a.id);
                      const isBank = a.type === "bank";
                      const expectedCents = parseCents(a.balance);
                      const countedStr = counts[id] ?? "";
                      const countedCents = parseCents(countedStr);
                      const diffCents = countedStr ? countedCents - expectedCents : 0n;
                      const diffFormatted = formatCents(diffCents);

                      return (
                        <div
                          key={id}
                          style={{
                            background: "#f8fafc",
                            padding: 10,
                            borderRadius: 8,
                            border: "1px solid #e2e8f0",
                            marginBottom: 8,
                          }}
                        >
                          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4, fontSize: 13 }}>
                            <span><b>{str(a.name)}</b> {isBank ? "(Bank Account)" : `(${str(a.holder)})`}</span>
                            <span>Expected: <b>{rupees(a.balance)}</b></span>
                          </div>
                          <div className="form-grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                            <Field label={isBank ? "Verified Closing Bank Balance (₹) *" : "Physically Counted Cash (₹) *"}>
                              <input
                                type="text"
                                inputMode="decimal"
                                value={counts[id] ?? ""}
                                onChange={(e) =>
                                  setCounts({ ...counts, [id]: e.target.value })
                                }
                                placeholder="0.00"
                                required
                                style={{ fontSize: 13, padding: "6px 10px" }}
                              />
                            </Field>
                            <Field label="Explanation (if difference)">
                              <input
                                type="text"
                                value={reasons[id] ?? ""}
                                onChange={(e) =>
                                  setReasons({ ...reasons, [id]: e.target.value })
                                }
                                placeholder={
                                  diffCents !== 0n
                                    ? "Explanation required"
                                    : "Optional note"
                                }
                                style={{ fontSize: 13, padding: "6px 10px" }}
                              />
                            </Field>
                          </div>
                          {countedStr && (
                            <div
                              style={{
                                marginTop: 4,
                                fontSize: 11,
                                color: diffCents === 0n ? "#166534" : "#991b1b",
                                fontWeight: 600,
                              }}
                            >
                              {diffCents === 0n
                                ? `✓ ${isBank ? "Bank balance" : "Drawer"} matches expected book balance exactly.`
                                : `Diff: ${diffCents > 0n ? "+" : ""}${diffFormatted} (Counted: ${formatCents(countedCents)} vs Expected: ${formatCents(expectedCents)})`}
                            </div>
                          )}
                        </div>
                      );
                    })}

                    <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                      <Button type="submit" className="primary" style={{ padding: "6px 14px", fontSize: 12 }} disabled={closeBusy}>
                        {closeBusy ? "Locking Day…" : "Confirm Count & Close Day"}
                      </Button>
                      <Button
                        type="button"
                        className="secondary"
                        style={{ padding: "6px 12px", fontSize: 12 }}
                        disabled={closeBusy}
                        onClick={() => setIsClosingOpen(false)}
                      >
                        Cancel
                      </Button>
                    </div>
                  </form>
                )}
              </div>
            )}
          </section>
          <section className="panel inbound-handovers-panel" style={{ minHeight: "auto", margin: 0, padding: "16px 20px" }}>
            <div className="section-title" style={{ marginBottom: 12 }}>
              <div>
                <h2 style={{ fontSize: 17, margin: 0 }}>Inbound Cash from Mudhasir (Route Collections)</h2>
                <p className="cash-subtitle" style={{ fontSize: 12, margin: "2px 0 0" }}>Direct field cash collections awaiting manager verification into till</p>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span className="badge" style={{ background: pendingHandovers.length > 0 ? "#dbeafe" : "#e2e8f0", color: pendingHandovers.length > 0 ? "#1e40af" : "#475569", fontWeight: 700, fontSize: 11, padding: "3px 8px" }}>
                  {pendingHandovers.length} Pending
                </span>
                <ArrowLeftRight size={20} aria-hidden="true" />
              </div>
            </div>

            {handoverSuccess && (
              <div className="notice" role="status" style={{ marginBottom: 12 }}>
                {handoverSuccess}
              </div>
            )}
            {handoverError && (
              <div className="error" role="alert" style={{ marginBottom: 12 }}>
                {handoverError}
              </div>
            )}

            {pendingHandovers.length === 0 ? (
              <div style={{ padding: "24px 16px", textAlign: "center", color: "#64748b", background: "#f8fafc", borderRadius: 12, border: "1px dashed #cbd5e1" }}>
                <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: "#166534" }}>✓ All Mudhasir route collections received into till.</p>
                <small style={{ color: "#94a3b8", fontSize: 12, marginTop: 2, display: "block" }}>No pending route cash awaiting manager count.</small>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {pendingHandovers.map((h) => {
                  const hId = str(h.id);
                  const isSelected = reviewingHandover && str(reviewingHandover.id) === hId;
                  return (
                    <div
                      className="drawer-card compact-drawer-card"
                      key={hId}
                      style={{
                        padding: "10px 14px",
                        borderRadius: 10,
                        marginBottom: 8,
                        gap: 12,
                        cursor: "pointer",
                        background: isSelected ? "#f0fdf4" : undefined,
                        borderColor: isSelected ? "#86efac" : undefined,
                      }}
                      onClick={() => openAcceptHandover(h)}
                      title="Click to select this route cash collection"
                    >
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <strong style={{ fontSize: 14, marginBottom: 2 }}>
                            {str(h.salesman_name)}
                          </strong>
                          <span
                            style={{
                              fontSize: 10,
                              fontWeight: 700,
                              background: "#fef3c7",
                              color: "#b45309",
                              padding: "2px 6px",
                              borderRadius: 4,
                            }}
                          >
                            IN HAND
                          </span>
                        </div>
                        <small style={{ fontSize: 12, color: "var(--dashboard-muted)", display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {h.salesman_note ? str(h.salesman_note) : "Route collection"}{h.date ? ` · ${dateLabel(h.date)}` : ""}
                        </small>
                      </div>

                      <div className="drawer-balance" style={{ textAlign: "right", flexShrink: 0 }}>
                        <b style={{ fontSize: 18, display: "block", color: "#0f172a", fontVariantNumeric: "tabular-nums" }}>
                          {rupees(h.amount)}
                        </b>
                        <small style={{ fontSize: 11, color: "var(--dashboard-muted)" }}>Route cash</small>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="drawer-footer" style={{ flexDirection: "column", alignItems: "stretch", gap: 8, marginTop: 8, paddingTop: 10, borderTop: "1px solid #f1f5f9" }}>
              {!reviewingHandover ? (
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                  <p style={{ margin: 0, fontSize: 12, color: "#64748b" }}>
                    {pendingHandovers.length > 0
                      ? "Manager count required to transfer route cash into drawer."
                      : "No pending route cash awaiting manager count."}
                  </p>
                  <Button
                    className="primary"
                    disabled={handoverBusy || isDayClosed || pendingHandovers.length === 0}
                    style={{ padding: "6px 14px", fontSize: 12 }}
                    onClick={() => {
                      if (pendingHandovers.length > 0) {
                        openAcceptHandover(pendingHandovers[0]);
                      }
                    }}
                  >
                    <Check size={14} /> Receive
                  </Button>
                </div>
              ) : (
                <div
                  style={{
                    padding: 12,
                    background: handoverActionType === "accept" ? "#f0fdf4" : "#fef2f2",
                    border: handoverActionType === "accept" ? "1px solid #86efac" : "1px solid #fca5a5",
                    borderRadius: 8,
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                    <strong style={{ fontSize: 13, color: handoverActionType === "accept" ? "#166534" : "#991b1b" }}>
                      {handoverActionType === "accept"
                        ? `Accept Cash Handover from ${str(reviewingHandover.salesman_name)}`
                        : `Reject Cash Handover from ${str(reviewingHandover.salesman_name)}`}
                    </strong>
                    <Button
                      type="button"
                      className="text-link"
                      style={{ fontSize: 12 }}
                      onClick={() => setReviewingHandover(null)}
                      disabled={handoverBusy}
                    >
                      Cancel
                    </Button>
                  </div>

                  {handoverActionType === "accept" ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      <div style={{ fontSize: 12, color: "#374151" }}>
                        Reported route cash in hand: <b>{rupees(reviewingHandover.amount)}</b>
                      </div>
                      <div className="form-grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                        <Field label="Actual Counted Cash (₹) * (Supports Partial)">
                          <input
                            type="text"
                            inputMode="decimal"
                            value={handoverAcceptedAmount}
                            onChange={(e) => setHandoverAcceptedAmount(e.target.value)}
                            placeholder="e.g. 10000.00"
                            required
                            style={{ fontSize: 13, padding: "6px 10px" }}
                          />
                        </Field>
                        <Field label="Target Cash Till / Account *">
                          <select
                            value={handoverAccountId || defaultHandoverCashAccount}
                            onChange={(e) => setHandoverAccountId(e.target.value)}
                            required
                            style={{ fontSize: 13, padding: "6px 10px" }}
                          >
                            {cash.map((cAcc) => (
                              <option key={str(cAcc.id)} value={str(cAcc.id)}>
                                {str(cAcc.name)} ({str(cAcc.holder)})
                              </option>
                            ))}
                          </select>
                        </Field>
                      </div>

                      {parseMoneyNumber(handoverAcceptedAmount) < parseMoneyNumber(reviewingHandover.amount) && (
                        <div
                          style={{
                            background: "#fffbeb",
                            color: "#92400e",
                            padding: "6px 10px",
                            borderRadius: 6,
                            fontSize: 12,
                            border: "1px solid #fde68a",
                          }}
                        >
                          ⚠️ Partial acceptance: You are accepting{" "}
                          <b>{rupees(cleanMoney(handoverAcceptedAmount) || "0")}</b> out of{" "}
                          <b>{rupees(reviewingHandover.amount)}</b>. The difference of{" "}
                          <b>
                            {rupees(
                              (
                                parseMoneyNumber(reviewingHandover.amount) -
                                (parseMoneyNumber(handoverAcceptedAmount) || 0)
                              ).toFixed(2),
                            )}
                          </b>{" "}
                          remains with the salesman.
                        </div>
                      )}

                      <Field label="Manager remarks / count notes (optional)">
                        <input
                          type="text"
                          placeholder="e.g. Counted into physical till at 4:30 PM"
                          value={handoverNote}
                          onChange={(e) => setHandoverNote(e.target.value)}
                          style={{ fontSize: 13, padding: "6px 10px" }}
                        />
                      </Field>

                      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 4 }}>
                        <Button
                          type="button"
                          className="secondary"
                          style={{ color: "#dc2626", borderColor: "#fca5a5", padding: "5px 12px", fontSize: 12 }}
                          disabled={handoverBusy}
                          onClick={() => setHandoverActionType("reject")}
                        >
                          Reject
                        </Button>
                        <Button
                          type="button"
                          className="secondary"
                          disabled={handoverBusy}
                          style={{ padding: "5px 12px", fontSize: 12 }}
                          onClick={() => setReviewingHandover(null)}
                        >
                          Cancel
                        </Button>
                        <Button
                          type="button"
                          className="primary"
                          disabled={handoverBusy}
                          style={{ padding: "5px 14px", fontSize: 12 }}
                          onClick={handleConfirmHandover}
                        >
                          {handoverBusy
                            ? "Crediting Till…"
                            : `Confirm & Add ${rupees(handoverAcceptedAmount || "0")} to Cash Till`}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      <Field label="Reason for rejection (min 3 chars) *">
                        <input
                          type="text"
                          placeholder="e.g. Cash not received physically"
                          value={handoverNote}
                          onChange={(e) => setHandoverNote(e.target.value)}
                          required
                          minLength={3}
                          style={{ fontSize: 13, padding: "6px 10px" }}
                        />
                      </Field>
                      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 4 }}>
                        <Button
                          type="button"
                          className="secondary"
                          disabled={handoverBusy}
                          style={{ padding: "5px 12px", fontSize: 12 }}
                          onClick={() => setHandoverActionType("accept")}
                        >
                          Back
                        </Button>
                        <Button
                          type="button"
                          className="secondary"
                          disabled={handoverBusy}
                          style={{ padding: "5px 12px", fontSize: 12 }}
                          onClick={() => setReviewingHandover(null)}
                        >
                          Cancel
                        </Button>
                        <Button
                          type="button"
                          className="secondary"
                          style={{ color: "#dc2626", borderColor: "#fca5a5", padding: "5px 12px", fontSize: 12 }}
                          disabled={handoverBusy}
                          onClick={handleRejectHandover}
                        >
                          {handoverBusy ? "Rejecting…" : "Confirm Rejection"}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
function ReceiveMoneyPage({
  date,
  masters,
  dashboard,
  excludeSalesmanId,
  onSelect,
  onGoToSalesman,
}: {
  date: string;
  masters?: Row;
  dashboard?: Row;
  excludeSalesmanId?: string;
  onSelect: (id: string) => void;
  onGoToSalesman?: (salesmanId: string) => void;
}) {
  const qc = useQueryClient(),
    [salesmanId, setSalesmanId] = useState(""),
    [lastRecordedSalesmanId, setLastRecordedSalesmanId] = useState(""),
    [paymentDate, setPaymentDate] = useState(date),
    [cashAmount, setCashAmount] = useState(""),
    [bankAmount, setBankAmount] = useState(""),
    [note, setNote] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [success, setSuccess] = useState("");

  const accounts = arr(masters?.accounts);
  const defaultCashId = accounts.find((a) => a.type === "cash")?.id ?? "";
  const defaultBankId = accounts.find((a) => a.type === "bank")?.id ?? "";

  const receiveCashVal = (() => {
    const c = cleanMoney(cashAmount);
    return c && !isNaN(Number(c)) ? D(c) : D(0);
  })();
  const receiveOnlineList = parseMultiAmounts(bankAmount);
  const receiveOnlineVal = receiveOnlineList.reduce((acc, curr) => acc.plus(D(curr)), D(0));
  const receiveTotalVal = receiveCashVal.plus(receiveOnlineVal);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");
    if (!salesmanId) {
      setError("Please select a salesman.");
      return;
    }
    const cleanCash = cleanMoney(cashAmount);
    const bankAmounts = parseMultiAmounts(bankAmount);
    const hasCash = Boolean(cleanCash && parseMoneyNumber(cleanCash) > 0);
    const hasBank = bankAmounts.length > 0;
    if (!hasCash && !hasBank) {
      setError("Enter either a cash amount or at least one valid bank/online amount (separate multiple with + or /).");
      return;
    }

    setBusy(true);
    try {
      const receipts: Row[] = [];
      if (hasCash) {
        receipts.push({
          amount: cleanCash,
          accountId: defaultCashId,
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
            accountId: defaultBankId,
            method: "online",
            actualDate: paymentDate,
            reference: (note ? `${note}${suffix}` : `Online payment${suffix}`).trim(),
            verified: false,
          });
        });
      }

      await api(
        "commands/receiptBatch",
        commandResult,
        {
          date: paymentDate,
          salesmanId,
          note,
          receipts,
        },
        "POST",
        crypto.randomUUID(),
      );

      const savedSalesmanId = salesmanId;
      setLastRecordedSalesmanId(savedSalesmanId);
      setSuccess("Payment recorded successfully.");
      setCashAmount("");
      setBankAmount("");
      setNote("");
      await qc.invalidateQueries();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const selectedSalesmanName = str(
    arr(masters?.salesmen).find((s) => s.id === lastRecordedSalesmanId)?.name,
  );

  return (
    <>
      <section className="panel">
        <div className="section-title">
          <h2>Receive Money</h2>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="form-grid">
            <Field label="Salesman">
              <select
                value={salesmanId}
                onChange={(e) => setSalesmanId(e.target.value)}
                required
              >
                <option value="">Choose salesman…</option>
                {arr(masters?.salesmen)
                  .filter((s) => s.active && (!excludeSalesmanId || s.id !== excludeSalesmanId))
                  .map((s) => (
                    <option key={str(s.id)} value={str(s.id)}>
                      {str(s.code)} · {str(s.name)}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="Date">
              <input
                type="date"
                value={paymentDate}
                onChange={(e) => setPaymentDate(e.target.value)}
                required
              />
            </Field>
            <Field label="Cash amount (₹)">
              <input
                inputMode="decimal"
                placeholder="0.00"
                value={cashAmount}
                onChange={(e) => setCashAmount(e.target.value)}
              />
            </Field>
            <Field label="Bank / Online amount(s) (₹)">
              <input
                placeholder="e.g. 500 + 1,200"
                value={bankAmount}
                onChange={(e) => setBankAmount(e.target.value)}
              />
              {(() => {
                const parsed = parseMultiAmounts(bankAmount);
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
                return (
                  <div style={{ marginTop: 2, fontSize: 11, color: "#64748b" }}>
                    Separate multiple transactions by comma or space
                  </div>
                );
              })()}
            </Field>
            <Field label="Total Received (₹)">
              <div
                style={{
                  padding: "9px 12px",
                  borderRadius: 6,
                  background: "#f0fdf4",
                  border: "1.5px solid #86efac",
                  color: "#15803d",
                  fontWeight: 800,
                  fontSize: 16,
                  minHeight: 38,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <span>₹{receiveTotalVal.toFixed(2)}</span>
                <span style={{ fontSize: 11, fontWeight: 600, color: "#166534" }}>
                  Cash: ₹{receiveCashVal.toFixed(2)} + Bank: ₹{receiveOnlineVal.toFixed(2)}
                </span>
              </div>
            </Field>
            <Field label="Notes">
              <input
                placeholder="Reference / remarks (optional)"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </Field>
          </div>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          {success && (
            <div
              role="status"
              className="notice"
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                flexWrap: "wrap",
                gap: 10,
                padding: "12px 16px",
              }}
            >
              <span>
                Payment recorded successfully.{" "}
                {lastRecordedSalesmanId && onGoToSalesman && (
                  <button
                    type="button"
                    onClick={() => onGoToSalesman(lastRecordedSalesmanId)}
                    style={{
                      background: "none",
                      border: "none",
                      padding: 0,
                      color: "#b45309",
                      fontWeight: 700,
                      textDecoration: "underline",
                      cursor: "pointer",
                      fontSize: "inherit",
                    }}
                  >
                    View {selectedSalesmanName ? `${selectedSalesmanName}'s` : "salesman"} updated passbook & statement →
                  </button>
                )}
              </span>
            </div>
          )}
          <div className="actions" style={{ marginTop: 16 }}>
            <Button className="primary" disabled={busy} type="submit">
              {busy ? "Recording…" : "Save Payment"}
            </Button>
          </div>
        </form>
      </section>

      <section className="panel">
        <h2>Awaiting verification</h2>
        {dashboard &&
          arr(dashboard.claims).map((r) => (
            <div className="claim" key={str(r.id)}>
              <div>
                <strong>{str(r.salesman_name)}</strong>
                <small>
                  {str(r.account_name)} · reported {dateLabel(r.actual_date)} ·{" "}
                  {str(r.reference)}
                </small>
              </div>
              <b>{rupees(r.amount)}</b>
              <Button
                className="secondary"
                onClick={() => onSelect("verify:" + r.id)}
              >
                Review
              </Button>
            </div>
          ))}
        {(!dashboard || !arr(dashboard.claims).length) && (
          <Empty text="No payments awaiting verification." />
        )}
      </section>

      <Documents onSelect={onSelect} kind="receipt" excludeSalesmanId={excludeSalesmanId} />
    </>
  );
}

function FoodsPage({
  date,
  masters,
  owner: _owner,
  onSelect,
}: {
  date: string;
  masters: Row;
  owner: boolean;
  onSelect: (id: string) => void;
}) {
  const qc = useQueryClient(),
    [activeTab, setActiveTab] = useState<"foods">("foods"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [success, setSuccess] = useState("");

  const accounts = arr(masters.accounts);
  const cashAccounts = accounts.filter((a) => a.type === "cash");
  const bankAccounts = accounts.filter((a) => a.type === "bank");
  const defaultCash = str(cashAccounts[0]?.id ?? "");
  const defaultBank = str(bankAccounts[0]?.id ?? "");

  // Load registered foods salesmen list from API
  const foodsSalesmenQuery = useQuery({
    queryKey: ["foods-salesmen"],
    queryFn: async () => {
      const r = await fetch("/api/v1/foods-salesmen");
      return (await r.json()) as Array<{ id: string; name: string; territory?: string; phone?: string; active: boolean }>;
    },
  });
  const foodsSalesmenOptions = (foodsSalesmenQuery.data ?? []).filter((f) => f.active);

  // Foods Collections state
  const [foodsSalesman, setFoodsSalesman] = useState(""),
    [foodsDate, setFoodsDate] = useState(date),
    [foodsBillNo, setFoodsBillNo] = useState(""),
    [foodsItems, setFoodsItems] = useState(""),
    [foodsCashAmount, setFoodsCashAmount] = useState(""),
    [foodsCashAccountId, setFoodsCashAccountId] = useState(defaultCash),
    [foodsBankAmount, setFoodsBankAmount] = useState(""),
    [foodsBankAccountId, setFoodsBankAccountId] = useState(defaultBank),
    [foodsNotes, setFoodsNotes] = useState("");

  const parsedBankAmounts = parseMultiAmounts(foodsBankAmount);
  const totalBankParsed = parsedBankAmounts.reduce((acc, curr) => acc.plus(curr), D(0));
  const foodsCashVal = (() => {
    const c = cleanMoney(foodsCashAmount);
    return c && !isNaN(Number(c)) ? D(c) : D(0);
  })();
  const totalFoodsPayment = foodsCashVal.plus(totalBankParsed);

  const handleFoodsSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");
    if (!foodsSalesman) {
      setError("Please select the foods salesman.");
      return;
    }
    const cleanCash = cleanMoney(foodsCashAmount);
    const cashVal = cleanCash ? parseMoneyNumber(cleanCash) : 0;
    const bankVal = totalBankParsed.toNumber();

    if (cashVal <= 0 && bankVal <= 0) {
      setError("Please enter at least one amount (cash or bank/online).");
      return;
    }

    setBusy(true);
    try {
      const foodsObj = foodsSalesmenOptions.find((f) => f.name === foodsSalesman || f.id === foodsSalesman);
      const foodsSalesmanId = foodsObj?.id;
      const foodsDisplayName = foodsObj?.name || foodsSalesman;

      // If both cash and bank are present, or separate transactions:
      // Post cash receipt separately from online receipt so each event is independently
      // reversible, verifiable, and tracked to its exact cash drawer vs bank account.
      const messages: string[] = [];

      if (cashVal > 0) {
        await api(
          "commands/foodsReceipt",
          commandResult,
          {
            date: foodsDate,
            foodsSalesman: foodsDisplayName,
            foodsSalesmanId,
            billNo: foodsBillNo.trim(),
            foodItems: foodsItems.trim(),
            method: "cash",
            cashAmount: cleanCash,
            bankAmount: "0.00",
            cashAccountId: foodsCashAccountId || defaultCash || undefined,
            note: foodsNotes.trim(),
          },
          "POST",
          crypto.randomUUID(),
        );
        messages.push(`Cash (₹${cleanCash}) posted to Cash Drawer`);
      }

      if (bankVal > 0) {
        await api(
          "commands/foodsReceipt",
          commandResult,
          {
            date: foodsDate,
            foodsSalesman: foodsDisplayName,
            foodsSalesmanId,
            billNo: foodsBillNo.trim(),
            foodItems: foodsItems.trim(),
            method: "online",
            cashAmount: "0.00",
            bankAmount: totalBankParsed.toFixed(2),
            bankAmounts: parsedBankAmounts.length > 0 ? parsedBankAmounts : undefined,
            bankAccountId: foodsBankAccountId || defaultBank || undefined,
            verified: false,
            note: foodsNotes.trim(),
          },
          "POST",
          crypto.randomUUID(),
        );
        messages.push(
          `Online (₹${totalBankParsed.toFixed(2)}${
            parsedBankAmounts.length > 1 ? ` across ${parsedBankAmounts.length} split claims` : ""
          }) queued for bank verification`
        );
      }

      setSuccess(`Foods collection recorded successfully: ${messages.join(" and ")}.`);
      setFoodsBillNo("");
      setFoodsItems("");
      setFoodsCashAmount("");
      setFoodsBankAmount("");
      setFoodsNotes("");
      await qc.invalidateQueries();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <section className="panel" style={{ paddingBottom: 8 }}>
        <div
          style={{
            display: "flex",
            gap: 24,
            borderBottom: "1px solid #e7e5e4",
            marginBottom: 20,
          }}
        >
          {[
            ["foods", "Foods Collection"],
          ].map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => {
                setActiveTab(k as typeof activeTab);
                setError("");
                setSuccess("");
              }}
              style={{
                background: "none",
                border: "none",
                padding: "10px 4px",
                fontSize: "14px",
                fontWeight: activeTab === k ? 700 : 500,
                color: activeTab === k ? "#c2410c" : "#78716c",
                borderBottom: activeTab === k ? "3px solid #ea580c" : "3px solid transparent",
                cursor: "pointer",
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {activeTab === "foods" && (
          <form onSubmit={handleFoodsSubmit}>
            <div className="form-grid">
              <Field label="Foods Salesman *">
                <select
                  value={foodsSalesman}
                  onChange={(e) => setFoodsSalesman(e.target.value)}
                  required
                >
                  <option value="">Choose foods salesman…</option>
                  {foodsSalesmenOptions.map((f) => (
                    <option key={f.id} value={f.name}>
                      {f.name} {f.territory ? `· ${f.territory}` : ""}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Date *">
                <input
                  type="date"
                  value={foodsDate}
                  onChange={(e) => setFoodsDate(e.target.value)}
                  required
                />
              </Field>

              <Field label="Bill No (optional)">
                <input
                  placeholder="e.g. FOOD-BILL-089"
                  value={foodsBillNo}
                  onChange={(e) => setFoodsBillNo(e.target.value)}
                />
              </Field>

              <Field label="Food Items (optional)">
                <input
                  placeholder="e.g. Spices, Atta, Grains, Snacks"
                  value={foodsItems}
                  onChange={(e) => setFoodsItems(e.target.value)}
                />
              </Field>

              <Field label="Cash Amount (₹)">
                <input
                  inputMode="decimal"
                  placeholder="0.00"
                  value={foodsCashAmount}
                  onChange={(e) => setFoodsCashAmount(e.target.value)}
                />
              </Field>

              {cashAccounts.length > 0 && (
                <Field label="Cash Drawer / Account">
                  <select
                    value={foodsCashAccountId || defaultCash}
                    onChange={(e) => setFoodsCashAccountId(e.target.value)}
                  >
                    {cashAccounts.map((a) => (
                      <option key={str(a.id)} value={str(a.id)}>
                        {str(a.name)} {a.holder ? `(${str(a.holder)})` : ""}
                      </option>
                    ))}
                  </select>
                </Field>
              )}

              <Field label="Bank / Online Amount(s) (₹)">
                <input
                  placeholder="e.g. 500 + 1,200"
                  value={foodsBankAmount}
                  onChange={(e) => setFoodsBankAmount(e.target.value)}
                />
                {(() => {
                  const parsed = parsedBankAmounts;
                  if (parsed.length > 1) {
                    return (
                      <div style={{ marginTop: 4, fontSize: 11, color: "#0369a1", display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center" }}>
                        <span>{parsed.length} split online records:</span>
                        {parsed.map((p, i) => (
                          <span key={i} style={{ background: "#e0f2fe", padding: "1px 6px", borderRadius: 4, fontWeight: 600 }}>
                            ₹{p}
                          </span>
                        ))}
                        <strong style={{ color: "#0c4a6e" }}>(Total ₹{totalBankParsed.toFixed(2)})</strong>
                      </div>
                    );
                  }
                  return (
                    <div style={{ marginTop: 2, fontSize: 11, color: "#64748b" }}>
                      Separate multiple amounts by comma or space (adds to Online Queue)
                    </div>
                  );
                })()}
              </Field>

              {bankAccounts.length > 0 && (
                <Field label="Bank Account">
                  <select
                    value={foodsBankAccountId || defaultBank}
                    onChange={(e) => setFoodsBankAccountId(e.target.value)}
                  >
                    {bankAccounts.map((a) => (
                      <option key={str(a.id)} value={str(a.id)}>
                        {str(a.name)}
                      </option>
                    ))}
                  </select>
                </Field>
              )}

              <Field label="Total Received (₹)">
                <div
                  style={{
                    padding: "8px 12px",
                    borderRadius: 6,
                    background: "#f0fdf4",
                    border: "1.5px solid #86efac",
                    color: "#15803d",
                    fontWeight: 800,
                    fontSize: 16,
                    minHeight: 38,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <span>₹{totalFoodsPayment.toFixed(2)}</span>
                  <span style={{ fontSize: 11, fontWeight: 600, color: "#166534" }}>
                    Cash: ₹{foodsCashVal.toFixed(2)} + Bank: ₹{totalBankParsed.toFixed(2)}
                  </span>
                </div>
              </Field>

              <Field label="Notes (optional)">
                <input
                  placeholder="Additional remarks or slip reference…"
                  value={foodsNotes}
                  onChange={(e) => setFoodsNotes(e.target.value)}
                />
              </Field>
            </div>

            {error && <p role="alert" className="error">{error}</p>}
            {success && <p role="status" className="notice">{success}</p>}

            <div style={{ marginTop: 20, display: "flex", justifyContent: "flex-end" }}>
              <Button className="primary" disabled={busy} type="submit" style={{ padding: "10px 24px" }}>
                {busy ? "Recording…" : "Save Foods Collection"}
              </Button>
            </div>
          </form>
        )}
      </section>

      {/* Relevant register table for Foods Collection */}
      <Documents
        onSelect={onSelect}
        kind="foods_receipt"
      />
    </>
  );
}

function OtherMoneyPage({
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
  const qc = useQueryClient(),
    [activeTab, setActiveTab] = useState<"expense" | "employee" | "transfer">("expense"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [success, setSuccess] = useState("");

  const accounts = arr(masters.accounts);
  const defaultCash = str(accounts.find((a) => a.type === "cash")?.id ?? "");
  const defaultBank = str(accounts.find((a) => a.type === "bank")?.id ?? "");

  // Load registered employees list from API
  const employeesQuery = useQuery({
    queryKey: ["employees"],
    queryFn: async () => {
      const r = await fetch("/api/v1/employees");
      return (await r.json()) as Array<{ id: string; name: string; role: string; phone?: string; active: boolean }>;
    },
  });
  const employeeOptions = (employeesQuery.data ?? []).filter((e) => e.active);

  const foodsSalesmenQuery = useQuery({
    queryKey: ["foods-salesmen"],
    queryFn: async () => {
      const r = await fetch("/api/v1/foods-salesmen");
      return (await r.json()) as Array<{ id: string; name: string; territory?: string; phone?: string; active: boolean }>;
    },
  });
  const foodsSalesmenOptions = (foodsSalesmenQuery.data ?? []).filter((f) => f.active);

  // 1. Operating expense state
  const [expenseCategory, setExpenseCategory] = useState("Diesel / Vehicle Fuel"),
    [expenseAmount, setExpenseAmount] = useState(""),
    [expensePayee, setExpensePayee] = useState(""),
    [expenseAccount, setExpenseAccount] = useState<string>(defaultCash),
    [expenseDate, setExpenseDate] = useState(date),
    [expenseRef, setExpenseRef] = useState("");

  // 2. Employee state (salary, advance, receive)
  const [empType, setEmpType] = useState<"salary" | "advance" | "receive">("salary"),
    [empName, setEmpName] = useState(""),
    [empAmount, setEmpAmount] = useState(""),
    [empPeriod, setEmpPeriod] = useState(""),
    [empAccount, setEmpAccount] = useState<string>(defaultCash),
    [empDate, setEmpDate] = useState(date),
    [empNotes, setEmpNotes] = useState(""),
    [signatureBlob, setSignatureBlob] = useState<Blob | null>(null),
    [createdDocId, setCreatedDocId] = useState<string | null>(null);

  // 3. Cash to bank transfer state
  const [transferFrom, setTransferFrom] = useState<string>(defaultCash),
    [transferTo, setTransferTo] = useState<string>(defaultBank),
    [transferAmount, setTransferAmount] = useState(""),
    [transferDate, setTransferDate] = useState(date),
    [transferNotes, setTransferNotes] = useState("");

  useEffect(() => {
    if (!expenseAccount && defaultCash) setExpenseAccount(defaultCash);
    if (!empAccount && defaultCash) setEmpAccount(defaultCash);
    if (!transferFrom && defaultCash) setTransferFrom(defaultCash);
    if (!transferTo && defaultBank) setTransferTo(defaultBank);
  }, [defaultCash, defaultBank]);

  const handleExpenseSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");
    const cleanAmt = cleanMoney(expenseAmount);
    if (!cleanAmt || parseMoneyNumber(cleanAmt) <= 0) {
      setError("Please enter a valid expense amount.");
      return;
    }
    if (!expenseAccount) {
      setError("Please select the paying account.");
      return;
    }
    setBusy(true);
    try {
      await api(
        "commands/expense",
        commandResult,
        {
          date: expenseDate,
          category: expenseCategory,
          payee: expensePayee || expenseCategory,
          amount: cleanAmt,
          note: expenseRef,
          legs: [{ accountId: expenseAccount, amount: cleanAmt }],
        },
        "POST",
        crypto.randomUUID(),
      );
      setSuccess("Operating expense recorded successfully.");
      setExpenseAmount("");
      setExpensePayee("");
      setExpenseRef("");
      await qc.invalidateQueries();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleEmployeeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");
    setCreatedDocId(null);
    if (!empName.trim()) {
      setError("Please enter the employee name.");
      return;
    }
    const cleanAmt = cleanMoney(empAmount);
    if (!cleanAmt || parseMoneyNumber(cleanAmt) <= 0) {
      setError("Please enter a valid amount.");
      return;
    }
    if (!empAccount) {
      setError(empType === "receive" ? "Please select the receiving account." : "Please select the paying account.");
      return;
    }

    setBusy(true);
    try {
      const empObj = employeeOptions.find((e) => e.name === empName.trim() || e.id === empName);
      const employeeId = empObj?.id;
      const empDisplayName = empObj?.name || empName.trim();

      let docResult: { id?: string; number?: string; amount?: string } | null = null;
      if (empType === "salary") {
        docResult = await api(
          "commands/salary",
          commandResult,
          {
            date: empDate,
            payee: empDisplayName,
            employeeId,
            period: empPeriod || "Regular Salary",
            amount: cleanAmt,
            setoff: "0",
            accountId: empAccount,
            note: empNotes,
          },
          "POST",
          crypto.randomUUID(),
        );
      } else if (empType === "advance") {
        if (!owner) {
          await api("requests", rowSchema, {
            command: "loan",
            payload: {
              date: empDate,
              direction: "staff",
              counterparty: empDisplayName,
              employeeId,
              accountId: empAccount,
              amount: cleanAmt,
              note: empNotes,
            },
            reason: `Staff advance requested for ${empDisplayName}`,
          });
        } else {
          docResult = await api(
            "commands/loan",
            commandResult,
            {
              date: empDate,
              direction: "staff",
              counterparty: empDisplayName,
              employeeId,
              accountId: empAccount,
              amount: cleanAmt,
              note: empNotes,
            },
            "POST",
            crypto.randomUUID(),
          );
        }
      } else if (empType === "receive") {
        docResult = await api(
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
          crypto.randomUUID(),
        );
      }

      // If digital signature was captured and document was created, upload it as private evidence
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
          empType === "receive"
            ? `Money received from employee recorded successfully as #${docResult.number ?? ""}. Added to account!`
            : `Employee ${empType} payment recorded successfully as #${docResult.number ?? ""}. Digital signature attached!`,
        );
      } else {
        setSuccess("Approval request submitted for owner approval.");
      }

      setEmpAmount("");
      setEmpNotes("");
      setEmpPeriod("");
      setSignatureBlob(null);
      await qc.invalidateQueries();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

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
        crypto.randomUUID(),
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
    <>
      <section className="panel" style={{ paddingBottom: 8 }}>
        <div
          style={{
            display: "flex",
            gap: 24,
            borderBottom: "1px solid #e7e5e4",
            marginBottom: 20,
          }}
        >
          {[
            ["expense", "Operating Expenses"],
            ["employee", "Employee & Staff / Foods (Salary / Advance / Expense)"],
            ["transfer", "Cash to Bank Transfer"],
          ].map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => {
                setActiveTab(k as typeof activeTab);
                setError("");
                setSuccess("");
              }}
              style={{
                background: "none",
                border: "none",
                padding: "10px 4px",
                fontSize: "14px",
                fontWeight: activeTab === k ? 700 : 500,
                color: activeTab === k ? "#c2410c" : "#78716c",
                borderBottom: activeTab === k ? "3px solid #ea580c" : "3px solid transparent",
                cursor: "pointer",
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {activeTab === "expense" && (
          <form onSubmit={handleExpenseSubmit}>
            <h3 style={{ textTransform: "uppercase", fontSize: 13, letterSpacing: 0.5, color: "#44403c", marginBottom: 16 }}>
              Record Operating Expense
            </h3>
            <div className="form-grid">
              <Field label="Category *">
                <select
                  value={expenseCategory}
                  onChange={(e) => setExpenseCategory(e.target.value)}
                  required
                >
                  {[
                    "Diesel / Vehicle Fuel",
                    "Shop / Godown Rent",
                    "Electricity / Utilities",
                    "Transport / Freight",
                    "Repairs & Maintenance",
                    "Stationery & Printing",
                    "Tea, Snacks & Refreshment",
                    "Loading & Unloading",
                    "Packaging Materials",
                    "Miscellaneous Expense",
                  ].map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Amount (₹) *">
                <input
                  inputMode="decimal"
                  placeholder="0.00"
                  value={expenseAmount}
                  onChange={(e) => setExpenseAmount(e.target.value)}
                  required
                />
              </Field>

              <Field label="Recipient / Description *">
                <input
                  placeholder="e.g. Bharat Petroleum - Diesel refill for delivery van"
                  value={expensePayee}
                  onChange={(e) => setExpensePayee(e.target.value)}
                  required
                />
              </Field>

              <Field label="Date *">
                <input
                  type="date"
                  value={expenseDate}
                  onChange={(e) => setExpenseDate(e.target.value)}
                  required
                />
              </Field>

              <Field label="Paid From Account *">
                <select
                  value={expenseAccount}
                  onChange={(e) => setExpenseAccount(e.target.value)}
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

              <Field label="Bill / Voucher Reference">
                <input
                  placeholder="e.g. Bill #8821"
                  value={expenseRef}
                  onChange={(e) => setExpenseRef(e.target.value)}
                />
              </Field>
            </div>

            {error && <p role="alert" className="error">{error}</p>}
            {success && <p role="status" className="notice">{success}</p>}

            <div style={{ marginTop: 20, display: "flex", justifyContent: "flex-end" }}>
              <Button className="primary" disabled={busy} type="submit" style={{ padding: "10px 24px" }}>
                {busy ? "Recording…" : "Record Expense"}
              </Button>
            </div>
          </form>
        )}

        {activeTab === "employee" && (
          <form onSubmit={handleEmployeeSubmit}>
            <h3 style={{ textTransform: "uppercase", fontSize: 13, letterSpacing: 0.5, color: "#44403c", marginBottom: 16 }}>
              Employee & Staff / Foods Salesman (Salary, Advance & Money Received)
            </h3>
            <div className="form-grid">
              <Field label="Entry Type *">
                <select
                  value={empType}
                  onChange={(e) => setEmpType(e.target.value as typeof empType)}
                  required
                >
                  <option value="salary">Salary Payment</option>
                  <option value="advance">Salary Advance (Staff Loan)</option>
                  <option value="receive">Receive money from emp</option>
                </select>
              </Field>

              <Field label="Employee / Foods Salesman *">
                <select
                  value={empName}
                  onChange={(e) => setEmpName(e.target.value)}
                  required
                >
                  <option value="">Choose employee or foods salesman…</option>
                  {employeeOptions.length > 0 && (
                    <optgroup label="Employees & Staff">
                      {employeeOptions.map((e) => (
                        <option key={e.id} value={e.name}>
                          {e.name} {e.role ? `(${e.role})` : ""}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {foodsSalesmenOptions.length > 0 && (
                    <optgroup label="Foods Salesmen">
                      {foodsSalesmenOptions.map((f) => (
                        <option key={f.id} value={f.name}>
                          {f.name} {f.territory ? `(${f.territory})` : "(Foods)"}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {/* Keep selected value visible if it was customized or not in standard list */}
                  {empName &&
                    !employeeOptions.some((e) => e.name === empName) &&
                    !foodsSalesmenOptions.some((f) => f.name === empName) && (
                      <option value={empName}>{empName}</option>
                    )}
                </select>
              </Field>

              <Field label="Amount (₹) *">
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

              {empType === "salary" && (
                <Field label="Salary Month / Period">
                  <input
                    placeholder="e.g. October 2026"
                    value={empPeriod}
                    onChange={(e) => setEmpPeriod(e.target.value)}
                  />
                </Field>
              )}

              <Field label={empType === "receive" ? "Received Into Account *" : "Paid From Account *"}>
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

              <Field label="Notes / Reference">
                <input
                  placeholder="Payment remarks or voucher number…"
                  value={empNotes}
                  onChange={(e) => setEmpNotes(e.target.value)}
                />
              </Field>
            </div>

            <SignaturePad
              key={createdDocId ?? "sigpad"}
              onChange={(blob) => setSignatureBlob(blob)}
              onClear={() => setSignatureBlob(null)}
            />

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
                    <Printer size={15} style={{ marginRight: 6 }} /> View & Print Payment Voucher
                  </Button>
                )}
              </div>
            )}

            <div style={{ marginTop: 20, display: "flex", justifyContent: "flex-end" }}>
              <Button className="primary" disabled={busy} type="submit" style={{ padding: "10px 24px" }}>
                {busy
                  ? "Recording…"
                  : empType === "receive"
                    ? "Receive Money"
                    : "Save Employee Record"}
              </Button>
            </div>
          </form>
        )}

        {activeTab === "transfer" && (
          <form onSubmit={handleTransferSubmit}>
            <h3 style={{ textTransform: "uppercase", fontSize: 13, letterSpacing: 0.5, color: "#44403c", marginBottom: 16 }}>
              Cash & Bank Transfer
            </h3>
            <div className="form-grid">
              <Field label="Transfer From *">
                <select
                  value={transferFrom}
                  onChange={(e) => setTransferFrom(e.target.value)}
                  required
                >
                  <option value="">Choose source account…</option>
                  {accounts.map((a) => (
                    <option key={str(a.id)} value={str(a.id)}>
                      {str(a.name)} ({str(a.type)})
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Transfer To *">
                <select
                  value={transferTo}
                  onChange={(e) => setTransferTo(e.target.value)}
                  required
                >
                  <option value="">Choose destination account…</option>
                  {accounts.map((a) => (
                    <option key={str(a.id)} value={str(a.id)}>
                      {str(a.name)} ({str(a.type)})
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Transfer Amount (₹) *">
                <input
                  inputMode="decimal"
                  placeholder="0.00"
                  value={transferAmount}
                  onChange={(e) => setTransferAmount(e.target.value)}
                  required
                />
              </Field>

              <Field label="Date *">
                <input
                  type="date"
                  value={transferDate}
                  onChange={(e) => setTransferDate(e.target.value)}
                  required
                />
              </Field>

              <Field label="Transfer Notes / Cheque / Ref">
                <input
                  placeholder="e.g. Cash deposit slip #1049"
                  value={transferNotes}
                  onChange={(e) => setTransferNotes(e.target.value)}
                />
              </Field>
            </div>

            {error && <p role="alert" className="error">{error}</p>}
            {success && <p role="status" className="notice">{success}</p>}

            <div style={{ marginTop: 20, display: "flex", justifyContent: "flex-end" }}>
              <Button className="primary" disabled={busy} type="submit" style={{ padding: "10px 24px" }}>
                {busy ? "Recording…" : "Complete Transfer"}
              </Button>
            </div>
          </form>
        )}

      </section>

      {/* Relevant register table for the active category */}
      <Documents
        onSelect={onSelect}
        kind={
          activeTab === "expense"
            ? "expense"
            : activeTab === "employee"
              ? "salary,loan,employee_receipt"
              : "transfer,deposit"
        }
      />

      <Requests owner={owner} date={date} masters={masters} />
    </>
  );
}


function Requests({
  owner,
  date,
  masters,
}: {
  owner: boolean;
  date: string;
  masters: Row;
}) {
  const [offset, setOffset] = useState(0);
  const q = useQuery({
    queryKey: ["requests"],
    queryFn: () => api("requests", rowsSchema),
  });

  const allRequests = q.data ?? [];
  const pageSize = 15;
  const pageRequests = allRequests.slice(offset, offset + pageSize);

  return (
    <section className="panel">
      <h2>Approval requests</h2>
      <p className="muted">
        Requests are separate from completed money movements.
      </p>
      {pageRequests.length ? (
        <>
          {pageRequests.map((r) => (
            <RequestRow
              key={str(r.id)}
              row={r}
              owner={owner}
              date={date}
              masters={masters}
            />
          ))}
          {allRequests.length > pageSize && (
            <div className="pagination" style={{ marginTop: 14 }}>
              <Button
                disabled={!offset}
                onClick={() => setOffset(Math.max(0, offset - pageSize))}
              >
                Previous
              </Button>
              <span>
                Showing {offset + 1}–
                {Math.min(offset + pageSize, allRequests.length)} of{" "}
                {allRequests.length} requests (latest first)
              </span>
              <Button
                disabled={offset + pageSize >= allRequests.length}
                onClick={() => setOffset(offset + pageSize)}
              >
                Next
              </Button>
            </div>
          )}
        </>
      ) : (
        <Empty text="No requests yet." />
      )}
    </section>
  );
}

function RequestRow({
  row,
  owner,
  date,
  masters,
}: {
  row: Row;
  owner: boolean;
  date: string;
  masters: Row;
}) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    qc = useQueryClient();
  return (
    <div className="claim">
      <div>
        <strong>{str((row.payload as Row).command)}</strong>
        <small>
          {str(row.reason)} · {str(row.state)}
        </small>
        <details>
          <summary>Review frozen transaction details</summary>
          <Review
            value={(row.payload as Row).payload}
            masters={masters}
            documents={[]}
          />
        </details>
      </div>
      {owner && row.state === "pending" && (
        <Button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await api(
                "requests/" + row.id + "/approve",
                rowSchema,
                { date },
                "POST",
                "request-" + row.id,
              );
              await qc.invalidateQueries();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          Approve reviewed transaction
        </Button>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
}

function SettingsPage({
  masters,
  date,
  owner,
  setAction,
}: {
  masters: Row;
  date: string;
  owner: boolean;
  setAction: (n: CommandName) => void;
}) {
  return (
    <MasterRecordsManager
      masters={masters}
      date={date}
      setAction={setAction}
    />
  );
}

function Salesmen({
  data,
  masters,
  date,
  onStatement,
  owner: _owner,
  add,
  setAdd,
  initialSelectedId,
  onSelectRecord,
  hideStats,
}: {
  owner: boolean;
  data: Row | undefined;
  masters: Row;
  date: string;
  onStatement: (id: string) => void;
  add: boolean;
  setAdd: (add: boolean) => void;
  initialSelectedId?: string | null;
  onSelectRecord?: (id: string) => void;
  hideStats?: boolean;
}) {
  const [search, setSearch] = useState(""),
    [filter, setFilter] = useState("all"),
    [selected, setSelected] = useState(initialSelectedId || "");

  useEffect(() => {
    if (initialSelectedId) {
      setSelected(initialSelectedId);
    }
  }, [initialSelectedId]);
  const people = data ? arr(data.people) : arr(masters.salesmen),
    visible = people
      .filter((p) =>
        (str(p.name) + " " + str(p.code))
          .toLowerCase()
          .includes(search.toLowerCase()),
      )
      .filter(
        (p) =>
          filter === "all" ||
          (filter === "advance" && str(p.balance).startsWith("-")) ||
          (filter === "due" &&
            !str(p.balance).startsWith("-") &&
            str(p.balance) !== "0.00"),
      );
  const current = selected || str(visible[0]?.id),
    [passbookOffset, setPassbookOffset] = useState(0),
    statement = useQuery({
      queryKey: ["statement", current],
      queryFn: () => api("statements/" + current),
      enabled: !!current,
    });

  useEffect(() => {
    setPassbookOffset(0);
  }, [current]);
  return (
    <>
      {!hideStats && (
        <div className="stats">
          <Metric
            label="Still to receive"
            value={data?.due}
            caption="Gross dues across salesmen"
            accent
          />
          <Metric
            label="Paid in advance"
            value={data?.credit}
            caption="Credits remain separate from other dues"
          />
        </div>
      )}
      {add && (
        <section className="panel">
          <MasterForm
            kind="salesmen"
            date={date}
            onDone={() => setAdd(false)}
          />
        </section>
      )}
      <div className="khata-layout">
        <div>
          <input
            className="khata-search"
            aria-label="Search salesman"
            placeholder="Search name or code…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="khata-toolbar">
            {[
              ["all", "All"],
              ["due", "Still to receive"],
              ["advance", "Advances"],
            ].map(([id, label]) => (
              <Button
                key={id}
                className={filter === id ? "primary" : "secondary"}
                onClick={() => setFilter(id)}
              >
                {label}
              </Button>
            ))}
          </div>
          <div className="khata-list">
            {visible.map((p) => (
              <button
                key={str(p.id)}
                className={"khata-card " + (p.id === current ? "selected" : "")}
                onClick={() => setSelected(str(p.id))}
              >
                <div>
                  <strong>{str(p.name)}</strong>
                  <small>
                    {str(p.code)} · {p.active ? "Active" : "Inactive"}
                  </small>
                </div>
                <div>
                  <small>
                    {str(p.balance).startsWith("-")
                      ? "Advance"
                      : "Signed balance"}
                  </small>
                  <b>{rupees(p.balance)}</b>
                </div>
              </button>
            ))}
            {!visible.length && <Empty text="No matching salesmen." />}
          </div>
        </div>
        <section className="panel">
          <div className="section-title">
            <div>
              <h2>
                {str(people.find((p) => p.id === current)?.name) ||
                  "Khata passbook"}
              </h2>
              <p className="muted small">
                Trade ledger · loans and staff advances are separate.
              </p>
            </div>
            {current && (
              <Button
                className="secondary"
                onClick={() => onStatement(current)}
              >
                Date range / print
              </Button>
            )}
          </div>
          {statement.isPending ? (
            <p>Choose a salesman to view history.</p>
          ) : statement.isError ? (
            <p className="error">{statement.error.message}</p>
          ) : (
            <>
              <div className="review-balances">
                <p>
                  Ending signed balance <b>{rupees(statement.data.ending)}</b>
                </p>
              </div>
              {(() => {
                const allEntries = arr(statement.data.entries)
                  .map((e) => {
                    const method = (e.data as Row | undefined)?.method;
                    let displayType = str(e.kind);
                    if (e.kind === "receipt") {
                      displayType =
                        method === "cash"
                          ? "receipt-cash"
                          : method === "online"
                            ? "receipt-online"
                            : "receipt";
                    }
                    return {
                      ...e,
                      displayType,
                    };
                  })
                  .slice()
                  .reverse(); // Latest required first

                const pageSize = 15;
                const pageEntries = allEntries.slice(
                  passbookOffset,
                  passbookOffset + pageSize,
                );

                return (
                  <>
                    <Table
                      rows={pageEntries}
                      columns={[
                        ["number", "Record"],
                        ["date", "Date"],
                        ["displayType", "Type"],
                        ["debit", "Increases due", true],
                        ["credit", "Reduces due", true],
                        ["balance", "Balance", true],
                      ]}
                      onRow={onSelectRecord ? (r) => onSelectRecord(str(r.id)) : undefined}
                    />
                    <div className="pagination" style={{ marginTop: 14 }}>
                      <Button
                        disabled={!passbookOffset}
                        onClick={() =>
                          setPassbookOffset(Math.max(0, passbookOffset - pageSize))
                        }
                      >
                        Previous
                      </Button>
                      <span>
                        Showing {allEntries.length ? passbookOffset + 1 : 0}–
                        {Math.min(passbookOffset + pageSize, allEntries.length)} of{" "}
                        {allEntries.length} entries (latest first)
                      </span>
                      <Button
                        disabled={passbookOffset + pageSize >= allEntries.length}
                        onClick={() => setPassbookOffset(passbookOffset + pageSize)}
                      >
                        Next
                      </Button>
                    </div>
                  </>
                );
              })()}
            </>
          )}
        </section>
      </div>
    </>
  );
}
const labels: Record<CommandName, string> = {
  bill: "New bill",
  receiptBatch: "Receive split payment",
  adjustment: "Approved correcting adjustment",
  receipt: "Receive payment",
  verify: "Verify online payment",
  reject: "Reject claim",
  return: "Record linked return",
  refund: "Issue credit refund",
  opening: "Approve opening balance",
  openingBatch: "Finalize opening import",
  expense: "Record expense",
  transfer: "Transfer business money",
  deposit: "Hand over bank deposit",
  resolveDeposit: "Resolve deposit",
  loan: "Loan, borrowing or staff advance",
  repay: "Record principal repayment",
  salary: "Record salary payment",
  owner: "Owner money movement",
  unidentified: "Unidentified bank credit",
  identify: "Identify an existing bank credit",
  reverse: "Reverse a posted record",
  close: "Close today",
  resolveCloseException: "Resolve a cash difference",
  reopen: "Reopen a business date",
  reconcile: "Bank reconciliation",
  reallocate: "Review allocations",
  foodsReceipt: "Foods payment receipt",
  employeeReceipt: "Employee advance / recovery receipt",
  receiveSalesmanCash: "Receive salesman cash into till",
  initiateCashHandover: "Initiate cash handover to manager",
  confirmCashHandover: "Confirm cash handover into till",
  rejectCashHandover: "Reject cash handover",
};
type Spec = {
  key: string;
  label: string;
  type?: "date" | "money" | "quantity" | "text";
  source?:
  | "salesmen"
  | "accounts"
  | "documents"
  | "cash"
  | "bank"
  | "billLines"
  | "closes";
  options?: string[];
  optional?: boolean;
  default?: string;
};
const common: Spec[] = [
  { key: "date", label: "Business posting date", type: "date" },
  { key: "note", label: "Note", optional: true },
];
const amount: Spec = { key: "amount", label: "Amount (₹)", type: "money" },
  acc: Spec = {
    key: "accountId",
    label: "Actual money account",
    source: "accounts",
  },
  sales: Spec = { key: "salesmanId", label: "Salesman", source: "salesmen" };
const specs: Partial<Record<CommandName, Spec[]>> = {
  resolveCloseException: [
    { key: "closeId", label: "Unresolved cash difference", source: "closes" },
    {
      key: "resolution",
      label: "Owner resolution",
      options: ["recount_confirmed", "linked_correction"],
    },
    {
      key: "documentId",
      label: "Actual correction document (if linked)",
      source: "documents",
      optional: true,
    },
    { key: "reason", label: "Explanation and evidence checked" },
  ],
  receiptBatch: [sales],
  adjustment: [
    { key: "target", label: "Correction target", options: ["trade", "money"] },
    { key: "targetId", label: "Salesman / money account", source: "accounts" },
    {
      key: "direction",
      label: "Effect on signed balance",
      options: ["increase", "decrease"],
    },
    amount,
    {
      key: "category",
      label: "Approved category",
      options: [
        "opening_correction",
        "write_off",
        "cash_over_short",
        "approved_trade_correction",
      ],
    },
    { key: "reason", label: "Reason and supporting record" },
  ],
  receipt: [
    sales,
    amount,
    acc,
    { key: "method", label: "Payment method", options: ["cash", "online"] },
    { key: "actualDate", label: "Actual payment date", type: "date" },
    { key: "reference", label: "Bank reference / cash note", optional: true },
  ],
  refund: [sales, amount, acc, { key: "reason", label: "Reason" }],
  expense: [
    amount,
    {
      key: "category",
      label: "Expense category",
      options: [
        "diesel",
        "rent",
        "electricity",
        "transport",
        "repairs",
        "stationery",
        "miscellaneous",
      ],
    },
    { key: "payee", label: "Paid to / description" },
  ],
  transfer: [
    { key: "sourceId", label: "From business account", source: "accounts" },
    { key: "destinationId", label: "To business account", source: "accounts" },
    amount,
  ],
  deposit: [
    { key: "sourceId", label: "Cash handed over from", source: "cash" },
    { key: "destinationId", label: "Destination bank", source: "bank" },
    amount,
  ],
  resolveDeposit: [
    { key: "depositId", label: "Original deposit", source: "documents" },
    {
      key: "resolution",
      label: "What happened?",
      options: ["credit", "return"],
    },
    acc,
    amount,
    {
      key: "bankIdentity",
      label: "Bank credit identity (required for credit)",
      optional: true,
    },
  ],
  loan: [
    {
      key: "direction",
      label: "Type",
      options: ["given", "borrowed", "staff"],
    },
    { key: "counterparty", label: "Counterparty / staff name" },
    acc,
    amount,
  ],
  repay: [
    { key: "loanId", label: "Original loan / advance", source: "documents" },
    acc,
    amount,
  ],
  salary: [
    { key: "payee", label: "Staff name" },
    { key: "period", label: "Salary period" },
    amount,
    {
      key: "staffLoanId",
      label: "Staff advance (if set off)",
      source: "documents",
      optional: true,
    },
    { key: "setoff", label: "Advance setoff (₹)", type: "money", default: "0" },
    acc,
  ],
  owner: [
    {
      key: "classification",
      label: "Owner classification",
      options: [
        "contribution",
        "owner_advance",
        "withdrawal",
        "owner_advance_repayment",
      ],
    },
    acc,
    amount,
  ],
  unidentified: [
    acc,
    amount,
    {
      key: "bankIdentity",
      label: "Unique receiving-account bank transaction identity",
    },
  ],
  identify: [
    {
      key: "receiptId",
      label: "Original unidentified bank credit",
      source: "documents",
    },
  ],
  opening: [
    { key: "target", label: "Opening type", options: ["trade", "money"] },
    { key: "targetId", label: "Salesman or money account", source: "accounts" },
    {
      key: "amount",
      label: "Signed opening (negative = advance)",
      type: "text",
    },
    { key: "batchId", label: "Import / approval batch ID" },
    { key: "rowId", label: "Unique approved row ID" },
  ],
  reverse: [
    { key: "documentId", label: "Original record", source: "documents" },
    { key: "reason", label: "Correction reason" },
  ],
  return: [
    { key: "lineId", label: "Original bill line", source: "billLines" },
    { key: "quantity", label: "Returned quantity", type: "quantity" },
    { key: "reason", label: "Return reason" },
  ],
  reopen: [{ key: "reason", label: "Reason for reopening" }],
  reconcile: [
    acc,
    { key: "statement", label: "Bank statement balance (₹)", type: "text" },
  ],
  reallocate: [sales],
};
function WorkflowPage({
  title,
  onClose,
  children,
  busy = false,
  actions,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  busy?: boolean;
  actions?: React.ReactNode;
}) {
  const heading = useRef<HTMLHeadingElement>(null),
    titleId = useId(),
    setBusy = useContext(WorkflowBusyContext);
  useEffect(() => {
    window.scrollTo(0, 0);
    heading.current?.focus();
    return () => window.scrollTo(0, 0);
  }, []);
  useEffect(() => {
    setBusy(busy);
    return () => setBusy(false);
  }, [busy, setBusy]);
  return (
    <section
      className="workflow-page"
      role="region"
      aria-labelledby={titleId}
      aria-busy={busy}
    >
      <div className="workflow-heading">
        <div>
          <p className="eyebrow">SALES & MONEY BOOK</p>
          <h1 id={titleId} ref={heading} tabIndex={-1}>
            {title}
          </h1>
        </div>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {actions}
          <Button className="secondary" disabled={busy} onClick={onClose}>
            ← Back
          </Button>
        </div>
      </div>
      <div className="workflow-body">{children}</div>
    </section>
  );
}

function CommandPage({
  name,
  date,
  masters,
  dashboard,
  owner,
  onClose,
  onGoToSalesman,
  onSelect,
  restore,
}: {
  restore?: Row | null;
  name: CommandName;
  date: string;
  masters: Row;
  dashboard: Row;
  owner: boolean;
  onClose: () => void;
  onGoToSalesman?: (salesmanId: string) => void;
  onSelect?: (id: string) => void;
}) {
  const mubashirSalesman = arr(masters.salesmen).find(
    (s) =>
      str((s.details as Row)?.is_direct_route) === "true" ||
      str((s.details as Row)?.direct_route) === "true" ||
      str((s.details as Row)?.isDirectRoute) === "true" ||
      str(s.name).toLowerCase().includes("mubashir") ||
      str(s.name).toLowerCase().includes("muddasir") ||
      str((s.details as Row)?.itc_id) === "1HG2",
  );
  const mubashirSalesmanId = mubashirSalesman ? str(mubashirSalesman.id) : undefined;
  const qc = useQueryClient(),
    [values, setValues] = useState<Record<string, string>>({
      date,
      actualDate: date,
      note: "",
      method: "cash",
      setoff: "0",
      direction: "given",
      classification: "contribution",
      resolution: "credit",
      target: "trade",
      category: "diesel",
    }),
    [quantities, setQuantities] = useState<Record<string, string>>({}),
    [billRowIds, setBillRowIds] = useState<string[]>(() => [crypto.randomUUID()]),
    [billRowProducts, setBillRowProducts] = useState<Record<string, string>>({}),
    [lineEdits, setLineEdits] = useState<
      Record<string, Record<string, string>>
    >({}),
    [legs, setLegs] = useState([{ accountId: "", amount: "" }]),
    [assignments, setAssignments] = useState([{ salesmanId: "", amount: "" }]),
    [counts, setCounts] = useState<Record<string, string>>({}),
    [reasons, setReasons] = useState<Record<string, string>>({}),
    [withPayments, setWithPayments] = useState(true),
    [cashPay, setCashPay] = useState(""),
    [onlinePay, setOnlinePay] = useState(""),
    [cashId, setCashId] = useState(""),
    [bankId, setBankId] = useState(""),
    [bankRef, setBankRef] = useState(""),
    [step, setStep] = useState<"entry" | "review" | "saved">("entry"),
    [payload, setPayload] = useState<unknown>(),
    [preview, setPreview] = useState<Row | null>(null),
    [result, setResult] = useState<Row>(),
    [notice, setNotice] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [key, setKey] = useState(crypto.randomUUID()),
    [draft, setDraft] = useState<{ id: string; version: number } | null>(null);
  useEffect(() => {
    if (!restore) return;
    try {
      const data = rowSchema.parse(restore.data);
      setValues(z.record(z.string(), z.string()).parse(data.values));
      setQuantities(
        z.record(z.string(), z.string()).parse(data.quantities ?? {}),
      );
      setLineEdits(
        z
          .record(z.string(), z.record(z.string(), z.string()))
          .parse(data.lineEdits ?? {}),
      );
      setCounts(z.record(z.string(), z.string()).parse(data.counts ?? {}));
      setReasons(z.record(z.string(), z.string()).parse(data.reasons ?? {}));
      setLegs(
        z
          .array(z.object({ accountId: z.string(), amount: z.string() }))
          .parse(data.legs ?? []),
      );
      setAssignments(
        z
          .array(z.object({ salesmanId: z.string(), amount: z.string() }))
          .parse(data.assignments ?? []),
      );
      const payment = rowSchema.parse(data.payment ?? {});
      setWithPayments(payment.withPayments !== undefined ? payment.withPayments === true : true);
      setCashPay(str(payment.cashPay));
      setOnlinePay(str(payment.onlinePay));
      setCashId(str(payment.cashId));
      setBankId(str(payment.bankId));
      setBankRef(str(payment.bankRef));
      setDraft({ id: str(restore.id), version: Number(restore.version) });
    } catch {
      setError("This draft cannot be restored. Its data format is invalid.");
    }
  }, [restore]);
  const [sourceSearch, setSourceSearch] = useState("");
  const [matchOffset, setMatchOffset] = useState(0);
  const bankMatches = useQuery({
    queryKey: [
      "matching-bank",
      values.accountId,
      values.matchFrom,
      values.date,
      matchOffset,
    ],
    enabled: name === "reconcile" && !!values.accountId,
    queryFn: () =>
      api(
        `books/${values.accountId}?from=${values.matchFrom ?? date.slice(0, 7) + "-01"}&to=${values.date}&offset=${matchOffset}`,
      ),
  });
  const docs = useQuery({
    queryKey: ["documents", "selector", sourceSearch],
    queryFn: () =>
      api("documents?search=" + encodeURIComponent(sourceSearch), rowsSchema),
  }),
    allLines = useQuery({
      queryKey: ["bill-lines", "selector", sourceSearch],
      queryFn: () =>
        api(
          "bill-lines?search=" + encodeURIComponent(sourceSearch),
          rowsSchema,
        ),
      enabled: name === "return",
    });
  const set = (k: string, v: string) => setValues((s) => ({ ...s, [k]: v }));
  const options = (s: Spec): Row[] =>
    s.source === "closes"
      ? arr(dashboard.exceptions).map((r) => ({
        ...r,
        name:
          str(r.date) +
          " · " +
          str(r.account) +
          " · difference " +
          rupees(r.difference),
      }))
      : s.source === "billLines"
        ? (allLines.data ?? [])
        : s.source === "documents"
          ? (docs.data ?? []).filter(
            (r) =>
              !r.reversed &&
              (s.key === "depositId"
                ? r.kind === "deposit"
                : s.key === "loanId" || s.key === "staffLoanId"
                  ? r.kind === "loan"
                  : s.key === "receiptId"
                    ? r.kind === "unidentified"
                    : true),
          )
          : s.key === "targetId" && values.target === "trade"
            ? arr(masters.salesmen)
            : s.source === "salesmen"
              ? arr(masters.salesmen)
              : arr(masters.accounts).filter((r) =>
                s.source === "cash" || s.source === "bank"
                  ? r.type === s.source
                  : true,
              );
  const onlyRequest =
    (!owner &&
      [
        "refund",
        "loan",
        "repay",
        "owner",
        "opening",
        "reverse",
        "reopen",
        "adjustment",
      ].includes(name)) ||
    (!owner && name === "bill" && preview?.needsOwnerApproval === true);
  const build = () => {
    const p: Row = {};
    if (name !== "close")
      for (const f of [...common, ...(specs[name] ?? [])]) {
        if (f.optional && !values[f.key]) {
          if (
            f.key === "note" ||
            f.key === "reference" ||
            f.key === "bankIdentity"
          )
            p[f.key] = "";
          continue;
        }
        p[f.key] = values[f.key] ?? f.default ?? "";
      }
    if (name === "receipt") p.verified = false;
    if (name === "receiptBatch") {
      const cleanCash = cleanMoney(cashPay);
      const onlineAmounts = parseMultiAmounts(onlinePay);
      const batchReceipts: Row[] = [];
      if (cleanCash) {
        batchReceipts.push({
          amount: cleanCash,
          accountId: cashId,
          method: "cash",
          actualDate: date,
          reference: "",
          verified: false,
        });
      }
      if (onlineAmounts.length > 0) {
        onlineAmounts.forEach((amt, idx) => {
          const suffix = onlineAmounts.length > 1 ? ` (${idx + 1}/${onlineAmounts.length})` : "";
          batchReceipts.push({
            amount: amt,
            accountId: bankId,
            method: "online",
            actualDate: date,
            reference: (bankRef ? `${bankRef}${suffix}` : `Online payment${suffix}`).trim(),
            verified: false,
          });
        });
      }
      p.receipts = batchReceipts;
    }
    if (name === "bill") {
      p.salesmanId = values.salesmanId;
      p.lines = billRowIds
        .map((rowId) => {
          const productId = billRowProducts[rowId];
          let quantity = (quantities[rowId] ?? "").trim();
          if (quantity.startsWith(".")) quantity = "0" + quantity;
          if (!productId || !quantity || isNaN(Number(quantity)) || Number(quantity) <= 0) {
            return null;
          }
          const edit = lineEdits[rowId] ?? lineEdits[productId] ?? {};
          return {
            productId,
            quantity,
            ...(edit.rate !== undefined ? { rate: edit.rate } : {}),
            ...(edit.basis !== undefined ? { basis: edit.basis } : {}),
          };
        })
        .filter((l): l is NonNullable<typeof l> => l !== null);
      p.receipts = [];
      p.paperReference = values.paperReference ?? "";
      p.overrideReason = values.overrideReason ?? "";
      const cleanDisc = cleanMoney(values.discount);
      if (cleanDisc && parseMoneyNumber(cleanDisc) > 0) {
        p.discount = cleanDisc;
      }
      if (withPayments) {
        const defaultCashId =
          cashId ||
          (arr(masters.accounts).find((a) => a.type === "cash")?.id ?? "");
        const defaultBankId =
          bankId ||
          (arr(masters.accounts).find((a) => a.type === "bank")?.id ?? "");
        const cleanCash = cleanMoney(cashPay);
        const onlineAmounts = parseMultiAmounts(onlinePay);
        const receipts: Row[] = [];
        if (cleanCash)
          receipts.push({
            amount: cleanCash,
            accountId: defaultCashId,
            method: "cash",
            actualDate: date,
            reference: "",
            verified: false,
          });
        if (onlineAmounts.length > 0) {
          onlineAmounts.forEach((amt, idx) => {
            const suffix = onlineAmounts.length > 1 ? ` (${idx + 1}/${onlineAmounts.length})` : "";
            receipts.push({
              amount: amt,
              accountId: defaultBankId,
              method: "online",
              actualDate: date,
              reference: (bankRef ? `${bankRef}${suffix}` : `Online payment${suffix}`).trim(),
              verified: false,
            });
          });
        }
        p.receipts = receipts;
      }
    }
    if (name === "expense") p.legs = legs;
    if (name === "identify") p.assignments = assignments;
    if (name === "close") {
      p.date = date;
      p.counts = arr(masters.accounts)
        .filter((a) => a.type === "cash" && a.active)
        .map((a) => ({
          accountId: a.id,
          counted: cleanMoney(counts[str(a.id)] ?? ""),
          reason: reasons[str(a.id)] ?? "",
        }));
    }
    if (name === "opening") {
      if (!p.batchId) p.batchId = `opening-manual-${date || new Date().toISOString().slice(0, 10)}`;
      if (!p.rowId) p.rowId = `row-${p.targetId || "entry"}-${crypto.randomUUID().slice(0, 8)}`;
    }
    if (name === "reopen") delete p.note;
    if (name === "reconcile") {
      p.matches = (values.matches ?? "")
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean);
    }
    if (name === "reallocate")
      p.preferredChargeIds = (values.preferred ?? "")
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean);
    return commands[name].parse(p);
  };
  let quoteInput: string | null = null;
  if (name === "bill" && step === "entry") {
    try {
      quoteInput = JSON.stringify(build());
    } catch {
      /* Incomplete entry has no amount yet. */
    }
  }
  const [debouncedQuote, setDebouncedQuote] = useState<string | null>(null);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuote(quoteInput), 250);
    return () => window.clearTimeout(timer);
  }, [quoteInput]);
  const entryQuote = useQuery({
    queryKey: ["bill-entry-preview", debouncedQuote],
    enabled:
      name === "bill" &&
      step === "entry" &&
      debouncedQuote !== null &&
      debouncedQuote === quoteInput,
    queryFn: () =>
      api("preview/bill", previewResponse, JSON.parse(debouncedQuote!)),
    staleTime: 0,
  });
  const currentQuote =
    quoteInput !== null &&
      debouncedQuote === quoteInput &&
      !entryQuote.isFetching &&
      !entryQuote.isError
      ? entryQuote.data
      : undefined;
  const clientEstimatedTotal = (() => {
    let sum = 0;
    for (const rId of billRowIds) {
      const prodId = billRowProducts[rId];
      const rawQ = (quantities[rId] ?? "").trim();
      const qStr = rawQ.startsWith(".") ? "0" + rawQ : rawQ;
      const prod = arr(masters.products).find((x) => str(x.id) === prodId);
      if (!prod || !prod.rate) continue;
      const q = Number(qStr);
      const r = Number(prod.rate);
      const b = Number(prod.basis || 1) || 1;
      if (isNaN(q) || isNaN(r) || q <= 0 || r <= 0) continue;
      sum += (q * r) / b;
    }
    return sum > 0 ? (Math.round(sum * 100) / 100).toFixed(2) : null;
  })();
  const totalQuantity = (() => {
    let sum = D(0);
    let count = 0;
    for (const rId of billRowIds) {
      const prodId = billRowProducts[rId];
      const rawQ = (quantities[rId] ?? "").trim();
      const qStr = rawQ.startsWith(".") ? "0" + rawQ : rawQ;
      if (!prodId || !qStr || isNaN(Number(qStr)) || Number(qStr) <= 0) continue;
      try {
        sum = sum.plus(D(qStr));
        count++;
      } catch {
        // ignore invalid decimals
      }
    }
    return count > 0 ? sum.toFixed() : null;
  })();
  const save = async () => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const p = build();
      setPayload(p);
      if (name === "bill") {
        const quote = await api("preview/bill", rowSchema, p);
        setPreview(quote);
        const billPayload = p as Row;
        setPayload({
          ...billPayload,
          expectedQuoteHash: quote.quoteHash,
          ...(!owner && quote.needsOwnerApproval
            ? {
              overrideReason:
                values.note ||
                "Manager requests owner approval for bill pricing or credit-limit exception",
            }
            : {}),
        });
      }
      setStep("review");
    } catch (e) {
      setError(
        e instanceof z.ZodError
          ? e.issues.map((i) => i.path.join(".") + ": " + i.message).join("; ")
          : (e as Error).message,
      );
    } finally {
      setBusy(false);
    }
  };
  const targetSalesmanName = values.salesmanId
    ? str(arr(masters.salesmen).find((s) => s.id === values.salesmanId)?.name)
    : "";

  return (
    <WorkflowPage title={labels[name]} onClose={onClose} busy={busy}>
      {step === "saved" ? (
        <div className="saved">
          <span className="saved-icon">
            <Check />
          </span>
          <h3>
            {onlyRequest
              ? "Request saved for owner review"
              : "Saved to business records"}
          </h3>
          <p>{str(result?.number ?? result?.id)}</p>
          <p className="muted">
            {onlyRequest
              ? "This request has no financial effect."
              : "Printing and evidence uploads are separate actions. The saved entry is already recorded."}
          </p>

          {values.salesmanId && onGoToSalesman && (
            <p style={{ margin: "16px 0", fontSize: 14 }}>
              📄 View{" "}
              <button
                type="button"
                onClick={() => onGoToSalesman(values.salesmanId)}
                style={{
                  background: "none",
                  border: "none",
                  padding: 0,
                  color: "#d97706",
                  fontWeight: 700,
                  textDecoration: "underline",
                  cursor: "pointer",
                  fontSize: "inherit",
                }}
              >
                {targetSalesmanName ? `${targetSalesmanName}'s` : "salesman"} passbook & statement
              </button>{" "}
              to see the updated balance and entries.
            </p>
          )}

          <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 12 }}>
            <Button className="primary" onClick={onClose}>
              Done
            </Button>
          </div>
        </div>
      ) : (
        <>
          {name !== "bill" && (
            <p className="notice">
              {onlyRequest
                ? "Owner approval required. This saves a request with no financial effect."
                : "Review before posting. Online claims remain pending until verified."}
            </p>
          )}
          {name === "bill" && step === "review" && onlyRequest && (
            <p className="notice">
              Owner review required for this bill's pricing, discount or
              credit-limit exception. No financial effect until approved.
            </p>
          )}
          {step === "entry" ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && e.target instanceof HTMLInputElement)
                  e.preventDefault();
              }}
            >
              {(specs[name] ?? []).some(
                (s) => s.source === "documents" || s.source === "billLines",
              ) && (
                  <Field label="Find original record by number, name or paper reference">
                    <input
                      value={sourceSearch}
                      onChange={(e) => setSourceSearch(e.target.value)}
                      placeholder="Search all recorded history…"
                    />
                  </Field>
                )}
              <div className="form-grid">
                {name !== "close" &&
                  name !== "bill" &&
                  common.map((f) => (
                    <Field label={f.label} key={f.key}>
                      <input
                        type={f.type === "date" ? "date" : "text"}
                        value={values[f.key] ?? ""}
                        onChange={(e) => set(f.key, e.target.value)}
                      />
                    </Field>
                  ))}
                {name === "bill" && (
                  <>
                    <Field label="Salesman">
                      <select
                        value={values.salesmanId ?? ""}
                        onChange={(e) => set("salesmanId", e.target.value)}
                      >
                        <option value="">Choose salesman</option>
                        {arr(masters.salesmen)
                          .filter((s) => s.active && (!mubashirSalesmanId || s.id !== mubashirSalesmanId))
                          .map((s) => (
                            <option key={str(s.id)} value={str(s.id)}>
                              {str(s.code)} · {str(s.name)}
                            </option>
                          ))}
                      </select>
                    </Field>
                    <Field label="Date">
                      <input
                        type="date"
                        value={values.date}
                        onChange={(e) => set("date", e.target.value)}
                      />
                    </Field>
                  </>
                )}
                {(specs[name] ?? []).map((f) => {
                  const dynamicLabel =
                    f.key === "targetId"
                      ? values.target === "trade"
                        ? "Select Salesman"
                        : values.target === "money"
                          ? "Select Money / Bank Account"
                          : f.label
                      : f.label;
                  return (
                    <Field
                      key={f.key}
                      label={dynamicLabel + (f.optional ? " (optional)" : "")}
                    >
                      {f.source || f.options ? (
                        <select
                          value={values[f.key] ?? f.default ?? ""}
                          onChange={(e) => set(f.key, e.target.value)}
                        >
                          <option value="">Choose…</option>
                          {f.options
                            ? (name === "adjustment" && f.key === "category"
                              ? f.options.filter((o) =>
                                values.target === "money"
                                  ? o === "cash_over_short" || o === "opening_correction"
                                  : o !== "cash_over_short",
                              )
                              : f.options
                            ).map((o) => (
                              <option key={o} value={o}>
                                {o.replaceAll("_", " ")}
                              </option>
                            ))
                            : options(f).map((r) => (
                              <option key={str(r.id)} value={str(r.id)}>
                                {str(r.name ?? r.number ?? r.label)}
                                {r.amount ? " · " + rupees(r.amount) : ""}
                              </option>
                            ))}
                        </select>
                      ) : (
                        <input
                          type={f.type === "date" ? "date" : "text"}
                          inputMode={
                            f.type === "money" || f.type === "quantity"
                              ? "decimal"
                              : undefined
                          }
                          value={values[f.key] ?? f.default ?? ""}
                          onChange={(e) => set(f.key, e.target.value)}
                        />
                      )}
                    </Field>
                  );
                })}
              </div>
              {name === "bill" && (
                <>
                  <div className="table-scroll bill-grid bill-entry-grid">
                    <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: "0 6px" }}>
                      <thead>
                        <tr>
                          <th style={{ width: 40, textAlign: "center" }}>#</th>
                          <th style={{ width: 110 }}>Product ID</th>
                          <th style={{ minWidth: 220 }}>Product Name</th>
                          <th style={{ width: 120 }}>Quantity (m)</th>
                          <th style={{ width: 130 }}>Rate / m</th>
                          <th className="money-cell" style={{ width: 120 }}>Amount</th>
                          <th style={{ width: 45, textAlign: "center" }}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {billRowIds.map((rowId, index) => {
                          const productId = billRowProducts[rowId] ?? "";
                          const p = arr(masters.products).find((x) => str(x.id) === productId);
                          const quoted = currentQuote?.lines.find((l) => l.productId === productId);
                          const quantity = quantities[rowId] ?? "";
                          const normQty = quantity.trim().startsWith(".")
                            ? "0" + quantity.trim()
                            : quantity.trim();
                          const clientEstimatedAmount = (() => {
                            if (!p || !p.rate) return null;
                            const qNum = Number(normQty);
                            const rNum = Number(p.rate);
                            if (isNaN(qNum) || isNaN(rNum) || qNum <= 0 || rNum <= 0) return null;
                            const basisNum = Number(p.basis || 1) || 1;
                            return (Math.round((qNum * rNum / basisNum) * 100) / 100).toFixed(2);
                          })();
                          const disabledProductIds = billRowIds
                            .filter((id) => id !== rowId && billRowProducts[id])
                            .map((id) => billRowProducts[id]);

                          return (
                            <tr key={rowId} style={{ background: "#ffffff" }}>
                              <td style={{ textAlign: "center", color: "#a8a29e", fontSize: 13, fontWeight: 500 }}>
                                {index + 1}
                              </td>
                              <td>
                                <ProductIdSearchableSelect
                                  products={arr(masters.products).filter((x) => x.active)}
                                  selectedId={productId}
                                  disabledIds={disabledProductIds}
                                  onSelect={(selectedProdId) => {
                                    setBillRowProducts((prev) => ({ ...prev, [rowId]: selectedProdId }));
                                  }}
                                />
                              </td>
                              <td>
                                <ProductSearchableSelect
                                  products={arr(masters.products).filter((x) => x.active)}
                                  selectedId={productId}
                                  disabledIds={disabledProductIds}
                                  onSelect={(selectedProdId) => {
                                    setBillRowProducts((prev) => ({ ...prev, [rowId]: selectedProdId }));
                                  }}
                                />
                              </td>
                              <td>
                                <input
                                  aria-label="Quantity in m"
                                  inputMode="decimal"
                                  value={quantity}
                                  onChange={(e) =>
                                    setQuantities((q) => ({
                                      ...q,
                                      [rowId]: e.target.value,
                                    }))
                                  }
                                  placeholder="0"
                                  style={{
                                    width: "100%",
                                    padding: "7px 10px",
                                    borderRadius: 8,
                                    border: "1px solid #d6d3d1",
                                    textAlign: "center",
                                    fontWeight: 600,
                                    fontSize: 13,
                                  }}
                                />
                              </td>
                              <td>
                                {p ? (
                                  <span className="uneditable-rate">
                                    {rupees(p.rate)}
                                    <small style={{ color: "#78716c", fontSize: 11 }}> / m</small>
                                  </span>
                                ) : (
                                  <span style={{ color: "#a8a29e", fontSize: 14 }}>—</span>
                                )}
                              </td>
                              <td className="money-cell" style={{ fontWeight: 600, fontSize: 13 }}>
                                <output aria-label="Amount">
                                  {quoted
                                    ? rupees(quoted.amount)
                                    : clientEstimatedAmount
                                      ? rupees(clientEstimatedAmount)
                                      : quantity && productId && quoteInput
                                        ? "…"
                                        : "₹0.00"}
                                </output>
                              </td>
                              <td style={{ textAlign: "center" }}>
                                <button
                                  type="button"
                                  aria-label="Remove item"
                                  disabled={billRowIds.length <= 1}
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
                                  style={{
                                    background: "none",
                                    border: "none",
                                    cursor: billRowIds.length <= 1 ? "not-allowed" : "pointer",
                                    color: billRowIds.length <= 1 ? "#d6d3d1" : "#a8a29e",
                                    padding: 4,
                                    borderRadius: 4,
                                    display: "inline-flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                  }}
                                  onMouseEnter={(e) => {
                                    if (billRowIds.length > 1) e.currentTarget.style.color = "#ef4444";
                                  }}
                                  onMouseLeave={(e) => {
                                    if (billRowIds.length > 1) e.currentTarget.style.color = "#a8a29e";
                                  }}
                                >
                                  <Trash2 size={16} />
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot>
                        <tr>
                          <td colSpan={7} style={{ padding: "8px 0" }}>
                            <Button
                              type="button"
                              className="secondary"
                              onClick={() => {
                                const newId = crypto.randomUUID();
                                setBillRowIds((prev) => [...prev, newId]);
                              }}
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 6,
                                fontSize: 13,
                                fontWeight: 600,
                                padding: "6px 14px",
                              }}
                            >
                              <Plus size={15} /> Add product line
                            </Button>
                          </td>
                        </tr>
                        <tr>
                          <td colSpan={3} style={{ fontWeight: 600 }}>Total</td>
                          <td style={{ fontWeight: 700, fontSize: 13 }}>
                            <output aria-label="Total quantity">
                              {totalQuantity != null ? totalQuantity : "—"}
                            </output>
                          </td>
                          <td></td>
                          <td className="money-cell" style={{ fontWeight: 700, fontSize: 14 }}>
                            <output aria-label="Bill total">
                              {currentQuote
                                ? rupees(currentQuote.total)
                                : clientEstimatedTotal
                                  ? rupees(clientEstimatedTotal)
                                  : "—"}
                            </output>
                          </td>
                          <td></td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                  {entryQuote.isError &&
                    quoteInput &&
                    debouncedQuote === quoteInput && (
                      <p className="bill-pricing-error" role="status">
                        {entryQuote.error.message}
                      </p>
                    )}
                  <div className="form-grid">
                    <Field label="Overall Bill Discount (₹) (Optional)">
                      <input
                        inputMode="decimal"
                        placeholder="0.00"
                        value={values.discount ?? ""}
                        onChange={(e) => set("discount", e.target.value)}
                      />
                    </Field>
                  </div>
                  <details className="bill-notes">
                    <summary>Note / paper reference (optional)</summary>
                    <div className="form-grid">
                      <Field label="Note">
                        <input
                          value={values.note ?? ""}
                          onChange={(e) => set("note", e.target.value)}
                        />
                      </Field>
                      <Field label="Paper reference (optional)">
                        <input
                          value={values.paperReference ?? ""}
                          onChange={(e) =>
                            set("paperReference", e.target.value)
                          }
                        />
                      </Field>
                    </div>
                  </details>
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={withPayments}
                      onChange={(e) => setWithPayments(e.target.checked)}
                    />{" "}
                    Also record money received with this entry
                  </label>
                  {withPayments && (
                    <div className="form-grid">
                      <Field label="Cash amount received (₹)">
                        <input
                          inputMode="decimal"
                          placeholder="0.00"
                          value={cashPay}
                          onChange={(e) => setCashPay(e.target.value)}
                        />
                      </Field>
                      <Field label="Online amount received (₹)">
                        <input
                          inputMode="decimal"
                          placeholder="0.00"
                          value={onlinePay}
                          onChange={(e) => setOnlinePay(e.target.value)}
                        />
                      </Field>
                      <Field label="Notes">
                        <input
                          placeholder="Payment remarks / reference (optional)"
                          value={bankRef}
                          onChange={(e) => setBankRef(e.target.value)}
                        />
                      </Field>
                    </div>
                  )}
                </>
              )}
              {name === "receiptBatch" && (
                <div className="form-grid">
                  <Field label="Cash amount actually received (₹)">
                    <input
                      inputMode="decimal"
                      value={cashPay}
                      onChange={(e) => setCashPay(e.target.value)}
                    />
                  </Field>
                  <Field label="Receiving cash account">
                    <select
                      value={cashId}
                      onChange={(e) => setCashId(e.target.value)}
                    >
                      <option value="">Choose…</option>
                      {arr(masters.accounts)
                        .filter((a) => a.type === "cash")
                        .map((a) => (
                          <option key={str(a.id)} value={str(a.id)}>
                            {str(a.name)}
                          </option>
                        ))}
                    </select>
                  </Field>
                  <Field label="Online claim amount (₹)">
                    <input
                      inputMode="decimal"
                      value={onlinePay}
                      onChange={(e) => setOnlinePay(e.target.value)}
                    />
                  </Field>
                  <Field label="Receiving bank">
                    <select
                      value={bankId}
                      onChange={(e) => setBankId(e.target.value)}
                    >
                      <option value="">Choose…</option>
                      {arr(masters.accounts)
                        .filter((a) => a.type === "bank")
                        .map((a) => (
                          <option key={str(a.id)} value={str(a.id)}>
                            {str(a.name)}
                          </option>
                        ))}
                    </select>
                  </Field>
                  <Field label="Online bank reference">
                    <input
                      value={bankRef}
                      onChange={(e) => setBankRef(e.target.value)}
                    />
                  </Field>
                </div>
              )}
              {name === "expense" && (
                <>
                  <h3>Actual payments · must add up to total</h3>
                  {legs.map((l, i) => (
                    <div className="split-row" key={i}>
                      <select
                        aria-label={"Expense account " + (i + 1)}
                        value={l.accountId}
                        onChange={(e) =>
                          setLegs(
                            legs.map((v, j) =>
                              j === i ? { ...v, accountId: e.target.value } : v,
                            ),
                          )
                        }
                      >
                        <option value="">Choose account</option>
                        {arr(masters.accounts).map((a) => (
                          <option key={str(a.id)} value={str(a.id)}>
                            {str(a.name)}
                          </option>
                        ))}
                      </select>
                      <input
                        aria-label={"Expense leg amount " + (i + 1)}
                        inputMode="decimal"
                        value={l.amount}
                        onChange={(e) =>
                          setLegs(
                            legs.map((v, j) =>
                              j === i ? { ...v, amount: e.target.value } : v,
                            ),
                          )
                        }
                      />
                      <Button
                        onClick={() => setLegs(legs.filter((_, j) => i !== j))}
                      >
                        Remove
                      </Button>
                    </div>
                  ))}
                  <Button
                    className="secondary"
                    onClick={() =>
                      setLegs([...legs, { accountId: "", amount: "" }])
                    }
                  >
                    Add payment leg
                  </Button>
                </>
              )}
              {name === "identify" && (
                <>
                  <h3>Assign the existing credit</h3>
                  {assignments.map((l, i) => (
                    <div className="split-row" key={i}>
                      <select
                        aria-label="Salesman assignment"
                        value={l.salesmanId}
                        onChange={(e) =>
                          setAssignments(
                            assignments.map((v, j) =>
                              j === i
                                ? { ...v, salesmanId: e.target.value }
                                : v,
                            ),
                          )
                        }
                      >
                        <option value="">Choose salesman</option>
                        {arr(masters.salesmen).map((a) => (
                          <option key={str(a.id)} value={str(a.id)}>
                            {str(a.name)}
                          </option>
                        ))}
                      </select>
                      <input
                        aria-label="Assignment amount"
                        value={l.amount}
                        onChange={(e) =>
                          setAssignments(
                            assignments.map((v, j) =>
                              j === i ? { ...v, amount: e.target.value } : v,
                            ),
                          )
                        }
                      />
                    </div>
                  ))}
                  <Button
                    onClick={() =>
                      setAssignments([
                        ...assignments,
                        { salesmanId: "", amount: "" },
                      ])
                    }
                  >
                    Add assignment
                  </Button>
                </>
              )}
              {name === "close" && arr(dashboard.exceptions).length > 0 && (
                <div className="notice">
                  There are {arr(dashboard.exceptions).length} unresolved prior
                  cash differences. Book balances carry forward unchanged.
                </div>
              )}
              {name === "close" &&
                arr(masters.accounts)
                  .filter((a) => a.type === "cash" && a.active)
                  .map((a) => (
                    <div className="close-count" key={str(a.id)}>
                      <h3>
                        {str(a.name)} · {str(a.holder)}
                      </h3>
                      <p>
                        Expected book cash:{" "}
                        {rupees(
                          arr(dashboard.accounts).find((x) => x.id === a.id)
                            ?.balance,
                        )}
                      </p>
                      <div className="form-grid">
                        <Field label="Cash physically counted (₹)">
                          <input
                            inputMode="decimal"
                            value={counts[str(a.id)] ?? ""}
                            onChange={(e) =>
                              setCounts({
                                ...counts,
                                [str(a.id)]: e.target.value,
                              })
                            }
                          />
                        </Field>
                        <Field label="Explanation for any difference">
                          <input
                            value={reasons[str(a.id)] ?? ""}
                            onChange={(e) =>
                              setReasons({
                                ...reasons,
                                [str(a.id)]: e.target.value,
                              })
                            }
                          />
                        </Field>
                      </div>
                    </div>
                  ))}
              {name === "reconcile" && (
                <section className="cash-help">
                  <h3>Match real bank statement entries</h3>
                  <Field label="Show app bank entries from">
                    <input
                      type="date"
                      value={values.matchFrom ?? date.slice(0, 7) + "-01"}
                      onChange={(e) => {
                        set("matchFrom", e.target.value);
                        setMatchOffset(0);
                      }}
                    />
                  </Field>
                  {bankMatches.isError ? (
                    <p className="error">{bankMatches.error.message}</p>
                  ) : (
                    arr(bankMatches.data?.entries).map((r) => (
                      <label className="checkbox" key={str(r.id)}>
                        <input
                          type="checkbox"
                          checked={(values.matches ?? "")
                            .split(",")
                            .includes(str(r.id))}
                          onChange={(e) => {
                            const ids = (values.matches ?? "")
                              .split(",")
                              .filter(Boolean);
                            set(
                              "matches",
                              (e.target.checked
                                ? [...ids, str(r.id)]
                                : ids.filter((id) => id !== r.id)
                              ).join(","),
                            );
                          }}
                        />
                        {str(r.date)} · {str(r.number)} · in {rupees(r.inflow)}{" "}
                        / out {rupees(r.outflow)}
                      </label>
                    ))
                  )}
                  <div className="pagination">
                    <Button
                      disabled={!matchOffset}
                      onClick={() =>
                        setMatchOffset(Math.max(0, matchOffset - 100))
                      }
                    >
                      Previous entries
                    </Button>
                    <Button
                      disabled={arr(bankMatches.data?.entries).length < 100}
                      onClick={() => setMatchOffset(matchOffset + 100)}
                    >
                      Next entries
                    </Button>
                  </div>
                  <p className="small muted">
                    Matching records a check against your statement. A
                    difference never creates a balancing expense.
                  </p>
                </section>
              )}
              {name === "reallocate" && (
                <section className="cash-help">
                  <h3>Preferred bills to settle first (optional)</h3>
                  <Field label="Find a bill by number or paper reference">
                    <input
                      value={sourceSearch}
                      onChange={(e) => setSourceSearch(e.target.value)}
                    />
                  </Field>
                  {(docs.data ?? [])
                    .filter(
                      (r) =>
                        r.kind === "bill" &&
                        r.salesman_id === values.salesmanId &&
                        !r.reversed,
                    )
                    .map((r) => (
                      <label className="checkbox" key={str(r.id)}>
                        <input
                          type="checkbox"
                          checked={(values.preferred ?? "")
                            .split(",")
                            .includes(str(r.id))}
                          onChange={(e) => {
                            const ids = (values.preferred ?? "")
                              .split(",")
                              .filter(Boolean);
                            set(
                              "preferred",
                              (e.target.checked
                                ? [...ids, str(r.id)]
                                : ids.filter((id) => id !== r.id)
                              ).join(","),
                            );
                          }}
                        />
                        {str(r.number)} · {rupees(r.amount)}
                      </label>
                    ))}
                  <p className="small muted">
                    Selection order sets the preference. Remaining credit still
                    settles other eligible dues oldest first; this does not move
                    money.
                  </p>
                </section>
              )}
            </form>
          ) : (
            <div className="review">
              <h3 className="section-marker">
                Review this {onlyRequest ? "request" : "transaction"}
              </h3>
              <Review
                value={
                  name === "bill"
                    ? Object.fromEntries(
                      Object.entries(payload as Row).filter(
                        ([key]) => key !== "lines",
                      ),
                    )
                    : payload
                }
                masters={masters}
                documents={[
                  ...(docs.data ?? []),
                  ...arr(bankMatches.data?.entries),
                ]}
              />
              {preview && (
                <Table
                  rows={arr(preview.lines).map((l) => ({
                    ...l,
                    name:
                      arr(masters.products).find((p) => p.id === l.productId)
                        ?.name ?? l.productId,
                    rateDisplay: rupees(l.effectiveRate),
                    discountDisplay: l.discountAmount && Number(l.discountAmount) > 0 ? rupees(l.discountAmount) : "—",
                  }))}
                  columns={[
                    ["name", "Product"],
                    ["quantity", "Quantity"],
                    ["rateDisplay", "Rate"],
                    ["discountDisplay", "Discount"],
                    ["amount", "Amount", true],
                  ]}
                />
              )}
              {preview && (
                <div className="review-balances">
                  {name === "bill" ? (
                    <>
                      {arr(preview.lines).length > 0 && (
                        <p>
                          Total quantity{" "}
                          <b>
                            {arr(preview.lines)
                              .reduce((acc, l) => acc.plus(D(str(l.quantity) || 0)), D(0))
                              .toFixed()}
                          </b>
                        </p>
                      )}
                      {preview.discount && Number(preview.discount) > 0 && (
                        <>
                          <p>
                            Items subtotal <b>{rupees(preview.subtotal ?? preview.total)}</b>
                          </p>
                          <p style={{ color: "#dc2626" }}>
                            Overall bill discount <b>-{rupees(preview.discount)}</b>
                          </p>
                        </>
                      )}
                      <p>
                        This bill total <b>{rupees(preview.total)}</b>
                      </p>
                    </>
                  ) : (
                    <>
                      <p>
                        Previous signed balance <b>{rupees(preview.previous)}</b>
                      </p>
                      <p>
                        This bill <b>{rupees(preview.total)}</b>
                      </p>
                      <p>
                        Confirmed payments now <b>{rupees(preview.confirmed)}</b>
                      </p>
                      <p>
                        Pending online claims <b>{rupees(preview.pending)}</b>
                      </p>
                      <p>
                        New signed balance <b>{rupees(preview.projected)}</b>
                      </p>
                    </>
                  )}
                </div>
              )}
              <p className="small muted">
                Posting date: {dateLabel(values.date)}. This app records
                transactions; it does not move bank money.
              </p>
            </div>
          )}
          {notice && (
            <p role="status" className="notice">
              {notice}
            </p>
          )}
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <div className="workflow-actions">
            {step === "entry" ? (
              <>
                <Button
                  className="secondary"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    setError("");
                    setNotice("");
                    try {
                      const r = await api("drafts", rowSchema, {
                        ...(draft?.id ? { id: draft.id, version: draft.version ?? 0 } : {}),
                        data: {
                          name,
                          values,
                          quantities,
                          lineEdits,
                          legs,
                          assignments,
                          counts,
                          reasons,
                          payment: {
                            withPayments,
                            cashPay,
                            onlinePay,
                            cashId,
                            bankId,
                            bankRef,
                          },
                        },
                      });
                      setDraft({ id: str(r.id), version: Number(r.version) });
                      setNotice("Draft saved. No financial posting.");
                    } catch (e) {
                      setError((e as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Save draft
                </Button>
                <Button className="primary" disabled={busy} onClick={save}>
                  {busy
                    ? "Checking…"
                    : "Review " + (onlyRequest ? "request" : "entry")}
                </Button>
              </>
            ) : (
              <>
                <Button
                  className="secondary"
                  disabled={busy}
                  onClick={() => {
                    setStep("entry");
                    setKey(crypto.randomUUID());
                  }}
                >
                  Back to entry
                </Button>
                <Button
                  className="primary"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    setError("");
                    try {
                      const r = onlyRequest
                        ? await api("requests", rowSchema, {
                          command: name,
                          payload,
                          reason:
                            values.reason ||
                            values.note ||
                            "Please review and approve this transaction",
                        })
                        : await api(
                          "commands/" + name,
                          commandResult,
                          payload,
                          "POST",
                          key,
                          draft
                            ? {
                              "x-draft-id": draft.id,
                              "x-draft-version": str(draft.version),
                            }
                            : {},
                        );
                      setResult(r);
                      setStep("saved");
                      await qc.invalidateQueries();
                    } catch (e) {
                      setError(
                        "Not confirmed as saved: " +
                        (e as Error).message +
                        ". Keep this page open and retry the same action.",
                      );
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {busy
                    ? "Waiting for server…"
                    : onlyRequest
                      ? "Send for owner review"
                      : "Confirm & save"}
                </Button>
              </>
            )}
          </div>
        </>
      )}
      {name === "bill" && (
        <div style={{ marginTop: 28 }}>
          <Documents onSelect={onSelect ?? (() => { })} kind="bill" />
        </div>
      )}
    </WorkflowPage>
  );
}
function Review({
  value,
  masters,
  documents,
}: {
  value: unknown;
  masters: Row;
  documents: Row[];
}) {
  const resolveValue = (k: string, v: unknown) => {
    if (
      (k === "date" || k.endsWith("Date")) &&
      /^\d{4}-\d{2}-\d{2}$/.test(str(v))
    )
      return dateLabel(v);
    if (["amount", "setoff", "counted", "statement", "creditLimit"].includes(k))
      return rupees(v);
    if (k.endsWith("Id") || /^[0-9a-f]{8}-[0-9a-f-]{27}$/.test(str(v))) {
      const r = [
        ...arr(masters.salesmen),
        ...arr(masters.accounts),
        ...arr(masters.products),
        ...documents,
      ].find((r) => r.id === v);
      return str(r?.name ?? r?.number ?? v);
    }
    return str(v);
  };
  return (
    <dl>
      {Object.entries(value as Row)
        .filter(
          ([k, v]) => k !== "expectedQuoteHash" && v !== "" && v !== false,
        )
        .map(([k, v]) => (
          <div key={k}>
            <dt>{k.replace(/([A-Z])/g, " $1")}</dt>
            <dd>
              {Array.isArray(v)
                ? v.map((x, i) => (
                  <div key={i}>
                    {typeof x === "object"
                      ? Object.entries(x)
                        .map(
                          ([key, val]) =>
                            `${key}: ${resolveValue(key, val)}`,
                        )
                        .join(" · ")
                      : resolveValue(k, x)}
                  </div>
                ))
                : resolveValue(k, v)}
            </dd>
          </div>
        ))}
    </dl>
  );
}
function VerificationPage({
  id,
  date,
  dashboard,
  onClose,
}: {
  id: string;
  date: string;
  dashboard?: Row;
  onClose: () => void;
}) {
  const qc = useQueryClient(),
    [notes, setNotes] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [key] = useState(crypto.randomUUID());

  const claim = arr(dashboard?.claims).find((c) => str(c.id) === id);

  return (
    <WorkflowPage title="Review online payment" onClose={onClose} busy={busy}>
      <div
        className="form-grid"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
          gap: "12px",
          marginBottom: 16,
        }}
      >
        <Field label="Salesman">
          <input
            readOnly
            value={str(claim?.salesman_name ?? "—")}
            style={{ background: "#f5f5f4" }}
          />
        </Field>
        <Field label="Date">
          <input
            readOnly
            value={claim?.actual_date ? dateLabel(claim.actual_date) : dateLabel(date)}
            style={{ background: "#f5f5f4" }}
          />
        </Field>
        <Field label="Amount">
          <input
            readOnly
            value={claim?.amount ? rupees(claim.amount) : "—"}
            style={{ background: "#f5f5f4", fontWeight: "bold" }}
          />
        </Field>
      </div>

      <Field label="Notes (Transaction ID, or rejection reason if rejecting)">
        <input
          placeholder="Enter transaction ID (optional) or rejection reason…"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </Field>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <div className="workflow-actions">
        <Button
          disabled={busy}
          onClick={async () => {
            if (!notes.trim()) {
              setError("Please provide a rejection reason in Notes.");
              return;
            }
            setBusy(true);
            setError("");
            try {
              await api(
                "commands/reject",
                commandResult,
                { claimId: id, reason: notes.trim() },
                "POST",
                key,
              );
              await qc.invalidateQueries();
              onClose();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          Reject payment
        </Button>
        <Button
          className="primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              const trimmed = notes.trim();
              await api(
                "commands/verify",
                commandResult,
                {
                  claimId: id,
                  date,
                  note: trimmed,
                  bankIdentity: trimmed || `VERIFIED-${id.slice(0, 8)}`,
                  evidence: trimmed
                    ? `Verified transaction ID: ${trimmed}`
                    : "Verified online payment",
                },
                "POST",
                key,
              );
              await qc.invalidateQueries();
              onClose();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          Approve payment
        </Button>
      </div>
    </WorkflowPage>
  );
}
function CustomerStatementPage({
  customerId,
  onClose,
  date,
  onSelectRecord,
  onNewBill,
  onReceiveMoney,
}: {
  customerId: string;
  onClose: () => void;
  date?: string;
  onSelectRecord?: (recordId: string) => void;
  onNewBill?: (customerId: string, salesmanId?: string) => void;
  onReceiveMoney?: (customerId: string, salesmanId?: string) => void;
}) {
  const [selectedDate, setSelectedDate] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [currentCustomerId] = useState(customerId);
  const [offset, setOffset] = useState(0);
  const pageSize = 15;

  // Query customer details & statement (full history, date filter applied on table level)
  const q = useQuery({
    queryKey: ["direct-customer-statement", currentCustomerId, "2000-01-01", date || ""],
    queryFn: () => {
      const params = new URLSearchParams();
      params.set("from", "2000-01-01");
      if (date) params.set("to", date);
      return api(`direct-cig/statement/${currentCustomerId}?${params.toString()}`);
    },
  });

  return (
    <WorkflowPage
      title="Customer Statement"
      onClose={onClose}
      actions={
        <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <Button
            className="primary"
            onClick={() =>
              onNewBill?.(
                currentCustomerId,
                str((q.data?.customer as Row)?.salesman_id),
              )
            }
            style={{
              padding: "6px 14px",
              minHeight: 36,
              fontSize: 13,
              fontWeight: 600,
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
            }}
            title="Create new bill for this customer"
          >
            <Plus size={15} strokeWidth={2.5} /> Bill
          </Button>
          <Button
            className="secondary"
            onClick={() =>
              onReceiveMoney?.(
                currentCustomerId,
                str((q.data?.customer as Row)?.salesman_id),
              )
            }
            style={{
              padding: "6px 14px",
              minHeight: 36,
              fontSize: 13,
              fontWeight: 600,
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
            }}
            title="Receive money from this customer"
          >
            <IndianRupee size={14} strokeWidth={2.5} /> Receive
          </Button>
        </div>
      }
    >
      {q.isLoading ? (
        <p style={{ padding: 16 }}>Loading customer statement…</p>
      ) : q.isError ? (
        <p className="error">{q.error.message}</p>
      ) : q.data ? (
        <div>
          {/* Customer Metadata Card */}
          <div
            style={{
              background: "#ffffff",
              border: "1px solid #e2e8f0",
              borderRadius: 12,
              padding: "18px 20px",
              marginBottom: 20,
              boxShadow: "0 1px 3px rgba(0, 0, 0, 0.03)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
              <div>
                <h2 style={{ margin: "0 0 6px", fontSize: 20, color: "#0f172a" }}>
                  {str((q.data.customer as Row)?.customer_name)}
                </h2>
                <div
                  style={{
                    display: "flex",
                    gap: 16,
                    flexWrap: "wrap",
                    fontSize: 13,
                    color: "#64748b",
                  }}
                >
                  <span>
                    Customer Code: <b style={{ fontFamily: "monospace" }}>{str((q.data.customer as Row)?.customer_id)}</b>
                  </span>
                  <span>
                    Beat / Area:{" "}
                    <b>
                      {str((q.data.customer as Row)?.beat_name)} (
                      {str((q.data.customer as Row)?.beat_code)})
                    </b>
                  </span>
                  <span>
                    Salesman Route:{" "}
                    <b>{str((q.data.customer as Row)?.salesman_name)}</b>
                  </span>
                </div>
              </div>

              {/* Net Real Dues pill */}
              <div style={{ textAlign: "right", background: "#f8fafc", padding: "8px 16px", borderRadius: 10, border: "1px solid #e2e8f0" }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase" }}>
                  Net Current Due
                </div>
                <div
                  style={{
                    fontSize: 22,
                    fontWeight: 700,
                    marginTop: 2,
                    color:
                      parseFloat(str(q.data.currentBalance || "0")) > 0
                        ? "#dc2626"
                        : "#16a34a",
                  }}
                >
                  {rupees(q.data.currentBalance)}
                </div>
              </div>
            </div>

            {/* Brought Forward Balance if any */}
            {Boolean(q.data.opening && q.data.opening !== "0.00") && (
              <div
                style={{
                  marginTop: 14,
                  paddingTop: 12,
                  borderTop: "1px solid #f1f5f9",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: 10,
                  fontSize: 13,
                  color: "#475569",
                }}
              >
                <span>
                  Brought Forward (Opening): <b>{rupees(q.data.opening ?? "0.00")}</b>
                </span>
              </div>
            )}
          </div>

          {/* Table Level Filters: Single Date & Word Search */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 14,
              flexWrap: "wrap",
              gap: 10,
              padding: "10px 14px",
              background: "#ffffff",
              border: "1px solid #e2e8f0",
              borderRadius: 10,
            }}
          >
            <div>
              <h3 style={{ margin: 0, fontSize: 16, color: "#0f172a" }}>Transaction History</h3>
              <p className="muted" style={{ margin: "2px 0 0", fontSize: 12 }}>
                {selectedDate ? `Filtered for ${dateLabel(selectedDate)}` : `All records up to ${dateLabel(date || new Date().toISOString().slice(0, 10))}`}
              </p>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              {/* Single Date Picker with Calendar icon & Clear X */}
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  background: selectedDate ? "#f0fdf4" : "#ffffff",
                  border: `1.5px solid ${selectedDate ? "#86efac" : "#cbd5e1"}`,
                  borderRadius: 10,
                  padding: "4px 10px 4px 12px",
                  minHeight: 38,
                  boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
                  transition: "all 0.15s ease",
                }}
              >
                <Calendar size={16} color={selectedDate ? "#16a34a" : "#64748b"} />
                <input
                  type="date"
                  aria-label="Filter customer statement by date"
                  value={selectedDate}
                  onChange={(e) => {
                    setSelectedDate(e.target.value);
                    setOffset(0);
                  }}
                  style={{
                    border: "none",
                    background: "transparent",
                    fontSize: 13,
                    fontWeight: selectedDate ? 600 : 400,
                    color: selectedDate ? "#15803d" : "#334155",
                    outline: "none",
                    cursor: "pointer",
                    padding: 0,
                  }}
                />
                {selectedDate && (
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedDate("");
                      setOffset(0);
                    }}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      background: "#fee2e2",
                      border: "none",
                      borderRadius: "50%",
                      width: 20,
                      height: 20,
                      color: "#dc2626",
                      cursor: "pointer",
                      padding: 0,
                      marginLeft: 4,
                    }}
                    title="Remove date filter"
                  >
                    <X size={13} strokeWidth={2.5} />
                  </button>
                )}
              </div>

              {/* Word Search Input */}
              <input
                type="search"
                aria-label="Search customer statement records"
                placeholder="Search record #, type, note…"
                value={searchTerm}
                onChange={(e) => {
                  setSearchTerm(e.target.value);
                  setOffset(0);
                }}
                className="direct-cig-search-input"
                style={{ width: 220, minHeight: 38 }}
              />
            </div>
          </div>

          {(() => {
            const rawEntries = arr(q.data.ledger)
              .map((row: Row) => ({
                ...row,
                displayType: str(row.kind).toUpperCase(),
              }))
              .slice()
              .reverse(); // latest first

            const allEntries = rawEntries.filter((row: Row) => {
              if (selectedDate && str(row.date) !== selectedDate) {
                return false;
              }
              if (searchTerm.trim()) {
                const term = searchTerm.trim().toLowerCase();
                const num = str(row.number).toLowerCase();
                const type = str(row.displayType).toLowerCase();
                const note = str(
                  row.note ||
                  (row.data as Row)?.note ||
                  (row.data as Row)?.notes ||
                  (row.data as Row)?.remarks ||
                  (row.data as Row)?.reference ||
                  ""
                ).toLowerCase();
                if (!num.includes(term) && !type.includes(term) && !note.includes(term)) {
                  return false;
                }
              }
              return true;
            });

            const pageEntries = allEntries.slice(offset, offset + pageSize);

            if (allEntries.length === 0) {
              return (
                <div style={{ padding: "30px 20px", textAlign: "center", background: "#f8fafc", borderRadius: 10, border: "1px dashed #cbd5e1" }}>
                  <p className="muted" style={{ margin: 0 }}>
                    {selectedDate || searchTerm
                      ? "No transactions match the selected filter."
                      : "No transactions recorded for this customer."}
                  </p>
                </div>
              );
            }

            return (
              <>
                <div className="table-scroll">
                  <Table
                    rows={pageEntries}
                    columns={[
                      ["number", "Record"],
                      ["date", "Date"],
                      ["displayType", "Type"],
                      ["note_icon", "Note"],
                      ["debit", "Bill (Due Increases)", true],
                      ["credit", "Paid / Return (Due Reduces)", true],
                      ["balance", "Balance", true],
                    ]}
                    cellRenderers={{
                      note_icon: (r) => {
                        const noteText = str(
                          r.note ||
                          (r.data as Row)?.note ||
                          (r.data as Row)?.notes ||
                          (r.data as Row)?.remarks ||
                          (r.data as Row)?.reference ||
                          (r.data as Row)?.reason ||
                          ""
                        );
                        if (!noteText) return <span style={{ color: "#cbd5e1" }}>—</span>;
                        return (
                          <span
                            title={noteText}
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              justifyContent: "center",
                              width: 24,
                              height: 24,
                              borderRadius: 4,
                              background: "#f1f5f9",
                              color: "#475569",
                              cursor: "pointer",
                              border: "1px solid #e2e8f0",
                              fontSize: 13,
                            }}
                          >
                            📝
                          </span>
                        );
                      },
                    }}
                    onRow={onSelectRecord ? (r) => onSelectRecord(str(r.id)) : undefined}
                  />
                </div>
                <div className="pagination" style={{ margin: "14px 0" }}>
                  <Button
                    disabled={!offset}
                    onClick={() => setOffset(Math.max(0, offset - pageSize))}
                  >
                    Previous
                  </Button>
                  <span>
                    Showing {allEntries.length ? offset + 1 : 0}–
                    {Math.min(offset + pageSize, allEntries.length)} of{" "}
                    {allEntries.length} entries (latest first)
                  </span>
                  <Button
                    disabled={offset + pageSize >= allEntries.length}
                    onClick={() => setOffset(offset + pageSize)}
                  >
                    Next
                  </Button>
                </div>
              </>
            );
          })()}

          <div style={{ marginTop: 16, display: "flex", gap: 10 }}>
            <Button className="secondary" onClick={() => window.print()}>
              <Printer size={16} /> Print Statement
            </Button>
          </div>
        </div>
      ) : null}
    </WorkflowPage>
  );
}

function StatementPage({
  id,
  onClose,
  date,
  onSelectRecord,
  onNewBill,
  onReceiveMoney,
}: {
  id: string;
  onClose: () => void;
  date: string;
  onSelectRecord?: (recordId: string) => void;
  onNewBill?: (salesmanId: string) => void;
  onReceiveMoney?: (salesmanId: string) => void;
}) {
  const [selectedDate, setSelectedDate] = useState(""),
    [searchTerm, setSearchTerm] = useState(""),
    [offset, setOffset] = useState(0);

  // Fetch full history as-of date (or filtered by selectedDate)
  const fromParam = selectedDate || "2000-01-01";
  const toParam = selectedDate || date;

  const q = useQuery({
    queryKey: ["statement", id, fromParam, toParam],
    queryFn: () => api(`statements/${id}?from=${fromParam}&to=${toParam}`),
  });

  return (
    <WorkflowPage
      title="Salesman statement"
      onClose={onClose}
      actions={
        <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <Button
            className="primary"
            onClick={() => onNewBill?.(id)}
            style={{
              padding: "6px 14px",
              minHeight: 36,
              fontSize: 13,
              fontWeight: 600,
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
            }}
            title="Create new bill for this salesman"
          >
            <Plus size={15} strokeWidth={2.5} /> Bill
          </Button>
          <Button
            className="secondary"
            onClick={() => onReceiveMoney?.(id)}
            style={{
              padding: "6px 14px",
              minHeight: 36,
              fontSize: 13,
              fontWeight: 600,
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
            }}
            title="Receive money from this salesman"
          >
            <IndianRupee size={14} strokeWidth={2.5} /> Receive
          </Button>
        </div>
      }
    >
      {/* Modern Filter Header with Single Date Pill & Word Search */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 12,
          padding: "14px 16px",
          background: "#ffffff",
          border: "1px solid #e2e8f0",
          borderRadius: 12,
          marginBottom: 16,
          boxShadow: "0 1px 3px rgba(0,0,0,0.03)",
        }}
      >
        <div>
          <h3 style={{ margin: 0, fontSize: 17, color: "#0f172a" }}>
            {str((q.data?.salesman as Row)?.name || "Salesman History")}
          </h3>
          <p className="muted" style={{ margin: "2px 0 0", fontSize: 12 }}>
            Passbook entries · {selectedDate ? `Filtered for ${dateLabel(selectedDate)}` : `All transactions up to ${dateLabel(date)}`}
          </p>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          {/* Enhanced Single Date Picker */}
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              background: selectedDate ? "#f0fdf4" : "#ffffff",
              border: `1.5px solid ${selectedDate ? "#86efac" : "#cbd5e1"}`,
              borderRadius: 10,
              padding: "4px 10px 4px 12px",
              minHeight: 40,
              boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
              transition: "all 0.15s ease",
            }}
          >
            <Calendar size={16} color={selectedDate ? "#16a34a" : "#64748b"} />
            <input
              type="date"
              aria-label="Filter statement by date"
              value={selectedDate}
              onChange={(e) => {
                setSelectedDate(e.target.value);
                setOffset(0);
              }}
              style={{
                border: "none",
                background: "transparent",
                fontSize: 13,
                fontWeight: selectedDate ? 600 : 400,
                color: selectedDate ? "#15803d" : "#334155",
                outline: "none",
                cursor: "pointer",
                padding: 0,
              }}
            />
            {selectedDate && (
              <button
                type="button"
                onClick={() => {
                  setSelectedDate("");
                  setOffset(0);
                }}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: "#fee2e2",
                  border: "none",
                  borderRadius: "50%",
                  width: 20,
                  height: 20,
                  color: "#dc2626",
                  cursor: "pointer",
                  padding: 0,
                  marginLeft: 4,
                  transition: "background 0.12s ease",
                }}
                title="Remove date filter"
                onMouseEnter={(e) => (e.currentTarget.style.background = "#fecaca")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "#fee2e2")}
              >
                <X size={13} strokeWidth={2.5} />
              </button>
            )}
          </div>

          {/* Word / Text search input */}
          <input
            type="search"
            aria-label="Search statement records"
            placeholder="Search record #, type, note…"
            value={searchTerm}
            onChange={(e) => {
              setSearchTerm(e.target.value);
              setOffset(0);
            }}
            className="direct-cig-search-input"
            style={{ width: 240, minHeight: 40 }}
          />
        </div>
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
              Ending signed balance <b>{rupees(q.data.ending)}</b>
            </p>
          </div>
          {(() => {
            const rawEntries = arr(q.data.entries)
              .map((e) => {
                const method = (e.data as Row | undefined)?.method;
                let displayType = str(e.kind);
                if (e.kind === "receipt") {
                  displayType =
                    method === "cash"
                      ? "receipt-cash"
                      : method === "online"
                        ? "receipt-online"
                        : "receipt";
                }
                return {
                  ...e,
                  displayType,
                  searchIndex: (
                    str(e.number) +
                    " " +
                    str(e.kind) +
                    " " +
                    displayType +
                    " " +
                    str(e.date) +
                    " " +
                    str((e.data as Row)?.note || "") +
                    " " +
                    str((e.data as Row)?.notes || "") +
                    " " +
                    str((e.data as Row)?.remarks || "") +
                    " " +
                    str((e.data as Row)?.reason || "") +
                    " " +
                    str((e.data as Row)?.reference || "")
                  ).toLowerCase(),
                };
              })
              .slice()
              .reverse(); // Latest required first

            const sTerm = searchTerm.trim().toLowerCase();
            const allEntries = sTerm
              ? rawEntries.filter((e) => e.searchIndex.includes(sTerm))
              : rawEntries;

            const pageSize = 15;
            const pageEntries = allEntries.slice(offset, offset + pageSize);

            if (allEntries.length === 0) {
              return (
                <div style={{ padding: 24, textAlign: "center", color: "#64748b" }}>
                  <p>No transactions match your search filter.</p>
                </div>
              );
            }

            return (
              <>
                <Table
                  rows={pageEntries}
                  columns={[
                    ["number", "Record"],
                    ["date", "Date"],
                    ["displayType", "Type"],
                    ["note_icon", "Note"],
                    ["debit", "Increases due", true],
                    ["credit", "Reduces due", true],
                    ["balance", "Balance", true],
                  ]}
                  cellRenderers={{
                    note_icon: (r) => {
                      const noteText = str(
                        (r.data as Row)?.note ||
                        (r.data as Row)?.notes ||
                        (r.data as Row)?.remarks ||
                        (r.data as Row)?.reference ||
                        (r.data as Row)?.reason ||
                        r.note ||
                        ""
                      );
                      if (!noteText) return <span style={{ color: "#cbd5e1" }}>—</span>;
                      return (
                        <span
                          title={noteText}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            width: 24,
                            height: 24,
                            borderRadius: 4,
                            background: "#f1f5f9",
                            color: "#475569",
                            cursor: "pointer",
                            border: "1px solid #e2e8f0",
                            fontSize: 13,
                          }}
                        >
                          📝
                        </span>
                      );
                    },
                  }}
                  onRow={onSelectRecord ? (r) => onSelectRecord(str(r.id)) : undefined}
                />
                <div className="pagination" style={{ margin: "14px 0" }}>
                  <Button
                    disabled={!offset}
                    onClick={() => setOffset(Math.max(0, offset - pageSize))}
                  >
                    Previous
                  </Button>
                  <span>
                    Showing {allEntries.length ? offset + 1 : 0}–
                    {Math.min(offset + pageSize, allEntries.length)} of{" "}
                    {allEntries.length} entries (latest first)
                  </span>
                  <Button
                    disabled={offset + pageSize >= allEntries.length}
                    onClick={() => setOffset(offset + pageSize)}
                  >
                    Next
                  </Button>
                </div>
              </>
            );
          })()}
          <h3>Unconfirmed claims (no balance effect)</h3>
          <Table
            rows={arr(q.data.pending)}
            columns={[
              ["actual_date", "Reported date"],
              ["state", "Status"],
              ["amount", "Amount", true],
            ]}
          />
          <Button className="secondary" onClick={() => window.print()}>
            Print statement
          </Button>
        </>
      ) : (
        <p>Loading…</p>
      )}
    </WorkflowPage>
  );
}
// ─── Root Mount with URL routing for Public View Links ──────────────────────
const urlParams = new URLSearchParams(window.location.search);
const publicViewDocId = urlParams.get("view");
const publicViewToken = urlParams.get("token");

if (publicViewDocId && publicViewToken) {
  createRoot(document.getElementById("root")!).render(
    <PublicDocumentView docId={publicViewDocId} token={publicViewToken} />
  );
} else {
  createRoot(document.getElementById("root")!).render(
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>,
  );
}
