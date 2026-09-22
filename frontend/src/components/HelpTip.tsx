import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type Props = { text: string };

export default function HelpTip({ text }: Props) {
  const iconRef = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!open || !iconRef.current) return;
    const rect = iconRef.current.getBoundingClientRect();
    setPos({ top: rect.top - 6, left: rect.left + rect.width / 2 });
  }, [open]);

  return (
    <span
      className="helptip"
      aria-label={text}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <span ref={iconRef} className="helptip-icon">ⓘ</span>
      {open && pos && createPortal(
        <span
          className="helptip-bubble"
          role="tooltip"
          style={{ top: pos.top, left: pos.left, transform: "translate(-50%, -100%)" }}
        >
          {text}
        </span>,
        document.body
      )}
    </span>
  );
}
