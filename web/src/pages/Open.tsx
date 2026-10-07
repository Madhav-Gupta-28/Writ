import { useEffect, useMemo, useState } from "react";
import { useAccount } from "wagmi";
import { bytesToHex, isAddress, keccak256, parseAbi, toHex, zeroHash, type Address } from "viem";
import { writAbi } from "../../../shared/abi/writ.ts";
import { openAuthNonce, type Terms } from "../../../shared/auth.ts";
import { USDC } from "../config";
import { useAction, useClient, useNetwork } from "../hooks";
import { KeyCardCreator } from "../keycardUi";
import { formatDate, formatUsdc, INTERVALS, parseUsdc, short, usdc } from "../lib/format";
import type { KeyCard } from "../lib/keycard";
import { chainNow } from "../lib/tx";
import { events, sendWrit, signReceiveAuth } from "../lib/write";
import { ArrowRight, ChevronDown, CircleCheck, KeyRound, PartyPopper } from "lucide-react";
import { Field, KEY_CARD_LINE, NetLink, Note, StatusLine, WalletGate } from "../ui";

const erc20 = parseAbi(["function balanceOf(address) view returns (uint256)"]);

const ASAP_DELAY = 120; // seconds between clicking and the first payment: time to sign both prompts

const pad = (n: number) => String(n).padStart(2, "0");
function localInput(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function localDate(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Suggested tip cap for whoever presses Pay: covers gas plus some margin, below the payment. */
export function suggestedFeeCap(amount: bigint): bigint {
  let cap = amount / 100n; // ~1% (§6.2)
  if (cap < 5_000n) cap = 5_000n; // 0.005 USDC covers ~0.003 of gas at the 20 gwei floor
  if (cap > 50_000n) cap = 50_000n;
  if (cap >= amount) cap = amount / 2n;
  return cap;
}

export function OpenOrder() {
  const net = useNetwork();
  const client = useClient(net);
  const { address } = useAccount();
  const [card, setCard] = useState<KeyCard | null>(null);

  const [beneficiary, setBeneficiary] = useState("");
  const [amount, setAmount] = useState("");
  const [period, setPeriod] = useState(86400n);
  const [asap, setAsap] = useState(true);
  const [first, setFirst] = useState(() => localInput(new Date(Date.now() + 10 * 60_000)));
  const [tick, setTick] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setTick(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  const [end, setEnd] = useState(() => localDate(new Date(Date.now() + 30 * 86400_000)));
  const [feeCapText, setFeeCapText] = useState("");
  const [fundMode, setFundMode] = useState<"all" | "custom">("all");
  const [fundText, setFundText] = useState("");
  const [refText, setRefText] = useState("");
  const [openedId, setOpenedId] = useState<bigint | null>(null);
  const [openedStart, setOpenedStart] = useState<bigint>(0n);
  const action = useAction();

  const calc = useMemo(() => {
    const amt = parseUsdc(amount);
    // "As soon as possible" = about 2 minutes from now, fixed when you click (leaves time to sign).
    const startAt = asap ? BigInt(Math.floor(tick / 1000) + ASAP_DELAY) : BigInt(Math.floor(new Date(first).getTime() / 1000));
    const endD = new Date(`${end}T23:59:59`);
    const endTime = BigInt(Math.floor(endD.getTime() / 1000));
    const cap = feeCapText.trim() ? parseUsdc(feeCapText) : amt ? suggestedFeeCap(amt) : null;
    const payments = amt && endTime >= startAt ? (endTime - startAt) / period + 1n : 0n;
    const fundAll = amt && cap !== null ? payments * (amt + cap) : null;
    const funding = fundMode === "all" ? fundAll : parseUsdc(fundText);
    const errors: Record<string, string | null> = {
      beneficiary: !beneficiary ? null
        : !isAddress(beneficiary) ? "That isn't a valid address."
        : beneficiary.toLowerCase() === net.writ.toLowerCase() ? "That's the Writ contract itself." : null,
      amount: amount && !amt ? "Enter an amount like 25 or 0.5." : amt === 0n ? "Must be more than zero." : null,
      first: asap ? null
        : Number.isNaN(Number(startAt)) ? "Pick a date and time."
        : startAt * 1000n < BigInt(tick + 60_000) ? "Pick a time at least a minute from now." : null,
      end: amt && endTime < startAt + period ? "The end date must allow at least one full interval after the first payment." : null,
      cap: cap === null && feeCapText ? "Enter an amount."
        : cap !== null && amt && (cap === 0n || cap >= amt) ? "Must be above zero and below the payment amount." : null,
      funding: funding === null && fundMode === "custom" && fundText ? "Enter an amount."
        : funding !== null && amt && funding < amt ? `Fund at least one payment (${usdc(amt)}).` : null,
    };
    const covered = funding && amt && cap !== null ? funding / (amt + cap) : 0n;
    const ready = !!card && isAddress(beneficiary) && !!amt && cap !== null && funding !== null && !!funding &&
      Object.values(errors).every((e) => !e);
    return { amt, startAt, endTime, cap, payments, fundAll, funding, covered, errors, ready };
  }, [amount, first, asap, tick, end, feeCapText, period, fundMode, fundText, beneficiary, card, net.writ]);

  const submit = () =>
    action.run(async (step) => {
      if (!address || !card || !calc.ready) return;
      const now = await chainNow(client);
      const startAt = asap ? now + BigInt(ASAP_DELAY) : calc.startAt;
      if (startAt < now + 20n) throw new Error("The first payment time has already passed. Pick a time a few minutes from now.");
      const bal = await client.readContract({ address: USDC, abi: erc20, functionName: "balanceOf", args: [address] });
      if (bal < calc.funding! + 20_000n) {
        throw new Error(`Your wallet has ${usdc(bal)}. You need ${usdc(calc.funding!)} for the order plus a little for the network fee.`);
      }
      const terms: Terms = {
        beneficiary: beneficiary as Address, amountPerPeriod: calc.amt!, periodSeconds: period, startAt,
        endTime: calc.endTime, maxExecutorFee: calc.cap!, pqKey: bytesToHex(card.publicKey),
        ref: refText.trim() ? keccak256(toHex(refText.trim())) : zeroHash,
      };
      step("Reading the next order number…");
      const id = await client.readContract({ address: net.writ, abi: writAbi, functionName: "nextId" });
      const nonce = openAuthNonce(net.writ, id, terms);
      const onChain = await client.readContract({ address: net.writ, abi: writAbi, functionName: "openAuthNonce", args: [id, terms] });
      if (onChain !== nonce) throw new Error("Safety check failed: this app and the contract disagree on the authorization. Nothing was sent.");
      const auth = await signReceiveAuth(client, net, address, calc.funding!, nonce, step);
      const { hash, receipt } = await sendWrit(client, net, "openWithAuthorization", [terms, address, calc.funding!, auth], step);
      const opened = events(receipt).find((e) => e.eventName === "Opened");
      const newId = (opened?.args as { id?: bigint } | undefined)?.id ?? id;
      setOpenedId(newId);
      setOpenedStart(startAt);
      return { message: `Order #${newId} is open and funded with ${usdc(calc.funding!)}.`, hash };
    }, { action: "open" });

  const { isConnected, chainId } = useAccount();
  const walletOk = isConnected && chainId === net.chain.id;

  if (openedId !== null) {
    return (
      <div className="card stack" style={{ maxWidth: 720 }}>
        <div className="done-line" style={{ fontSize: "1.1rem" }}><PartyPopper size={22} />Order #{openedId.toString()} is live</div>
        <StatusLine status={action.status} net={net} />
        <p className="text-2">The first payment is due {formatDate(openedStart)}. From then on, anyone can press Pay on the order page and earn the tip.</p>
        <Note icon={KeyRound} kind="warn">Keep your key card file and its password safe. They're the only way to change or cancel this order.</Note>
        <div><NetLink to={`/order/${openedId}`} className="btn btn-primary btn-lg">Go to order #{openedId.toString()} <ArrowRight size={18} /></NetLink></div>
      </div>
    );
  }

  const intervalText = INTERVALS.find((i) => i.seconds === period)?.label.toLowerCase();

  return (
    <div className="stack">
      <div className="section-head" style={{ marginBottom: 4 }}>
        <h1>Create a recurring payment</h1>
        <p>Three steps. You'll sign once, and it pays on schedule from then on.</p>
      </div>
      <div className="open-layout">
        <div className="stack">
          <section className={`card step-card ${walletOk ? "done" : ""}`}>
            <div className="step-title"><span className="step-num">1</span><h2>Connect your wallet</h2></div>
            <WalletGate net={net} why="Your wallet adds the money and pays the small network fee (in USDC).">
              <p className="done-line"><CircleCheck size={18} />Connected to {net.label}</p>
            </WalletGate>
          </section>

          <section className={`card step-card ${card ? "done" : ""}`}>
            <div className="step-title"><span className="step-num">2</span><h2>Create your key card</h2></div>
            {!card && (
              <div className="keycard-explain">
                <KeyRound size={22} className="ico icon" />
                <div className="text-2">
                  <strong style={{ color: "var(--text)" }}>Your key card is {KEY_CARD_LINE}</strong> Not even your wallet can change the
                  recipient without it, so a stolen wallet can't redirect your payments. It's made here in your browser and never sent anywhere.
                </div>
              </div>
            )}
            <KeyCardCreator net={net} onReady={setCard} />
          </section>

          <section className={`card step-card ${card ? "" : "locked"}`}>
            <div className="step-title"><span className="step-num">3</span><h2>Who, how much, how often</h2></div>
            {!card && <p className="muted">Save your key card first. This unlocks once it's checked.</p>}
            <fieldset disabled={!card || action.busy}>
              <Field label="Recipient address" error={calc.errors.beneficiary} hint="Who gets paid. Only your key card can change this later.">
                <input className="mono" placeholder="0x…" value={beneficiary} onChange={(e) => setBeneficiary(e.target.value.trim())} spellCheck={false} />
              </Field>
              <div className="cols-2">
                <Field label="Amount per payment (USDC)" error={calc.errors.amount}>
                  <input inputMode="decimal" placeholder="25.00" value={amount} onChange={(e) => setAmount(e.target.value)} />
                </Field>
                <Field label="How often">
                  <select value={period.toString()} onChange={(e) => setPeriod(BigInt(e.target.value))}>
                    {INTERVALS.map((i) => <option key={i.label} value={i.seconds.toString()}>{i.label}</option>)}
                  </select>
                </Field>
                <Field label="First payment" error={calc.errors.first}>
                  <select value={asap ? "asap" : "at"} onChange={(e) => setAsap(e.target.value === "asap")}>
                    <option value="asap">As soon as possible (about 2 min)</option>
                    <option value="at">At a specific time…</option>
                  </select>
                  {!asap && <input type="datetime-local" value={first} onChange={(e) => setFirst(e.target.value)} aria-label="First payment time" />}
                </Field>
                <Field label="Last payment on or before" error={calc.errors.end} hint="Required, as a safety net if the key card is ever lost.">
                  <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
                </Field>
              </div>

              <div className="stack" style={{ gap: 10 }}>
                <span className="field-label">How much to put in now</span>
                <label className="choice">
                  <input type="radio" checked={fundMode === "all"} onChange={() => setFundMode("all")} />
                  <span>Enough for every payment{calc.fundAll !== null && calc.payments > 0n ? <> · <strong>{usdc(calc.fundAll)}</strong></> : ""}</span>
                </label>
                <label className="choice">
                  <input type="radio" checked={fundMode === "custom"} onChange={() => setFundMode("custom")} />
                  <span>A different amount (you or anyone can add more later)</span>
                </label>
                {fundMode === "custom" && (
                  <Field label="Amount to add now (USDC)" error={calc.errors.funding}>
                    <input inputMode="decimal" value={fundText} onChange={(e) => setFundText(e.target.value)} />
                  </Field>
                )}
              </div>

              <details className="more">
                <summary>More options <ChevronDown size={16} /></summary>
                <div className="more-body cols-2">
                  <Field label="Max tip per payment (USDC)" error={calc.errors.cap}
                         hint={<>Whoever presses Pay gets their network fee back plus a small tip, up to this. Default {calc.amt ? usdc(suggestedFeeCap(calc.amt)) : "about 1%"}.</>}>
                    <input inputMode="decimal" placeholder={calc.amt ? formatUsdc(suggestedFeeCap(calc.amt)) : "0.005"} value={feeCapText} onChange={(e) => setFeeCapText(e.target.value)} />
                  </Field>
                  <Field label="Reference (optional)" hint="For example an invoice number. It's recorded with every payment.">
                    <input value={refText} maxLength={100} onChange={(e) => setRefText(e.target.value)} />
                  </Field>
                </div>
              </details>
            </fieldset>
          </section>
        </div>

        <aside className="card summary-card">
          <div className="eyebrow">Summary</div>
          <div>
            <div className="summary-big">{calc.funding ? usdc(calc.funding) : "— USDC"}</div>
            <div className="muted">goes into the order now</div>
          </div>
          <ul className="summary-list">
            <li><span>Pays</span><span>{calc.amt ? `${usdc(calc.amt)} ${intervalText}` : "—"}</span></li>
            <li><span>To</span><span className="mono">{isAddress(beneficiary) ? short(beneficiary) : "—"}</span></li>
            <li><span>First payment</span><span>{asap ? "In about 2 min" : formatDate(calc.startAt)}</span></li>
            <li><span>Payments</span><span>{calc.payments > 0n ? calc.payments.toString() : "—"}</span></li>
            <li><span>Covers</span><span>{calc.funding && calc.payments > 0n ? (calc.covered >= calc.payments ? "Every payment" : `${calc.covered} of ${calc.payments}`) : "—"}</span></li>
          </ul>
          <p className="field-hint">Anything left over comes back to you. You'll sign one USDC permission, then confirm one transaction.</p>
          <WalletGate net={net}>
            <button className="btn btn-primary btn-xl" disabled={!calc.ready || action.busy} onClick={submit}>Sign and create order</button>
          </WalletGate>
          <StatusLine status={action.status} net={net} />
        </aside>
      </div>
    </div>
  );
}
