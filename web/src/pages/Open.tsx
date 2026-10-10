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
      // open() requires initialFunding >= amountPerPeriod + maxExecutorFee: a
      // period has to be payable *with* its executor fee (§6.3). Validating
      // against the amount alone would let the payer sign the USDC
      // authorization and only then have the transaction revert
      // InsufficientInitialFunding.
      funding: funding === null && fundMode === "custom" && fundText ? "Enter an amount."
        : funding !== null && amt && cap !== null && funding < amt + cap
          ? `Fund at least one payment plus its tip (${usdc(amt + cap)}).`
          : null,
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
        <p className="text-2">First payment due {formatDate(openedStart)}. From then on anyone can press Pay and earn the tip.</p>
        <Note icon={KeyRound} kind="warn">Keep the key card file and its password safe. They are the only way to change or cancel this order.</Note>
        <div><NetLink to={`/order/${openedId}`} className="btn btn-primary btn-lg">Go to order #{openedId.toString()} <ArrowRight size={18} /></NetLink></div>
      </div>
    );
  }

  const intervalText = INTERVALS.find((i) => i.seconds === period)?.label.toLowerCase();
  const cardState = card ? "ready" : "not yet";

  return (
    <div className="make">
      <header className="make-head">
        <h1>New order.</h1>
        <p>Say who gets paid, how much and how often. You sign once.</p>
      </header>

      {/* Two things have to exist before the terms mean anything. They are
          stated as conditions with a status, not as numbered steps — a step
          list implies a wizard, and this is one form. */}
      <section className="slab">
        <div className="slab-head">
          <span>Your wallet</span>
          <span className={walletOk ? "ok" : ""}>{walletOk ? short(address ?? "") : "not connected"}</span>
        </div>
        <div className="slab-body">
          <WalletGate net={net} why="Your wallet funds the order. Fees are paid in USDC.">
            <p className="done-line"><CircleCheck size={17} />Connected to {net.label}</p>
          </WalletGate>
        </div>
      </section>

      <section className="slab">
        <div className="slab-head">
          <span>Your key card</span>
          <span className={card ? "ok" : ""}>{cardState}</span>
        </div>
        <div className="slab-body">
          {!card && (
            <p className="slab-why">
              <strong>{KEY_CARD_LINE}</strong> The only thing that can ever redirect this
              money. Made here, never sent anywhere.
            </p>
          )}
          <KeyCardCreator net={net} onReady={setCard} />
        </div>
      </section>

      <fieldset disabled={!card || action.busy} className="make-terms">
        <section className="slab">
          <div className="slab-head"><span>Who gets paid</span></div>
          <div className="slab-body">
            <Field label="Recipient address" error={calc.errors.beneficiary}>
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
            </div>
          </div>
        </section>

        <section className="slab">
          <div className="slab-head"><span>How long</span></div>
          <div className="slab-body">
            <div className="cols-2">
              <Field label="First payment" error={calc.errors.first}>
                <select value={asap ? "asap" : "at"} onChange={(e) => setAsap(e.target.value === "asap")}>
                  <option value="asap">As soon as possible</option>
                  <option value="at">At a specific time…</option>
                </select>
                {!asap && <input type="datetime-local" value={first} onChange={(e) => setFirst(e.target.value)} aria-label="First payment time" />}
              </Field>
              <Field label="Last payment on or before" error={calc.errors.end} hint="A safety net if the key card is ever lost.">
                <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
              </Field>
            </div>
          </div>
        </section>

        <section className="slab">
          <div className="slab-head">
            <span>How much to put in</span>
            {calc.payments > 0n && <span>{calc.payments.toString()} payments</span>}
          </div>
          <div className="slab-body">
            <div className="choices">
              <label className="choice">
                <input type="radio" checked={fundMode === "all"} onChange={() => setFundMode("all")} />
                <span>Enough for every payment{calc.fundAll !== null && calc.payments > 0n ? <> · <strong>{usdc(calc.fundAll)}</strong></> : ""}</span>
              </label>
              <label className="choice">
                <input type="radio" checked={fundMode === "custom"} onChange={() => setFundMode("custom")} />
                <span>A different amount <span className="muted">— anyone can top it up later</span></span>
              </label>
            </div>
            {fundMode === "custom" && (
              <Field label="Amount to add now (USDC)" error={calc.errors.funding}>
                <input inputMode="decimal" value={fundText} onChange={(e) => setFundText(e.target.value)} />
              </Field>
            )}
            <details className="more">
              <summary>More options <ChevronDown size={15} /></summary>
              <div className="more-body cols-2">
                <Field label="Max tip per payment (USDC)" error={calc.errors.cap}
                       hint={<>Whoever presses Pay gets their fee back plus a tip, up to this.</>}>
                  <input inputMode="decimal" placeholder={calc.amt ? formatUsdc(suggestedFeeCap(calc.amt)) : "0.005"} value={feeCapText} onChange={(e) => setFeeCapText(e.target.value)} />
                </Field>
                <Field label="Reference (optional)" hint="An invoice number, say. Recorded with every payment.">
                  <input value={refText} maxLength={100} onChange={(e) => setRefText(e.target.value)} />
                </Field>
              </div>
            </details>
          </div>
        </section>
      </fieldset>

      {/* Rialto's closing bar: the whole decision on one line, and the button
          that commits to it. A sidebar competed with the form for attention
          and repeated what the fields already said. */}
      <div className="make-bar">
        <div className="mb-sum">
          <div className="mb-big num">{calc.funding ? usdc(calc.funding) : "— USDC"}</div>
          <div className="mb-line">
            {calc.amt && isAddress(beneficiary)
              ? <>pays <strong>{usdc(calc.amt)}</strong> {intervalText} to <span className="mono">{short(beneficiary)}</span>, {asap ? "starting in about 2 min" : `starting ${formatDate(calc.startAt)}`}</>
              : "fill in the terms above"}
          </div>
        </div>
        <div className="mb-act">
          <WalletGate net={net}>
            <button className="btn btn-primary btn-xl" disabled={!calc.ready || action.busy} onClick={submit}>Sign and create order</button>
          </WalletGate>
          <StatusLine status={action.status} net={net} />
        </div>
      </div>
      <p className="make-foot">One signature, then one transaction. Anything left over comes back to you.</p>
    </div>
  );
}
