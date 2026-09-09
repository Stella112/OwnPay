"use client";

import QRCode from "qrcode";
import { useEffect, useMemo, useState } from "react";
import { buildOwnPayLink, ownPayFileName, type OwnPayLinkMode } from "@/lib/ownpay-links";
import { OwnPayIcon } from "@/components/OwnPayIcon";

type LinkProps = { recipient: string; displayName: string; mode?: OwnPayLinkMode };

function createQrDataUrl(link: string): string {
  const qr = QRCode.create(link, { errorCorrectionLevel: "M" });
  const moduleSize = qr.modules.size;
  const margin = 4;
  const viewSize = moduleSize + margin * 2;
  let path = "";
  for (let row = 0; row < moduleSize; row += 1) {
    for (let column = 0; column < moduleSize; column += 1) {
      if (qr.modules.data[row * moduleSize + column]) {
        path += `M${column + margin} ${row + margin}h1v1h-1z`;
      }
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${viewSize} ${viewSize}" shape-rendering="crispEdges"><path fill="#FFFDF8" d="M0 0h${viewSize}v${viewSize}H0z"/><path fill="#6B352A" d="${path}"/></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export function OwnPayLinkTools({ recipient, displayName, mode }: LinkProps) {
  const link = useMemo(() => buildOwnPayLink(recipient, mode), [recipient, mode]);
  const qrDataUrl = useMemo(() => {
    try { return createQrDataUrl(link); } catch { return undefined; }
  }, [link]);
  const [qrError, setQrError] = useState<string>();
  const [copied, setCopied] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

  useEffect(() => {
    if (!modalOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setModalOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [modalOpen]);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2200);
    } catch {
      setQrError("Couldn’t copy automatically. Select the link and copy it manually.");
    }
  }

  async function shareLink() {
    if (navigator.share) {
      try {
        await navigator.share({ title: "OwnPay", text: "Send me ownership with OwnPay.", url: link });
        return;
      } catch (error) {
        if ((error as { name?: string }).name === "AbortError") return;
      }
    }
    await copyLink();
  }

  async function downloadQr() {
    if (!qrDataUrl) {
      setQrError("QR is still preparing. Try again in a moment.");
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = 900;
    canvas.height = 1080;
    const context = canvas.getContext("2d");
    if (!context) {
      setQrError("This browser could not create a downloadable QR.");
      return;
    }

    context.fillStyle = "#fffaf2";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#6B352A";
    context.fillRect(0, 0, canvas.width, 18);
    context.fillStyle = "#261713";
    context.font = "700 28px Arial";
    context.fillText("OwnPay", 70, 88);
    context.fillStyle = "#6c5650";
    context.font = "500 18px Arial";
    context.fillText("One link to receive ownership.", 70, 122);
    context.fillStyle = "#6B352A";
    context.font = "700 34px Arial";
    context.fillText(`Send ownership to ${displayName}`, 70, 190);

    const qrImage = new Image();
    await new Promise<void>((resolve) => {
      qrImage.onload = () => resolve();
      qrImage.onerror = () => resolve();
      qrImage.src = qrDataUrl;
    });
    context.drawImage(qrImage, 170, 235, 560, 560);
    context.fillStyle = "#6c5650";
    context.font = "500 16px Arial";
    context.fillText(link, 70, 855, 760);
    context.fillStyle = "#6B352A";
    context.font = "700 20px Arial";
    context.fillText("Scan to send ownership", 70, 930);
    context.fillStyle = "#9b8a82";
    context.font = "500 16px Arial";
    context.fillText("Pay. Gift. Tip. Own.", 70, 980);

    const anchor = document.createElement("a");
    anchor.download = ownPayFileName(recipient, mode);
    anchor.href = canvas.toDataURL("image/png");
    anchor.click();
  }

  return (
    <>
      <div className="link-tools">
        <div className="link-tools-url" title={link}>{link}</div>
        <div className="link-tools-buttons">
          <button type="button" className="btn btn-primary" onClick={copyLink}><OwnPayIcon name="check" size={16} /> {copied ? "Link copied" : "Copy Link"}</button>
          <button type="button" className="btn btn-ghost" onClick={shareLink}><OwnPayIcon name="send" size={16} /> Share Link</button>
          <button type="button" className="btn btn-butter" onClick={() => setModalOpen(true)}><OwnPayIcon name="spark" size={16} /> Show QR</button>
          <button type="button" className="btn btn-ghost" onClick={downloadQr} disabled={!qrDataUrl}><OwnPayIcon name="claim" size={16} /> Download QR</button>
        </div>
        {qrError && <p className="field-error" role="alert">{qrError}</p>}
      </div>
      {modalOpen && <OwnPayQrModal displayName={displayName} link={link} qrDataUrl={qrDataUrl} onClose={() => setModalOpen(false)} onCopy={copyLink} onShare={shareLink} onDownload={downloadQr} copied={copied} />}
    </>
  );
}

export function OwnPayQrPreview({ recipient, mode }: { recipient: string; mode?: OwnPayLinkMode }) {
  const link = useMemo(() => buildOwnPayLink(recipient, mode), [recipient, mode]);
  const dataUrl = useMemo(() => {
    try { return createQrDataUrl(link); } catch { return undefined; }
  }, [link]);
  return dataUrl ? <img className="qr-preview" src={dataUrl} alt="QR code for this OwnPay Link" /> : <div className="qr-preview-loading" role="status">Preparing QR…</div>;
}

export function OwnPayLinkCard({ recipient, displayName }: { recipient: string; displayName: string }) {
  return (
    <section className="own-link-card" aria-labelledby="own-link-title">
      <div className="own-link-copy"><span className="eyebrow">Your receiving link</span><h2 id="own-link-title">Your OwnPay Link</h2><p>Share this link to receive stock payments, gifts, and tips.</p><div className="own-link-recipient"><span className="identity-avatar"><OwnPayIcon name="wallet" size={18} /></span><span><strong>{displayName}</strong><small>Recipient address verified locally</small></span></div></div>
      <div className="own-link-qr"><OwnPayQrPreview recipient={recipient} /><span>Link. Scan. Pay. Own.</span></div>
      <OwnPayLinkTools recipient={recipient} displayName={displayName} />
    </section>
  );
}

function OwnPayQrModal({ displayName, link, qrDataUrl, onClose, onCopy, onShare, onDownload, copied }: { displayName: string; link: string; qrDataUrl?: string; onClose: () => void; onCopy: () => void; onShare: () => void; onDownload: () => void; copied: boolean }) {
  return (
    <div className="qr-modal-backdrop" role="presentation" onClick={onClose}>
      <div className="qr-modal" role="dialog" aria-modal="true" aria-labelledby="qr-modal-title" onClick={(event) => event.stopPropagation()}>
        <button type="button" className="qr-modal-close" aria-label="Close QR dialog" onClick={onClose}><OwnPayIcon name="close" size={19} /></button>
        <span className="eyebrow">OwnPay Link</span>
        <h2 id="qr-modal-title">Send ownership to {displayName}</h2>
        <p>Link. Scan. Pay. Own.</p>
        <div className="qr-modal-code">{qrDataUrl ? <img src={qrDataUrl} alt={`QR code linking to ${link}`} /> : <span role="status">Preparing QR…</span>}</div>
        <div className="qr-modal-link">{link}</div>
        <div className="qr-modal-actions"><button type="button" className="btn btn-primary" onClick={onCopy}>{copied ? "Link copied" : "Copy Link"}</button><button type="button" className="btn btn-butter" onClick={onShare}>Share</button><button type="button" className="btn btn-ghost" onClick={onDownload}>Download QR</button></div>
      </div>
    </div>
  );
}
