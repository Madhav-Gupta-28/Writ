import { useRef, useState } from "react";
import { bytesToHex, type Hex } from "viem";
import type { Network } from "./config";
import {
  KeyCardError, checkPassword, decryptKeyCard, downloadKeyCard, encryptKeyCard, keyCardFileName, parseKeyCardFile,
  readFileText, type KeyCard, type KeyCardFile,
} from "./lib/keycard";
import { generateKeyCard } from "./lib/signer";
import { Field, Spinner } from "./ui";

const errText = (e: unknown) => (e instanceof KeyCardError ? e.message : `Something went wrong: ${(e as Error)?.message ?? e}`);

/**
 * Generate a key card, encrypt it, make the user download it, and refuse to
 * continue until they prove they have the file by unlocking it (§7.1 step 3).
 */
export function KeyCardCreator({ net, onReady, intro }: { net: Network; onReady: (card: KeyCard) => void; intro?: string }) {
  const [card, setCard] = useState<KeyCard | null>(null);
  const [file, setFile] = useState<KeyCardFile | null>(null);
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [verifyPw, setVerifyPw] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [verified, setVerified] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const generate = async () => {
    setErr(null); setBusy("Generating your key card…");
    try { setCard(await generateKeyCard()); } catch (e) { setErr(errText(e)); } finally { setBusy(null); }
  };

  const encryptAndDownload = async () => {
    const bad = checkPassword(pw, pw2);
    if (bad) return setErr(bad);
    setErr(null); setBusy("Encrypting…");
    try {
      const f = await encryptKeyCard(card!, pw, net.name);
      setFile(f);
      downloadKeyCard(f);
    } catch (e) { setErr(errText(e)); } finally { setBusy(null); }
  };

  const verify = async () => {
    const f = fileInput.current?.files?.[0];
    if (!f) return setErr("Choose the key card file you just downloaded.");
    setErr(null); setBusy("Checking your file…");
    try {
      const parsed = parseKeyCardFile(await readFileText(f));
      if (parsed.publicKey.toLowerCase() !== bytesToHex(card!.publicKey)) {
        throw new KeyCardError("That's a different key card. Upload the one you just downloaded.");
      }
      await decryptKeyCard(parsed, verifyPw);
      setVerified(true);
      onReady(card!);
    } catch (e) { setErr(errText(e)); } finally { setBusy(null); }
  };

  if (verified) {
    return (
      <div className="keycard-done">
        <span className="check" aria-hidden="true">✓</span>
        <div>
          <strong>Key card saved and checked.</strong>
          <div className="field-hint mono">{file && keyCardFileName(file.publicKey)}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="keycard">
      {intro && <p>{intro}</p>}
      {!card && (
        <>
          <p className="muted">
            Your key card is a post-quantum (SLH-DSA) key made right here in your browser. It never leaves your device.
            It's the <strong>only</strong> thing that can change who gets paid, or cancel the order. Not your wallet, and not us.
          </p>
          <button className="btn" onClick={generate} disabled={!!busy}>Generate key card</button>
        </>
      )}

      {card && !file && (
        <>
          <p className="muted">Choose a password to encrypt the file. You'll need both the file and the password to manage your order. There is no recovery.</p>
          <Field label="Password" hint="At least 10 characters">
            <input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
          </Field>
          <Field label="Repeat password">
            <input type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
          </Field>
          <button className="btn" onClick={encryptAndDownload} disabled={!!busy}>Encrypt and download</button>
        </>
      )}

      {file && (
        <>
          <div className="notice">
            <strong>Downloaded {keyCardFileName(file.publicKey)}.</strong> Move it somewhere safe (a password manager or a USB stick).
            {" "}<button className="link" onClick={() => downloadKeyCard(file)}>Download again</button>
          </div>
          <p className="muted">To make sure you really have it, open the file you saved and enter its password.</p>
          <Field label="Your key card file">
            <input ref={fileInput} type="file" accept="application/json,.json" />
          </Field>
          <Field label="Password">
            <input type="password" autoComplete="current-password" value={verifyPw} onChange={(e) => setVerifyPw(e.target.value)} />
          </Field>
          <button className="btn" onClick={verify} disabled={!!busy}>Check my key card</button>
        </>
      )}

      {busy && <div className="status busy"><Spinner label={busy} /></div>}
      {err && <div className="status error" role="alert">{err}</div>}
    </div>
  );
}

/** Upload + password -> a decrypted key card, checked against the order's on-chain key. */
export function KeyCardUnlock({ expected, onUnlock }: { expected?: Hex; onUnlock: (card: KeyCard) => void }) {
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const unlock = async () => {
    const f = fileInput.current?.files?.[0];
    if (!f) return setErr("Choose your key card file.");
    setErr(null); setBusy(true);
    try {
      const parsed = parseKeyCardFile(await readFileText(f));
      if (expected && parsed.publicKey.toLowerCase() !== expected.toLowerCase()) {
        throw new KeyCardError(
          `This key card doesn't control this order. It belongs to key ${parsed.publicKey.slice(0, 10)}…, ` +
          `but the order is controlled by ${expected.slice(0, 10)}….`,
        );
      }
      onUnlock(await decryptKeyCard(parsed, pw));
    } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };

  return (
    <div className="keycard">
      <Field label="Key card file">
        <input ref={fileInput} type="file" accept="application/json,.json" />
      </Field>
      <Field label="Password">
        <input type="password" autoComplete="current-password" value={pw}
               onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => e.key === "Enter" && unlock()} />
      </Field>
      <button className="btn" onClick={unlock} disabled={busy}>{busy ? "Unlocking…" : "Unlock key card"}</button>
      {busy && <div className="status busy"><Spinner label="Decrypting (this takes a moment on purpose)…" /></div>}
      {err && <div className="status error" role="alert">{err}</div>}
    </div>
  );
}
