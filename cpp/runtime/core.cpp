// Logical runtime ownership. Browser objects and user callbacks never enter
// WASM.
#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <emscripten/bind.h>
#include <limits>
#include <set>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <vector>
using emscripten::val;
namespace {
using Mat = std::array<double, 16>;
Mat identity() {
  Mat m{};
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}
Mat multiply(const Mat &a, const Mat &b) {
  Mat m{};
  for (int c = 0; c < 4; c++)
    for (int r = 0; r < 4; r++)
      for (int k = 0; k < 4; k++)
        m[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return m;
}
uint32_t next(uint32_t &id) {
  if (id == std::numeric_limits<uint32_t>::max())
    return 0;
  return ++id;
}
} // namespace
class RuntimeWorld {
  struct Node {
    uint32_t handle = 0, parent = 0;
    std::string id, name;
    std::unordered_set<uint32_t> children;
    std::array<double, 9> trs{0, 0, 0, 0, 0, 0, 1, 1, 1};
    Mat local = identity(), world = identity();
    uint64_t localRev = 1, cachedLocal = 0, cachedParent = 0, worldRev = 0;
  };
  std::vector<Node> nodes;
  std::vector<uint32_t> freeSlots;
  std::unordered_map<uint32_t, uint32_t> slots;
  std::unordered_map<std::string, uint32_t> ids;
  std::unordered_map<std::string, std::set<uint32_t>> names;
  uint32_t sequence = 0;
  uint64_t revision = 0, updates = 0;
  Node *get(uint32_t h) {
    auto i = slots.find(h);
    return i == slots.end() ? nullptr : &nodes[i->second];
  }
  void evaluate(Node &n) {
    auto *p = get(n.parent);
    auto parentRev = p ? p->worldRev : 0;
    if (n.cachedLocal == n.localRev && n.cachedParent == parentRev)
      return;
    n.world = p ? multiply(p->world, n.local) : n.local;
    n.cachedLocal = n.localRev;
    n.cachedParent = parentRev;
    n.worldRev = ++revision;
    updates++;
  }

public:
  uint32_t create(const std::string &id, const std::string &name) {
    if (ids.count(id) || id.empty())
      return 0;
    uint32_t h = next(sequence);
    if (!h)
      return 0;
    uint32_t slot;
    if (freeSlots.empty()) {
      slot = nodes.size();
      nodes.emplace_back();
    } else {
      slot = freeSlots.back();
      freeSlots.pop_back();
      nodes[slot] = Node{};
    }
    auto &n = nodes[slot];
    n.handle = h;
    n.id = id;
    n.name = name;
    slots.emplace(h, slot);
    ids.emplace(id, h);
    names[name].insert(h);
    return h;
  }
  bool alive(uint32_t h) { return get(h) != nullptr; }
  uint32_t find(const std::string &id) {
    auto i = ids.find(id);
    return i == ids.end() ? 0 : i->second;
  }
  std::string name(uint32_t h) {
    auto *n = get(h);
    return n ? n->name : "";
  }
  bool rename(uint32_t h, const std::string &name) {
    auto *n = get(h);
    if (!n)
      return false;
    auto old = names.find(n->name);
    if (old != names.end()) {
      old->second.erase(h);
      if (old->second.empty())
        names.erase(old);
    }
    n->name = name;
    names[name].insert(h);
    return true;
  }
  val named(const std::string &name) {
    val a = val::array();
    auto it = names.find(name);
    uint32_t i = 0;
    if (it != names.end())
      for (auto h : it->second)
        a.set(i++, h);
    return a;
  }
  bool setParent(uint32_t h, uint32_t parent) {
    auto *n = get(h);
    if (!n || (parent && !get(parent)))
      return false;
    if (n->parent == parent)
      return true;
    for (auto *p = get(parent); p; p = get(p->parent))
      if (p->handle == h)
        return false;
    if (auto *p = get(n->parent))
      p->children.erase(h);
    n->parent = parent;
    if (auto *p = get(parent))
      p->children.insert(h);
    n->localRev++;
    return true;
  }
  uint32_t parent(uint32_t h) {
    auto *n = get(h);
    return n ? n->parent : 0;
  }
  bool transform(uint32_t h, double x, double y, double z, double rx, double ry,
                 double rz, double sx, double sy, double sz) {
    auto *n = get(h);
    if (!n)
      return false;
    std::array<double, 9> t{x, y, z, rx, ry, rz, sx, sy, sz};
    for (double v : t)
      if (!std::isfinite(v))
        return false;
    if (n->trs == t)
      return true;
    n->trs = t;
    double hx = rx * .5, hy = ry * .5, hz = rz * .5, cx = cos(hx),
           sxr = sin(hx), cy = cos(hy), syr = sin(hy), cz = cos(hz),
           szr = sin(hz);
    double qx = cy * sxr * cz + syr * cx * szr,
           qy = syr * cx * cz - cy * sxr * szr,
           qz = cy * cx * szr - syr * sxr * cz,
           qw = cy * cx * cz + syr * sxr * szr;
    auto &m = n->local;
    m = {(1 - 2 * (qy * qy + qz * qz)) * sx,
         2 * (qx * qy + qz * qw) * sx,
         2 * (qx * qz - qy * qw) * sx,
         0,
         2 * (qx * qy - qz * qw) * sy,
         (1 - 2 * (qx * qx + qz * qz)) * sy,
         2 * (qy * qz + qx * qw) * sy,
         0,
         2 * (qx * qz + qy * qw) * sz,
         2 * (qy * qz - qx * qw) * sz,
         (1 - 2 * (qx * qx + qy * qy)) * sz,
         0,
         x,
         y,
         z,
         1};
    n->localRev++;
    return true;
  }
  val world(uint32_t h) {
    auto *n = get(h);
    if (!n)
      return val::null();
    std::vector<uint32_t> chain;
    for (auto *p = n; p; p = get(p->parent))
      chain.push_back(p->handle);
    for (auto i = chain.rbegin(); i != chain.rend(); ++i)
      evaluate(*get(*i));
    return val(emscripten::typed_memory_view(16, n->world.data()));
  }
  void update() {
    std::vector<uint32_t> queue;
    queue.reserve(slots.size());
    for (auto &n : nodes)
      if (n.handle && !n.parent)
        queue.push_back(n.handle);
    for (size_t i = 0; i < queue.size(); i++) {
      auto *n = get(queue[i]);
      evaluate(*n);
      for (auto h : n->children)
        queue.push_back(h);
    }
  }
  val descendants(uint32_t h) {
    val a = val::array();
    std::vector<uint32_t> queue;
    if (auto *n = get(h))
      for (auto c : n->children)
        queue.push_back(c);
    for (size_t i = 0; i < queue.size(); i++) {
      auto *n = get(queue[i]);
      for (auto c : n->children)
        queue.push_back(c);
      a.set(i, queue[i]);
    }
    return a;
  }
  bool erase(uint32_t h) {
    auto i = slots.find(h);
    if (i == slots.end())
      return false;
    auto &n = nodes[i->second];
    if (auto *p = get(n.parent))
      p->children.erase(h);
    for (auto c : n.children)
      if (auto *child = get(c)) {
        child->parent = 0;
        child->localRev++;
      }
    auto name = names.find(n.name);
    if (name != names.end()) {
      name->second.erase(h);
      if (name->second.empty())
        names.erase(name);
    }
    ids.erase(n.id);
    freeSlots.push_back(i->second);
    n = Node{};
    slots.erase(i);
    return true;
  }
  void clear() {
    nodes.clear();
    freeSlots.clear();
    slots.clear();
    ids.clear();
    names.clear();
    updates = 0;
  }
  uint32_t count() const { return slots.size(); }
  uint32_t capacity() const { return nodes.size(); }
  double matrixUpdates() const { return updates; }
};
class RuntimeClock {
  struct Owner {
    uint32_t state = 1;
    std::unordered_set<uint32_t> timers;
  };
  struct Timer {
    uint32_t owner;
    double due, interval;
  };
  std::unordered_map<uint32_t, Owner> owners;
  std::unordered_map<uint32_t, Timer> timers;
  std::vector<uint32_t> due;
  size_t dueIndex = 0;
  uint32_t ownerSeq = 0, timerSeq = 0, maxSteps = 8, steps = 0;
  bool active = false, stopping = false, hasLast = false;
  double last = 0, accumulator = 0, maxDelta = .25;
  // Shared view: delta, unscaled delta, total, unscaled total, frame count,
  // fixed step, fixed total, fixed count, interpolation, dropped time, scale.
  std::array<double, 11> time{};

public:
  RuntimeClock() {
    time[5] = 1. / 60;
    time[10] = 1;
  }
  val view() {
    return val(emscripten::typed_memory_view(time.size(), time.data()));
  }
  void configure(double step, uint32_t max, double scale, double clamp) {
    time[5] = step;
    maxSteps = max;
    time[10] = scale;
    maxDelta = clamp;
    if (!stopping) {
      active = true;
      hasLast = false;
    }
  }
  void scale(double value) { time[10] = value; }
  bool beginFrame(double timestamp) {
    if (!active || stopping)
      return false;
    double raw = hasLast ? std::max(0., (timestamp - last) / 1000) : 0;
    last = timestamp;
    hasLast = true;
    double delta = std::min(raw, maxDelta);
    time[1] = delta;
    time[0] = delta * time[10];
    time[2] += time[0];
    time[3] += delta;
    time[4]++;
    time[9] += std::max(0., raw - maxDelta) * time[10];
    accumulator += time[0];
    steps = 0;
    return true;
  }
  bool nextFixed() {
    if (!active || stopping || steps >= maxSteps ||
        accumulator + 1e-10 < time[5])
      return false;
    accumulator -= time[5];
    steps++;
    time[6] += time[5];
    time[7]++;
    return true;
  }
  void finishFixed() {
    if (accumulator >= time[5]) {
      double lost = floor(accumulator / time[5]) * time[5];
      time[9] += lost;
      accumulator -= lost;
    }
    time[8] = std::max(0., accumulator / time[5]);
  }
  void pause() {
    active = false;
    hasLast = false;
    time[0] = time[1] = 0;
  }
  void resume() {
    if (!stopping) {
      active = true;
      hasLast = false;
    }
  }
  uint32_t addOwner() {
    if (stopping)
      return 0;
    uint32_t id = next(ownerSeq);
    if (id)
      owners.emplace(id, Owner{});
    return id;
  }
  uint32_t ownerState(uint32_t id) {
    auto i = owners.find(id);
    return i == owners.end() ? 0 : i->second.state;
  }
  bool startOwner(uint32_t id) {
    auto i = owners.find(id);
    if (i == owners.end() || i->second.state != 1)
      return false;
    i->second.state |= 2;
    return true;
  }
  bool beginDestroy(uint32_t id) {
    auto i = owners.find(id);
    if (i == owners.end() || (i->second.state & 4))
      return false;
    i->second.state |= 4;
    return true;
  }
  void removeOwner(uint32_t id) {
    auto o = owners.find(id);
    if (o == owners.end())
      return;
    for (auto timer : o->second.timers)
      timers.erase(timer);
    owners.erase(o);
  }
  uint32_t schedule(uint32_t owner, double seconds, bool repeat) {
    if (!(ownerState(owner) & 1) || (ownerState(owner) & 4) || stopping)
      return 0;
    uint32_t id = next(timerSeq);
    if (id) {
      timers.emplace(id, Timer{owner, time[2] + seconds, repeat ? seconds : 0});
      owners[owner].timers.insert(id);
    }
    return id;
  }
  void cancel(uint32_t id) {
    auto t = timers.find(id);
    if (t == timers.end())
      return;
    auto o = owners.find(t->second.owner);
    if (o != owners.end())
      o->second.timers.erase(id);
    timers.erase(t);
  }
  void beginTimers() {
    due.clear();
    dueIndex = 0;
    if (time[10] == 0)
      return;
    for (auto &i : timers)
      if (i.second.due <= time[2] + 1e-10)
        due.push_back(i.first);
    std::sort(due.begin(), due.end());
  }
  uint32_t nextTimer() {
    if (!active || stopping || time[10] == 0)
      return 0;
    while (dueIndex < due.size()) {
      auto id = due[dueIndex++];
      auto i = timers.find(id);
      if (i == timers.end())
        continue;
      if (!(ownerState(i->second.owner) & 1) ||
          (ownerState(i->second.owner) & 4)) {
        cancel(id);
        continue;
      }
      if (i->second.interval)
        i->second.due = time[2] + i->second.interval;
      else
        cancel(id);
      return id;
    }
    return 0;
  }
  void beginStop() {
    stopping = true;
    active = false;
  }
  void finishStop() {
    owners.clear();
    timers.clear();
    due.clear();
    hasLast = false;
    accumulator = 0;
    for (size_t i = 0; i < 9; i++)
      if (i != 5)
        time[i] = 0;
  }
  uint32_t ownerCount() const { return owners.size(); }
  uint32_t timerCount() const { return timers.size(); }
};
EMSCRIPTEN_BINDINGS(arkglide_runtime_core) {
  emscripten::class_<RuntimeWorld>("RuntimeWorld")
      .constructor<>()
      .function("create", &RuntimeWorld::create)
      .function("alive", &RuntimeWorld::alive)
      .function("find", &RuntimeWorld::find)
      .function("name", &RuntimeWorld::name)
      .function("rename", &RuntimeWorld::rename)
      .function("named", &RuntimeWorld::named)
      .function("setParent", &RuntimeWorld::setParent)
      .function("parent", &RuntimeWorld::parent)
      .function("transform", &RuntimeWorld::transform)
      .function("world", &RuntimeWorld::world)
      .function("update", &RuntimeWorld::update)
      .function("descendants", &RuntimeWorld::descendants)
      .function("erase", &RuntimeWorld::erase)
      .function("clear", &RuntimeWorld::clear)
      .function("count", &RuntimeWorld::count)
      .function("capacity", &RuntimeWorld::capacity)
      .function("matrixUpdates", &RuntimeWorld::matrixUpdates);
  emscripten::class_<RuntimeClock>("RuntimeClock")
      .constructor<>()
      .function("view", &RuntimeClock::view)
      .function("configure", &RuntimeClock::configure)
      .function("scale", &RuntimeClock::scale)
      .function("beginFrame", &RuntimeClock::beginFrame)
      .function("nextFixed", &RuntimeClock::nextFixed)
      .function("finishFixed", &RuntimeClock::finishFixed)
      .function("pause", &RuntimeClock::pause)
      .function("resume", &RuntimeClock::resume)
      .function("addOwner", &RuntimeClock::addOwner)
      .function("ownerState", &RuntimeClock::ownerState)
      .function("startOwner", &RuntimeClock::startOwner)
      .function("beginDestroy", &RuntimeClock::beginDestroy)
      .function("removeOwner", &RuntimeClock::removeOwner)
      .function("schedule", &RuntimeClock::schedule)
      .function("cancel", &RuntimeClock::cancel)
      .function("beginTimers", &RuntimeClock::beginTimers)
      .function("nextTimer", &RuntimeClock::nextTimer)
      .function("beginStop", &RuntimeClock::beginStop)
      .function("finishStop", &RuntimeClock::finishStop)
      .function("ownerCount", &RuntimeClock::ownerCount)
      .function("timerCount", &RuntimeClock::timerCount);
}
