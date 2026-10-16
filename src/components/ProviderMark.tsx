import { useRef } from "react";
import codexLogo from "../../codex.svg";

export function ProviderMark() {
  const turns = useRef(0);

  const handleMouseDown = (event: React.MouseEvent) => {
    event.stopPropagation();
    turns.current += 1;
    (event.currentTarget as HTMLDivElement).style.transform = `rotate(${turns.current * 360}deg)`;
  };

  return (
    <div className="provider-mark" aria-label="Codex" onMouseDown={handleMouseDown}>
      <img src={codexLogo} alt="" />
    </div>
  );
}
