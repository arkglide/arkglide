// Offline diffuse-light baking. Geometry and samples cross the WASM boundary in
// batches; BVH traversal and all shadow/AO rays stay inside the native module.
#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <emscripten/bind.h>
#include <limits>
#include <numeric>
#include <vector>

class LightBakeBatch {
  struct Node { double lo[3], hi[3]; uint32_t start, count, left, right; };
  std::vector<double> triangles, samples, lights;
  std::vector<float> output;
  std::vector<uint32_t> order;
  std::vector<Node> tree;
  uint32_t triangleCount = 0;
  uint64_t rays = 0;
  uint32_t build(uint32_t start, uint32_t count) {
    Node n{}; n.start=start; n.count=count;
    for(int a=0;a<3;a++){n.lo[a]=INFINITY;n.hi[a]=-INFINITY;}
    for(uint32_t i=start;i<start+count;i++)for(int v=0;v<3;v++)for(int a=0;a<3;a++){
      double p=triangles[size_t(order[i])*9+v*3+a]; n.lo[a]=std::min(n.lo[a],p);n.hi[a]=std::max(n.hi[a],p);
    }
    uint32_t index=tree.size();tree.push_back(n);
    if(count>8){
      int axis=0;for(int a=1;a<3;a++)if(n.hi[a]-n.lo[a]>n.hi[axis]-n.lo[axis])axis=a;
      uint32_t middle=start+count/2;
      auto center=[&](uint32_t t){const double *p=&triangles[size_t(t)*9];return p[axis]+p[axis+3]+p[axis+6];};
      std::nth_element(order.begin()+start,order.begin()+middle,order.begin()+start+count,[&](uint32_t a,uint32_t b){double x=center(a),y=center(b);return x==y?a<b:x<y;});
      uint32_t left=build(start,middle-start),right=build(middle,start+count-middle);
      tree[index].count=0;tree[index].left=left;tree[index].right=right;
    }
    return index;
  }
  bool box(const Node &n,const double *o,const double *d,double limit) const {
    double near=0,far=limit;
    for(int a=0;a<3;a++){
      if(std::abs(d[a])<1e-15){if(o[a]<n.lo[a]||o[a]>n.hi[a])return false;continue;}
      double x=(n.lo[a]-o[a])/d[a],y=(n.hi[a]-o[a])/d[a];if(x>y)std::swap(x,y);
      near=std::max(near,x);far=std::min(far,y);if(near>far)return false;
    }return true;
  }
  bool hit(const double *o,const double *d,double limit){
    rays++;if(tree.empty())return false;
    std::array<uint32_t,64> stack{};uint32_t top=1;
    while(top){const Node &n=tree[stack[--top]];if(!box(n,o,d,limit))continue;
      if(!n.count){stack[top++]=n.left;stack[top++]=n.right;continue;}
      for(uint32_t i=n.start;i<n.start+n.count;i++){
        const double *p=&triangles[size_t(order[i])*9];
        double e[3],f[3],h[3],s[3],q[3];for(int a=0;a<3;a++){e[a]=p[a+3]-p[a];f[a]=p[a+6]-p[a];s[a]=o[a]-p[a];}
        h[0]=d[1]*f[2]-d[2]*f[1];h[1]=d[2]*f[0]-d[0]*f[2];h[2]=d[0]*f[1]-d[1]*f[0];
        double det=e[0]*h[0]+e[1]*h[1]+e[2]*h[2];if(std::abs(det)<1e-12)continue;
        double inv=1/det,u=(s[0]*h[0]+s[1]*h[1]+s[2]*h[2])*inv;if(u<0||u>1)continue;
        q[0]=s[1]*e[2]-s[2]*e[1];q[1]=s[2]*e[0]-s[0]*e[2];q[2]=s[0]*e[1]-s[1]*e[0];
        double v=(d[0]*q[0]+d[1]*q[1]+d[2]*q[2])*inv;if(v<0||u+v>1)continue;
        double t=(f[0]*q[0]+f[1]*q[1]+f[2]*q[2])*inv;if(t>1e-9&&t<limit)return true;
      }
    }return false;
  }
public:
  bool reserve(uint32_t triangleCapacity,uint32_t sampleCapacity,uint32_t lightCapacity){
    if(triangleCapacity>1000000||sampleCapacity>65536||lightCapacity>256)return false;
    triangles.resize(size_t(triangleCapacity)*9);samples.resize(size_t(sampleCapacity)*6);output.resize(size_t(sampleCapacity)*3);lights.resize(size_t(lightCapacity)*10);return true;
  }
  emscripten::val triangleView(){return emscripten::val(emscripten::typed_memory_view(triangles.size(),triangles.data()));}
  emscripten::val sampleView(){return emscripten::val(emscripten::typed_memory_view(samples.size(),samples.data()));}
  emscripten::val lightView(){return emscripten::val(emscripten::typed_memory_view(lights.size(),lights.data()));}
  emscripten::val outputView(){return emscripten::val(emscripten::typed_memory_view(output.size(),output.data()));}
  bool prepare(uint32_t count){
    if(count>triangles.size()/9||!std::all_of(triangles.begin(),triangles.begin()+size_t(count)*9,[](double n){return std::isfinite(n);}))return false;
    triangleCount=count;order.resize(count);std::iota(order.begin(),order.end(),0);tree.clear();tree.reserve(count*2);if(count)build(0,count);rays=0;return true;
  }
  bool bake(uint32_t count,uint32_t lightCount,uint32_t aoSamples,double aoDistance,double bias){
    if(count>samples.size()/6||lightCount>lights.size()/10||aoSamples>128||!std::isfinite(aoDistance)||aoDistance<=0||!std::isfinite(bias)||bias<=0)return false;
    if(!std::all_of(samples.begin(),samples.begin()+size_t(count)*6,[](double n){return std::isfinite(n);})||!std::all_of(lights.begin(),lights.begin()+size_t(lightCount)*10,[](double n){return std::isfinite(n);}))return false;
    for(uint32_t i=0;i<count;i++){
      const double *s=&samples[size_t(i)*6];double n[3]={s[3],s[4],s[5]},o[3],rgb[3]={},ambient[3]={};
      double length=std::hypot(n[0],std::hypot(n[1],n[2]));if(length<1e-12)return false;
      for(int a=0;a<3;a++){n[a]/=length;o[a]=s[a]+n[a]*bias;}
      for(uint32_t j=0;j<lightCount;j++){
        const double *l=&lights[size_t(j)*10];double d[3],limit=1e12,attenuation=1;
        if(l[0]==2){double len=std::hypot(l[1],std::hypot(l[2],l[3]));double t=len>0?std::clamp(.5+.5*(n[0]*l[1]+n[1]*l[2]+n[2]*l[3])/len,0.0,1.0):.5;for(int a=0;a<3;a++)ambient[a]+=l[4+a]*t+l[7+a]*(1-t);continue;}
        for(int a=0;a<3;a++)d[a]=l[0]==1?l[1+a]-o[a]:-l[1+a];
        double len=std::hypot(d[0],std::hypot(d[1],d[2]));if(len<1e-12)continue;
        if(l[0]==1){limit=len;attenuation=1/std::max(len*len,1e-4);}for(int a=0;a<3;a++)d[a]/=len;
        double cosine=std::max(0.0,n[0]*d[0]+n[1]*d[1]+n[2]*d[2]);if(cosine<=0||hit(o,d,limit))continue;
        for(int a=0;a<3;a++)rgb[a]+=l[4+a]*cosine*attenuation;
      }
      uint32_t visible=0;
      if(aoSamples){
        double tangent[3]={std::abs(n[1])<.99?n[2]:0, std::abs(n[1])<.99?0:-n[2], std::abs(n[1])<.99?-n[0]:n[1]};
        double len=std::hypot(tangent[0],std::hypot(tangent[1],tangent[2]));for(auto &v:tangent)v/=len;
        double bitangent[3]={n[1]*tangent[2]-n[2]*tangent[1],n[2]*tangent[0]-n[0]*tangent[2],n[0]*tangent[1]-n[1]*tangent[0]};
        for(uint32_t j=0;j<aoSamples;j++){double radius=std::sqrt((j+.5)/aoSamples),angle=j*2.399963229728653;double x=radius*std::cos(angle),y=radius*std::sin(angle),z=std::sqrt(1-radius*radius),d[3];for(int a=0;a<3;a++)d[a]=tangent[a]*x+bitangent[a]*y+n[a]*z;if(!hit(o,d,aoDistance))visible++;}
      }
      double ao=aoSamples?double(visible)/aoSamples:1;for(int a=0;a<3;a++)output[size_t(i)*3+a]=std::clamp(rgb[a]+ambient[a]*ao,0.0,1000000.0);
    }return true;
  }
  double rayCount() const{return double(rays);}
};
EMSCRIPTEN_BINDINGS(arkglide_light_bake){
  emscripten::class_<LightBakeBatch>("LightBakeBatch").constructor<>()
    .function("reserve",&LightBakeBatch::reserve).function("triangleView",&LightBakeBatch::triangleView)
    .function("sampleView",&LightBakeBatch::sampleView).function("lightView",&LightBakeBatch::lightView)
    .function("outputView",&LightBakeBatch::outputView).function("prepare",&LightBakeBatch::prepare)
    .function("bake",&LightBakeBatch::bake).function("rayCount",&LightBakeBatch::rayCount);
}
