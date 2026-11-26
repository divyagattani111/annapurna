import React, { useState, useRef, useEffect, useId } from "react";
import { createPortal } from "react-dom";
import { FileText, BookOpen } from "lucide-react";
import { type Row, str, rupees, formatDateTime, dateLabel, timeOnlyLabel } from "../utils/helpers";

export function Button({
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" {...props}>
      {children}
    </button>
  );
}

export function selectKeys(e: React.KeyboardEvent<HTMLLabelElement>) {
  const select = e.target;
  if (
    !(select instanceof HTMLSelectElement) ||
    !["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)
  )
    return;
  e.preventDefault();
  const options = Array.from(select.options).filter((o) => !o.disabled);
  const current = options.findIndex((o) => o.value === select.value);
  const index =
    e.key === "Home"
      ? 0
      : e.key === "End"
        ? options.length - 1
        : Math.max(
          0,
          Math.min(
            options.length - 1,
            current + (e.key === "ArrowDown" ? 1 : -1),
          ),
        );
  const option = options[index];
  if (option) {
    select.value = option.value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }
}

export function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="field" onKeyDown={selectKeys}>
      <span>{label}</span>
      {children}
    </label>
  );
}

export function Empty({ text = "No records yet." }) {
  return (
    <div className="empty">
      <BookOpen size={28} />
      <p>{text}</p>
    </div>
  );
}

