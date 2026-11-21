# Request from W4 to W1: `app/src/contracts/` (comments and one declaration to share)

The mirror tests of section 3.2 pass against both engine modules as the contracts are: **no
declaration needs to change** (`docs/ENGINE-BINDING.md`, section 4). The three items below are
optional. They would put into the contracts what the binding does today and what other packages
would otherwise have to find in W4's document.

## 1. `AsmEngine.assemble`: say when it rejects, and what `fatal` covers (`engine.ts`, comments only)

Proposed additions to the comments:

```ts
export interface AsmResult {
  ...
  status: number; // the engine's own return value; -1 when `fatal` is set
  /** null normally. Otherwise the run ended abnormally - the original would have ended the whole
   *  editor process, the engine trapped, or no engine instance could be created ("The assembler
   *  could not start: ...") - and the other fields are empty. */
  fatal: string | null;
}

export interface AsmEngine {
  /** ...
   *  Resolves for everything that can happen to a program. Rejects only for arguments this
   *  comment forbids: a mainName that is not a key of `files`, a tabSize that is not an integer
   *  from -99 to 99, an invalid Date. */
  assemble(...): Promise<AsmResult>;
}
```

## 2. `HostNet.createNetClient`: the address is masked (`host.ts`, comment only)

"serverAddress is the 68000 address of the server string" - add "(`A2 & $FFFFFF`)". The binding
passes the address the original reads the string from, not the raw register
(`docs/porting/errata/W4.md`, entry 8).

## 3. `SimHostParts` in the contracts (`host.ts`, one declaration)

3.3.1 declares `SimHostParts` (the ten parts of a host) in `core/sim-host/index.ts` (SH8).
`app/src/engine/testing.ts` needs the same type for `createRecordingHost(parts)` and
`createTestEngine(parts)`, and `engine/` may not import `core/`, so it declares an identical
`HostParts` of its own. If `SimHostParts` moved to `contracts/host.ts`, SH8 and W4 would share one
declaration. The two are structurally the same today, so nothing breaks while they are separate.
