import { create } from "qrcode";

function qrSvg(value: string): string {
  const { modules } = create(value, { errorCorrectionLevel: "L" });
  const { size } = modules;
  let path = "";
  for (let row = 0; row < size; row += 1) {
    let col = 0;
    while (col < size) {
      let run = 0;
      while (col + run < size && modules.get(row, col + run)) {
        run += 1;
      }
      if (run > 0) {
        path += `M${col} ${row}h${run}v1h-${run}z`;
      }
      col += run + 1;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"><path d="${path}"/></svg>`;
}

export function QrCode({
  value,
  className,
}: {
  value: string;
  className?: string;
}) {
  return (
    <img
      alt="QR code"
      className={className}
      draggable={false}
      src={`data:image/svg+xml,${encodeURIComponent(qrSvg(value))}`}
    />
  );
}
