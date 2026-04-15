import { useEffect, useRef, useState, type CSSProperties } from 'react';

interface MultiSelectProps {
  label: string;
  options: string[];
  selected: string[];
  onChange: (next: string[]) => void;
  width?: number;
  formatOption?: (value: string) => string;
}

const triggerStyle: CSSProperties = {
  padding: '8px 12px',
  borderRadius: 8,
  border: '1px solid #ddd',
  background: '#fff',
  fontSize: 14,
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  whiteSpace: 'nowrap',
};

const panelStyle: CSSProperties = {
  position: 'absolute',
  top: 'calc(100% + 4px)',
  left: 0,
  zIndex: 50,
  background: '#fff',
  border: '1px solid #ddd',
  borderRadius: 8,
  boxShadow: '0 4px 14px rgba(0,0,0,0.08)',
  padding: 8,
  minWidth: 180,
  maxHeight: 280,
  overflowY: 'auto',
};

export default function MultiSelect({
  label,
  options,
  selected,
  onChange,
  width,
  formatOption,
}: MultiSelectProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const toggle = (value: string) => {
    if (selected.includes(value)) onChange(selected.filter((v) => v !== value));
    else onChange([...selected, value]);
  };

  const summary =
    selected.length === 0
      ? `All ${label}`
      : selected.length === 1
      ? (formatOption ? formatOption(selected[0]) : selected[0])
      : `${label} (${selected.length})`;

  return (
    <div ref={ref} style={{ position: 'relative', width }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{ ...triggerStyle, width: width ? '100%' : undefined }}
      >
        <span style={{ flex: 1, textAlign: 'left' }}>{summary}</span>
        <span style={{ color: '#999', fontSize: 11 }}>▾</span>
      </button>
      {open && (
        <div style={panelStyle}>
          {selected.length > 0 && (
            <button
              type="button"
              onClick={() => onChange([])}
              style={{
                background: 'none',
                border: 'none',
                color: '#2563eb',
                fontSize: 12,
                cursor: 'pointer',
                padding: '4px 6px',
                marginBottom: 4,
              }}
            >
              Clear selection
            </button>
          )}
          {options.length === 0 ? (
            <div style={{ padding: 8, color: '#999', fontSize: 13 }}>No options</div>
          ) : (
            options.map((opt) => (
              <label
                key={opt}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '6px 8px',
                  fontSize: 14,
                  cursor: 'pointer',
                  borderRadius: 4,
                }}
                onMouseDown={(e) => e.preventDefault()}
              >
                <input
                  type="checkbox"
                  checked={selected.includes(opt)}
                  onChange={() => toggle(opt)}
                />
                <span>{formatOption ? formatOption(opt) : opt}</span>
              </label>
            ))
          )}
        </div>
      )}
    </div>
  );
}
