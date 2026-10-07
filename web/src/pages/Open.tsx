import { useEffect, useMemo, useState } from "react";
import { useAccount } from "wagmi";
import { bytesToHex, isAddress, keccak256, parseAbi, toHex, zeroHash, type Address } from "viem";
import { writAbi } from "../../../shared/abi/writ.ts";
import { openAuthNonce, type Terms } from "../../../shared/auth.ts";
import { USDC } from "../config";
import { useAction, useClient, useNetwork } from "../hooks";
import { KeyCardCreator } from "../keycardUi";
import { formatDate, formatUsdc, INTERVALS, parseUsdc, usdc } from "../lib/format";
import type { KeyCard } from "../lib/keycard";
import { chainNow } from "../lib/tx";
import { events, sendWrit, signReceiveAuth } from "../lib/write";
import { Card, Field, NetLink, StatusLine, WalletGate } from "../ui";

const erc20 = parseAbi(["function balanceOf(address) view returns (uint256)"]);

const ASAP_DELAY = 120; // seconds between clicking and the first payment: time to sign both prompts

const pad = (n: number) => String(n).padStart(2, "0");
function localInput(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function localDate(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Suggested executor reward cap: enough to cover gas plus some margin, below the payment. */
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

  if (openedId !== null) {
    return (
      <Card title={`Order #${openedId} is live`}>
        <StatusLine status={action.status} net={net} />
        <p>The first payment is due {formatDate(openedStart)}. Anyone can trigger it from the order page and earn the reward.</p>
        <p className="muted">Keep your key card file and password safe. They're the only way to change or cancel this order.</p>
        <NetLink to={`/order/${openedId}`} className="btn">Go to order #{openedId.toString()}</NetLink>
      </Card>
    );
  }

  return (
    <div className="stack">
      <h1>Open a payment order</h1>
      <Card title={<><span className="step">1</span> Connect your wallet</>}>
        <WalletGate net={net} why="Your wallet funds the order and pays the network fee (in USDC).">
          <p className="ok-line">Connected to {net.label}.</p>
        </WalletGate>
      </Card>

      <Card title={<><span className="step">2</span> Create your key card</>}>
        <KeyCardCreator net={net} onReady={setCard} />
      </Card>

      <Card title={<><span className="step">3</span> Set the terms</>} className={card ? "" : "disabled"}>
        {!card && <p className="muted">Save your key card first. The form unlocks once it's checked.</p>}
        <fieldset disabled={!card || action.busy}>
          <Field label="Recipient address" error={calc.errors.beneficiary} hint="Who gets paid. Only your key card can change this later.">
            <input className="mono" placeholder="0x…" value={beneficiary} onChange={(e) => setBeneficiary(e.target.value.trim())} spellCheck={false} />
          </Field>
          <div className="row2">
            <Field label="Amount per payment (USDC)" error={calc.errors.amount}>
              <input inputMode="decimal" placeholder="25.00" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </Field>
            <Field label="How often">
              <select value={period.toString()} onChange={(e) => setPeriod(BigInt(e.target.value))}>
                {INTERVALS.map((i) => <option key={i.label} value={i.seconds.toString()}>{i.label}</option>)}
              </select>
            </Field>
          </div>
          <div className="row2">
            <Field label="First payment" error={calc.errors.first}>
              <select value={asap ? "asap" : "at"} onChange={(e) => setAsap(e.target.value === "asap")}>
                <option value="asap">As soon as possible (about 2 min)</option>
                <option value="at">At a specific time…</option>
              </select>
              {!asap && <input type="datetime-local" value={first} onChange={(e) => setFirst(e.target.value)} aria-label="First payment time" />}
            </Field>
            <Field label="Last payment on or before" error={calc.errors.end} hint="Required. It's the backstop if the key card is ever lost.">
              <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
            </Field>
          </div>

          <details className="advanced">
            <summary>Executor reward and reference</summary>
            <Field label="Max reward per payment (USDC)" error={calc.errors.cap}
                   hint={<>Whoever triggers a payment is paid back their gas plus a small tip, up to this cap. Default {calc.amt ? usdc(suggestedFeeCap(calc.amt)) : "about 1%"}.</>}>
              <input inputMode="decimal" placeholder={calc.amt ? formatUsdc(suggestedFeeCap(calc.amt)) : "0.005"} value={feeCapText} onChange={(e) => setFeeCapText(e.target.value)} />
            </Field>
            <Field label="Reference (optional)" hint="e.g. an invoice number. Stored as a hash in every payment event.">
              <input value={refText} maxLength={100} onChange={(e) => setRefText(e.target.value)} />
            </Field>
          </details>

          <div className="funding">
            <span className="field-label">Funding</span>
            <label className="radio">
              <input type="radio" checked={fundMode === "all"} onChange={() => setFundMode("all")} />
              Fund every payment{calc.fundAll !== null && calc.payments > 0n ? `: ${usdc(calc.fundAll)} for ${calc.payments} payments` : ""}
            </label>
            <label className="radio">
              <input type="radio" checked={fundMode === "custom"} onChange={() => setFundMode("custom")} />
              Custom amount (you can top up later)
            </label>
            {fundMode === "custom" && (
              <Field label="Amount to fund now (USDC)" error={calc.errors.funding}>
                <input inputMode="decimal" value={fundText} onChange={(e) => setFundText(e.target.value)} />
              </Field>
            )}
          </div>
        </fieldset>

        {calc.amt && calc.payments > 0n && calc.funding ? (
          <div className="summary">
            Pays <strong>{usdc(calc.amt)}</strong> {INTERVALS.find((i) => i.seconds === period)?.label.toLowerCase()} from{" "}
            <strong>{formatDate(calc.startAt)}</strong>, {calc.payments.toString()} payment{calc.payments === 1n ? "" : "s"} in total.{" "}
            {calc.covered >= calc.payments
              ? "The funding covers every payment, including executor rewards."
              : `The funding covers ${calc.covered} payment${calc.covered === 1n ? "" : "s"}; top up later to continue.`}{" "}
            Anything left over comes back to you.
          </div>
        ) : null}

        <WalletGate net={net}>
          <button className="btn btn-lg" disabled={!calc.ready || action.busy} onClick={submit}>
            Sign and open order
          </button>
          <p className="field-hint">You'll sign one USDC authorization, then confirm one transaction. No separate approval.</p>
        </WalletGate>
        <StatusLine status={action.status} net={net} />
      </Card>
    </div>
  );
}
