import { useRef, useState } from "react";
import { bytesToHex, type Hex } from "viem";
import { CircleCheck, Download, FileCheck2, KeyRound, Unlock } from "lucide-react";
import type { Network } from "./config";
import {
  KeyCardError, checkPassword, decryptKeyCard, downloadKeyCard, encryptKeyCard, keyCardFileName, parseKeyCardFile,
  readFileText, type KeyCard, type KeyCardFile,
} from "./lib/keycard";
import { generateKeyCard } from "./lib/signer";
import { Field, Note } from "./ui";

const errText = (e: unknown) => (e instanceof KeyCardError ? e.message : `Something went wrong: ${(e as Error)?.message ?? e}`);

function Busy({ label }: { label: string }) {
  return <div className="status busy"><span className="spinner" aria-hidden="true" /><span role="status">{label}</span></div>;
}

/**
 * Make a key card, encrypt it with a password, make the user download it, and
 * refuse to continue until they prove they have the file by unlocking it
 * (ARCHITECTURE.md §7.1 step 3).
 */
export function KeyCardCreator({ net, onReady }: { net: Network; onReady: (card: KeyCard) => void }) {
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
    setErr(null); setBusy("Creating your key card…");
    try { setCard(await generateKeyCard()); } catch (e) { setErr(errText(e)); } finally { setBusy(null); }
  };

  const encryptAndDownload = async () => {
    const bad = checkPassword(pw, pw2);
    if (bad) return setErr(bad);
    setErr(null); setBusy("Locking it with your password…");
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
      <div className="done-line">
        <CircleCheck size={20} />
        <span>Key card saved and checked <span className="muted mono" style={{ fontWeight: 400 }}>· {file && keyCardFileName(file.publicKey)}</span></span>
      </div>
    );
  }

  return (
    <div className="stack">
      {!card && (
        <div><button className="btn btn-primary" onClick={generate} disabled={!!busy}><KeyRound size={18} />Create my key card</button></div>
      )}

      {card && !file && (
        <>
          <p className="text-2">Choose a password to lock the file. You'll need both the file and the password to make changes later. Nobody can recover them for you.</p>
          <div className="cols-2">
            <Field label="Password" hint="At least 10 characters">
              <input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
            </Field>
            <Field label="Repeat password">
              <input type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
            </Field>
          </div>
          <div><button className="btn btn-primary" onClick={encryptAndDownload} disabled={!!busy}><Download size={18} />Encrypt and download</button></div>
        </>
      )}

      {file && (
        <>
          <Note icon={Download} kind="ok">
            Downloaded <span className="mono">{keyCardFileName(file.publicKey)}</span>. Keep it somewhere safe, like a password manager or a USB stick.{" "}
            <button className="link" onClick={() => downloadKeyCard(file)}>Download again</button>
          </Note>
          <p className="text-2">To make sure you really have it, pick the file you just saved and enter its password.</p>
          <div className="cols-2">
            <Field label="Your key card file">
              <input ref={fileInput} type="file" accept="application/json,.json" />
            </Field>
            <Field label="Password">
              <input type="password" autoComplete="current-password" value={verifyPw} onChange={(e) => setVerifyPw(e.target.value)} />
            </Field>
          </div>
          <div><button className="btn btn-primary" onClick={verify} disabled={!!busy}><FileCheck2 size={18} />Check my key card</button></div>
        </>
      )}

      {busy && <Busy label={busy} />}
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
        throw new KeyCardError("This key card doesn't control this order. It may be an old card that was replaced, or one for a different order.");
      }
      onUnlock(await decryptKeyCard(parsed, pw));
    } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };

  return (
    <div className="stack">
      <Field label="Key card file">
        <input ref={fileInput} type="file" accept="application/json,.json" />
      </Field>
      <Field label="Password">
        <input type="password" autoComplete="current-password" value={pw}
               onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => e.key === "Enter" && unlock()} />
      </Field>
      <div><button className="btn btn-primary" onClick={unlock} disabled={busy}><Unlock size={18} />{busy ? "Unlocking…" : "Unlock key card"}</button></div>
      {busy && <Busy label="Unlocking (this takes a moment on purpose)…" />}
      {err && <div className="status error" role="alert">{err}</div>}
      <p className="field-hint">The file is opened here in your browser. It isn't uploaded anywhere.</p>
    </div>
  );
}
