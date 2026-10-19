// Conservative static LOD: vertex clustering with normal/UV partitions. This
// produces far-view proxies, not a topology-preserving modelling operation.
#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <emscripten/bind.h>
#include <unordered_map>
#include <unordered_set>
#include <vector>

class GeometryBatch {
  using Key=std::array<int32_t,8>;
  struct Hash {size_t operator()(const Key &k)const {size_t h=2166136261u;for(int32_t v:k)h=(h^uint32_t(v))*16777619u;return h;}};
  struct FaceHash {size_t operator()(const std::array<uint32_t,3>&k)const{return (size_t(k[0])*73856093u)^(size_t(k[1])*19349663u)^(size_t(k[2])*83492791u);}};
  std::vector<double> input;
  std::vector<uint32_t> indices, outputIndices;
  std::vector<float> output;
public:
  bool reserve(uint32_t vertices,uint32_t count){if(vertices>1000000||count>3000000)return false;input.resize(size_t(vertices)*8);indices.resize(count);return true;}
  emscripten::val inputView(){return emscripten::val(emscripten::typed_memory_view(input.size(),input.data()));}
  emscripten::val indexView(){return emscripten::val(emscripten::typed_memory_view(indices.size(),indices.data()));}
  emscripten::val outputView(){return emscripten::val(emscripten::typed_memory_view(output.size(),output.data()));}
  emscripten::val outputIndexView(){return emscripten::val(emscripten::typed_memory_view(outputIndices.size(),outputIndices.data()));}
  int32_t simplify(uint32_t vertices,uint32_t count,uint32_t grid){
    if(vertices>input.size()/8||count>indices.size()||count%3||grid<2||grid>128||!std::all_of(input.begin(),input.begin()+size_t(vertices)*8,[](double x){return std::isfinite(x)&&std::abs(x)<=1e9;})||!std::all_of(indices.begin(),indices.begin()+count,[&](uint32_t i){return i<vertices;}))return -1;
    std::array<double,3> lo={INFINITY,INFINITY,INFINITY},hi={-INFINITY,-INFINITY,-INFINITY};
    for(uint32_t i=0;i<vertices;i++)for(int a=0;a<3;a++){lo[a]=std::min(lo[a],input[size_t(i)*8+a]);hi[a]=std::max(hi[a],input[size_t(i)*8+a]);}
    std::unordered_map<Key,uint32_t,Hash> clusters;clusters.reserve(vertices);
    std::vector<std::array<double,8>> sums;std::vector<uint32_t> weights,remap(vertices);
    for(uint32_t i=0;i<vertices;i++){
      const double *p=&input[size_t(i)*8];Key key{};
      for(int a=0;a<3;a++)key[a]=std::clamp(int32_t(std::floor((p[a]-lo[a])/std::max(1e-12,hi[a]-lo[a])*grid)),0,int32_t(grid-1));
      for(int a=3;a<6;a++)key[a]=int32_t(std::floor(std::clamp(p[a],-1.0,1.0)*2+.5));
      for(int a=6;a<8;a++)key[a]=int32_t(std::floor(std::clamp(p[a],-1000000.0,1000000.0)*4));
      auto result=clusters.emplace(key,uint32_t(sums.size()));uint32_t group=result.first->second;
      if(result.second){sums.push_back({});weights.push_back(0);}weights[group]++;remap[i]=group;
      for(int a=0;a<8;a++)sums[group][a]+=p[a];
    }
    output.resize(sums.size()*8);
    for(size_t i=0;i<sums.size();i++){
      double length=std::hypot(sums[i][3],std::hypot(sums[i][4],sums[i][5]));
      for(int a=0;a<8;a++)output[i*8+a]=sums[i][a]/(a>=3&&a<6?std::max(1e-12,length):double(weights[i]));
    }
    outputIndices.clear();outputIndices.reserve(count);
    std::unordered_set<std::array<uint32_t,3>,FaceHash> faces;
    for(uint32_t i=0;i<count;i+=3){
      std::array<uint32_t,3> face={remap[indices[i]],remap[indices[i+1]],remap[indices[i+2]]};
      if(face[0]==face[1]||face[1]==face[2]||face[0]==face[2])continue;
      double oldCross[3],newCross[3],e[3],f[3],u[3],v[3];
      for(int a=0;a<3;a++){e[a]=input[size_t(indices[i+1])*8+a]-input[size_t(indices[i])*8+a];f[a]=input[size_t(indices[i+2])*8+a]-input[size_t(indices[i])*8+a];u[a]=double(output[size_t(face[1])*8+a])-output[size_t(face[0])*8+a];v[a]=double(output[size_t(face[2])*8+a])-output[size_t(face[0])*8+a];}
      for(int a=0;a<3;a++){int b=(a+1)%3,c=(a+2)%3;oldCross[a]=e[b]*f[c]-e[c]*f[b];newCross[a]=u[b]*v[c]-u[c]*v[b];}
      if(oldCross[0]*newCross[0]+oldCross[1]*newCross[1]+oldCross[2]*newCross[2]<=1e-20)continue;
      auto sorted=face;std::sort(sorted.begin(),sorted.end());if(!faces.insert(sorted).second)continue;
      outputIndices.insert(outputIndices.end(),face.begin(),face.end());
    }
    return int32_t(outputIndices.size());
  }
};
EMSCRIPTEN_BINDINGS(arkglide_geometry){emscripten::class_<GeometryBatch>("GeometryBatch").constructor<>()
  .function("reserve",&GeometryBatch::reserve).function("inputView",&GeometryBatch::inputView)
  .function("indexView",&GeometryBatch::indexView).function("outputView",&GeometryBatch::outputView)
  .function("outputIndexView",&GeometryBatch::outputIndexView).function("simplify",&GeometryBatch::simplify);}
