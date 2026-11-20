/*
 * Stand-in for the pre-standard <stack.h> (easy68k-mac shim), used by
 * STRUCTURED.CPP:12 for stcStack, dbStack and forStack.
 *
 * Difference from a plain std::stack, on purpose: top() and pop() on an
 * EMPTY stack raise the shim's CPU-fault exception instead of reading or
 * writing outside the container. In the original (Borland, STLport) the
 * first such access reads through a null pointer; the access violation is
 * caught by asmStructure()'s catch(...), which reports "Invalid syntax"
 * (docs/porting/assembler.md 9.3.6). After a stack has been used and
 * emptied the original reads stale heap data instead - not knowable - and
 * the port gives the same deterministic "Invalid syntax" in that case too.
 */
#ifndef EZ_STACK_H
#define EZ_STACK_H

#include <vector>

template <class T, class Container = std::vector<T> >
class stack {
public:
  bool empty() const { return c.empty(); }
  size_t size() const { return c.size(); }
  void push(const T &v) { c.push_back(v); }
  T &top() {
    if (c.empty())
      ez_fault(EZ_FAULT_ACCESS);
    return c.back();
  }
  void pop() {
    if (c.empty())
      ez_fault(EZ_FAULT_ACCESS);
    c.pop_back();
  }
private:
  Container c;
};

#endif
