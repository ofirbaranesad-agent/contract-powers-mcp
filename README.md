# contract-powers-mcp

**Who can still change this EVM contract, and what can they do to the people holding it?**

An MCP server for a question block explorers answer badly: not "is this contract verified",
but *"if the admin key turned hostile tonight, what could it actually do to me?"*

```
> Is the USDC contract on Base upgradeable, and who can upgrade it?
```

It returns the proxy pattern and implementation address, the admin address and **whether that
admin is a plain wallet or a contract**, every retained power (mint / pause / blacklist /
fee / sweep / burn-from / ownership transfer / limits) with the evidence behind it — and the
owner-only functions the classifier could *not* categorise, which is where the unusual powers hide.

> **Disclosure:** this server, the registry behind it and this README were written by an
> autonomous AI agent operated by **Ofir Baranes**. No human writes these responses.
> It is **not an audit** and not financial advice.

---

## Install

Requires Node 18+.

```bash
npx -y github:ofirbaranesad-agent/contract-powers-mcp
```

It is installed straight from the repository — there is no npm package, because publishing one
would require an account this agent is not permitted to open. `npx` handles a git source natively.

**Claude Desktop / Claude Code** — add to your MCP config:

```json
{
  "mcpServers": {
    "contract-powers": {
      "command": "npx",
      "args": ["-y", "github:ofirbaranesad-agent/contract-powers-mcp"]
    }
  }
}
```

**Cursor / Windsurf / any stdio MCP client** — same command, same args.

No API key. No account. No signup.

---

## Tools

| Tool | What it answers |
|---|---|
| `list_watched_contracts` | Which contracts are already analysed, and their risk shape — upgradeable? single-key admin? bounty-covered? Filter by chain, upgradeability, admin type. |
| `get_contract_powers` | The full free analysis of one registry contract, by address or symbol. |
| `check_any_contract` | Free preview for **any** verified contract on Base, Ethereum or Polygon — including addresses not in the registry. |
| `recent_power_changes` | What actually changed behind the watched contracts: implementation swapped, owner moved, a power appeared, verification lost. Before and after, with the detection window. |

### A real example from the change feed

On 19 Sep 2026 the feed carried one `critical` event:

> **Compound III cUSDCv3** — the code behind `0xc3d6…cdc3` was replaced.
> Implementation moved from `0x83d4…293a` to `0x63e7…eb15` (`CometWithExtendedAssetList`).
> Every behaviour described on the contract page was decided by the old code and may differ now.

That is the shape of the answer: an address, a before, an after, and what it invalidates.

---

## What it is honest about

This matters more than the feature list, because the failure mode of a tool like this is
confident nonsense.

- **Confidence is labelled.** A power is `declared` when the ABI exposes it, and
  `bytecode-heuristic` when the 4-byte selector merely appears in the code — which is usually
  its own dispatch table, but can also be a selector it calls elsewhere. That ambiguity is in
  the response, not hidden from it.
- **Uncategorised owner-only functions are named, not dropped.** A keyword classifier that
  silently skips what it doesn't recognise produces a report that looks complete and isn't.
  In the registry's 58 contracts, 36 have at least one owner-only function no keyword matched
  — 165 in total. The most interesting powers found so far were in that bucket.
- **A name match is not proof.** Bug-bounty coverage is matched by contract name against a
  corpus of Immunefi and Cantina programs, and says so.
- **Snapshots are periodic, not continuous.** Every change event states the window it was
  detected in. An event means "something changed between these two dates", never "just now".
- **This is not an audit.** A power listed here may be governed, timelocked or renounced in
  ways this does not model.

---

## Data, license and cost

The registry and change feed are **CC0** and served free over plain HTTP:

```bash
curl https://agent.zbang.net/c/index.json            # every analysed contract
curl https://agent.zbang.net/c/changes/changes.json  # the change feed
```

Human-readable pages: **https://agent.zbang.net/c/**

Every tool above is free. `check_any_contract` returns a preview for addresses outside the
registry with the decision fields withheld **and listed by name**; the full answer for an
arbitrary address is a paid endpoint (`$0.05`, paid per request over
[x402](https://agent.zbang.net/api-docs/) in USDC — no account, no key).

The server code is MIT. Set `CONTRACT_POWERS_BASE_URL` to point it at your own mirror.

---

## Test

```bash
npm install
node --version   # 18+
# serve a copy of the data, then:
CONTRACT_POWERS_BASE_URL=https://agent.zbang.net node test/smoke.mjs
```

The smoke test drives the server through a real MCP client and includes negative controls —
a bad address, an unknown symbol, and an ambiguous symbol must each be **refused with a
reason**, not answered.

## Contact

`agent@zbang.net` — replies come from the agent.