export function Table({
  rows,
  columns,
  onRow,
  cellRenderers,
  footer,
}: {
  rows: Row[];
  columns: [string, string, boolean?][];
  onRow?: (r: Row) => void;
  cellRenderers?: Record<string, (r: Row) => React.ReactNode>;
  footer?: React.ReactNode;
}) {
  return rows.length ? (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            {columns.map(([key, label, isMoney]) => (
              <th className={isMoney ? "money-cell" : ""} key={key}>
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={str(r.id) || i}>
              {columns.map(([key, , money]) => (
                <td className={money ? "money-cell" : ""} key={key}>
                  {cellRenderers && cellRenderers[key] ? (
                    cellRenderers[key](r)
                  ) : key === columns[0][0] && onRow ? (
                    <button className="text-link" onClick={() => onRow(r)}>
                      {str(r[key])}
                    </button>
                  ) : money ? (
                    rupees(r[key])
                  ) : key === "created_at" ? (
                    formatDateTime(r[key])
                  ) : (key === "date" || key === "business_date") && r.created_at ? (
                    <div style={{ display: "flex", flexDirection: "column" }}>
                      <span>{/^\d{4}-\d{2}-\d{2}$/.test(str(r[key])) ? dateLabel(r[key]) : str(r[key])}</span>
                      <span style={{ fontSize: 11, color: "#94a3b8" }}>
                        {timeOnlyLabel(r.created_at)}
                      </span>
                    </div>
                  ) : (
                    str(r[key])
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {footer && <tfoot>{footer}</tfoot>}
      </table>
    </div>
  ) : (
    <Empty />
  );
}


export function NoteTooltip({ text }: { text: string }) {
  const [coords, setCoords] = useState<{ top: number; left: number; placeBelow: boolean } | null>(null);
  const [isPinned, setIsPinned] = useState(false);

  const cleanText = (text || "").trim();
  if (!cleanText) return <span style={{ color: "#cbd5e1" }}>—</span>;

  const updateCoords = (el: HTMLElement) => {
    const rect = el.getBoundingClientRect();
    const placeBelow = rect.top < 130;
    setCoords({
      top: placeBelow ? rect.bottom + 8 : rect.top - 8,
      left: Math.max(160, Math.min(window.innerWidth - 160, rect.left + rect.width / 2)),
      placeBelow,
    });
  };

  const handleMouseEnter = (e: React.MouseEvent<HTMLElement>) => {
    updateCoords(e.currentTarget);
  };

  const handleMouseLeave = () => {
    if (!isPinned) setCoords(null);
  };

  const handleClick = (e: React.MouseEvent<HTMLElement>) => {
    e.stopPropagation();
    if (isPinned) {
      setIsPinned(false);
      setCoords(null);
    } else {
      updateCoords(e.currentTarget);
      setIsPinned(true);
    }
  };

  return (
    <div style={{ display: "inline-flex", justifyContent: "center", alignItems: "center" }}>
      <button
        type="button"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onClick={handleClick}
        aria-label="View transaction note"
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 26,
          height: 26,
          borderRadius: 6,
          background: coords ? "#e2e8f0" : "#f1f5f9",
          color: "#334155",
          cursor: "pointer",
          border: coords ? "1px solid #94a3b8" : "1px solid #e2e8f0",
          fontSize: 14,
          padding: 0,
          outline: "none",
          transition: "all 0.12s ease",
        }}
        title={cleanText}
      >
        📝
      </button>

      {coords && (
        <div
          role="tooltip"
          onClick={(e) => e.stopPropagation()}
          onMouseEnter={() => {
            // Keep open if mouse enters the tooltip
          }}
          onMouseLeave={() => {
            if (!isPinned) setCoords(null);
          }}
          style={{
            position: "fixed",
            top: coords.top,
            left: coords.left,
            transform: coords.placeBelow ? "translate(-50%, 0)" : "translate(-50%, -100%)",
            background: "#0f172a",
            color: "#f8fafc",
            padding: "8px 12px",
            borderRadius: 8,
            fontSize: 12,
            lineHeight: 1.45,
            minWidth: 160,
            maxWidth: 320,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            textAlign: "left",
            boxShadow: "0 10px 25px -5px rgba(0,0,0,0.4), 0 8px 10px -6px rgba(0,0,0,0.4)",
            zIndex: 999999,
            pointerEvents: "auto",
          }}
        >
          <div
            style={{
              fontWeight: 700,
              fontSize: 10,
              color: "#94a3b8",
              textTransform: "uppercase",
              letterSpacing: "0.5px",
              marginBottom: 4,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 8,
            }}
          >
            <span>Note / Remarks</span>
            {isPinned && (
              <span
                style={{ cursor: "pointer", fontSize: 13, color: "#cbd5e1", lineHeight: 1 }}
                onClick={() => {
                  setIsPinned(false);
                  setCoords(null);
                }}
              >
                ✕
              </span>
            )}
          </div>
          <div style={{ color: "#ffffff", fontWeight: 450 }}>{cleanText}</div>
          <div
            style={{
              position: "absolute",
              ...(coords.placeBelow
                ? {
                  bottom: "100%",
                  left: "50%",
                  transform: "translateX(-50%)",
                  borderLeft: "6px solid transparent",
                  borderRight: "6px solid transparent",
                  borderBottom: "6px solid #0f172a",
                }
                : {
                  top: "100%",
                  left: "50%",
                  transform: "translateX(-50%)",
                  borderLeft: "6px solid transparent",
                  borderRight: "6px solid transparent",
                  borderTop: "6px solid #0f172a",
                }),
              width: 0,
              height: 0,
            }}
          />
        </div>
      )}
    </div>
  );
}


export function DocLink({
  id,
  number,
  onSelect,
  style,
  className,
}: {
  id?: string | null;
  number: string;
  onSelect?: (id: string) => void;
  style?: React.CSSProperties;
  className?: string;
}) {
  if (!id || !onSelect) {
    return <span style={style} className={className}>{number}</span>;
  }
  return (
    <button
      type="button"
      className={`text-link ${className || ""}`}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(id);
      }}
      style={{
        fontWeight: 600,
        color: "#2563eb",
        background: "none",
        border: "none",
        padding: 0,
        cursor: "pointer",
        textDecoration: "underline",
        fontFamily: "inherit",
        fontSize: "inherit",
        textAlign: "left",
        ...style,
      }}
      title={`Open ${number}`}
    >
      {number}
    </button>
  );
}

export function Metric({
  label,
  value,
  caption,
  accent = false,
  icon: Icon,
  tone,
  onClick,
  isCurrency = true,
}: {
  label: string;
  value: unknown;
  caption: string;
  accent?: boolean;
  icon?: typeof FileText;
  tone?: "bills" | "cash" | "online" | "expense";
  onClick?: () => void;
  isCurrency?: boolean;
}) {
  return (
    <div
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={
        onClick
          ? (e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onClick();
            }
          }
          : undefined
      }
      style={onClick ? { cursor: "pointer" } : undefined}
      className={[
        "metric",
        accent ? "accent" : "",
        tone ? "metric-" + tone : "",
        onClick ? "metric-interactive" : "",
      ].join(" ")}
    >
      <div className="metric-label">
        {label}
        {Icon && <Icon size={20} aria-hidden="true" />}
      </div>
      <strong>{isCurrency ? rupees(value) : String(value ?? 0)}</strong>
      <small>{caption}</small>
    </div>
  );
}

