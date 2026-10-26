"use client";

import { Check, Copy } from "lucide-react";
import Link from "next/link";
import { QRCodeSVG } from "qrcode.react";
import { useState } from "react";

import styles from "./login.module.css";
import { useI18n } from "@/components/LocaleProvider";

export function AuthenticatorSetup({ secret, uri }: { secret: string; uri: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);

  const copyKey = async () => {
    setCopyError(false);
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
    } catch {
      setCopyError(true);
    }
  };

  return (
    <div className={styles.setupCard}>
      <p className={styles.scanLabel}>{t("auth.scan")}</p>
      <div className={styles.qrFrame}>
        <QRCodeSVG
          value={uri}
          size={212}
          marginSize={4}
          level="M"
          fgColor="#171717"
          bgColor="#ffffff"
          title={t("auth.qrTitle")}
          role="img"
          aria-label={t("auth.qrLabel")}
        />
      </div>
      <p className={styles.scanHint}>{t("auth.scanHint")}</p>
      <details className={styles.manualSetup}>
        <summary>{t("auth.manualSetup")}</summary>
        <div className={styles.keyRow}>
          <code>{secret.replace(/(.{4})/g, "$1 ").trim()}</code>
          <button
            type="button"
            className={styles.copyKey}
            onClick={copyKey}
            aria-label={copied ? t("auth.copiedLabel") : t("auth.copyLabel")}
          >
            {copied ? (
              <Check size={18} aria-hidden="true" />
            ) : (
              <Copy size={18} aria-hidden="true" />
            )}
          </button>
        </div>
        <p className={styles.copyStatus} role="status">
          {copyError ? t("auth.copyError") : copied ? t("auth.copied") : ""}
        </p>
        <Link href={uri}>{t("auth.openAuthenticator")}</Link>
      </details>
    </div>
  );
}
