(function(root){
  'use strict';
  function generateUV2(B,mesh,primitive,apply=true){
    const original=mesh.getVerticesData(B.VertexBuffer.UVKind),positions=mesh.getVerticesData(B.VertexBuffer.PositionKind),normals=mesh.getVerticesData(B.VertexBuffer.NormalKind);
    if(!original||!positions||!normals)throw Error('基础几何缺少 UV 或法线');
    const uv=new Float32Array(original);
    const min=[Infinity,Infinity],max=[-Infinity,-Infinity];for(let i=0;i<original.length;i++){const a=i%2;min[a]=Math.min(min[a],original[i]);max[a]=Math.max(max[a],original[i]);}
    for(let i=0;i<uv.length/2;i++){
      if(primitive==='box'){
        if(uv.length!==48)throw Error('自定义盒体需要预先生成 UV2');
        const face=Math.floor(i/4);uv[i*2]=(face%3+.06+original[i*2]*.88)/3;uv[i*2+1]=(Math.floor(face/3)+.06+original[i*2+1]*.88)/2;
      }else if(primitive==='cylinder'){
        const y=normals[i*3+1];
        if(Math.abs(y)>.99){uv[i*2]=(y>0?.5:0)+(.06+(positions[i*3]+.5)*.88)/2;uv[i*2+1]=.5+(.06+(positions[i*3+2]+.5)*.88)/2;}
        else{uv[i*2]=.03+original[i*2]*.94;uv[i*2+1]=(.06+original[i*2+1]*.88)/2;}
      }else {for(let a=0;a<2;a++)uv[i*2+a]=.02+(original[i*2+a]-min[a])/Math.max(1e-10,max[a]-min[a])*.96;}
    }
    // Geometry may be shared with an unbaked object. UV2 ownership is local.
    if(apply){mesh.makeGeometryUnique();mesh.setVerticesData(B.VertexBuffer.UV2Kind,uv,false);}return uv;
  }
  root.ArkGlideLightingUV={generateUV2};
})(globalThis);
