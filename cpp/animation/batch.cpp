// Immutable clip data and reusable pose buffers. Babylon owns the target nodes.
#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <emscripten/bind.h>
#include <vector>

class AnimationBatch {
  // Track: group, pose, sample kind, first key, key count.
  // Key: frame, value[4], in tangent[4], out tangent[4], flags.
  // Kind: component count 1..4; 5 denotes quaternion slerp.
  static constexpr size_t keyStride = 14, trackStride = 5;
  std::vector<uint32_t> tracks, kinds;
  std::vector<double> keys, base, output, weights, jobs;
  std::vector<std::vector<uint32_t>> groups;
  bool ready = false;
  static uint32_t width(uint32_t kind) { return kind == 5 ? 4 : kind; }
  static void normalize(double *v) {
    double length =
        std::sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2] + v[3] * v[3]);
    if (length && length != 1)
      for (int i = 0; i < 4; ++i)
        v[i] /= length;
  }
  static void mix(const double *a, const double *b, double t, uint32_t kind,
                  double *result, bool normalized) {
    double left = 1 - t, right = t;
    if (kind == 5) {
      double dot = 0;
      for (int i = 0; i < 4; ++i)
        dot += a[i] * b[i];
      bool negative = dot < 0;
      dot = std::abs(dot);
      if (dot <= 0.999999) {
        double angle = std::acos(dot), inverse = 1 / std::sin(angle);
        left = std::sin((1 - t) * angle) * inverse;
        right = std::sin(t * angle) * inverse;
      }
      if (negative)
        right = -right;
    }
    for (uint32_t i = 0; i < width(kind); ++i)
      result[i] = a[i] * left + b[i] * right;
    if (kind == 5 && normalized)
      normalize(result);
  }
  void sample(const uint32_t *track, double frame, double *result) const {
    size_t first = track[3], count = track[4], lo = 0, hi = count;
    // upper_bound preserves Babylon's last-key-at-equal-frame semantics.
    while (lo < hi) {
      size_t mid = lo + (hi - lo) / 2;
      if (keys[(first + mid) * keyStride] <= frame)
        lo = mid + 1;
      else
        hi = mid;
    }
    size_t index = lo ? lo - 1 : 0;
    const auto *a = &keys[(first + index) * keyStride];
    uint32_t kind = track[2], size = width(kind);
    if (!lo || index == count - 1 || (uint32_t(a[13]) & 1)) {
      std::copy_n(a + 1, size, result);
      return;
    }
    const auto *b = a + keyStride;
    double delta = b[0] - a[0], t = (frame - a[0]) / delta;
    if ((uint32_t(a[13]) & 4) && (uint32_t(b[13]) & 2)) {
      double t2 = t * t, t3 = t2 * t;
      for (uint32_t i = 0; i < size; ++i)
        result[i] =
            (2 * t3 - 3 * t2 + 1) * a[1 + i] + (-2 * t3 + 3 * t2) * b[1 + i] +
            (t3 - 2 * t2 + t) * a[9 + i] * delta + (t3 - t2) * b[5 + i] * delta;
      if (kind == 5)
        normalize(result);
    } else
      mix(a + 1, b + 1, t, kind, result, false);
  }

