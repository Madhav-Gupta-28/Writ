import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useAccount } from "wagmi";
import { bytesToHex, isAddress, keccak256, parseAbi, toHex, zeroHash, type Address } from "viem";
import { writAbi } from "../../../shared/abi/writ.ts";
import { openAuthNonce, type Terms } from "../../../shared/auth.ts";
import { USDC } from "../config";
import { useAction, useClient, useNetwork } from "../hooks";
import { KeyCardCreator } from "../keycardUi";
import { formatDate, formatDay, formatUsdc, INTERVALS, parseUsdc, short, usdc } from "../lib/format";
import type { KeyCard } from "../lib/keycard";
import { chainNow } from "../lib/tx";
import { events, sendWrit, signReceiveAuth } from "../lib/write";
import { ArrowRight, Check, ChevronDown, CircleCheck, KeyRound, PartyPopper } from "lucide-react";
import { Field, KEY_CARD_LINE, NetLink, Note, StatusLine, WalletGate } from "../ui";
import { Words } from "../lib/motion";

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

/* The page is a form beside its result: numbered steps on the left (they are
   a real sequence, filled in order), and on the right the order itself, drawn
   as it will exist on the chain and filled in as you type. The closing bar
   that used to sit under the form lives at the foot of that draft. */

/** One numbered step. Its number turns into a check once the step is satisfied. */
function Step({ n, title, done, aside, children }: { n: string; title: string; done: boolean; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="slab mk-step" data-done={done}>
      <div className="slab-head">
        <span className="mk-step-t">
          <span className="step-n" key={done ? "done" : "todo"} aria-hidden="true">{done ? <Check size={15} strokeWidth={3} /> : n}</span>
          {title}
        </span>
        {aside}
      </div>
      <div className="slab-body">{children}</div>
    </section>
  );
}

