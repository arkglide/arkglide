// CPU render preparation only. GPU resources remain owned by the renderer.
#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <emscripten/bind.h>
#include <limits>
#include <vector>

class RenderBatch {
  std::vector<double> positions, accumulated, boxes;
  std::vector<float> normals;
  std::vector<uint32_t> indices, visible;
  std::array<double, 24> planes{};

public:
  void reserveGeometry(uint32_t vertices, uint32_t indexCount) {
    if (vertices > std::numeric_limits<size_t>::max() / 3)
      return;
    if (positions.size() < size_t(vertices) * 3) {
      positions.resize(size_t(vertices) * 3);
      accumulated.resize(size_t(vertices) * 3);
      normals.resize(size_t(vertices) * 3);
    }
    if (indices.size() < indexCount)
      indices.resize(indexCount);
  }
  emscripten::val positionView() {
    return emscripten::val(
        emscripten::typed_memory_view(positions.size(), positions.data()));
  }
  emscripten::val indexView() {
    return emscripten::val(
        emscripten::typed_memory_view(indices.size(), indices.data()));
  }
  emscripten::val normalView() {
    return emscripten::val(
        emscripten::typed_memory_view(normals.size(), normals.data()));
  }
  bool computeNormals(uint32_t vertices, uint32_t indexCount,
                      bool rightHanded) {
    if (vertices > positions.size() / 3 || indexCount > indices.size() ||
        indexCount % 3)
      return false;
    size_t size = size_t(vertices) * 3;
    for (size_t i = 0; i < size; i++)
      if (!std::isfinite(positions[i]))
        return false;
    for (size_t i = 0; i < indexCount; i++)
      if (indices[i] >= vertices)
        return false;
    std::fill(accumulated.begin(), accumulated.begin() + size, 0);
    for (size_t i = 0; i < indexCount; i += 3) {
      size_t a = size_t(indices[i]) * 3, b = size_t(indices[i + 1]) * 3,
             c = size_t(indices[i + 2]) * 3;
      double ax = positions[a] - positions[b],
             ay = positions[a + 1] - positions[b + 1],
             az = positions[a + 2] - positions[b + 2],
             bx = positions[c] - positions[b],
             by = positions[c + 1] - positions[b + 1],
             bz = positions[c + 2] - positions[b + 2];
      double x = ay * bz - az * by, y = az * bx - ax * bz,
             z = ax * by - ay * bx;
      double length = std::sqrt(x * x + y * y + z * z);
      // Babylon gives each non-degenerate face equal weight.
      double factor = (rightHanded ? -1.0 : 1.0) / (length ? length : 1.0);
      x *= factor;
      y *= factor;
      z *= factor;
      for (auto v : {a, b, c}) {
        accumulated[v] += x;
        accumulated[v + 1] += y;
        accumulated[v + 2] += z;
      }
    }
    for (size_t i = 0; i < size; i += 3) {
      double x = accumulated[i], y = accumulated[i + 1], z = accumulated[i + 2];
      double length = std::sqrt(x * x + y * y + z * z);
      if (!length)
        length = 1;
      normals[i] = x / length;
      normals[i + 1] = y / length;
      normals[i + 2] = z / length;
    }
    return true;
  }
  void reserveBoxes(uint32_t count) {
    if (count > std::numeric_limits<size_t>::max() / 6)
      return;
    if (boxes.size() < size_t(count) * 6) {
      boxes.resize(size_t(count) * 6);
      visible.resize(count);
    }
  }
  emscripten::val boxView() {
    return emscripten::val(
        emscripten::typed_memory_view(boxes.size(), boxes.data()));
  }
  emscripten::val planeView() {
    return emscripten::val(
        emscripten::typed_memory_view(planes.size(), planes.data()));
  }
  emscripten::val visibleView() {
    return emscripten::val(
        emscripten::typed_memory_view(visible.size(), visible.data()));
  }
  int32_t cull(uint32_t count, double epsilon) {
    if (count > boxes.size() / 6 || !std::isfinite(epsilon) || epsilon < 0)
      return -1;
    bool validPlanes = std::all_of(planes.begin(), planes.end(),
                                   [](double v) { return std::isfinite(v); });
    uint32_t written = 0;
    for (uint32_t i = 0; i < count; i++) {
      const auto *box = &boxes[size_t(i) * 6];
      bool valid = validPlanes;
      for (int j = 0; j < 6; j++)
        valid = valid && std::isfinite(box[j]);
      for (int j = 0; j < 3; j++)
        valid = valid && box[j] <= box[j + 3];
      bool inside = true;
      if (valid)
        for (int p = 0; p < 6; p++) {
          const auto *n = &planes[p * 4];
          double distance = n[0] * box[n[0] >= 0 ? 3 : 0] +
                            n[1] * box[n[1] >= 0 ? 4 : 1] +
                            n[2] * box[n[2] >= 0 ? 5 : 2] + n[3];
          if (distance < -epsilon) {
            inside = false;
            break;
          }
        }
      // Unknown/deforming bounds are retained conservatively.
      if (inside)
        visible[written++] = i;
    }
    return written;
  }
};

EMSCRIPTEN_BINDINGS(arkglide_render_batch) {
  emscripten::class_<RenderBatch>("RenderBatch")
      .constructor<>()
      .function("reserveGeometry", &RenderBatch::reserveGeometry)
      .function("positionView", &RenderBatch::positionView)
      .function("indexView", &RenderBatch::indexView)
      .function("normalView", &RenderBatch::normalView)
      .function("computeNormals", &RenderBatch::computeNormals)
      .function("reserveBoxes", &RenderBatch::reserveBoxes)
      .function("boxView", &RenderBatch::boxView)
      .function("planeView", &RenderBatch::planeView)
      .function("visibleView", &RenderBatch::visibleView)
      .function("cull", &RenderBatch::cull);
}
