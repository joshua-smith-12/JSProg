const fs = require('fs');
const readline = require('readline-sync');
const { conditionalJumpOps } = require('./jsprog/loader/utils.js');

const mem = new WebAssembly.Memory({initial: 1});
  
const eax = new WebAssembly.Global({ value: "i32", mutable: true }, 0);
const ebx = new WebAssembly.Global({ value: "i32", mutable: true }, 0);
const ecx = new WebAssembly.Global({ value: "i32", mutable: true }, 0);
const edx = new WebAssembly.Global({ value: "i32", mutable: true }, 0);
const esi = new WebAssembly.Global({ value: "i32", mutable: true }, 0);
const edi = new WebAssembly.Global({ value: "i32", mutable: true }, 0);
const esp = new WebAssembly.Global({ value: "i32", mutable: true }, 0);
const ebp = new WebAssembly.Global({ value: "i32", mutable: true }, 0);
  
const link = new WebAssembly.Global({ value: "i32", mutable: true }, 0);
const t1 = new WebAssembly.Global({ value: "i32", mutable: true }, 0);
const t2 = new WebAssembly.Global({ value: "i32", mutable: true }, 0);
  
const cf = new WebAssembly.Global({ value: "i32", mutable: true }, 0);
const of_ = new WebAssembly.Global({ value: "i32", mutable: true }, 0);
const zf = new WebAssembly.Global({ value: "i32", mutable: true }, 0);
const sf = new WebAssembly.Global({ value: "i32", mutable: true }, 0);
const pf = new WebAssembly.Global({ value: "i32", mutable: true }, 0);
const af = new WebAssembly.Global({ value: "i32", mutable: true }, 0);

function debugHandler(chunkDetail, showAddr = true) {
  const instruction = chunkDetail.instructions[t1.value];
  const decoded = decodeInstruction(instruction);
  if (showAddr) console.log("0x" + instruction.virtualAddress.toString(16).toUpperCase() + ": " + decoded);
  while (true) {
    const response = readline.question("> ");
    if (response === "" || response === "continue") {
      break;
    } else if (response === "show reg") {
      console.log("EAX        EBX        ECX        EDX");
      console.log("0x" + eax.value.toString(16).toUpperCase().padStart(8, '0') + " 0x" + ebx.value.toString(16).toUpperCase().padStart(8, '0') + " 0x" + ecx.value.toString(16).toUpperCase().padStart(8, '0') + " 0x" + edx.value.toString(16).toUpperCase().padStart(8, '0'));
      
      console.log("ESI        EDI        EBP        ESP");
      console.log("0x" + esi.value.toString(16).toUpperCase().padStart(8, '0') + " 0x" + edi.value.toString(16).toUpperCase().padStart(8, '0') + " 0x" + ebp.value.toString(16).toUpperCase().padStart(8, '0') + " 0x" + esp.value.toString(16).toUpperCase().padStart(8, '0'));
    } else if (response === "show flags") {
      console.log("CF   OF   SF   ZF   PF   AF");
      console.log("0x" + cf.value.toString(16).toUpperCase().padStart(2, '0') + " 0x" + of_.value.toString(16).toUpperCase().padStart(2, '0') + " 0x" + sf.value.toString(16).toUpperCase().padStart(2, '0') + " 0x" + zf.value.toString(16).toUpperCase().padStart(2, '0') + " 0x" + pf.value.toString(16).toUpperCase().padStart(2, '0') + " 0x" + af.value.toString(16).toUpperCase().padStart(2, '0'));
    } else if (response === "show sys") {
    } else {
    } 
  }
  if (showAddr) console.log("Resuming execution from 0x" + instruction.virtualAddress.toString(16).toUpperCase());
} 

function decodeInstruction(instruction) {
  switch (instruction.mnemonic) {
    case "JMP": {
      const destinationChunk = instruction.operandSet[1].val;
      const destinationInstr = instruction.operandSet[2].val;
      if (destinationChunk === -1) return "JMP this@" + destinationInstr;
      else return "JMP chunk" + destinationChunk + "@" + destinationInstr;
    }
    default: return instruction.mnemonic; 
  }
}

function listImports(chunk) {
  const importList = [];
  for (const instruction of chunk.instructions) { 
    if ((instruction.mnemonic === "JMP" || instruction.mnemonic === "CALL" || conditionalJumpOps.includes(instruction.mnemonic)) && instruction.operandSet[0].type !== 'reg' && instruction.operandSet[1].val !== -1 && !importList.includes(`chunk${instruction.operandSet[1].val}::defaultExport`)) {
      importList.push(`chunk${instruction.operandSet[1].val}::defaultExport`);
    } else if (instruction.mnemonic === "EXTERN" && !importList.includes(instruction.operandSet[0].val)) {
      importList.push(instruction.operandSet[0].val);
    }
  }
  return importList;
}

function runChunk(module, version, chunkId) {
  const chunkDetail = JSON.parse(fs.readFileSync(`./chunks/${module}@${version}/chunks.${chunkId}.json`));
  
  const importData = {
    js: { mem },
    registers: { eax, ebx, ecx, edx, esi, edi, esp, ebp, link, t1, t2, cf, zf, sf, pf, af, of: of_ },
    system: {
      readSegment: () => { return; }, 
      writeSegment: () => { return; },
      debugger: () => {
        debugHandler(chunkDetail);
      }
    }
  };
  
  const importList = listImports(chunkDetail);
  for (const imp of importList) {
    const impModule = imp.split("::")[0];
    const name = imp.split("::")[1];
    importData[impModule] = importData[impModule] || {};
    importData[impModule][name] = () => {
      console.log("Waiting to invoke function " + imp);
      debugHandler(chunkDetail, false);
      if (impModule.startsWith("chunk")) {
        const nextChunkId = impModule.replace("chunk", "");
        runChunk(module, version, nextChunkId);
      } else {
        console.log("Library function " + imp + " has no definition.");
      }
    };
  }
  
  const chunkData = fs.readFileSync(`./chunks/${module}@${version}/chunks.${chunkId}.wasm`);
  
  WebAssembly.instantiate(chunkData, importData)
  .then((result) => result.instance.exports.defaultExport());
}

async function doDebug() {
  const module = readline.question("What module should I run? ");
  const version = readline.question("What is the version of the module? ");
    
  runChunk(module, version, 0);
}

doDebug();