/** A line on the draft. The value is keyed so a change flips it in. */
function DraftRow({ k, v }: { k: string; v: string | null }) {
  return (
    <div className="mk-row">
      <span className="k">{k}</span>
      <span className="v" key={v ?? ""} data-unset={v === null}>{v ?? "not set"}</span>
    </div>
  );
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
      <div className="mk mk-done">
        <header className="mk-head">
          <div className="ov-kicker"><span className="live-dot">Live on {net.label}</span></div>
          <h1 className="ov-h"><Words text={`Order #${openedId.toString()} is live.`} step={80} /></h1>
          <p className="ov-sum">First payment due {formatDate(openedStart)}. From then on anyone can press Pay and earn the tip.</p>
        </header>
        <div className="mk-done-body">
          <div className="done-line"><PartyPopper size={22} />Opened and funded</div>
          <StatusLine status={action.status} net={net} />
          <Note icon={KeyRound} kind="warn">Keep the key card file and its password safe. They are the only way to change or cancel this order.</Note>
          <div><NetLink to={`/order/${openedId}`} className="btn btn-primary btn-xl">Go to order #{openedId.toString()} <ArrowRight size={18} /></NetLink></div>
        </div>
      </div>
    );
  }

  const intervalText = INTERVALS.find((i) => i.seconds === period)?.label.toLowerCase();

  // The first thing standing between this form and a signature, in the order a
  // person fills it in. Only ever shown when there is no figure to print.
  const missing =
    !walletOk ? "Connect a wallet to begin."
    : !card ? "Create your key card to continue."
    : !isAddress(beneficiary) ? "Add the recipient's address."
    : !calc.amt ? "Add an amount per payment."
    : Object.values(calc.errors).find((e) => e) ?? "Fill in the terms above.";

  const whoDone = isAddress(beneficiary) && !!calc.amt && !calc.errors.beneficiary && !calc.errors.amount;
  const whenDone = calc.payments > 0n && !calc.errors.first && !calc.errors.end;
  const fundDone = !!calc.funding && !calc.errors.funding && !calc.errors.cap;

  return (
    <div className="mk">
      <header className="mk-head">
        <div className="ov-kicker"><span className="eyebrow">{net.label} · standing order</span></div>
        <h1 className="ov-h"><Words text="New order." step={90} /></h1>
        <p className="ov-sum">Say who gets paid, how much and how often. You sign once, and from then on it pays itself.</p>
      </header>

      <div className="mk-steps">
        {/* Two things have to exist before the terms mean anything. Once they
            are satisfied they are facts, not steps, so they collapse into one
            strip and give the height back to the form. */}
        {walletOk && card ? (
          <div className="ready-strip">
            <span><span className="step-n" aria-hidden="true"><Check size={15} strokeWidth={3} /></span>Wallet <span className="mono">{short(address ?? "")}</span></span>
            <span><span className="step-n" aria-hidden="true"><Check size={15} strokeWidth={3} /></span>Key card ready</span>
          </div>
        ) : (
          <>
            <Step n="01" title="Your wallet" done={walletOk}
                  aside={<span className={walletOk ? "ok" : "mk-aside"}>{walletOk ? short(address ?? "") : "not connected"}</span>}>
              <WalletGate net={net} why="Your wallet funds the order. Fees are paid in USDC.">
                <p className="done-line"><CircleCheck size={17} />Connected to {net.label}</p>
              </WalletGate>
            </Step>

            <Step n="02" title="Your key card" done={!!card}
                  aside={<span className={card ? "ok" : "mk-aside"}>{card ? "ready" : "not yet"}</span>}>
              {!card && (
                <p className="slab-why">
                  <strong>{KEY_CARD_LINE}</strong> The only thing that can ever redirect this
                  money. Made here, never sent anywhere.
                </p>
              )}
              <KeyCardCreator net={net} onReady={setCard} />
            </Step>
          </>
        )}

        <fieldset disabled={!card || action.busy} className="make-terms">
          <Step n="03" title="Who gets paid" done={whoDone}>
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
          </Step>

          <Step n="04" title="How long" done={whenDone}>
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
          </Step>

          <Step n="05" title="How much to put in" done={fundDone}
                aside={calc.payments > 0n ? <span className="mk-aside">{calc.payments.toString()} payments</span> : undefined}>
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
          </Step>
        </fieldset>
      </div>

      {/* The order as it will exist, filled in as the form is. The closing bar
          sits at its foot: until there is a figure worth printing it says
          what is still missing, never a placeholder total like "— USDC". */}
      <aside className="mk-side">
        <div className="mk-draft">
          <div className="mk-draft-head"><span>Standing order · draft</span><span>{net.label}</span></div>
          <DraftRow k="pays" v={calc.amt ? usdc(calc.amt) : null} />
          <DraftRow k="every" v={intervalText ?? null} />
          <DraftRow k="to" v={isAddress(beneficiary) ? short(beneficiary) : null} />
          <DraftRow k="first payment" v={asap ? "in about 2 min" : calc.errors.first ? null : formatDate(calc.startAt)} />
          <DraftRow k="last by" v={calc.errors.end || Number.isNaN(Number(calc.endTime)) ? null : formatDay(calc.endTime)} />
          <DraftRow k="payments" v={calc.payments > 0n ? calc.payments.toString() : null} />
          <DraftRow k="tip up to" v={calc.cap !== null && calc.amt ? usdc(calc.cap) : null} />
          <div className="mk-rule">who may change it</div>
          <div className="mk-row"><span className="k">the wallet that funds it</span><span className="stamp">refused</span></div>
          <div className="mk-row"><span className="k">us, the authors</span><span className="stamp">refused</span></div>
          <div className="mk-row mk-row-card"><span className="k">your key card</span><span className="v" key={card ? "y" : "n"}>{card ? "the only thing that can" : "make it in step 02"}</span></div>

          <div className="make-bar">
            <div className="mb-sum">
              {calc.funding ? (
                <>
                  <div className="mb-k">you put in</div>
                  <div className="mb-big num" key={calc.funding.toString()}>{usdc(calc.funding)}</div>
                  <div className="mb-line">
                    pays <strong>{usdc(calc.amt!)}</strong> {intervalText} to{" "}
                    <span className="mono">{short(beneficiary)}</span>,{" "}
                    {asap ? "starting in about 2 min" : `starting ${formatDate(calc.startAt)}`}
                  </div>
                </>
              ) : (
                <div className="mb-todo">{missing}</div>
              )}
            </div>
            <div className="mb-act">
              <WalletGate net={net}>
                <button className="btn btn-primary btn-xl" disabled={!calc.ready || action.busy} onClick={submit}>Sign and create order <ArrowRight size={18} /></button>
              </WalletGate>
              <StatusLine status={action.status} net={net} />
            </div>
          </div>
        </div>
        <p className="make-foot">One signature, then one transaction. Anything left over comes back to you.</p>
      </aside>
    </div>
  );
}