public:
  bool reserve(uint32_t groupCount, uint32_t poseCount, uint32_t trackCount,
               uint32_t keyCount) {
    ready = false;
    // Safety limits are independent of the configurable, lower runtime budgets.
    if (groupCount > 65536 || poseCount > 65536 || trackCount > 65536 ||
        keyCount > 4194304)
      return false;
    groups.assign(groupCount, {});
    kinds.resize(poseCount);
    tracks.resize(size_t(trackCount) * trackStride);
    keys.resize(size_t(keyCount) * keyStride);
    base.resize(size_t(poseCount) * 4);
    output.resize(base.size());
    weights.resize(poseCount);
    return true;
  }
  bool seal() {
    ready = false;
    for (auto &g : groups)
      g.clear();
    for (size_t i = 0; i < kinds.size(); ++i) {
      if (!kinds[i] || kinds[i] > 5)
        return false;
      for (uint32_t j = 0; j < width(kinds[i]); ++j)
        if (!std::isfinite(base[i * 4 + j]))
          return false;
    }
    for (size_t i = 0; i < tracks.size(); i += trackStride) {
      const auto *t = &tracks[i];
      if (t[0] >= groups.size() || t[1] >= kinds.size() || !t[2] || t[2] > 5 ||
          width(t[2]) != width(kinds[t[1]]) || !t[4] ||
          t[3] > keys.size() / keyStride ||
          t[4] > keys.size() / keyStride - t[3])
        return false;
      double previous = -INFINITY;
      for (size_t k = t[3]; k < size_t(t[3]) + t[4]; ++k) {
        const auto *key = &keys[k * keyStride];
        for (size_t j = 0; j < keyStride; ++j)
          if (!std::isfinite(key[j]))
            return false;
        if (key[0] < previous || key[13] < 0 || key[13] > 7 ||
            key[13] != std::floor(key[13]))
          return false;
        previous = key[0];
      }
      groups[t[0]].push_back(i);
    }
    return ready = true;
  }
  bool reserveJobs(uint32_t count) {
    if (count > 131072)
      return false;
    if (jobs.size() < size_t(count) * 3)
      jobs.resize(size_t(count) * 3);
    return true;
  }
  bool evaluate(uint32_t count) {
    if (!ready || count > jobs.size() / 3)
      return false;
    // Reject the complete input before modifying any result.
    for (size_t i = 0; i < size_t(count) * 3; i += 3)
      if (!std::isfinite(jobs[i]) || jobs[i] < 0 || jobs[i] >= groups.size() ||
          jobs[i] != std::floor(jobs[i]) || !std::isfinite(jobs[i + 1]) ||
          !std::isfinite(jobs[i + 2]) || jobs[i + 2] < 0 || jobs[i + 2] > 1)
        return false;
    std::copy(base.begin(), base.end(), output.begin());
    std::fill(weights.begin(), weights.end(), 0);
    for (size_t j = 0; j < size_t(count) * 3; j += 3) {
      double weight = jobs[j + 2];
      if (!weight)
        continue;
      for (auto i : groups[uint32_t(jobs[j])]) {
        const auto *track = &tracks[i];
        size_t pose = track[1];
        double value[4]{};
        sample(track, jobs[j + 1], value);
        auto *out = &output[pose * 4];
        if (weights[pose])
          mix(out, value, weight / (weights[pose] + weight), kinds[pose], out,
              true);
        else
          std::copy_n(value, width(kinds[pose]), out);
        weights[pose] += weight;
      }
    }
    for (size_t i = 0; i < kinds.size(); ++i)
      if (weights[i] < 1)
        mix(&base[i * 4], &output[i * 4], weights[i], kinds[i], &output[i * 4],
            true);
    return true;
  }
#define VIEW(name, member)                                                     \
  emscripten::val name() {                                                     \
    return emscripten::val(                                                    \
        emscripten::typed_memory_view(member.size(), member.data()));          \
  }
  VIEW(trackView, tracks)
  VIEW(kindView, kinds)
  VIEW(keyView, keys)
  VIEW(baseView, base)
  VIEW(jobView, jobs)
  VIEW(poseView, output)
#undef VIEW
};

EMSCRIPTEN_BINDINGS(arkglide_animation_batch) {
  emscripten::class_<AnimationBatch>("AnimationBatch")
      .constructor<>()
      .function("reserve", &AnimationBatch::reserve)
      .function("seal", &AnimationBatch::seal)
      .function("reserveJobs", &AnimationBatch::reserveJobs)
      .function("evaluate", &AnimationBatch::evaluate)
      .function("trackView", &AnimationBatch::trackView)
      .function("kindView", &AnimationBatch::kindView)
      .function("keyView", &AnimationBatch::keyView)
      .function("baseView", &AnimationBatch::baseView)
      .function("jobView", &AnimationBatch::jobView)
      .function("poseView", &AnimationBatch::poseView);
}
