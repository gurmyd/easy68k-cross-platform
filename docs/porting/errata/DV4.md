# Errata of DV4 (desktop serial ports and network)

What DV4 found while building the serial and network tasks of the desktop app from
`docs/ARCHITECTURE.md` 3.3.4, 7.6 and 9.6, trap15-a §6 and trap15-b §12, checked against the
original's code (`Net.cpp`, `simIOu.cpp:2048-2464`, `CODE9.CPP`): where the document is silent or
does not fit the code that exists, what the repository does, and why.

## Contract

### 1. The device bridge is not part of `Platform` (3.13, 3.3.4)

- The Serial Ports dialog asks the main process for the serial devices of the machine
  (`serial.list`). The bridge for that is `DesktopPlatform.deviceBridge` (`app/src/platform/desktop.ts`,
  DV2 errata 3), which the contract's `Platform` does not declare.
- Does: `features/desktop-devices/model.ts` `deviceBridgeOf(ctx.platform)` reads the member if it
  is there (a local adapter); on the web it finds none and the dialog lists no devices.
- For W1: `readonly deviceBridge: DesktopDeviceBridge | null` on `Platform` (null on the web), as
  DV2 errata 3 proposed.

### 2. No command opens the Serial Ports dialog (3.12, 9.6)

- 9.6 asks for "the `COMn` to device mapping dialog" in `features/desktop-devices`, but the command
  tables (W3's `commands/specs.ts`, `tables/sim-menu.ts`) have no id for it, and the registry
  refuses a handler for an id it does not know.
- Does: the feature registers the dialog `desktop-devices.serialPorts` and exports
  `openSerialPortsDialog(ctx)`. It registers a handler for `sim.options.serialPorts` (enabled in
  the desktop app only) as soon as `COMMAND_SPECS` has that id, and none before.
- Request: `docs/requests/DV4-serial-ports-command.md`.

### 3. A device call that finishes later (3.3.4, DV2 errata 8)

- 3.3.4: open, configure, send, close and name lookup are synchronous bridge calls; "the main
  process sets the reply when the operation has finished". Opening a serial port, binding and
  connecting a socket, sending a datagram and looking up a name finish later in Node (callbacks,
  events). DV2's `answerDeviceRequest` set `event.returnValue` with whatever the handler returned
  at once, so a handler could not wait.
- Does: a device handler returns a Promise for such a call; `registerSyncIpc` (DV2's
  `desktop/src/sync-ipc.ts`) sets `event.returnValue` when it settles (a rejection answers
  `undefined`). The page waits meanwhile, as the original's window waits in Winsock. Electron
  supports a `returnValue` set later: the page stays in `ipcRenderer.sendSync` until it is set
  (seen in `tests/desktop/dev/dv4-net.spec.ts`, whose TCP connects wait 500 ms that way).
- This change and the two lines that register the devices in `desktop/src/main.ts` are in DV2's
  files. They are made on DV4's branch, because without them nothing of 3.3.4 can run, and are
  described exactly for DV2 in `docs/requests/DV4-device-wiring.md`.

## Files in other packages' folders

### 4. Tests in `tests/desktop/dev` (DV2's folder)

- The CI job `desktop-dev` runs every `*.spec.ts` of `tests/desktop/dev` on macOS. DV4's runner
  tests are files of their own there: `dv4-net.spec.ts`, `dv4-serial.spec.ts` and their helpers
  `dv4-helpers.ts` (owner DV4). They use DV2's `harness.ts` as it is.
- On Windows (and on any system without pseudo-terminals) the two serial tests are skipped with
  the reason "pseudo-terminals exist on macOS and Linux only"; the network tests and the dialog
  test run everywhere.

## Decisions where the document is silent

### 5. Where the original's network model lives

- 3.3.4 puts "the devices" in the main process. The port keeps the original's whole model of
  `Net.cpp` (one socket, `mode`, `type`, `netInitialized`, `bound`, `remote`, Winsock's start-up
  count, every result code) in the page, in `core/sim-host/net/desktop.ts`; the main process
  (`desktop/src/net.ts`) only owns the sockets and answers plain questions (open, bind, connect,
  send, close, look up, local address). Receives must be answered from the page's buffer, so the
  page must know `bound`, `mode` and `type` anyway; with the whole model in one place the quirks of
  §12 are written once and tested under Node. The same split for the serial ports
  (`core/sim-host/serial/desktop.ts` and `desktop/src/serial.ts`).

### 6. Winsock's start-up count and the closed handle (trap15-b §12.1-12.3)

- The page counts `WSAStartup` calls not yet matched by `WSACleanup` and remembers whether the
  socket handle is live, closed, or was never made (`sock == NULL`). From that it gives the
  original's answers for the cases §12 lists as UNVERIFIED, all derived from the source:
  - send, close, local address with Winsock not started: `$276D0001` (WSANOTINITIALISED);
  - close after a task 100/101 with an unsupported protocol (Winsock started, no socket):
    `$27360001` (WSAENOTSOCK), and Winsock stays started, so task 105 then succeeds (§12.3);
  - a receive after a reset that closed the socket, with `bound` still set: `$276D0001`;
  - a UDP client created after an earlier session had `bound` set receives on an unbound socket:
    `$27260001` (WSAEINVAL, §12.3).

### 7. Error numbers

- The main process reports Node's error names; `WINSOCK_ERRORS` in `core/sim-host/net/desktop.ts`
  maps them to the Winsock numbers (10000 + the BSD number, winsock.h). `EPIPE` (no Winsock
  counterpart) becomes WSAECONNRESET; a name not in the table becomes WSAENETDOWN.
- So that the same program gets the same D0 on every system, the page itself answers three cases
  that the operating systems answer differently: a UDP send to address 0 or port 0
  (WSAEADDRNOTAVAIL, `$27410001`), a UDP send to 255.255.255.255 (what `inet_addr` gives for a
  string that is no address: broadcast without SO_BROADCAST, WSAEACCES, `$271D0001`), and a TCP
  send on a socket that is not connected (the listening socket of a server, WSAENOTCONN,
  `$27490001`).

### 8. Task 100 over TCP: the connect loop (V14)

- Implemented as written in Net.cpp:195-216, as 3.3.4 says: the bridge call waits in steps of
  500 ms and looks at the connection after each step but the last (the original tries `connect`
  at 0, 500, ..., 4500 ms and leaves the loop after the tenth sleep); connected gives 0, an error
  `(code << 16) + 1`, and after 5000 ms the connection is pending and the task returns 0. A
  connection to a local server therefore takes 500 ms, as in the original. Which behaviour the
  Winsock 1.1 binary really shows remains item V14.
- A connection that failed is reported once; the next attempt (the retry inside tasks 102 and 106)
  starts a new connection, as a new `connect()` on the socket does.

### 9. TCP server: the system listens from task 101 on

- The original binds at task 101 and listens only inside the first receive. Node cannot bind a
  TCP socket without listening, so the main process listens at task 101 and keeps the first client
  that connects until the program's receive "accepts" it; later clients are refused once the first
  is accepted, as in the original. A client that connects before the program's first receive is
  therefore accepted where the original would refuse it (`docs/differences/DV4.md`).

### 10. Task 105

- "The first address of the local host" (gethostbyname of the host name) is, as 3.3.4 says, the
  first non-internal IPv4 address of the machine (`os.networkInterfaces()`); 127.0.0.1 when there
  is none. Written with its terminator, at most 16 bytes.

### 11. Serial ports in the main process

- `serialport` and its native module are loaded at the first serial call (dynamic `import()`), so a
  window that never opens a port never loads them, and a module that cannot be loaded makes task
  40 fail with 2 instead of stopping the app.
- serialport can change only the baud rate of an open port (`update`). Task 41 with other parity,
  data bits or stop bits closes the port and opens it again with the new settings; if that fails
  the old settings are restored and the result is 2.
- Ports are opened with `lock: true` (exclusive, as `CreateFile(..., 0, ...)` is).
- Port names are compared without regard to letter case (`com4` finds `COM4`), as Windows compares
  device names.
- The bytes waiting in the page are limited to 64 KB per port and the datagrams to 256 KB per
  socket; later ones are dropped, as a full driver or socket buffer drops them.

### 12. Each window's devices end with its page

- The main process keeps the devices per `WebContents` and closes them when the window closes and
  when its page navigates or reloads (a new page has a new simulator, whose model starts with
  nothing open).

### 13. TCP receive with a buffer size of 0

- Winsock's answer to `recv` with length 0 on a stream socket is not documented in the specs; the
  port reports 0 bytes and result 0 unless the peer has closed.

### 14. Task 100 with a host name: `remote` after the lookup (repaired after verification)

- Net.cpp:173 assigns `remote.sin_addr.s_addr = inet_addr(server)` before it calls
  `gethostbyname`, so a name that is not a dotted address leaves `remote` at INADDR_NONE
  (255.255.255.255) even when the lookup then fails and the task returns 8. The port does the
  same: a send after a failed lookup is a broadcast without SO_BROADCAST, `$271D0001`, and sends
  nothing (the first version kept the old address and really sent a datagram there).
- Net.cpp:174-185 treats every answer of `gethostbyname` as success. A lookup that answers
  255.255.255.255 (the string "255.255.255.255" itself, which `inet_addr` refuses; Node's lookup
  returns it) therefore gives 0 and writes "255.255.255.255" to (A2), and `remote` stays
  INADDR_NONE. Whether Winsock's `gethostbyname` accepts that numeric string as Node does is not
  verified (no Windows check of it was possible here); if it does not, the original gives 8.
