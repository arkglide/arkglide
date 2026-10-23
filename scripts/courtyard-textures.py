"""Prepare checked, local PBR maps. Requires Pillow; no Blender or runtime CDN.

Invoked by prepare-courtyard-assets.mjs. Source URLs and SHA-256 digests are
locked in examples/chinese-courtyard-assets/sources.lock.json.
"""
from pathlib import Path
from PIL import Image
import json, math, struct, io

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / 'work/courtyard/raw/assets/ph'
OUT = ROOT / 'examples/chinese-courtyard-assets'
(OUT / 'textures').mkdir(parents=True, exist_ok=True)
(OUT / 'models').mkdir(parents=True, exist_ok=True)

def convert(src, name, albedo=False, transform=None):
    image = Image.open(src).convert('RGB')
    if transform:
        image = transform(image)
    # Preserve all source normal/ARM values; colour maps use high-quality WebP.
    image.save(OUT / 'textures' / (name + '.webp'), 'WEBP', lossless=not albedo,
               quality=92, method=6, exact=True)

for name in ['weathered_planks', 'japanese_stone_wall', 'ceramic_roof_01', 'rock_boulder_dry']:
    for role, source in [('albedo', 'diffuse'), ('normal', 'nor_gl'), ('arm', 'arm')]:
        if name == 'rock_boulder_dry' and role != 'normal':
            continue
        change = None
        if name == 'ceramic_roof_01' and role == 'albedo':
            # Retain scanned wear and lichen, recolour red terracotta to qingwa.
            def grey_tiles(image):
                return Image.merge('RGB', tuple(image.convert('L').point(lambda x, k=k: int(x*k)) for k in [.71, .80, .81]))
            change = grey_tiles
        convert(RAW / 'textures' / name / (source + '_1k.jpg'), name + '-' + role, role == 'albedo', change)

rock = RAW / 'models/rock_moss_set_01'
convert(rock/'textures/rock_moss_set_01_diff_1k.jpg', 'moss-rock-albedo', True)
convert(rock/'textures/rock_moss_set_01_nor_gl_1k.jpg', 'moss-rock-normal')
rough = Image.open(rock/'textures/rock_moss_set_01_rough_1k.jpg').convert('RGB').getchannel('G')
Image.merge('RGB', (Image.new('L', rough.size, 255), rough, Image.new('L', rough.size, 0))).save(OUT/'textures/moss-rock-arm.webp', 'WEBP', lossless=True, method=6)

# Supplemental water normal: periodic, tangent-space waves, not an external scan.
size = 256
water = Image.new('RGB', (size, size))
for y in range(size):
    for x in range(size):
        u, v = 2*math.pi*x/size, 2*math.pi*y/size
        nx = .10*math.cos(3*u+2*v)+.04*math.cos(7*u-4*v)
        ny = .07*math.cos(2*u+3*v)-.03*math.sin(5*u-2*v)
        length = math.sqrt(nx*nx+ny*ny+1)
        water.putpixel((x,y), tuple(round((c/length*.5+.5)*255) for c in (nx,ny,1)))
water.save(OUT/'textures/water-normal.webp', 'WEBP', lossless=True, method=6)

# Extract the original six scanned meshes, without copying the atlas six times.
# The scene binds one managed PBR material to every rock, sharing all three maps.
g = json.loads((rock/'rock_moss_set_01_1k.gltf').read_text())
binary = (rock/g['buffers'][0]['uri']).read_bytes()
def accessor_data(index):
    a = g['accessors'][index]; b = g['bufferViews'][a['bufferView']]
    count = a['count'] * {'SCALAR':1, 'VEC2':2, 'VEC3':3, 'VEC4':4}[a['type']]
    start = b.get('byteOffset',0)+a.get('byteOffset',0)
    width = {5123:2,5125:4,5126:4}[a['componentType']]
    return bytearray(binary[start:start+count*width]), a

