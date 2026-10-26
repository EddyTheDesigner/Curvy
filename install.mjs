import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {join} from 'node:path';
if(!process.env.APPDATA)throw Error('Install dist/Curvy.jsx from EffectCraft: File → Scripts → Install ScriptUI Panel.');
const target=join(process.env.APPDATA,'EffectCraft','Scripts','ScriptUI Panels','Curvy.jsx');
const source=new URL('dist/Curvy.jsx',import.meta.url),data=await readFile(source);
try{const old=await readFile(target);if(!old.equals(data)){await mkdir(new URL('archive/',import.meta.url),{recursive:true});await writeFile(new URL('archive/Curvy-'+Date.now()+'.jsx',import.meta.url),old);}}catch(e){if(e.code!=='ENOENT')throw e;}
await mkdir(join(process.env.APPDATA,'EffectCraft','Scripts','ScriptUI Panels'),{recursive:true});
await copyFile(source,target);console.log('Installed '+target);
