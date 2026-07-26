import React from "react";

type Props = { text: string };

export default function HelpTip({ text }: Props) {
  return (
    <span className="helptip" aria-label={text}>
      <span className="helptip-icon">ⓘ</span>
      <span className="helptip-bubble" role="tooltip">{text}</span>
    </span>
  );
}
