import { FormControlLabel, MenuItem, Stack, Switch, TextField, Typography } from '@mui/material';
import type { MaterialAsset, TextureAsset } from '../../types/content';
import '../../engine/rendering-config.js';
import {ScalarField} from '../ScalarField';

export function AdvancedMaterialEditor({material:m,textures,onChange}:{material:MaterialAsset;textures:TextureAsset[];onChange:(patch:Partial<MaterialAsset>)=>unknown}){
 const c=(globalThis as any).ArkGlideRenderingConfig.material(m);
 const change=(section:'clearCoat'|'sheen'|'anisotropy'|'transmission'|'detail',patch:object)=>void onChange({[section]:{...c[section],...patch}});
 const scalar=(label:string,value:number,commit:(value:number)=>void,min:number,max:number,step=.1)=><ScalarField key={m.id+label} label={label} size="small" value={value} inputProps={{min,max,step}} onValueChange={commit} />;
 const number=(section:'clearCoat'|'sheen'|'anisotropy'|'transmission'|'detail',field:string,label:string,min:number,max:number,step=.1)=>scalar(label,c[section][field],value=>change(section,{[field]:value}),min,max,step);
 const texture=(field:keyof MaterialAsset,label:string)=><TextField key={field} label={label} select size="small" value={m[field] || ''} onChange={e=>void onChange({[field]:e.target.value||undefined})}><MenuItem value="">无贴图</MenuItem>{textures.filter(t=>['image/png','image/jpeg','image/webp','image/ktx2'].includes(t.mime)&&(!t.ktx2||['sheenTextureId'].includes(field)||t.ktx2.colorSpace==='linear')).map(t=><MenuItem key={t.id} value={t.id}>{t.name}</MenuItem>)}</TextField>;
 const toggle=(section:'clearCoat'|'sheen'|'anisotropy'|'transmission'|'detail',label:string)=><FormControlLabel label={label} control={<Switch checked={c[section].enabled} onChange={e=>change(section,{enabled:e.target.checked})} />} />;
 return <Stack spacing={1} data-testid="advanced-material">
  {m.lightmapTextureId&&<FormControlLabel label="烘焙直射光（关闭实时直射）" control={<Switch checked={!!m.bakedDirectLighting} onChange={e=>void onChange({bakedDirectLighting:e.target.checked})}/>}/>}
  <Typography variant="subtitle2">透明、法线与 UV</Typography>
  <TextField label="透明模式" select size="small" value={c.alphaMode} onChange={e=>void onChange({alphaMode:e.target.value as MaterialAsset['alphaMode']})}>{[['auto','自动（按透明度）'],['opaque','不透明'],['mask','透明裁切'],['blend','透明混合']].map(([v,n])=><MenuItem key={v} value={v}>{n}</MenuItem>)}</TextField>
  <Stack direction="row" spacing={1}>{scalar('裁切阈值',c.alphaCutoff,alphaCutoff=>void onChange({alphaCutoff}),0,1,.05)}{scalar('法线强度',c.normalScale,normalScale=>void onChange({normalScale}),0,10)}</Stack>
  <Stack direction="row" spacing={1}>{(['u','v'] as const).map(axis=>scalar('UV 偏移 '+axis.toUpperCase(),c.uvOffset[axis],value=>void onChange({uvOffset:{...c.uvOffset,[axis]:value}}),-10000,10000))}</Stack>
  {scalar('UV 旋转（弧度）',c.uvRotation,uvRotation=>void onChange({uvRotation}),-Math.PI*2,Math.PI*2)}
  {toggle('clearCoat','清漆层')}
  {c.clearCoat.enabled&&<>
   <Stack direction="row" spacing={1}>{number('clearCoat','intensity','清漆强度',0,1)}{number('clearCoat','roughness','清漆粗糙度',0,1)}</Stack>
   {texture('clearCoatTextureId','清漆贴图（R 强度 / G 粗糙度）')}{texture('clearCoatNormalTextureId','清漆法线贴图')}{number('clearCoat','normalScale','清漆法线强度',0,10)}
  </>}
  {toggle('sheen','织物光泽')}
  {c.sheen.enabled&&<>
   <TextField label="光泽颜色" type="color" size="small" value={c.sheen.color} onChange={e=>change('sheen',{color:e.target.value})} />
   <Stack direction="row" spacing={1}>{number('sheen','intensity','光泽强度',0,1)}{number('sheen','roughness','光泽粗糙度',0,1)}</Stack>
   {texture('sheenTextureId','光泽贴图（RGB 颜色 / A 粗糙度）')}
  </>}
  {toggle('anisotropy','各向异性')}
  {c.anisotropy.enabled&&<>
   <Stack direction="row" spacing={1}>{number('anisotropy','intensity','各向异性强度',0,1)}{number('anisotropy','rotation','纹理方向（弧度）',-Math.PI*2,Math.PI*2)}</Stack>
   {texture('anisotropyTextureId','各向异性贴图（RG 方向 / B 强度）')}
  </>}
  {toggle('transmission','环境透射与厚度吸收')}
  {c.transmission.enabled&&<>
   <Stack direction="row" spacing={1}>{number('transmission','intensity','透射强度',0,1)}{number('transmission','ior','折射率 IOR',1,3,.05)}{number('transmission','thickness','材质厚度',0,1000)}</Stack>
   <TextField label="透射吸收颜色" type="color" size="small" value={c.transmission.tintColor} onChange={e=>change('transmission',{tintColor:e.target.value})} />
   {number('transmission','tintDistance','吸收距离',.001,100000)}
   {texture('transmissionTextureId','透射遮罩（R 通道）')}{texture('thicknessTextureId','厚度贴图（G 通道）')}
   <Typography variant="caption">透射采样项目环境贴图。透明混合可透出后方几何，但不会折射后方物体。</Typography>
  </>}
  {toggle('detail','细节贴图')}
  {c.detail.enabled&&<>
   {texture('detailTextureId','细节贴图（R 明暗 / AG 法线 / B 粗糙度）')}{number('detail','scale','细节平铺倍数',.01,1000)}
   <Stack direction="row" spacing={1}>{number('detail','diffuse','细节明暗强度',0,5)}{number('detail','normal','细节法线强度',0,5)}{number('detail','roughness','细节粗糙度强度',0,5)}</Stack>
  </>}
 </Stack>;
}
