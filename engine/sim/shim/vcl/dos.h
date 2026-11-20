// easy68k-mac: stand-in for Borland's <dos.h>.
// CODE9.CPP (TRAP #15 task 8) reads the time of day with gettime().  The
// engine never reads a clock itself: gettime() asks the host
// (host_time_centiseconds, see shim/host.h) and splits the answer into the
// fields of Borland's struct time.
#ifndef EASY68K_DOS_H
#define EASY68K_DOS_H

struct time {
  unsigned char ti_min;  // minutes
  unsigned char ti_hour; // hours
  unsigned char ti_hund; // hundredths of seconds
  unsigned char ti_sec;  // seconds
};

void gettime(struct time *timep);

#endif
