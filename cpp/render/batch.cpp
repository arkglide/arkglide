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
  std::vector<double> viewInputs, viewOutputs;
  std::array<double, 19> viewCameraData{};
  struct Candidate { uint32_t index; double area, scale; };
  std::vector<Candidate> viewCandidates;

public:
  void reserveViews(uint32_t count) {
    if (count > 65536) return;
    if (viewInputs.size() < size_t(count) * 10) {
      viewInputs.resize(size_t(count) * 10); viewOutputs.resize(size_t(count) * 4);
      viewCandidates.reserve(count);
    }
  }
  emscripten::val viewInput() { return emscripten::val(emscripten::typed_memory_view(viewInputs.size(), viewInputs.data())); }
  emscripten::val viewOutput() { return emscripten::val(emscripten::typed_memory_view(viewOutputs.size(), viewOutputs.data())); }
  emscripten::val viewCamera() { return emscripten::val(emscripten::typed_memory_view(viewCameraData.size(), viewCameraData.data())); }
  int32_t planViews(uint32_t count, uint32_t width, uint32_t height, uint32_t maxSize, double minArea, uint32_t maxViews, uint32_t maxPixels, uint32_t minResolution) {
    if (count > viewInputs.size() / 10 || !width || !height || !maxSize || maxViews > 64 || maxPixels > 67108864 || !minResolution || !std::isfinite(minArea) || minArea < 0 || minArea > 1 ||
        !std::all_of(viewCameraData.begin(), viewCameraData.end(), [](double v) { return std::isfinite(v); })) return -1;
    using Point = std::array<double, 4>;
    const auto &m = viewCameraData;
    viewCandidates.clear();
    for (uint32_t i = 0; i < count; i++) {
      const double *p = &viewInputs[size_t(i) * 10];
      if (!std::all_of(p, p + 10, [](double v) { return std::isfinite(v); }) || p[7] <= 0 || p[8] <= 0 || p[9] <= 0) continue;
      double x = p[3], y = p[4], z = p[5], w = p[6];
      double nx = 2 * (x*z + y*w), ny = 2 * (y*z - x*w), nz = 1 - 2 * (x*x + y*y);
      if ((m[16]-p[0])*nx + (m[17]-p[1])*ny + (m[18]-p[2])*nz <= 0) continue;
      std::array<Point, 16> polygon{}, next{}; size_t size = 4;
      const double signs[4][2] = {{-1,-1},{1,-1},{1,1},{-1,1}};
      for (size_t j = 0; j < 4; j++) {
        double u = signs[j][0]*p[7]/2, v = signs[j][1]*p[8]/2;
        double vx = p[0] + (1-2*(y*y+z*z))*u + 2*(x*y-z*w)*v,
               vy = p[1] + 2*(x*y+z*w)*u + (1-2*(x*x+z*z))*v,
               vz = p[2] + 2*(x*z-y*w)*u + 2*(y*z+x*w)*v;
        for (size_t k = 0; k < 4; k++) polygon[j][k] = vx*m[k] + vy*m[4+k] + vz*m[8+k] + m[12+k];
        // Match the aperture vertex shader's near-plane depth bias.
        if (polygon[j][3] > 0) polygon[j][2] = std::max(polygon[j][2], -polygon[j][3]);
      }
      for (size_t plane = 0; plane < 6 && size; plane++) {
        size_t written = 0;
        for (size_t j = 0; j < size; j++) {
          const Point &a = polygon[j], &b = polygon[(j+1)%size];
          double da = (plane & 1) ? a[3]-a[plane/2] : a[3]+a[plane/2],
                 db = (plane & 1) ? b[3]-b[plane/2] : b[3]+b[plane/2];
          if (da >= 0 && written < next.size()) next[written++] = a;
          if ((da >= 0) != (db >= 0) && written < next.size()) {
            double t = da/(da-db); for (size_t k = 0; k < 4; k++) next[written][k] = a[k]+(b[k]-a[k])*t;
            written++;
          }
        }
        size = written; polygon.swap(next);
      }
      if (!size) continue;
      double minX = 1, minY = 1, maxX = -1, maxY = -1;
      for (size_t j = 0; j < size; j++) {
        const auto &p = polygon[j]; if (p[3] <= 1e-10) continue;
        minX = std::min(minX,p[0]/p[3]); maxX = std::max(maxX,p[0]/p[3]);
        minY = std::min(minY,p[1]/p[3]); maxY = std::max(maxY,p[1]/p[3]);
      }
      double area = std::max(0.0,(maxX-minX)*(maxY-minY)/4);
      if (area > minArea && area > 0) viewCandidates.push_back({i,area,p[9]});
    }
    std::sort(viewCandidates.begin(),viewCandidates.end(),[](const Candidate &a,const Candidate &b) { return a.area != b.area ? a.area > b.area : a.index < b.index; });
    uint32_t written = 0, pixels = maxPixels;
    for (const auto &c : viewCandidates) {
      if (written >= maxViews || !pixels) break;
      double scale = std::min({c.scale, double(maxSize)/width, double(maxSize)/height});
      uint32_t vw = std::max(1.0,std::floor(width*scale)), vh = std::max(1.0,std::floor(height*scale));
      uint32_t minSide = std::min({minResolution,vw,vh});
      if (double(vw)*vh > pixels) {
        double factor = std::sqrt(double(pixels)/(double(vw)*vh));
        vw = std::max(1.0,std::floor(vw*factor)); vh = std::max(1.0,std::floor(vh*factor));
      }
      if (std::min(vw,vh) < minSide || double(vw)*vh > pixels) continue;
      pixels -= vw*vh; size_t at = size_t(written++)*4;
      viewOutputs[at]=c.index; viewOutputs[at+1]=vw; viewOutputs[at+2]=vh; viewOutputs[at+3]=c.area;
    }
    return written;
  }
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
      .function("reserveViews", &RenderBatch::reserveViews)
      .function("viewInput", &RenderBatch::viewInput)
      .function("viewOutput", &RenderBatch::viewOutput)
      .function("viewCamera", &RenderBatch::viewCamera)
      .function("planViews", &RenderBatch::planViews)
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
