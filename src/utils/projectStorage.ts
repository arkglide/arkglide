import { get, set, keys } from 'idb-keyval';
import type { SceneNode } from '../store/useEditorStore';
import type { ProjectSettings } from '../types/project';

export interface StoredProject {
  projectId: string;
  name: string;
  version: string;
  updatedAt: number;
  scene: { nodes: SceneNode[] };
  scripts: Record<string, string>;
  activeFileId: string;
  modelRefs: { assetId: string; fileName: string }[];
  settings?: ProjectSettings;
}
let database: Promise<IDBDatabase> | undefined;
function openDatabase(): Promise<IDBDatabase> {
  if (database) return database;
  database = new Promise((resolve, reject) => {
    function open(version?: number) {
      const request = indexedDB.open('arkglide-db', version);
      request.onupgradeneeded = () => {
        for (const name of ['projects', 'models', 'recoveries', 'recoveryInfo']) {
          if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name);
        }
      };
      request.onerror = () => { database = undefined; reject(request.error); };
      request.onblocked = () => { database = undefined; reject(new Error('请关闭其他 ArkGlide 标签页后重试保存')); };
      request.onsuccess = () => {
        const db = request.result;
        if (['projects','models','recoveries','recoveryInfo'].some(name=>!db.objectStoreNames.contains(name))) {
          const nextVersion = db.version + 1;
          db.close(); open(nextVersion); return;
        }
        db.onversionchange = () => { db.close(); database = undefined; };
        resolve(db);
      };
    }
    open();
  });
  return database;
}
function store(name: string) {
  return <T>(mode: IDBTransactionMode, callback: (store: IDBObjectStore) => T | PromiseLike<T>): Promise<T> =>
    openDatabase().then(db => callback(db.transaction(name, mode).objectStore(name)));
}
const projectStore = store('projects'), modelStore = store('models');
const modelKey = (projectId: string, assetId: string) => projectId + '/' + assetId;
function complete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = transaction.onabort = () => reject(transaction.error || new Error('数据库事务已取消'));
  });
}
export async function saveProject(projectId: string, data: StoredProject): Promise<void> {
  await set(projectId, data, projectStore);
}
/** Metadata and model binaries commit together; projects cannot overwrite each other's models. */
export async function saveProjectSnapshot(data: StoredProject, buffers: Map<string, ArrayBuffer>): Promise<void> {
  const db = await openDatabase();
  const tx = db.transaction(['projects', 'models'], 'readwrite');
  const finished = complete(tx);
  tx.objectStore('projects').put(data, data.projectId);
  for (const ref of data.modelRefs) {
    const buffer = buffers.get(ref.assetId);
    if (buffer) tx.objectStore('models').put(buffer, modelKey(data.projectId, ref.assetId));
    else tx.objectStore('models').delete(modelKey(data.projectId, ref.assetId));
  }
  const liveKeys=new Set(data.modelRefs.map(ref=>modelKey(data.projectId,ref.assetId)));
  const cursor=tx.objectStore('models').openKeyCursor();
  cursor.onsuccess=()=>{const entry=cursor.result;if(!entry)return;if(String(entry.key).startsWith(data.projectId+'/')&&!liveKeys.has(String(entry.key)))tx.objectStore('models').delete(entry.key);entry.continue();};
  await finished;
}
export function loadProject(projectId: string): Promise<StoredProject | undefined> { return get(projectId, projectStore); }
export async function listProjects(): Promise<StoredProject[]> {
  const projects = await Promise.all((await keys<string>(projectStore)).map(loadProject));
  return projects.filter((p): p is StoredProject => !!p).sort((a, b) => b.updatedAt - a.updatedAt);
}
export async function deleteProject(projectId: string): Promise<void> {
  const db = await openDatabase();
  const tx = db.transaction(['projects', 'models'], 'readwrite');
  const finished = complete(tx);
  tx.objectStore('projects').delete(projectId);
  const cursor = tx.objectStore('models').openKeyCursor();
  cursor.onsuccess = () => {
    const entry = cursor.result;
    if (!entry) return;
    if (String(entry.key).startsWith(projectId + '/')) tx.objectStore('models').delete(entry.key);
    entry.continue();
  };
  await finished;
}
export function saveModelBlob(assetId: string, buffer: ArrayBuffer): Promise<void> { return set(assetId, buffer, modelStore); }
export async function loadModelBlob(assetId: string, projectId?: string): Promise<ArrayBuffer | undefined> {
  // Keep the old unscoped keys readable when migrating existing projects.
  const scoped = projectId ? await get<ArrayBuffer>(modelKey(projectId, assetId), modelStore) : undefined;
  return scoped ?? get<ArrayBuffer>(assetId, modelStore);
}

export interface RecoverySummary {recoveryId:string;project:StoredProject;updatedAt:number;}
export interface RecoveryRecord extends RecoverySummary {
  recoveryId:string;
  project:StoredProject;
  buffers:Map<string,ArrayBuffer>;
  updatedAt:number;
}
const recoveryStore=store('recoveries'),recoveryInfoStore=store('recoveryInfo');
export async function saveRecovery(record:RecoveryRecord):Promise<void> {
  // A single structured-clone record atomically stores metadata and its model binaries.
  const db=await openDatabase(),tx=db.transaction(['recoveries','recoveryInfo'],'readwrite'),done=complete(tx);
  tx.objectStore('recoveries').put(record,record.recoveryId);
  tx.objectStore('recoveryInfo').put({recoveryId:record.recoveryId,project:record.project,updatedAt:record.updatedAt},record.recoveryId);
  await done;
  const records=await listRecoveries();
  for(const old of records.slice(20))await deleteRecovery(old.recoveryId);
}
export function loadRecovery(id:string):Promise<RecoveryRecord|undefined>{return get(id,recoveryStore);}
export async function listRecoveries():Promise<RecoverySummary[]> {
  // Recovery lists never clone all model binaries into memory.
  const records=await Promise.all((await keys<string>(recoveryInfoStore)).map(id=>get<RecoverySummary>(id,recoveryInfoStore)));
  return records.filter((r):r is RecoverySummary=>!!r).sort((a,b)=>b.updatedAt-a.updatedAt);
}
export async function deleteRecovery(id:string):Promise<void> {
  const db=await openDatabase(),tx=db.transaction(['recoveries','recoveryInfo'],'readwrite'),done=complete(tx);
  tx.objectStore('recoveries').delete(id);tx.objectStore('recoveryInfo').delete(id);await done;
}
