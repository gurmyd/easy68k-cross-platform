# Differences of DV4 (desktop serial ports and network)

Deliberate differences from EASy68K v5.16.1 on Windows in TRAP #15 tasks 40-43 and 100-107, as
the desktop app gives them. A browser has no serial ports and no network: there every task gives
the original's own "not available" result (note 37 of 1.4), unchanged.

## Serial ports (tasks 40-43)

- **Port names.** Windows names serial ports `COM1`, `COM2`, ...; a Mac names them
  `/dev/cu.<something>`. A program still opens `COM4` with task 40: the Serial Ports dialog (to be
  reached from Simulator mode's Options menu, docs/requests/DV4-serial-ports-command.md) says which
  device each name stands for
  (`AppSettings.serialPortMap`). A name with no device gives result 2, as a COM port that does not
  exist does. Names are compared without regard to letter case.
- **Task 42 does not wait.** The original waits up to `count + 1` ms (plus the inter-character
  timeout) for bytes that have not arrived yet; the port returns at once with what has arrived
  (result 4 when that is fewer than asked for). A program that polls, as programs for the original
  must anyway, sees the same bytes; a program that relies on the short wait may see more short
  reads.
- **Task 43 returns when the system has taken the bytes**, not when they have left the wire.
- **Line settings the device cannot do.** A setting of task 41 that the Mac's serial driver refuses
  gives result 2, where Windows may accept it. Mark parity is one: macOS has no mark parity, and
  task 41 with parity 3 gives 2 there (seen on GitHub's macOS 15 runner against a pseudo-terminal;
  the port stays open with its previous settings).
- **Changing parity, data bits or stop bits** closes the device and opens it again with the new
  settings (only the baud rate can be changed on an open port on a Mac); bytes the driver held
  and had not passed on yet are lost.
- **Buffers.** At most 64 KB per port wait to be read; more is dropped.

## Network (tasks 100-107)

- **TCP server, task 101.** The original binds at task 101 and starts listening at the program's
  first receive; the port listens from task 101 on. A client that connects before the server's
  first receive is accepted (and its data kept) where the original would refuse the connection.
  After the one client is accepted, others are refused, as in the original.
- **Task 105** gives the first non-internal IPv4 address of the machine; the original gives the
  first address its host name resolves to. On most machines they are the same address.
- **Task 100 with a host name** looks the name up as macOS does (DNS, `/etc/hosts`, mDNS), not as
  Windows does; a name only Windows knows (a NetBIOS name, say) fails with 8.
- **Errors** are the Winsock numbers the original would report for the same situation, mapped from
  the Mac's own error numbers; where the two systems disagree about what a situation is (a send to
  a broadcast address, to address 0 or port 0), the Winsock answer is given.
- **Buffers.** At most 256 KB of datagrams wait to be read per socket; more are dropped, as a full
  socket buffer drops them.
- The waits of the original are kept: task 100 over TCP waits for the connection in steps of
  500 ms for up to 5 seconds, and a name lookup takes as long as it takes, with the window waiting.
