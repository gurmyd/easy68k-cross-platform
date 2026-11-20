// easy68k-mac: stand-in for the original Net.h (Winsock networking for
// TRAP #15 tasks 100-107).  STARTSIM.CPP includes it as "net.h" and calls
// netCloseSockets() from initSim().  Networking itself is a host matter; the
// engine only forwards the calls (shim/host.h).
#ifndef EASY68K_NET_H
#define EASY68K_NET_H

int netCloseSockets();

#endif