for i, mesh in enumerate(g['meshes']):
    doc = {'asset':{'version':'2.0','generator':'ArkGlide source-preserving rock extraction'}, 'scene':0,
           'scenes':[{'nodes':[0]}], 'nodes':[{'mesh':0,'name':g['nodes'][i]['name']}],
           'meshes':[{'primitives':[]}], 'accessors':[], 'bufferViews':[], 'buffers':[]}
    payload = bytearray()
    def add(index, flip_v=False):
        raw, old = accessor_data(index)
        if flip_v:
            # The editable material library uploads with invertY=true; glTF's
            # original material uses invertY=false. Keep the scan's UV alignment.
            for off in range(4,len(raw),8): struct.pack_into('<f',raw,off,1-struct.unpack_from('<f',raw,off)[0])
        offset = len(payload); payload.extend(raw)
        while len(payload)%4:payload.append(0)
        v = len(doc['bufferViews']);doc['bufferViews'].append({'buffer':0,'byteOffset':offset,'byteLength':len(raw)})
        a = {k:val for k,val in old.items() if k not in ('bufferView','byteOffset','min','max')}
        if 'min' in old and not flip_v:a.update(min=old['min'],max=old['max'])
        a['bufferView']=v;doc['accessors'].append(a);return len(doc['accessors'])-1
    for primitive in mesh['primitives']:
        doc['meshes'][0]['primitives'].append({'attributes':{key:add(value,key=='TEXCOORD_0') for key,value in primitive['attributes'].items()},'indices':add(primitive['indices'])})
    doc['buffers']=[{'byteLength':len(payload)}]
    encoded=json.dumps(doc,separators=(',',':')).encode();encoded+=b' '*((-len(encoded))%4)
    glb=struct.pack('<III',0x46546c67,2,28+len(encoded)+len(payload))+struct.pack('<II',len(encoded),0x4e4f534a)+encoded+struct.pack('<II',len(payload),0x004e4942)+payload
    (OUT/'models'/('moss-rock-'+str(i+1)+'.glb')).write_bytes(glb)
# Artist-authored bamboo: keep branch, leaf and culm PBR sets shared by all
# patches. Embedded image sizes are <=1K; preserve source alpha and normal data.
bamboo_bytes = (ROOT/'work/courtyard/raw/sketchfab/free-bamboo-set.glb').read_bytes()
json_size = struct.unpack_from('<I', bamboo_bytes, 12)[0]
bamboo = json.loads(bamboo_bytes[20:20+json_size])
bamboo_bin = bamboo_bytes[28+json_size:]
for i, name in enumerate(['bamboo-branch', 'bamboo-leaf', 'bamboo-stem']):
    for role, offset in [('albedo',0),('arm',1),('normal',2)]:
        view = bamboo['bufferViews'][bamboo['images'][i*3+offset]['bufferView']]
        start = view.get('byteOffset',0)
        image = Image.open(io.BytesIO(bamboo_bin[start:start+view['byteLength']]))
        image = image.convert('RGBA' if role=='albedo' and i==1 else 'RGB')
        image.save(OUT/'textures'/f'{name}-{role}.webp','WEBP',lossless=role!='albedo',quality=92,method=6,exact=True)

for folder,name in [('screens','chinese_screen_panels'),('chair','chinese_armchair')]:
    for role,source in [('albedo','diff'),('normal','nor_gl'),('arm','arm')]:
        convert(ROOT/'work/courtyard/raw'/folder/'textures'/f'{name}_{source}_1k.jpg',name+'-'+role,role=='albedo')

refinement = ROOT/'work/courtyard/raw/refinement'
fern = refinement/'fern/textures'
leaf = Image.open(fern/'fern_02_diff_1k.jpg').convert('RGBA')
mask = Image.open(fern/'fern_02_alpha_2k.png').convert('I').point(lambda x:x/257).convert('L')
leaf.putalpha(mask.resize(leaf.size, Image.Resampling.LANCZOS))
leaf.save(OUT/'textures/fern-albedo.webp','WEBP',quality=92,method=6,exact=True)
for role,source in [('normal','nor_gl'),('arm','arm')]:
    convert(fern/f'fern_02_{source}_1k.jpg','fern-'+role)

# ambientCG Moss002 is retained as a complete 1K PBR surface. Do not bake
# directional lighting into it or replace its normal with a flat colour.
for role,source in [('albedo','garden-moss.jpg'),('normal','garden-moss-normal.jpg')]:
    im=Image.open(refinement/source).convert('RGB').resize((1024,1024),Image.Resampling.LANCZOS)
    im.save(OUT/'textures'/('garden-moss-'+role+'.webp'),'WEBP',lossless=role!='albedo',quality=92,method=6)
rough=Image.open(refinement/'garden-moss-rough.jpg').convert('L').resize((1024,1024),Image.Resampling.LANCZOS)
Image.merge('RGB',(Image.new('L',rough.size,255),rough,Image.new('L',rough.size,0))).save(OUT/'textures/garden-moss-arm.webp','WEBP',lossless=True,method=6)
for obsolete in ['bamboo-leaves.png','bamboo-culm.png','forest_leaves_02-albedo.webp','forest_leaves_02-normal.webp','forest_leaves_02-arm.webp','rock_boulder_dry-albedo.webp','rock_boulder_dry-arm.webp']:
    (OUT/'textures'/obsolete).unlink(missing_ok=True)
print('Prepared full PBR maps, real bamboo/fern masks, Chinese joinery, moss and scanned rocks.')
