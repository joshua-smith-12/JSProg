const fs = require('fs').promises;
const readline = require('readline-sync');

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

function debugHandler() {
  const response = readline.question("> ");
  if (response === "show reg") {
    console.log("EAX        EBX        ECX        EDX");
    console.log("0x" + eax.value.toString(16).toUpperCase() + " 0x" + ebx.value.toString(16).toUpperCase() + " 0x" + ecx.value.toString(16).toUpperCase() + " 0x" + edx.value.toString(16).toUpperCase());
    
    console.log("ESI        EDI        EBP        ESP");
    console.log("0x" + esi.value.toString(16).toUpperCase() + " 0x" + edi.value.toString(16).toUpperCase() + " 0x" + ebp.value.toString(16).toUpperCase() + " 0x" + esp.value.toString(16).toUpperCase());
  } else if (response === "show flags") {
  } else if (response === "show sys") {
  } else {
  } 
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

async function doDebug() {
  const module = readline.question("What module should I run? ");
  const version = readline.question("What is the version of the module? ");
    
  const chunkDetail = JSON.parse(await fs.readFile(`./chunks/${module}@${version}/chunks.0.json`));
  
  const importData = {
    js: { mem },
    registers: { eax, ebx, ecx, edx, esi, edi, esp, ebp, link, t1, t2, cf, zf, sf, pf, af, of: of_ },
    system: {
      readSegment: () => { return; }, 
      writeSegment: () => { return; },
      debugger: () => {
        const instruction = chunkDetail.instructions[t1.value];
        const decoded = decodeInstruction(instruction);
        console.log("0x" + instruction.virtualAddress.toString(16).toUpperCase() + ": " + decoded);
        debugHandler();
      }
    }
  };
  const importList = listImports(chunkDetail);
  for (const imp of importList) {
    const module = imp.split("::")[0];
    const name = imp.split("::")[1];
    importData[module] = importData[module] || {};
    importData[module][name] = () => {
      console.log("Invoked function " + imp);
      debugHandler();
    };
  }
  
  const chunkData = await fs.readFile(`./chunks/${module}@${version}/chunks.0.wasm`);
  
  const instance = await WebAssembly.instantiate(chunkData, importData);
  instance.instance.exports.defaultExport();
}

doDebug();
